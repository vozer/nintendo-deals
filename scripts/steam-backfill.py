import urllib.request
import urllib.parse
import json
import time
import re
import os
import sys
import unicodedata

API_KEY = os.environ.get('RATINGS_API_KEY', 'REDACTED_RATINGS_API_KEY')
BASE_URL = "https://nintendo-deals.vercel.app"
SAVE_EVERY = 20


def normalize(value):
    value = str(value)
    value = value.replace('\u00ae', '').replace('\u2122', '')
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s]', '', value.lower())
    return re.sub(r'\s+', ' ', value).strip()


SWITCH_SUFFIXES_RE = re.compile(
    r'\s*[-:]\s*(Legacy|XL|DX|Deluxe|Definitive|Complete|Enhanced|'
    r'Final|Anniversary|Ultimate|Remastered|Special|Gold|Premium|'
    r'Platinum|Extended|for Nintendo Switch|Nintendo Switch Edition|'
    r'Switch Edition)\s*(Edition|Version|Cut)?\s*$',
    re.IGNORECASE,
)

def _steam_search(query):
    safe = urllib.parse.quote(query, safe='')
    url = f"https://store.steampowered.com/api/storesearch?term={safe}&cc=us&l=en"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read()).get('items', [])
    except Exception:
        return []


def _match_items(items, norm_title):
    for item in items[:5]:
        if normalize(item['name']) == norm_title:
            return item['id']
    for item in items[:5]:
        nn = normalize(item['name'])
        if norm_title in nn or nn in norm_title:
            return item['id']
    base = re.split(r'\s*[:\-\u2013\u2014]\s*', norm_title)[0].strip()
    if len(base) >= 6:
        for item in items[:3]:
            if base in normalize(item['name']):
                return item['id']
    return None


def search_steam(title):
    norm_title = normalize(title)
    items = _steam_search(title)
    if items:
        appid = _match_items(items, norm_title)
        if appid:
            return appid

    stripped = SWITCH_SUFFIXES_RE.sub('', title).strip()
    if stripped != title and len(stripped) >= 4:
        norm_stripped = normalize(stripped)
        items2 = _steam_search(stripped)
        if items2:
            appid = _match_items(items2, norm_stripped)
            if appid:
                return appid
            appid = _match_items(items2, norm_title)
            if appid:
                return appid

    parts = re.split(r'\s*[:\-\u2013\u2014]\s*', title)
    if len(parts) >= 2:
        base = parts[0].strip()
        if len(base) >= 4 and base != stripped:
            items3 = _steam_search(base)
            if items3:
                appid = _match_items(items3, normalize(base))
                if appid:
                    return appid

    return None


def get_steamspy_tags(appid):
    url = f"https://steamspy.com/api.php?request=appdetails&appid={appid}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read())
            tags = list(data.get('tags', {}).keys())
            return tags[:15]
    except Exception:
        return []


def get_steam_review_stats(appid):
    url = f"https://store.steampowered.com/app/{appid}/"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept-Language': 'en-US,en;q=0.5',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode('utf-8')
            match = re.search(r'data-tooltip-html="([^"]+)"', html)
            if match:
                tooltip = match.group(1)
                pct_match = re.search(r'(\d+)%', tooltip)
                count_match = re.search(r'([\d,]+) user reviews', tooltip)
                if pct_match and count_match:
                    pct = int(pct_match.group(1))
                    count = int(count_match.group(1).replace(',', ''))
                    return pct, count
    except Exception:
        pass

    try:
        api_url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all"
        req2 = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req2, timeout=10) as res2:
            data = json.loads(res2.read())
            s = data.get('query_summary', {})
            total = s.get('total_positive', 0) + s.get('total_negative', 0)
            if total > 0:
                pct = int(s['total_positive'] / total * 100)
                return pct, total
    except Exception:
        pass

    return None, None


def backfill_tags():
    """Add SteamSpy tags to existing entries that don't have them."""
    print("Loading existing steam ratings...")
    existing = {}
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/steam", method='GET')
        with urllib.request.urlopen(req) as res:
            existing = json.loads(res.read())
            print(f"Loaded {len(existing)} existing ratings.")
    except Exception:
        print("No existing ratings found.")
        return

    needs_tags = [k for k, v in existing.items() if not v.get('tags')]
    print(f"Entries needing tags: {len(needs_tags)}")

    save_counter = 0
    for i, fs_id in enumerate(needs_tags):
        entry = existing[fs_id]
        tags = get_steamspy_tags(entry['steam_id'])
        entry['tags'] = tags
        save_counter += 1
        tag_str = f" {tags[:3]}" if tags else " []"
        print(f"[{i+1}/{len(needs_tags)}] {entry['matched_title']}{tag_str}")
        time.sleep(1.0)

        if save_counter >= SAVE_EVERY:
            print(f"  Saving batch...")
            req = urllib.request.Request(
                f"{BASE_URL}/api/steam",
                data=json.dumps(existing).encode('utf-8'),
                headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
                method='PUT'
            )
            try:
                urllib.request.urlopen(req)
                save_counter = 0
            except Exception as e:
                print(f"  Save failed: {e}")

    if save_counter > 0:
        print("Final save...")
        req = urllib.request.Request(
            f"{BASE_URL}/api/steam",
            data=json.dumps(existing).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
            method='PUT'
        )
        try:
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Final save failed: {e}")

    print(f"Done. Tagged {len(needs_tags)} entries.")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--tags-only':
        backfill_tags()
        return

    print("Loading existing steam ratings...")
    existing = {}
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/steam", method='GET')
        with urllib.request.urlopen(req) as res:
            existing = json.loads(res.read())
            print(f"Loaded {len(existing)} existing ratings.")
    except Exception:
        print("No existing ratings found.")

    print("Fetching Nintendo games...")
    all_games = []
    start = 0
    rows = 1000
    while True:
        solr_url = (
            f"https://searching.nintendo-europe.com/es/select?"
            f"q=*&fq=type:GAME%20AND%20system_type:nintendoswitch*"
            f"%20AND%20price_has_discount_b:true"
            f"%20AND%20price_sorting_f:%5B0%20TO%2014.99%5D"
            f"%20AND%20language_availability:*english*"
            f"%20AND%20digital_version_b:true"
            f"&sort=popularity%20asc&start={start}&rows={rows}"
            f"&wt=json&fl=title,title_master_s,fs_id"
        )
        res = urllib.request.urlopen(solr_url)
        data = json.loads(res.read())
        docs = data['response']['docs']
        all_games.extend(docs)
        total = data['response']['numFound']
        start += rows
        if start >= total:
            break
    print(f"Loaded {len(all_games)} Nintendo games.")

    updates = 0
    save_counter = 0
    skipped = 0
    not_found = 0

    for i, game in enumerate(all_games):
        fs_id = game['fs_id']
        if fs_id in existing:
            skipped += 1
            continue

        title = game.get('title_master_s', game['title'])

        appid = search_steam(title)

        if appid:
            pct, count = get_steam_review_stats(appid)
            tags = get_steamspy_tags(appid)
            if pct is not None:
                existing[fs_id] = {
                    "steam_id": appid,
                    "score_pct": pct,
                    "votes": count,
                    "url": f"https://store.steampowered.com/app/{appid}/",
                    "matched_title": title,
                    "tags": tags,
                }
                updates += 1
                save_counter += 1
                tag_str = f" tags={tags[:3]}" if tags else ""
                print(f"[{i+1}/{len(all_games)}] {title} -> {pct}% ({count}){tag_str}")
            else:
                print(f"[{i+1}/{len(all_games)}] {title} -> AppID {appid} but no reviews")
            time.sleep(2.0)
        else:
            not_found += 1
            if i < 100 or i % 100 == 0:
                print(f"[{i+1}/{len(all_games)}] {title} -> not on Steam")
            time.sleep(0.5)

        if save_counter >= SAVE_EVERY:
            print(f"  Saving batch... ({len(existing)} total, {updates} new)")
            req = urllib.request.Request(
                f"{BASE_URL}/api/steam",
                data=json.dumps(existing).encode('utf-8'),
                headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
                method='PUT'
            )
            try:
                urllib.request.urlopen(req)
                save_counter = 0
            except Exception as e:
                print(f"  Save failed: {e}")

    if save_counter > 0:
        print(f"Final save... ({len(existing)} total)")
        req = urllib.request.Request(
            f"{BASE_URL}/api/steam",
            data=json.dumps(existing).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
            method='PUT'
        )
        try:
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Final save failed: {e}")

    print(f"\nDone. New: {updates}, Skipped: {skipped}, Not found: {not_found}, Total stored: {len(existing)}")


if __name__ == "__main__":
    main()
