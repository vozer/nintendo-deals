#!/usr/bin/env python3
"""Merge Nintendo, IGDB and validated Steam media. Dry-run by default."""
import argparse
import ast
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, ORIGINAL_SWITCH_FILTER, is_original_switch_game

SPEC = importlib.util.spec_from_file_location('steam_backfill', Path(__file__).with_name('steam-backfill.py'))
steam = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(steam)

TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID', '')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET', '')
PROVIDER_HOSTS = ('nintendo.com', 'nintendo.net', 'nintendo.eu', 'igdb.com', 'steamstatic.com', 'steamcontent.com', 'steampowered.com', 'ytimg.com')


def safe_url(value):
    try:
        url = urllib.parse.urlparse(value)
        return url.scheme == 'https' and not url.username and not url.password and not url.port and any(
            url.hostname == host or (url.hostname or '').endswith('.' + host) for host in PROVIDER_HOSTS
        )
    except (TypeError, ValueError):
        return False


def read_url(url, body=None, headers=None):
    request = urllib.request.Request(url, data=body, headers={'User-Agent': 'NintendoDeals/1.0', **(headers or {})})
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.read()


def parse_nintendo_gallery(document, source_url):
    screenshots, videos = [], []
    parsed = 0
    items = re.findall(r'_gItems\.push\((\{.*?\})\);', document, re.DOTALL)
    for raw in items:
        raw = re.sub(r':\s*(false|true)\b', lambda match: ': ' + match[1].title(), raw)
        try:
            item = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            continue
        if item.get('isVideo') and item.get('video_id'):
            video = {'video_id': str(item['video_id']), 'type': 'limelight', 'source': 'nintendo', 'source_url': source_url}
            for target, key in [('thumbnail', 'video_thumbnail_url'), ('content_url', 'video_content_url')]:
                value = html.unescape(item.get(key, ''))
                if safe_url(value):
                    video[target] = value
            videos.append(video)
            parsed += 1
        elif safe_url(item.get('image_url')):
            screenshots.append(html.unescape(item['image_url']))
            parsed += 1
    return {'screenshots': screenshots, 'videos': videos, 'source': 'nintendo', 'collection_complete': bool(items) and parsed == len(items)}


def fetch_nintendo_gallery(page_url):
    url = urllib.parse.urljoin('https://www.nintendo.com', page_url)
    if urllib.parse.urlparse(url).hostname != 'www.nintendo.com' or not safe_url(url):
        raise ValueError('Invalid Nintendo page URL')
    return parse_nintendo_gallery(read_url(url).decode('utf-8', errors='replace'), url)


def fetch_igdb_media(igdb_id, access_token):
    result = {'screenshots': [], 'videos': [], 'source': 'igdb', 'collection_complete': True}
    headers = {'Client-ID': TWITCH_CLIENT_ID, 'Authorization': f'Bearer {access_token}', 'Content-Type': 'text/plain'}
    for endpoint, fields in [('screenshots', 'image_id'), ('game_videos', 'name,video_id')]:
        for offset in range(0, 500, 50):
            body = f'fields {fields}; where game = {int(igdb_id)}; sort id asc; limit 50; offset {offset};'.encode()
            try:
                rows = json.loads(read_url(f'https://api.igdb.com/v4/{endpoint}', body, headers))
                if not isinstance(rows, list):
                    raise ValueError('Invalid IGDB media response')
                for row in rows:
                    if endpoint == 'screenshots' and re.fullmatch(r'[\w-]+', str(row.get('image_id', ''))):
                        result['screenshots'].append(f"https://images.igdb.com/igdb/image/upload/t_1080p/{row['image_id']}.jpg")
                    elif endpoint == 'game_videos' and re.fullmatch(r'[\w-]{11}', str(row.get('video_id', ''))):
                        result['videos'].append({'video_id': row['video_id'], 'name': row.get('name', ''), 'type': 'youtube', 'source': 'igdb', 'youtube_url': f"https://www.youtube.com/embed/{row['video_id']}"})
                if len(rows) < 50:
                    break
            except Exception:
                result['collection_complete'] = False
                break
            finally:
                time.sleep(0.28)
        else:
            result['collection_complete'] = False
    try:
        body = f'fields url; where id = {int(igdb_id)}; limit 1;'.encode()
        games = json.loads(read_url('https://api.igdb.com/v4/games', body, headers))
        if games and safe_url(games[0].get('url')) and urllib.parse.urlparse(games[0]['url']).hostname == 'www.igdb.com':
            result['igdb_url'] = games[0]['url']
    except Exception:
        result['collection_complete'] = False
    finally:
        time.sleep(0.28)
    return result


def steam_media(details):
    appid = details['steam_appid']
    source_url = f'https://store.steampowered.com/app/{appid}/'
    result = {'screenshots': [], 'videos': [], 'source': 'steam', 'collection_complete': True,
              'steam_match': {'steam_id': appid, 'matched_title': details['name'], 'publisher': ', '.join(details.get('publishers', [])), 'last_updated': datetime.now(timezone.utc).isoformat()}}
    for screenshot in details.get('screenshots', []):
        if safe_url(screenshot.get('path_full')):
            result['screenshots'].append(screenshot['path_full'])
    for movie in details.get('movies', []):
        video = {'video_id': str(movie['id']), 'name': movie.get('name', ''), 'type': 'steam', 'source': 'steam', 'source_url': source_url}
        if safe_url(movie.get('thumbnail')):
            video['thumbnail'] = movie['thumbnail']
        for target, value in [('hls_url', movie.get('hls_h264')), ('content_url', (movie.get('mp4') or {}).get('max'))]:
            if safe_url(value):
                video[target] = value
        result['videos'].append(video)
    return result


def merge_media(previous, sources):
    result = {**previous, 'screenshots': list(previous.get('screenshots', [])), 'videos': list(previous.get('videos', [])), 'asset_sources': dict(previous.get('asset_sources', {})), 'igdb_url': previous.get('igdb_url'), 'last_updated': datetime.now(timezone.utc).isoformat(), 'collection_complete': True}
    providers = set(result['asset_sources'].values())
    if previous.get('source') in ('nintendo', 'igdb', 'steam'):
        for url in result['screenshots']:
            result['asset_sources'].setdefault(url, previous['source'])
        providers.add(previous['source'])
    for source in sources:
        provider = source['source']
        providers.add(provider)
        result['collection_complete'] &= source.get('collection_complete', True)
        for url in source.get('screenshots', []):
            if safe_url(url):
                result['screenshots'].append(url)
                result['asset_sources'].setdefault(url, provider)
        result['videos'].extend(source.get('videos', []))
        if source.get('steam_match'):
            result['steam_match'] = source['steam_match']
        if source.get('igdb_url') and safe_url(source['igdb_url']):
            result['igdb_url'] = source['igdb_url']
    result['screenshots'] = list(dict.fromkeys(result['screenshots']))
    videos = {}
    for video in result['videos']:
        key = (video['type'], video['video_id'])
        videos[key] = {**videos.get(key, {}), **{key: value for key, value in video.items() if value is not None and value != ''}}
    result['videos'] = list(videos.values())
    result['source'] = next(iter(providers)) if len(providers) == 1 else 'mixed'
    return result


def fetch_all_games(game_id=None):
    games, total, start = {}, None, 0
    while total is None or start < total:
        fq = f'type:GAME AND {ORIGINAL_SWITCH_FILTER}'
        fq += f' AND fs_id:{game_id}' if game_id else f' AND price_has_discount_b:true AND price_discounted_f:[0 TO {MAX_DISCOUNTED_PRICE_EUR}] AND language_availability:*english* AND digital_version_b:true'
        params = urllib.parse.urlencode({'q': '*', 'fq': fq, 'rows': 500, 'start': start, 'wt': 'json', 'sort': 'popularity asc', 'fl': 'title,title_master_s,fs_id,system_type,price_discounted_f,price_has_discount_b,url,publisher'})
        result = json.loads(read_url(f'https://searching.nintendo-europe.com/es/select?{params}'))['response']
        docs, found = result.get('docs'), result.get('numFound')
        if not isinstance(docs, list) or type(found) is not int or (total is not None and total != found) or (not docs and start < found):
            raise RuntimeError('Incomplete or drifting Nintendo catalog')
        total = found
        for game in docs:
            fs_id = str(game.get('fs_id', ''))
            if fs_id.isdigit() and is_original_switch_game(game):
                games[fs_id] = game
        start += len(docs)
    if len(games) != total:
        raise RuntimeError('Nintendo distinct count differs from numFound')
    return list(games.values())


def read_snapshot(base_url, path):
    with urllib.request.urlopen(base_url + path, timeout=30) as response:
        snapshot = json.loads(response.read())
        revision = response.headers.get('ETag')
    if not isinstance(snapshot, dict):
        raise RuntimeError(f'Invalid {path} snapshot')
    return snapshot, revision


def save_to_vercel(updates, base_url, api_key, revision):
    if not revision:
        raise RuntimeError('Target API does not expose a revision; deploy conditional writes before applying')
    with urllib.request.urlopen(urllib.request.Request(base_url + '/api/media', data=json.dumps(updates).encode(), method='PUT', headers={'Content-Type': 'application/json', 'x-api-key': api_key, 'If-Match': revision}), timeout=30) as response:
        return json.loads(response.read())


def main(argv=None):
    parser = argparse.ArgumentParser(description='Merge media (dry-run by default)')
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--game-id')
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--refresh-incomplete', action='store_true', help='Revisit legacy or incomplete cached records')
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 100 or (args.game_id and not args.game_id.isdigit()):
        parser.error('invalid game ID or limit (1-100)')
    key = os.environ.get('RATINGS_API_KEY', '')
    if args.apply and not key:
        parser.error('--apply requires RATINGS_API_KEY')
    base_url = args.base_url.rstrip('/')
    existing, revision = read_snapshot(base_url, '/api/media')
    ratings, _ = read_snapshot(base_url, '/api/ratings')
    steam_ratings, _ = read_snapshot(base_url, '/api/steam')
    games = [game for game in fetch_all_games(args.game_id) if args.game_id or str(game['fs_id']) not in existing or (args.refresh_incomplete and existing[str(game['fs_id'])].get('collection_complete') is not True)][:args.limit]
    token = None
    if TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET and any(ratings.get(str(game['fs_id']), {}).get('igdb_id') for game in games):
        body = urllib.parse.urlencode({'client_id': TWITCH_CLIENT_ID, 'client_secret': TWITCH_CLIENT_SECRET, 'grant_type': 'client_credentials'}).encode()
        token = json.loads(read_url('https://id.twitch.tv/oauth2/token', body))['access_token']
    staged = {}
    for game in games:
        fs_id = str(game['fs_id'])
        previous = existing.get(fs_id, {})
        sources = []
        try:
            sources.append(fetch_nintendo_gallery(game['url']))
        except Exception:
            sources.append({'source': 'nintendo', 'collection_complete': False})
        igdb_id = ratings.get(fs_id, {}).get('igdb_id')
        if igdb_id and token:
            sources.append(fetch_igdb_media(igdb_id, token))
        elif igdb_id:
            sources.append({'source': 'igdb', 'collection_complete': False})
        try:
            known_id = previous.get('steam_match', {}).get('steam_id') or steam_ratings.get(fs_id, {}).get('steam_id')
            details = steam.get_validated_steam_details(game, known_id)
            if details:
                sources.append(steam_media(details))
        except Exception:
            sources.append({'source': 'steam', 'collection_complete': False})
        merged = merge_media(previous, sources)
        if merged['screenshots'] or merged['videos'] or merged.get('steam_match'):
            staged[fs_id] = merged
        print(f"{fs_id}: {len(merged['screenshots'])} images, {len(merged['videos'])} videos; complete={merged['collection_complete']}")
    print(f'Staged {len(staged)} additive records; existing={len(existing)}; preferences untouched')
    if args.apply and staged:
        print('Published:', save_to_vercel(staged, base_url, key, revision))
    else:
        print('DRY RUN: no API writes performed.' if not args.apply else 'No media to publish.')


if __name__ == '__main__':
    main()
