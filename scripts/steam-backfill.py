import urllib.request
import json
import time
import re
import sys
import os
import unicodedata

API_KEY = os.environ.get('RATINGS_API_KEY', 'REDACTED_RATINGS_API_KEY')
BASE_URL = "https://nintendo-deals.vercel.app"
SAVE_EVERY = 20
SOLR_FL = "title,title_master_s,fs_id"


def slugify(value):
    value = str(value)
    value = value.replace('\u00ae', '').replace('\u2122', '')
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value.lower())
    return re.sub(r'[-\s]+', ' ', value).strip()


def fetch_steam_app_list():
    print("Fetching Steam App List...")
    url = "https://api.steampowered.com/ISteamApps/GetAppList/v2/"
    try:
        res = urllib.request.urlopen(url)
        data = json.loads(res.read())
        apps = data['applist']['apps']
        print(f"Loaded {len(apps)} Steam apps.")
        return apps
    except Exception as e:
        print(f"Failed to fetch Steam apps: {e}")
        return []


def build_steam_index(apps):
    index = {}
    for app in apps:
        name = app.get('name', '')
        if name:
            index[slugify(name)] = app['appid']
    return index


EDITION_RE = re.compile(
    r'\b(definitive|deluxe|complete|special|ultimate|enhanced|anniversary|'
    r'remastered|remake|hd|remaster|pixel\s+remaster)\s*(edition|version)?\b'
)


def match_title(slug, steam_index):
    if slug in steam_index:
        return steam_index[slug], "exact"

    if slug.startswith("the "):
        v = steam_index.get(slug[4:])
        if v:
            return v, "no-the"

    clean = EDITION_RE.sub('', slug).strip()
    clean = re.sub(r'\s+', ' ', clean)
    if clean != slug and clean in steam_index:
        return steam_index[clean], "no-edition"

    parts = re.split(r'\s*[:\-\u2013\u2014]\s*', slug)
    base = parts[0].strip()
    if len(base) >= 4 and base != slug and base in steam_index:
        return steam_index[base], "base-title"

    words = slug.split()
    for n in range(min(5, len(words)), 2, -1):
        prefix = ' '.join(words[:n])
        if len(prefix) >= 10 and prefix in steam_index:
            return steam_index[prefix], "prefix"

    return None, None


def get_steam_review_stats(appid):
    url = f"https://store.steampowered.com/app/{appid}/"
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            'Accept-Language': 'en-US,en;q=0.5',
        }
    )
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
            f"&wt=json&fl={SOLR_FL}"
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

    steam_apps = fetch_steam_app_list()
    steam_index = build_steam_index(steam_apps)
    print(f"Steam index: {len(steam_index)} unique slugs.")

    updates = 0
    save_counter = 0
    skipped = 0

    for i, game in enumerate(all_games):
        fs_id = game['fs_id']
        if fs_id in existing:
            skipped += 1
            continue

        title = game.get('title_master_s', game['title'])
        slug = slugify(title)

        appid, strategy = match_title(slug, steam_index)

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
                print(f"[{i+1}/{len(all_games)}] {title} -> {pct}% ({count}) [{strategy}]")
                time.sleep(1.5)
            else:
                print(f"[{i+1}/{len(all_games)}] {title} -> matched AppID {appid} but no reviews [{strategy}]")

        if save_counter >= SAVE_EVERY:
            print(f"Saving batch... ({len(existing)} total)")
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
                print(f"Save failed: {e}")

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

    print(f"\nDone. New matches: {updates}, Skipped (existing): {skipped}, Total stored: {len(existing)}")


if __name__ == "__main__":
    main()
