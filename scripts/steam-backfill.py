import argparse
import urllib.request
import urllib.parse
import urllib.error
import json
import time
import re
import os
import sys
import unicodedata
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, ORIGINAL_SWITCH_FILTER, is_original_switch_game

API_KEY = os.environ.get('RATINGS_API_KEY', '')
STEAM_REVIEW_REFRESH_DAYS = 30
STEAM_REVIEW_RETRY_DAYS = 7


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
        raise RuntimeError('Steam search unavailable') from None


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


def get_validated_steam_details(game, appid=None):
    title = game.get('title_master_s') or game.get('title', '')
    appid = appid or search_steam(title)
    if not appid or not str(appid).isdigit():
        return None
    url = f'https://store.steampowered.com/api/appdetails?appids={appid}&l=english&cc=es'
    request = urllib.request.Request(url, headers={'User-Agent': 'NintendoDeals/1.0'})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read()).get(str(appid), {})
    details = result.get('data', {})
    if not result.get('success') or details.get('type') != 'game':
        return None
    if _match_items([{'id': appid, 'name': details.get('name', '')}], normalize(title)) != appid:
        return None
    publisher = normalize(game.get('publisher', ''))
    providers = {normalize(value) for value in details.get('publishers', []) + details.get('developers', [])}
    if not publisher or publisher not in providers:
        return None
    return {**details, 'steam_appid': int(appid)}


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
    params = {
        'appid': int(appid),
        'languages': ['english'],
        'review_type': 0,
        'purchase_type': 0,
    }
    query = urllib.parse.urlencode({'input_json': json.dumps(params, separators=(',', ':'))})
    api_url = f"https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/?{query}"
    request = urllib.request.Request(api_url, headers={'User-Agent': 'NintendoDeals/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Valve review API returned HTTP {error.code}") from None
    except Exception as error:
        raise RuntimeError(f"Valve review API unavailable ({type(error).__name__})") from None

    summary = data.get('response', {}).get('query_summary') if isinstance(data, dict) else None
    if not isinstance(summary, dict):
        raise RuntimeError('Valve review API returned no query summary')
    try:
        positive = int(summary['total_positive'])
        negative = int(summary['total_negative'])
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('Valve review API returned invalid review totals') from None
    total = positive + negative
    if total <= 0:
        return None, None
    return positive * 100 // total, total


def _parse_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def refresh_existing_reviews(existing, limit=25, game_id=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    stamp = now.astimezone(timezone.utc).isoformat()
    stale_before = now - timedelta(days=STEAM_REVIEW_REFRESH_DAYS)
    retry_before = now - timedelta(days=STEAM_REVIEW_RETRY_DAYS)
    due = []
    for fs_id, entry in existing.items():
        if (game_id and fs_id != game_id) or not isinstance(entry, dict):
            continue
        appid = entry.get('steam_id')
        if not str(appid or '').isdigit():
            continue
        updated_at = _parse_timestamp(entry.get('last_updated'))
        attempted_at = _parse_timestamp(entry.get('review_attempted_at'))
        if updated_at is not None and updated_at > stale_before:
            continue
        if attempted_at is not None and attempted_at > retry_before:
            continue
        due.append((attempted_at or updated_at or datetime.min.replace(tzinfo=timezone.utc), fs_id, entry))

    due.sort(key=lambda item: (item[0], item[1]))
    selected = due[:limit]
    summary = {'eligible': len(due), 'selected': len(selected), 'updated': 0, 'failed': 0, 'empty': 0}
    for index, (_, fs_id, entry) in enumerate(selected, start=1):
        title = entry.get('matched_title') or fs_id
        entry['review_attempted_at'] = stamp
        try:
            score, votes = get_steam_review_stats(entry['steam_id'])
        except Exception as error:
            summary['failed'] += 1
            reason = (
                str(error).replace('\r', ' ').replace('\n', ' ')[:160]
                if isinstance(error, RuntimeError) else type(error).__name__
            )
            print(f"[{index}/{len(selected)}] {title} (Nintendo ID {fs_id}): review refresh failed ({reason})",
                  file=sys.stderr)
        else:
            if score is None or votes is None:
                summary['empty'] += 1
                print(f"[{index}/{len(selected)}] {title} (Nintendo ID {fs_id}): no review totals; kept cached score")
            else:
                entry['score_pct'] = score
                entry['votes'] = votes
                entry['last_updated'] = stamp
                summary['updated'] += 1
                print(f"[{index}/{len(selected)}] {title} -> {score}% ({votes} reviews)")
        if index < len(selected):
            time.sleep(1.0)
    return summary


def backfill_tags(base_url, apply, api_key, limit=25, game_id=None):
    """Add SteamSpy tags to existing entries that don't have them."""
    print("Loading existing steam ratings...")
    req = urllib.request.Request(f"{base_url}/api/steam", method='GET')
    with urllib.request.urlopen(req, timeout=30) as res:
        existing = json.loads(res.read())
        revision = res.headers.get('ETag')
    if not isinstance(existing, dict):
        raise RuntimeError("Steam API returned an invalid snapshot")
    print(f"Loaded {len(existing)} existing ratings.")

    needs_tags = [k for k, v in existing.items() if not v.get('tags') and (not game_id or k == game_id)][:limit]
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
        save_snapshot(base_url, api_key, existing, revision)
    else:
        print("DRY RUN: no API writes performed." if not apply else "No changed entries to save.")


def save_snapshot(base_url, api_key, snapshot, revision=None):
    if not revision:
        raise RuntimeError('Target API does not expose a revision; deploy conditional writes before applying')
    request = urllib.request.Request(
        f"{base_url}/api/steam",
        data=json.dumps(snapshot).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-api-key': api_key, **({'If-Match': revision} if revision else {})},
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
            'fl': 'title,title_master_s,fs_id,system_type,publisher',
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
    parser.add_argument('--refresh-existing', action='store_true', help='Refresh stale review scores for existing Steam matches')
    parser.add_argument('--limit', type=int, default=25, help='Maximum missing games to inspect (1-100)')
    parser.add_argument('--game-id', help='Only inspect this Nintendo ID')
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 100 or (args.game_id and not args.game_id.isdigit()) or (args.tags_only and args.refresh_existing):
        parser.error('invalid --limit or --game-id')
    if args.apply and not args.base_url:
        parser.error('--apply requires an explicit --base-url target')
    if args.apply and not API_KEY:
        parser.error('--apply requires RATINGS_API_KEY')
    if not args.base_url:
        parser.error('provide --base-url to read an explicit Nintendo Deals API target')
    base_url = args.base_url.rstrip('/')

    if args.tags_only:
        backfill_tags(base_url, args.apply, API_KEY, args.limit, args.game_id)
        return

    if args.refresh_existing:
        request = urllib.request.Request(f"{base_url}/api/steam", method='GET')
        with urllib.request.urlopen(request, timeout=30) as response:
            existing = json.loads(response.read())
            revision = response.headers.get('ETag')
        if not isinstance(existing, dict):
            raise RuntimeError("Steam API returned an invalid snapshot")
        summary = refresh_existing_reviews(existing, args.limit, args.game_id)
        print("Steam review refresh: " + ", ".join(f"{key}={value}" for key, value in summary.items()))
        if args.apply and summary['selected']:
            print('Published:', save_snapshot(base_url, API_KEY, existing, revision))
        elif args.apply:
            print("No stale ratings to save.")
        else:
            print("DRY RUN: no API writes performed.")
        return

    request = urllib.request.Request(f"{base_url}/api/steam", method='GET')
    with urllib.request.urlopen(request, timeout=30) as response:
        existing = json.loads(response.read())
        revision = response.headers.get('ETag')
    if not isinstance(existing, dict):
        raise RuntimeError("Steam API returned an invalid snapshot")
    games = fetch_games()
    updates = skipped = not_found = review_failures = 0

    games = [game for game in games if str(game['fs_id']) not in existing and (not args.game_id or str(game['fs_id']) == args.game_id)][:args.limit]

    for index, game in enumerate(games):
        fs_id = str(game['fs_id'])
        if fs_id in existing:
            skipped += 1
            continue
        title = game.get('title_master_s') or game.get('title')
        details = get_validated_steam_details(game)
        appid = details.get('steam_appid') if details else None
        if appid:
            try:
                score, votes = get_steam_review_stats(appid)
            except Exception as error:
                review_failures += 1
                reason = (
                    str(error).replace('\r', ' ').replace('\n', ' ')[:160]
                    if isinstance(error, RuntimeError) else type(error).__name__
                )
                print(f"[{index + 1}/{len(games)}] {title}: review lookup failed ({reason})",
                      file=sys.stderr)
                time.sleep(1.0)
                continue
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

    print(f"Steam snapshot: {updates} new, {skipped} existing, {not_found} unmatched, {review_failures} review failures; total {len(existing)}")
    if args.apply and updates:
        print('Published:', save_snapshot(base_url, API_KEY, existing, revision))
    else:
        print('DRY RUN: no API writes performed.' if not args.apply else 'No new entries to save.')


if __name__ == "__main__":
    main()
