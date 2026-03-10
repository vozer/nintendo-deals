"""
Scraper for ntdeals.net — fetches curated deals with Metacritic scores.
Uses cloudscraper to handle Cloudflare protection.

Usage:
    RATINGS_API_KEY=xxx python3 scripts/scrape-ntdeals.py [--pages N] [--dry-run]
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

try:
    import cloudscraper
except ImportError:
    print("Error: cloudscraper required. Install with: pip3 install cloudscraper")
    sys.exit(1)

API_KEY = os.environ.get('RATINGS_API_KEY', '')
BASE_URL = os.environ.get('DEALS_BASE_URL', 'https://nintendo-deals.vercel.app')
NTDEALS_URL = 'https://ntdeals.net/es-store/discounts'
MAX_PAGES = int(os.environ.get('NTDEALS_PAGES', '5'))

SOLR_BASE = (
    "https://searching.nintendo-europe.com/es/select?"
    "fq=type:GAME%20AND%20system_type:nintendoswitch*"
    "&rows=5&wt=json&fl=fs_id,title,title_master_s"
)


def normalize(title):
    title = str(title).lower()
    title = unicodedata.normalize('NFKD', title)
    title = title.encode('ascii', 'ignore').decode('ascii')
    title = re.sub(r'[^\w\s]', '', title)
    title = re.sub(r'\s+', ' ', title)
    return title.strip()


def search_solr(title):
    safe_title = urllib.parse.quote(title, safe='')
    url = f"{SOLR_BASE}&q={safe_title}"
    try:
        res = urllib.request.urlopen(url, timeout=10)
        data = json.loads(res.read())
        docs = data['response']['docs']
        if not docs:
            return None

        norm_target = normalize(title)

        for doc in docs:
            for field in ['title_master_s', 'title']:
                val = doc.get(field, '')
                if normalize(val) == norm_target:
                    return doc['fs_id']

        best_match = None
        best_score = 0
        for doc in docs:
            for field in ['title_master_s', 'title']:
                val = doc.get(field, '')
                norm_val = normalize(val)
                if norm_target in norm_val or norm_val in norm_target:
                    score = min(len(norm_target), len(norm_val)) / max(len(norm_target), len(norm_val))
                    if score > best_score:
                        best_score = score
                        best_match = doc['fs_id']

        if best_score >= 0.7:
            return best_match

    except Exception as e:
        print(f"    Solr search failed for '{title}': {e}")
    return None


def parse_game_items(html):
    """Extract game data from ntdeals HTML."""
    games = []

    item_re = re.compile(
        r'<div itemscope itemtype="http://schema.org/Product"'
        r' class="game-collection-item[^"]*">(.*?)'
        r'<div class="dropdown">',
        re.DOTALL,
    )

    for match in item_re.finditer(html):
        block = match.group(1)

        title_m = re.search(r'details-title">(.*?)</span>', block)
        if not title_m:
            continue
        title = title_m.group(1).strip()

        discount_m = re.search(r'item-discount">([^<]+)</span>', block)
        discount_pct = None
        if discount_m:
            try:
                discount_pct = int(discount_m.group(1).strip().replace('%', '').replace('-', ''))
            except ValueError:
                pass

        price_m = re.search(r'item-price-discount">([^<]+)</span>', block)
        price = None
        if price_m:
            try:
                price = float(price_m.group(1).strip().replace('€', '').replace(',', '.'))
            except ValueError:
                pass

        end_m = re.search(r'item-end-date">(.*?)</span>', block)
        end_text = end_m.group(1).strip() if end_m else None

        days_remaining = None
        if end_text:
            days_match = re.search(r'(\d+)\s*day', end_text)
            hours_match = re.search(r'(\d+)\s*hour', end_text)
            if days_match:
                days_remaining = int(days_match.group(1))
            elif hours_match:
                days_remaining = 0

        sku_m = re.search(r'itemprop="sku"[^>]*>(.*?)</span>', block)
        sku = sku_m.group(1).strip() if sku_m else None

        href_m = re.search(r'item-link"\s+href="([^"]+)"', block)
        href = href_m.group(1).strip() if href_m else None

        metascore_m = re.search(r'item-metascore[^>]*>\s*(\d+)\s*</div>', block)
        metacritic_score = None
        if metascore_m:
            try:
                metacritic_score = int(metascore_m.group(1))
            except ValueError:
                pass

        games.append({
            'title': title,
            'discount_pct': discount_pct,
            'price': price,
            'days_remaining': days_remaining,
            'end_text': end_text,
            'metacritic_score': metacritic_score,
            'sku': sku,
            'href': href,
        })

    return games


def compute_deal_rating(game):
    """Simple deal quality label based on discount + metacritic."""
    disc = game.get('discount_pct') or 0
    meta = game.get('metacritic_score')

    if meta and meta >= 80 and disc >= 60:
        return 'Excellent Deal'
    if meta and meta >= 75 and disc >= 50:
        return 'Great Deal'
    if disc >= 70:
        return 'Great Deal'
    if disc >= 50 or (meta and meta >= 70):
        return 'Good Deal'
    return None


def main():
    dry_run = '--dry-run' in sys.argv
    pages = MAX_PAGES
    for arg in sys.argv[1:]:
        if arg.startswith('--pages='):
            pages = int(arg.split('=')[1])

    if not dry_run and not API_KEY:
        print("Warning: RATINGS_API_KEY not set — will not be able to save results")

    scraper = cloudscraper.create_scraper()
    all_games = []
    seen_skus = set()

    sorts = ['best-new-deals', 'metascore', 'deal-rating']

    for sort_by in sorts:
        print(f"\n--- Fetching sort={sort_by} ---")
        for page in range(1, pages + 1):
            url = f"{NTDEALS_URL}?platforms=switch&sort={sort_by}&page={page}"
            print(f"  Page {page}: {url}")
            try:
                r = scraper.get(url)
                if r.status_code != 200:
                    print(f"    HTTP {r.status_code}")
                    break
            except Exception as e:
                print(f"    Request failed: {e}")
                break

            games = parse_game_items(r.text)
            if not games:
                print("    No games found — end of pages")
                break

            new_count = 0
            for g in games:
                key = g.get('sku') or g['title']
                if key not in seen_skus:
                    seen_skus.add(key)
                    all_games.append(g)
                    new_count += 1

            print(f"    Found {len(games)} items, {new_count} new (total: {len(all_games)})")

            if new_count == 0:
                break

            time.sleep(2)

    print(f"\nTotal unique games scraped: {len(all_games)}")

    if not all_games:
        print("No games scraped — exiting.")
        return

    curated_entries = {}
    matched = 0
    unmatched = 0

    for i, game in enumerate(all_games):
        title = game['title']
        fs_id = search_solr(title)

        if fs_id:
            matched += 1
            deal_rating = compute_deal_rating(game)
            entry = {
                'title': title,
                'review': '',
                'source_url': f"https://ntdeals.net{game['href']}" if game.get('href') else NTDEALS_URL,
                'source': 'ntdeals',
            }
            if game.get('metacritic_score'):
                entry['metacritic_score'] = game['metacritic_score']
            if deal_rating:
                entry['deal_rating'] = deal_rating
            if game.get('discount_pct'):
                entry['discount_pct'] = game['discount_pct']
            if game.get('days_remaining') is not None:
                entry['days_remaining'] = game['days_remaining']

            if fs_id not in curated_entries:
                curated_entries[fs_id] = entry
                print(f"  [{matched}] {title} -> fs_id={fs_id} (meta={game.get('metacritic_score', '-')}, {deal_rating or '-'})")
        else:
            unmatched += 1
            if i < 50:
                print(f"  [-] {title} -> NOT FOUND in eShop")

        time.sleep(0.3)

    print(f"\nMatched: {matched}, Unmatched: {unmatched}")
    print(f"Curated entries to save: {len(curated_entries)}")

    if dry_run:
        print("\n[DRY RUN] Would save these entries:")
        for fid, entry in list(curated_entries.items())[:10]:
            print(f"  {fid}: {entry['title']} (meta={entry.get('metacritic_score', '-')})")
        return

    if not curated_entries:
        print("No entries to save.")
        return

    print("\nFetching existing curated data...")
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/curated")
        with urllib.request.urlopen(req, timeout=15) as res:
            existing = json.loads(res.read())
    except Exception as e:
        print(f"  Failed to fetch existing curated: {e}")
        existing = {}

    nintendolife_entries = {k: v for k, v in existing.items() if v.get('source') != 'ntdeals'}
    merged = {**nintendolife_entries, **curated_entries}

    print(f"Merging: {len(nintendolife_entries)} NintendoLife + {len(curated_entries)} ntdeals = {len(merged)} total")

    print("Saving to API...")
    data = json.dumps(merged).encode('utf-8')
    req = urllib.request.Request(
        f"{BASE_URL}/api/curated",
        data=data,
        headers={
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
        },
        method='PUT',
    )
    try:
        with urllib.request.urlopen(req) as res:
            result = json.loads(res.read())
            print(f"Saved: {result}")
    except Exception as e:
        print(f"Save failed: {e}")


if __name__ == "__main__":
    main()
