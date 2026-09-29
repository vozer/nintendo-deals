import argparse
import urllib.request
import urllib.parse
import json
import time
import re
import os
import sys
import unicodedata
from datetime import datetime, timezone

from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, ORIGINAL_SWITCH_FILTER, is_original_switch_game

API_KEY = os.environ.get('RATINGS_API_KEY', '')


def normalize(value):
    value = str(value)
    value = value.replace('\u00ae', '').replace('\u2122', '')
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s]', '', value.lower())
    return re.sub(r'\s+', ' ', value).strip()


SWITCH_SUFFIXES_RE = re.compile(
    r'\s*[-:]?\s*(for Nintendo Switch|Nintendo Switch Edition|Switch Edition)\s*$',
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
    def canonical(value):
        normalized = normalize(value)
        return re.sub(r'\s+(?:for\s+)?nintendo\s+switch(?:\s+edition)?$', '', normalized)

    target = canonical(norm_title)
    matches = {item['id'] for item in items[:10] if canonical(item.get('name', '')) == target}
    return next(iter(matches)) if len(matches) == 1 else None


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
        return None


def get_steam_review_stats(appid):
    try:
        api_url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all"
        req2 = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req2, timeout=10) as res2:
            data = json.loads(res2.read())
            s = data.get('query_summary', {})
            if data.get('success') != 1:
                return None, None
            total = int(s.get('total_positive', 0)) + int(s.get('total_negative', 0))
            if total > 0:
                pct = round(int(s['total_positive']) / total * 100)
                return pct, total
    except Exception:
        pass

    return None, None


def backfill_tags(base_url, apply, api_key):
    """Add SteamSpy tags to existing entries that don't have them."""
    print("Loading existing steam ratings...")
    req = urllib.request.Request(f"{base_url}/api/steam", method='GET')
    with urllib.request.urlopen(req, timeout=30) as res:
        existing = json.loads(res.read())
    if not isinstance(existing, dict):
        raise RuntimeError("Steam API returned an invalid snapshot")
    print(f"Loaded {len(existing)} existing ratings.")

    needs_tags = [k for k, v in existing.items() if not v.get('tags')]
    print(f"Entries needing tags: {len(needs_tags)}")

    changed = 0
    for i, fs_id in enumerate(needs_tags):
        entry = existing[fs_id]
        tags = get_steamspy_tags(entry['steam_id'])
        if tags is not None:
            entry['tags'] = tags
            entry['tags_updated_at'] = datetime.now(timezone.utc).isoformat()
            changed += 1
        tag_str = f" {tags[:3]}" if tags else " []"
        print(f"[{i+1}/{len(needs_tags)}] {entry['matched_title']}{tag_str}")
        time.sleep(1.0)

    print(f"Tags refreshed: {changed}")
    if apply and changed:
        save_snapshot(base_url, api_key, existing)
    else:
        print("DRY RUN: no API writes performed." if not apply else "No changed entries to save.")


def save_snapshot(base_url, api_key, snapshot):
    request = urllib.request.Request(
        f"{base_url}/api/steam",
        data=json.dumps(snapshot).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-api-key': api_key},
        method='PUT',
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def fetch_games():
    all_games = {}
    expected_total = None
    start = 0
    rows = 1000
    while expected_total is None or start < expected_total:
        params = urllib.parse.urlencode({
            'q': '*:*',
            'fq': f'type:GAME AND {ORIGINAL_SWITCH_FILTER} AND price_has_discount_b:true AND price_discounted_f:[0 TO {MAX_DISCOUNTED_PRICE_EUR}] AND language_availability:*english* AND digital_version_b:true',
            'sort': 'popularity asc', 'start': start, 'rows': rows, 'wt': 'json',
            'fl': 'title,title_master_s,fs_id,system_type',
        })
        with urllib.request.urlopen(f"https://searching.nintendo-europe.com/es/select?{params}", timeout=45) as response:
            data = json.loads(response.read())
        result = data.get('response', {})
        total, docs = result.get('numFound'), result.get('docs')
        if type(total) is not int or not isinstance(docs, list):
            raise RuntimeError("Nintendo Solr returned invalid pagination data")
        if expected_total is not None and total != expected_total:
            raise RuntimeError("Nintendo Solr result count changed during pagination")
        expected_total = total
        if not docs and start < total:
            raise RuntimeError(f"Nintendo Solr pagination stopped at {start} of {total}")
        for game in docs:
            fs_id = str(game.get('fs_id', ''))
            if not fs_id.isdigit() or not is_original_switch_game(game):
                continue
            all_games.setdefault(fs_id, game)
        start += len(docs)
    if len(all_games) != expected_total:
        raise RuntimeError(f"Nintendo Solr returned {len(all_games)} distinct games; expected {expected_total}")
    return list(all_games.values())


def main(argv=None):
    parser = argparse.ArgumentParser(description="Backfill Steam review snapshots (dry-run by default)")
    parser.add_argument('--base-url', help='Explicit Nintendo Deals API target; required with --apply')
    parser.add_argument('--apply', action='store_true', help='Save the staged snapshot; default is dry-run')
    parser.add_argument('--tags-only', action='store_true', help='Only fill missing SteamSpy tags')
    args = parser.parse_args(argv)
    if args.apply and not args.base_url:
        parser.error('--apply requires an explicit --base-url target')
    if args.apply and not API_KEY:
        parser.error('--apply requires RATINGS_API_KEY')
    if not args.base_url:
        parser.error('provide --base-url to read an explicit Nintendo Deals API target')
    base_url = args.base_url.rstrip('/')

    if args.tags_only:
        backfill_tags(base_url, args.apply, API_KEY)
        return

    request = urllib.request.Request(f"{base_url}/api/steam", method='GET')
    with urllib.request.urlopen(request, timeout=30) as response:
        existing = json.loads(response.read())
    if not isinstance(existing, dict):
        raise RuntimeError("Steam API returned an invalid snapshot")
    games = fetch_games()
    updates = skipped = not_found = 0

    for index, game in enumerate(games):
        fs_id = str(game['fs_id'])
        if fs_id in existing:
            skipped += 1
            continue
        title = game.get('title_master_s') or game.get('title')
        appid = search_steam(title)
        if appid:
            score, votes = get_steam_review_stats(appid)
            tags = get_steamspy_tags(appid)
            if score is not None:
                existing[fs_id] = {
                    'steam_id': appid,
                    'score_pct': score,
                    'votes': votes,
                    'url': f"https://store.steampowered.com/app/{appid}/",
                    'matched_title': title,
                    'last_updated': datetime.now(timezone.utc).isoformat(),
                    **({'tags': tags} if tags is not None else {}),
                }
                updates += 1
                print(f"[{index + 1}/{len(games)}] {title} -> {score}% ({votes} reviews)")
            time.sleep(2)
        else:
            not_found += 1
            time.sleep(0.5)

    print(f"Steam snapshot: {updates} new, {skipped} existing, {not_found} unmatched; total {len(existing)}")
    if args.apply and updates:
        print('Published:', save_snapshot(base_url, API_KEY, existing))
    else:
        print('DRY RUN: no API writes performed.' if not args.apply else 'No new entries to save.')


if __name__ == "__main__":
    main()
