#!/usr/bin/env python3
"""Merge Nintendo, IGDB and validated Steam media. Dry-run by default."""
import argparse
import ast
import fcntl
import html
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, ORIGINAL_SWITCH_FILTER, is_original_switch_game, is_blocked_title
from automation.run_daily import compatible_igdb_candidates
from automation.nintendo_worker import normalize_title, title_similarity, is_active_deal

SPEC = importlib.util.spec_from_file_location('steam_backfill', Path(__file__).with_name('steam-backfill.py'))
steam = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(steam)

TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID', '')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET', '')
PROVIDER_HOSTS = ('nintendo.com', 'nintendo.net', 'nintendo.eu', 'igdb.com', 'steamstatic.com', 'steamcontent.com', 'steampowered.com', 'ytimg.com')
VERCEL_BODY_LIMIT = 4_500_000


class RunCheckpoint:
    def __init__(self, path, create=False):
        self.path = Path(path)
        if create:
            self.path.mkdir(parents=True, exist_ok=False)
        if not self.path.is_dir():
            raise RuntimeError(f'Crawler run directory not found: {self.path}')
        self.lock = (self.path / 'run.lock').open('a+b')
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise RuntimeError(f'Crawler run is already locked: {self.path}') from None
        database_path = self.path / 'checkpoint.sqlite3'
        if not create and not database_path.is_file():
            self.close()
            raise RuntimeError(f'Crawler checkpoint not found: {database_path}')
        try:
            self.database = sqlite3.connect(database_path, timeout=30)
            self.database.execute('PRAGMA journal_mode=WAL')
            self.database.execute('PRAGMA synchronous=FULL')
            self.database.execute('PRAGMA foreign_keys=ON')
            if create:
                self.database.executescript('''
                    CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
                    CREATE TABLE games (
                        position INTEGER PRIMARY KEY,
                        fs_id TEXT NOT NULL UNIQUE,
                        game TEXT NOT NULL,
                        before_media TEXT,
                        igdb_id INTEGER,
                        steam_id INTEGER
                    );
                    CREATE TABLE results (
                        fs_id TEXT PRIMARY KEY REFERENCES games(fs_id),
                        after_media TEXT NOT NULL,
                        providers TEXT NOT NULL,
                        complete INTEGER NOT NULL CHECK (complete IN (0, 1))
                    );
                ''')
            elif self.database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError(f'Crawler checkpoint integrity check failed: {database_path}')
        except Exception:
            self.close()
            raise

    def initialize(self, metadata, games):
        self.database.execute('BEGIN IMMEDIATE')
        try:
            self.database.execute('INSERT INTO metadata VALUES (1, ?)', (json.dumps(metadata),))
            self.database.executemany('INSERT INTO games VALUES (?, ?, ?, ?, ?, ?)', [
                (position, str(game['fs_id']), json.dumps(game),
                 json.dumps(metadata['existing'].get(str(game['fs_id']))),
                 metadata['ratings'].get(str(game['fs_id']), {}).get('igdb_id'),
                 metadata['steam_ratings'].get(str(game['fs_id']), {}).get('steam_id'))
                for position, game in enumerate(games, 1)
            ])
            self.database.commit()
        except Exception:
            self.database.rollback()
            raise

    def metadata(self):
        row = self.database.execute('SELECT value FROM metadata WHERE id = 1').fetchone()
        if not row:
            raise RuntimeError('Crawler checkpoint has no run metadata')
        return json.loads(row[0])

    def games(self):
        return self.database.execute('SELECT fs_id, game, before_media, igdb_id, steam_id FROM games ORDER BY position').fetchall()

    def results(self):
        return {fs_id: {'after': json.loads(after), 'providers': json.loads(providers), 'complete': bool(complete)}
                for fs_id, after, providers, complete in self.database.execute(
                    'SELECT fs_id, after_media, providers, complete FROM results')}

    def save_game(self, fs_id, after, providers):
        self.database.execute('BEGIN IMMEDIATE')
        try:
            self.database.execute('''
                INSERT INTO results VALUES (?, ?, ?, ?)
                ON CONFLICT(fs_id) DO UPDATE SET after_media=excluded.after_media,
                    providers=excluded.providers, complete=excluded.complete
            ''', (fs_id, json.dumps(after), json.dumps(providers), int(after.get('collection_complete') is True)))
            self.database.commit()
        except Exception:
            self.database.rollback()
            raise

    def close(self):
        database = getattr(self, 'database', None)
        if database:
            database.close()
            self.database = None
        lock = getattr(self, 'lock', None)
        if lock and not lock.closed:
            lock.close()


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


def fetch_validated_igdb_media(game, cached_id, access_token):
    headers = {'Client-ID': TWITCH_CLIENT_ID, 'Authorization': f'Bearer {access_token}', 'Content-Type': 'text/plain'}
    fields = 'id,name,platforms.name,game_type.type,parent_game,version_parent,url'
    title = str(game.get('title_master_s') or game.get('title') or '')
    def query(where):
        try:
            rows = json.loads(read_url('https://api.igdb.com/v4/games', f'fields {fields}; {where} limit 10;'.encode(), headers))
            if not isinstance(rows, list):
                raise ValueError('Invalid IGDB identity response')
            return rows
        finally:
            time.sleep(0.28)
    def acceptable(rows):
        return compatible_igdb_candidates(title, [row for row in rows if isinstance(row, dict)
            and type(row.get('id')) is int and row['id'] > 0
            and normalize_title((row.get('game_type') or {}).get('type')) in {'main game', 'remake', 'remaster', 'port', 'expanded game', 'standalone expansion'}
            and not row.get('parent_game')
            and (not row.get('version_parent') or normalize_title(row.get('name')) == normalize_title(title))
            and safe_url(row.get('url')) and urllib.parse.urlparse(row['url']).hostname == 'www.igdb.com'])
    candidates = acceptable([row for row in query(f'where id = {int(cached_id)};') if row.get('id') == int(cached_id)]) if cached_id else []
    if not candidates:
        escaped = title.replace('\\', '\\\\').replace('"', '\\"')
        candidates = acceptable(query(f'search "{escaped}";'))
    ranked = sorted(candidates, key=lambda row: title_similarity(title, row['name']), reverse=True)
    if not ranked or (len(ranked) > 1 and title_similarity(title, ranked[0]['name']) == title_similarity(title, ranked[1]['name'])):
        return {'source': 'igdb', 'screenshots': [], 'videos': [], 'collection_complete': False}
    identity = ranked[0]
    result = fetch_igdb_media(identity['id'], access_token, identity)
    result['igdb_match'] = {'igdb_id': identity['id'], 'matched_title': identity['name'], 'url': identity['url'], 'last_updated': datetime.now(timezone.utc).isoformat()}
    return result


def fetch_igdb_media(igdb_id, access_token, identity=None):
    result = {'screenshots': [], 'videos': [], 'source': 'igdb', 'collection_complete': True}
    headers = {'Client-ID': TWITCH_CLIENT_ID, 'Authorization': f'Bearer {access_token}', 'Content-Type': 'text/plain'}
    for endpoint, fields in [('screenshots', 'image_id'), ('game_videos', 'name,video_id')]:
        for offset in range(0, 500, 50):
            body = f'fields {fields},game; where game = {int(igdb_id)}; sort id asc; limit 50; offset {offset};'.encode()
            try:
                rows = json.loads(read_url(f'https://api.igdb.com/v4/{endpoint}', body, headers))
                if not isinstance(rows, list):
                    raise ValueError('Invalid IGDB media response')
                for row in rows:
                    if identity is not None and row.get('game') != igdb_id:
                        result['collection_complete'] = False
                        continue
                    if endpoint == 'screenshots' and re.fullmatch(r'[\w-]+', str(row.get('image_id', ''))):
                        result['screenshots'].append(f"https://images.igdb.com/igdb/image/upload/t_1080p/{row['image_id']}.jpg")
                    elif endpoint == 'game_videos' and re.fullmatch(r'[\w-]{11}', str(row.get('video_id', ''))):
                        result['videos'].append({'video_id': row['video_id'], 'name': row.get('name', ''), 'type': 'youtube', 'source': 'igdb', 'youtube_url': f"https://www.youtube.com/embed/{row['video_id']}"})
                if len(rows) < 50:
                    break
            finally:
                time.sleep(0.28)
        else:
            result['collection_complete'] = False
    if identity is not None:
        result['igdb_url'] = identity['url']
        return result
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
            if result.get('igdb_url') and result['igdb_url'] != source['igdb_url']:
                result.setdefault('legacy_igdb_url', result['igdb_url'])
            result['igdb_url'] = source['igdb_url']
        if source.get('igdb_match'):
            result['igdb_match'] = source['igdb_match']
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


def vercel_payload_sizes(existing, updates):
    request_bytes = len(json.dumps(updates).encode())
    projected = dict(existing)
    for fs_id, update in updates.items():
        previous = existing.get(fs_id) or {}
        merged = {**previous, **update}
        merged['screenshots'] = list(dict.fromkeys([*(previous.get('screenshots') or []), *(update.get('screenshots') or [])]))
        videos = {}
        for video in [*(previous.get('videos') or []), *(update.get('videos') or [])]:
            key = f"{video['type']}:{video['video_id']}"
            videos[key] = {**videos.get(key, {}), **{name: value for name, value in video.items() if value is not None and value != ''}}
        merged['videos'] = list(videos.values())
        merged['asset_sources'] = {**(previous.get('asset_sources') or {}), **(update.get('asset_sources') or {})}
        projected[fs_id] = merged
    response_bytes = len(json.dumps(projected, separators=(',', ':')).encode())
    return request_bytes, response_bytes


def preflight_vercel_publish(existing, updates, base_url):
    hostname = urllib.parse.urlparse(base_url).hostname or ''
    if hostname != 'vercel.app' and not hostname.endswith('.vercel.app'):
        return
    request_bytes, response_bytes = vercel_payload_sizes(existing, updates)
    if request_bytes > VERCEL_BODY_LIMIT or response_bytes > VERCEL_BODY_LIMIT:
        raise RuntimeError(f'Vercel media payload exceeds the 4.5 MB function limit (request={request_bytes}, response={response_bytes}); no write attempted')


def build_manifest(metadata, games, results):
    updates, records, outcomes = {}, {}, {}
    for fs_id, game_json, before_json, _, _ in games:
        result = results.get(fs_id)
        if not result:
            continue
        after = result['after']
        if after.get('screenshots') or after.get('videos') or after.get('steam_match'):
            updates[fs_id] = after
            records[fs_id] = {'before': json.loads(before_json) if before_json else None, 'after': after}
        outcomes[fs_id] = {'title': json.loads(game_json).get('title', ''), 'complete': result['complete'], 'providers': result['providers']}
    complete_count = sum(result['complete'] for result in results.values())
    manifest = {
        'base_url': metadata['base_url'], 'revision': metadata['revision'],
        'run_id': metadata['run_id'], 'created_at': metadata['created_at'],
        'catalog_count': metadata['catalog_count'], 'selected_count': len(games),
        'checkpointed_count': len(results), 'complete_count': complete_count,
        'incomplete_count': len(results) - complete_count,
        'pending_count': len(games) - len(results), 'records': records, 'outcomes': outcomes,
        'payload_bytes': len(json.dumps(updates).encode()),
    }
    return manifest, updates


def write_manifest(path, metadata, games, results):
    manifest, updates = build_manifest(metadata, games, results)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
    return manifest, updates


def new_run_path():
    root = Path(__file__).resolve().parents[1] / 'output' / 'media-crawls'
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"


def default_manifest_path(run_dir):
    path = Path(run_dir) / 'staged-manifest.json'
    index = 2
    while path.exists():
        path = Path(run_dir) / f'staged-manifest-{index}.json'
        index += 1
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description='Merge media (dry-run by default)')
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--apply-manifest', help='Previously staged manifest reviewed for this exact --resume checkpoint')
    parser.add_argument('--game-id')
    parser.add_argument('--all', action='store_true', help='Refresh the entire eligible catalog, including existing complete entries; ignores --limit')
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--refresh-incomplete', action='store_true', help='Revisit legacy or incomplete cached records')
    parser.add_argument('--output', help='Write staged before/after records to a new file; never overwrite')
    run_group = parser.add_mutually_exclusive_group()
    run_group.add_argument('--run-dir', help='Create a new resumable local crawler run in this unused directory')
    run_group.add_argument('--resume', help='Resume or export an existing crawler run directory')
    parser.add_argument('--retry-incomplete', action='store_true', help='Retry committed games with incomplete provider results; requires --resume')
    parser.add_argument('--export-only', action='store_true', help='Export the current checkpoint without contacting providers; requires --resume')
    args = parser.parse_args(argv)
    if args.all and args.game_id:
        parser.error('--all and --game-id are mutually exclusive')
    if not 1 <= args.limit <= 100 or (args.game_id and not args.game_id.isdigit()):
        parser.error('invalid game ID or limit (1-100)')
    if (args.retry_incomplete or args.export_only) and not args.resume:
        parser.error('--retry-incomplete and --export-only require --resume')
    if args.resume and (args.all or args.game_id or args.refresh_incomplete):
        parser.error('--resume uses its frozen selection; do not pass selection flags')
    if args.export_only and args.apply:
        parser.error('--export-only cannot be combined with --apply')
    if args.apply and not args.resume:
        parser.error('--apply requires a completed --resume run')
    if args.apply and not args.apply_manifest:
        parser.error('--apply requires --apply-manifest with the reviewed staged manifest')
    if args.apply_manifest and not args.apply:
        parser.error('--apply-manifest requires --apply')
    if args.apply and args.output:
        parser.error('--apply cannot be combined with --output')
    if args.apply and args.retry_incomplete:
        parser.error('--apply cannot be combined with --retry-incomplete')
    key = os.environ.get('RATINGS_API_KEY', '')
    if args.apply and not key:
        parser.error('--apply requires RATINGS_API_KEY')
    base_url = args.base_url.rstrip('/')
    if args.output and Path(args.output).exists():
        parser.error('--output must name a new file')
    if args.apply_manifest and not Path(args.apply_manifest).is_file():
        parser.error('--apply-manifest must name an existing staged manifest')
    if args.run_dir and Path(args.run_dir).exists():
        parser.error('--run-dir must name a new, unused directory')

    if args.resume:
        checkpoint = RunCheckpoint(args.resume)
        try:
            metadata = checkpoint.metadata()
            if metadata.get('base_url') != base_url:
                raise RuntimeError('Resume target does not match the target frozen in this crawler run')
            if metadata.get('schema_version') != 1:
                raise RuntimeError('Unsupported crawler checkpoint schema version')
            games = checkpoint.games()
            results = checkpoint.results()
            if metadata.get('selected_count') != len(games):
                raise RuntimeError('Crawler checkpoint selection does not match its frozen metadata')
            if args.export_only:
                manifest_path = Path(args.output) if args.output else default_manifest_path(args.resume)
                manifest, _ = write_manifest(manifest_path, metadata, games, results)
                print(f"Exported {manifest['checkpointed_count']}/{manifest['selected_count']} checkpointed games to {manifest_path}; no providers contacted")
                checkpoint.close()
                return
        except Exception:
            checkpoint.close()
            raise
    else:
        existing, revision = read_snapshot(base_url, '/api/media')
        ratings, _ = read_snapshot(base_url, '/api/ratings')
        steam_ratings, _ = read_snapshot(base_url, '/api/steam')
        catalog = fetch_all_games(args.game_id)
        selected = [game for game in catalog if not is_blocked_title(game.get('title'))
            and (args.game_id or is_active_deal(game))
            and (args.all or args.game_id or str(game['fs_id']) not in existing or (args.refresh_incomplete and (existing.get(str(game['fs_id'])) or {}).get('collection_complete') is not True))]
        if not args.all:
            selected = selected[:args.limit]
        run_dir = Path(args.run_dir) if args.run_dir else new_run_path()
        metadata = {
            'schema_version': 1, 'run_id': run_dir.name, 'run_dir': str(run_dir.resolve()),
            'base_url': base_url, 'revision': revision, 'created_at': datetime.now(timezone.utc).isoformat(),
            'catalog_count': len(catalog), 'selected_count': len(selected), 'all': args.all,
            'existing': existing, 'ratings': ratings, 'steam_ratings': steam_ratings,
        }
        checkpoint = RunCheckpoint(run_dir, create=True)
        try:
            checkpoint.initialize(metadata, selected)
            games = checkpoint.games()
            results = {}
            print(f"Run directory: {run_dir}", flush=True)
            print(f'Selected {len(selected)} games from {len(catalog)} distinct catalog records; all={args.all}', flush=True)
        except Exception:
            checkpoint.close()
            raise

    try:
        metadata = checkpoint.metadata()
        frozen_games = checkpoint.games()
        results = checkpoint.results()
        if args.apply and (len(results) != len(frozen_games) or any(not result['complete'] for result in results.values())):
            raise RuntimeError('Refusing to publish an incomplete checkpoint; finish acquisition and review its manifest first')
        work = []
        for row in frozen_games:
            fs_id = row[0]
            result = results.get(fs_id)
            if result and (not args.retry_incomplete or result['complete']):
                continue
            work.append(row)
        token = None
        if TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET and work:
            body = urllib.parse.urlencode({'client_id': TWITCH_CLIENT_ID, 'client_secret': TWITCH_CLIENT_SECRET, 'grant_type': 'client_credentials'}).encode()
            token = json.loads(read_url('https://id.twitch.tv/oauth2/token', body))['access_token']
        for fs_id, game_json, before_json, igdb_id, steam_id in work:
            game = json.loads(game_json)
            prior_result = results.get(fs_id)
            previous = (prior_result['after'] if prior_result else (json.loads(before_json) if before_json else None)) or {}
            if not isinstance(previous, dict):
                previous = {}
            sources, providers = [], {}
            try:
                source = fetch_nintendo_gallery(game['url'])
                sources.append(source)
                providers['nintendo'] = {'attempted': True, 'complete': source.get('collection_complete') is True,
                    'screenshots': len(source.get('screenshots', [])), 'videos': len(source.get('videos', []))}
            except Exception as error:
                print(f'{fs_id}: Nintendo acquisition failed ({type(error).__name__}); cached assets retained', flush=True)
                sources.append({'source': 'nintendo', 'collection_complete': False})
                providers['nintendo'] = {'attempted': True, 'complete': False, 'error': type(error).__name__}
            if token:
                try:
                    source = fetch_validated_igdb_media(game, igdb_id, token)
                    sources.append(source)
                    providers['igdb'] = {'attempted': True, 'complete': source.get('collection_complete') is True,
                        'screenshots': len(source.get('screenshots', [])), 'videos': len(source.get('videos', []))}
                except Exception as error:
                    print(f'{fs_id}: IGDB acquisition failed ({type(error).__name__}); cached assets retained', flush=True)
                    sources.append({'source': 'igdb', 'collection_complete': False})
                    providers['igdb'] = {'attempted': True, 'complete': False, 'error': type(error).__name__}
            else:
                sources.append({'source': 'igdb', 'collection_complete': False})
                providers['igdb'] = {'attempted': False, 'complete': False, 'reason': 'credentials_unavailable'}
            try:
                known_id = previous.get('steam_match', {}).get('steam_id') or steam_id
                details = steam.get_validated_steam_details(game, known_id)
                if details:
                    source = steam_media(details)
                    sources.append(source)
                providers['steam'] = {'attempted': True, 'complete': True, 'matched': bool(details),
                    'screenshots': len(source.get('screenshots', [])) if details else 0,
                    'videos': len(source.get('videos', [])) if details else 0}
            except Exception as error:
                print(f'{fs_id}: Steam acquisition failed ({type(error).__name__}); cached assets retained', flush=True)
                sources.append({'source': 'steam', 'collection_complete': False})
                providers['steam'] = {'attempted': True, 'complete': False, 'error': type(error).__name__}
            merged = merge_media(previous, sources)
            checkpoint.save_game(fs_id, merged, providers)
            results[fs_id] = {'after': merged, 'providers': providers, 'complete': merged['collection_complete'] is True}
            print(f"[{len(results)}/{len(frozen_games)}] {fs_id}: {len(merged['screenshots'])} images, {len(merged['videos'])} videos; complete={merged['collection_complete']}", flush=True)

        manifest, updates = build_manifest(metadata, frozen_games, results)
        if args.apply:
            reviewed_manifest = json.loads(Path(args.apply_manifest).read_text(encoding='utf-8'))
            if reviewed_manifest != manifest:
                raise RuntimeError('Reviewed manifest does not match the current checkpoint; stage and review a fresh manifest before applying')
            manifest_path = Path(args.apply_manifest)
        else:
            manifest_path = Path(args.output) if args.output else default_manifest_path(checkpoint.path)
            manifest, updates = write_manifest(manifest_path, metadata, frozen_games, results)
        print(f"Staged {manifest['checkpointed_count']}/{manifest['selected_count']} games in {manifest_path}; complete={manifest['complete_count']}, incomplete={manifest['incomplete_count']}, pending={manifest['pending_count']}; preferences untouched", flush=True)
        if args.apply and updates:
            if manifest['pending_count'] or manifest['incomplete_count']:
                raise RuntimeError('Refusing to publish an incomplete crawler run; staged manifest retained and no write attempted')
            preflight_vercel_publish(metadata['existing'], updates, base_url)
            print('Published:', save_to_vercel(updates, base_url, key, metadata['revision']))
        elif args.apply:
            print('No media to publish.')
        else:
            print('DRY RUN: no API writes performed.')
    finally:
        checkpoint.close()


if __name__ == '__main__':
    main()
