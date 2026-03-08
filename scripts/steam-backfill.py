import urllib.request
import urllib.parse
import json
import time
import re
import os
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


def search_steam(title):
    safe = urllib.parse.quote(title, safe='')
    url = f"https://store.steampowered.com/api/storesearch?term={safe}&cc=us&l=en"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read())
            items = data.get('items', [])
            if not items:
                return None

            norm_title = normalize(title)

            for item in items[:5]:
                norm_name = normalize(item['name'])
                if norm_name == norm_title:
                    return item['id']

            for item in items[:5]:
                norm_name = normalize(item['name'])
                if norm_title in norm_name or norm_name in norm_title:
                    return item['id']

            base_title = re.split(r'\s*[:\-\u2013\u2014]\s*', norm_title)[0].strip()
            if len(base_title) >= 6:
                for item in items[:3]:
                    norm_name = normalize(item['name'])
                    if base_title in norm_name:
                        return item['id']

    except Exception:
        pass
    return None


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
    return None, None


def main():
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
            if pct is not None:
                existing[fs_id] = {
                    "steam_id": appid,
                    "score_pct": pct,
                    "votes": count,
                    "url": f"https://store.steampowered.com/app/{appid}/",
                    "matched_title": title,
                }
                updates += 1
                save_counter += 1
                print(f"[{i+1}/{len(all_games)}] {title} -> {pct}% ({count})")
            else:
                print(f"[{i+1}/{len(all_games)}] {title} -> AppID {appid} but no reviews")
            time.sleep(1.5)
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
