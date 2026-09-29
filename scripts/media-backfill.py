#!/usr/bin/env python3
"""Fetch media (screenshots + videos) for all Nintendo deals games.

Primary source: Nintendo game pages (_gItems.push scraping)
Fallback: IGDB screenshots + YouTube videos API

Saves to Vercel Blob via PUT /api/media.
Designed to run as daily cron on Raspberry Pi alongside n8n ratings workflow.
"""
import argparse
import json, time, re, urllib.request, urllib.parse, sys, os

from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, ORIGINAL_SWITCH_FILTER, is_original_switch_game

TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID', '')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET', '')
IGDB_SCREENSHOTS_URL = "https://api.igdb.com/v4/screenshots"
IGDB_VIDEOS_URL = "https://api.igdb.com/v4/game_videos"
NINTENDO_BASE = "https://www.nintendo.com"
BATCH_SIZE = 500


def fetch_nintendo_gallery(page_url):
    full_url = NINTENDO_BASE + page_url if page_url.startswith('/') else page_url
    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except Exception:
        return None

    pushes = re.findall(r'_gItems\.push\((\{.*?\})\);', html, re.DOTALL)
    if not pushes:
        return None

    screenshots = []
    videos = []
    for p in pushes:
        fixed = p.replace("'", '"').replace('&amp;', '&')
        fixed = re.sub(r',\s*}', '}', fixed)
        try:
            item = json.loads(fixed)
        except json.JSONDecodeError:
            continue

        if item.get('isVideo') and item.get('video_id'):
            videos.append({
                'video_id': item['video_id'],
                'thumbnail': item.get('video_thumbnail_url', ''),
                'embed_url': item.get('video_embed_url', ''),
                'type': item.get('type', 'limelight'),
            })
        elif item.get('image_url'):
            screenshots.append(item['image_url'])

    if not screenshots and not videos:
        return None
    return {'screenshots': screenshots, 'videos': videos, 'source': 'nintendo'}


def fetch_igdb_media(igdb_id, access_token):
    screenshots = []
    videos = []

    body = f'fields image_id; where game = {igdb_id}; limit 10;'
    req = urllib.request.Request(IGDB_SCREENSHOTS_URL, data=body.encode(), method='POST')
    req.add_header('Client-ID', TWITCH_CLIENT_ID)
    req.add_header('Authorization', f'Bearer {access_token}')
    req.add_header('Content-Type', 'text/plain')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.loads(resp.read())
        for r in results:
            if r.get('image_id'):
                screenshots.append(f"https://images.igdb.com/igdb/image/upload/t_1080p/{r['image_id']}.jpg")
    except Exception:
        pass
    time.sleep(0.28)

    body = f'fields name,video_id; where game = {igdb_id}; limit 5;'
    req = urllib.request.Request(IGDB_VIDEOS_URL, data=body.encode(), method='POST')
    req.add_header('Client-ID', TWITCH_CLIENT_ID)
    req.add_header('Authorization', f'Bearer {access_token}')
    req.add_header('Content-Type', 'text/plain')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.loads(resp.read())
        for r in results:
            if r.get('video_id'):
                videos.append({
                    'video_id': r['video_id'],
                    'name': r.get('name', ''),
                    'youtube_url': f"https://www.youtube.com/embed/{r['video_id']}",
                    'type': 'youtube',
                })
    except Exception:
        pass

    if not screenshots and not videos:
        return None
    return {'screenshots': screenshots, 'videos': videos, 'source': 'igdb'}


def save_to_vercel(media_map, base_url, api_key):
    payload = json.dumps(media_map).encode()
    req = urllib.request.Request(
        f"{base_url}/api/media",
        data=payload, method='PUT',
        headers={'Content-Type': 'application/json', 'x-api-key': api_key}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_all_games():
    """Fetch all games with pagination."""
    all_games = []
    expected_total = None
    start = 0
    while expected_total is None or start < expected_total:
        rows = BATCH_SIZE if expected_total is None else min(BATCH_SIZE, expected_total - start)
        params = urllib.parse.urlencode({
            'q': '*',
            'fq': f'type:GAME AND {ORIGINAL_SWITCH_FILTER} AND price_has_discount_b:true AND price_discounted_f:[0 TO {MAX_DISCOUNTED_PRICE_EUR}] AND language_availability:*english* AND digital_version_b:true',
            'rows': str(rows), 'start': str(start), 'wt': 'json', 'sort': 'popularity asc',
            'fl': 'title,title_master_s,fs_id,system_type,price_discounted_f,price_has_discount_b',
        })
        req = urllib.request.Request(f"https://searching.nintendo-europe.com/es/select?{params}")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8', errors='replace'))
        result = data.get('response', {})
        docs = result.get('docs')
        total = result.get('numFound')
        if type(total) is not int or not isinstance(docs, list) or len(docs) > rows:
            raise RuntimeError("Nintendo Solr returned invalid pagination data")
        if expected_total is not None and total != expected_total:
            raise RuntimeError("Nintendo Solr result count changed during pagination")
        expected_total = total
        if not docs and start < total:
            raise RuntimeError(f"Nintendo Solr pagination stopped at {start} of {total}")
        all_games.extend(docs)
        print(f"  Fetched {len(all_games)}/{total} games", flush=True)
        start += len(docs)
    by_id = {str(game.get('fs_id')): game for game in all_games if str(game.get('fs_id', '')).isdigit()}
    if len(by_id) != expected_total:
        raise RuntimeError(f"Nintendo Solr returned {len(by_id)} distinct games; expected {expected_total}")
    def is_active_original_switch_game(game):
        try:
            price = float(game['price_discounted_f'])
        except (KeyError, TypeError, ValueError):
            return False
        return (
            is_original_switch_game(game)
            and game.get('price_has_discount_b') is not False
            and 0 <= price <= MAX_DISCOUNTED_PRICE_EUR
        )

    return [game for game in by_id.values() if is_active_original_switch_game(game)]


def read_snapshot(base_url, path):
    request = urllib.request.Request(f"{base_url}{path}")
    with urllib.request.urlopen(request, timeout=30) as response:
        snapshot = json.loads(response.read())
    if not isinstance(snapshot, dict):
        raise RuntimeError(f"{path} returned an invalid object")
    return snapshot


def main(argv=None):
    parser = argparse.ArgumentParser(description="Backfill Nintendo media (dry-run by default)")
    parser.add_argument('--base-url', required=True, help='Explicit Nintendo Deals API target')
    parser.add_argument('--apply', action='store_true', help='Publish the staged snapshot; default is dry-run')
    args = parser.parse_args(argv)
    base_url = args.base_url.rstrip('/')
    api_key = os.environ.get('RATINGS_API_KEY', '').strip()
    if args.apply and (not api_key or not TWITCH_CLIENT_ID or not TWITCH_CLIENT_SECRET):
        parser.error('--apply requires RATINGS_API_KEY, TWITCH_CLIENT_ID, and TWITCH_CLIENT_SECRET')

    existing_media = read_snapshot(base_url, '/api/media')
    ratings = read_snapshot(base_url, '/api/ratings')
    games = fetch_all_games()
    new_games = [game for game in games if str(game.get('fs_id')) not in existing_media]
    print(f"Media snapshot: {len(existing_media)} existing, {len(new_games)} candidates")
    if not args.apply or not new_games:
        print('DRY RUN: no API writes performed.' if not args.apply else 'No missing media to save.')
        return

    data = urllib.parse.urlencode({
        'client_id': TWITCH_CLIENT_ID, 'client_secret': TWITCH_CLIENT_SECRET,
        'grant_type': 'client_credentials'
    }).encode()
    request = urllib.request.Request("https://id.twitch.tv/oauth2/token", data=data, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        access_token = json.loads(response.read())['access_token']

    media_map = dict(existing_media)
    stats = {'nintendo': 0, 'igdb': 0, 'none': 0}
    for index, game in enumerate(new_games):
        fs_id, title = str(game['fs_id']), game['title']
        nintendo_media = fetch_nintendo_gallery(game.get('url', ''))
        igdb_id = ratings.get(fs_id, {}).get('igdb_id')
        igdb_data = fetch_igdb_media(igdb_id, access_token) if igdb_id else None
        if nintendo_media:
            stats['nintendo'] += 1
            source = nintendo_media
            videos = igdb_data['videos'] if igdb_data and igdb_data['videos'] else source['videos']
            matched = ratings.get(fs_id, {}).get('matched_title', '')
            igdb_url = f"https://www.igdb.com/games/{matched.lower().replace(' ', '-').replace(':', '')}" if matched else None
        elif igdb_data:
            stats['igdb'] += 1
            source, videos = igdb_data, igdb_data['videos']
            matched = ratings.get(fs_id, {}).get('matched_title', '')
            igdb_url = f"https://www.igdb.com/games/{matched.lower().replace(' ', '-').replace(':', '')}" if matched else None
        else:
            stats['none'] += 1
            continue
        media_map[fs_id] = {
            'screenshots': source['screenshots'],
            'videos': videos,
            'igdb_url': igdb_url,
            'source': 'nintendo' if nintendo_media else 'igdb',
            'last_updated': time.strftime('%Y-%m-%d'),
        }
        if (index + 1) % 10 == 0:
            print(f"  [{index + 1}/{len(new_games)}] {title} -> {media_map[fs_id]['source']}", flush=True)
        time.sleep(0.3)

    if len(media_map) == len(existing_media):
        raise RuntimeError('No media was returned; refusing to publish an unchanged snapshot')
    result = save_to_vercel(media_map, base_url, api_key)
    print(f"Saved {result}; Nintendo={stats['nintendo']}, IGDB={stats['igdb']}, missing={stats['none']}")


if __name__ == '__main__':
    main()
