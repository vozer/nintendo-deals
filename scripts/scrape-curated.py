import urllib.request
import urllib.parse
import json
import re
import os
import unicodedata
import time

API_KEY = os.environ.get('RATINGS_API_KEY', 'REDACTED_RATINGS_API_KEY')
BASE_URL = "https://nintendo-deals.vercel.app"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

SOURCES = [
    "https://www.nintendolife.com/guides/best-nintendo-switch-games",
    "https://www.nintendolife.com/guides/the-best-nintendo-switch-games-2026",
]

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


def fetch_html(url):
    print(f"Scraping {url}...")
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.read().decode('utf-8')
    except Exception as e:
        print(f"  Failed: {e}")
        return ""


def extract_entries(html):
    entries = []
    item_pattern = (
        r'<div class="list-item"><h3 class="heading"[^>]*>\s*(\d+)\.\s*'
        r'<a[^>]*>(.*?)</a></h3>(.*?)(?=<div class="list-item">|</div>\s*<h2|$)'
    )
    matches = re.findall(item_pattern, html, re.DOTALL)
    for rank_str, raw_title, content in matches:
        title = re.sub(r'\s*\([^)]*\)\s*$', '', raw_title).strip()
        title = re.sub(r'<[^>]+>', '', title).strip()

        paragraphs = re.findall(r'<p>(.*?)</p>', content, re.DOTALL)
        review_parts = []
        for p in paragraphs[:2]:
            clean = re.sub(r'<[^>]+>', '', p).strip()
            if clean:
                review_parts.append(clean)
        review = ' '.join(review_parts)

        entries.append({
            'rank': int(rank_str),
            'title': title,
            'review': review,
        })
    return entries


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
        best_match = None
        best_score = 0

        for doc in docs:
            for field in ['title_master_s', 'title']:
                val = doc.get(field, '')
                norm_val = normalize(val)
                if norm_val == norm_target:
                    return doc['fs_id']
                # Partial match scoring
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


def main():
    all_entries = {}
    seen_titles = set()

    for source_url in SOURCES:
        html = fetch_html(source_url)
        if not html:
            continue

        entries = extract_entries(html)
        print(f"  Found {len(entries)} entries.")

        for entry in entries:
            norm = normalize(entry['title'])
            if norm in seen_titles:
                continue
            seen_titles.add(norm)

            fs_id = search_solr(entry['title'])
            if fs_id:
                if fs_id not in all_entries or entry['rank'] < all_entries[fs_id].get('rank', 999):
                    all_entries[fs_id] = {
                        'title': entry['title'],
                        'review': entry['review'][:500],
                        'source_url': source_url,
                        'rank': entry['rank'],
                    }
                print(f"  [{entry['rank']}] {entry['title']} -> fs_id={fs_id}")
            else:
                print(f"  [{entry['rank']}] {entry['title']} -> NOT FOUND in eShop")

            time.sleep(0.3)

    print(f"\nTotal matched curated games: {len(all_entries)}")

    if all_entries:
        print("Saving to API...")
        req = urllib.request.Request(
            f"{BASE_URL}/api/curated",
            data=json.dumps(all_entries).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
            method='PUT'
        )
        try:
            with urllib.request.urlopen(req) as res:
                result = json.loads(res.read())
                print(f"Saved: {result}")
        except Exception as e:
            print(f"Save failed: {e}")
    else:
        print("No matches found — nothing to save.")


if __name__ == "__main__":
    main()
