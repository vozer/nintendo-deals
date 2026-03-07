#!/usr/bin/env python3
"""Fetch media (screenshots + videos) for all Nintendo deals games.

Primary source: Nintendo game pages (_gItems.push scraping)
Fallback: IGDB screenshots + YouTube videos API

Saves to Vercel Blob via PUT /api/media.
Designed to run as daily cron on Raspberry Pi alongside n8n ratings workflow.
"""
import json, time, re, urllib.request, urllib.parse, sys, os

TWITCH_CLIENT_ID = "REDACTED_TWITCH_CLIENT_ID"
TWITCH_CLIENT_SECRET = "REDACTED_TWITCH_CLIENT_SECRET"
IGDB_SCREENSHOTS_URL = "https://api.igdb.com/v4/screenshots"
IGDB_VIDEOS_URL = "https://api.igdb.com/v4/game_videos"
NINTENDO_BASE = "https://www.nintendo.com"
VERCEL_API = "https://nintendo-deals.vercel.app"
API_KEY = "REDACTED_RATINGS_API_KEY"
SAVE_EVERY = 50
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


def save_to_vercel(media_map):
    payload = json.dumps(media_map).encode()
    req = urllib.request.Request(
        f"{VERCEL_API}/api/media",
        data=payload, method='PUT',
        headers={'Content-Type': 'application/json', 'x-api-key': API_KEY}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  ERROR saving: {e.code} {e.read().decode()}", flush=True)
        return None


def fetch_all_games():
    """Fetch all games with pagination."""
    all_games = []
    start = 0
    while True:
        params = urllib.parse.urlencode({
            'q': '*',
            'fq': 'type:GAME AND system_type:nintendoswitch* AND price_has_discount_b:true AND price_sorting_f:[0 TO 14.99] AND language_availability:*english* AND digital_version_b:true',
            'rows': str(BATCH_SIZE), 'start': str(start), 'wt': 'json', 'sort': 'popularity asc'
        })
        req = urllib.request.Request(f"https://searching.nintendo-europe.com/es/select?{params}")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8', errors='replace'))
        docs = data['response']['docs']
        total = data['response']['numFound']
        all_games.extend(docs)
        print(f"  Fetched {len(all_games)}/{total} games", flush=True)
        if len(all_games) >= total:
            break
        start += BATCH_SIZE
    return all_games


# --- Main ---
print(f"=== Media Backfill ===", flush=True)
print(f"Started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n", flush=True)

# Fetch existing media
print("Loading existing media from Blob...", flush=True)
try:
    req = urllib.request.Request(f"{VERCEL_API}/api/media")
    with urllib.request.urlopen(req) as resp:
        existing_media = json.loads(resp.read())
except Exception:
    existing_media = {}
print(f"Existing: {len(existing_media)} entries\n", flush=True)

# Fetch all games
print("Fetching all Nintendo deals...", flush=True)
games = fetch_all_games()
print(f"Total: {len(games)} games\n", flush=True)

# Fetch ratings for IGDB IDs
print("Fetching ratings...", flush=True)
req = urllib.request.Request(f"{VERCEL_API}/api/ratings")
with urllib.request.urlopen(req) as resp:
    ratings = json.loads(resp.read())
print(f"Ratings: {len(ratings)}\n", flush=True)

# Filter to games without media
new_games = [g for g in games if g['fs_id'] not in existing_media]
print(f"Games needing media: {len(new_games)}\n", flush=True)

if not new_games:
    print("All games already have media. Done!", flush=True)
    sys.exit(0)

# Twitch token
print("Getting Twitch token...", flush=True)
data = urllib.parse.urlencode({
    'client_id': TWITCH_CLIENT_ID, 'client_secret': TWITCH_CLIENT_SECRET,
    'grant_type': 'client_credentials'
}).encode()
req = urllib.request.Request("https://id.twitch.tv/oauth2/token", data=data, method='POST')
with urllib.request.urlopen(req) as resp:
    access_token = json.loads(resp.read())['access_token']

# Process
media_map = dict(existing_media)
stats = {'nintendo': 0, 'igdb': 0, 'none': 0, 'saved': 0}

for i, game in enumerate(new_games):
    fs_id = game['fs_id']
    title = game['title']
    page_url = game.get('url', '')

    nintendo_media = fetch_nintendo_gallery(page_url)
    if nintendo_media:
        stats['nintendo'] += 1
        igdb_id = ratings.get(fs_id, {}).get('igdb_id')
        youtube_videos = []
        igdb_url = None
        if igdb_id:
            time.sleep(0.28)
            igdb_data = fetch_igdb_media(igdb_id, access_token)
            if igdb_data and igdb_data['videos']:
                youtube_videos = igdb_data['videos']
            matched = ratings.get(fs_id, {}).get('matched_title', '')
            if matched:
                igdb_url = f"https://www.igdb.com/games/{matched.lower().replace(' ', '-').replace(':', '')}"
        media_map[fs_id] = {
            'screenshots': nintendo_media['screenshots'],
            'videos': youtube_videos or nintendo_media['videos'],
            'igdb_url': igdb_url,
            'source': 'nintendo',
            'last_updated': time.strftime('%Y-%m-%d'),
        }
    else:
        igdb_id = ratings.get(fs_id, {}).get('igdb_id')
        if igdb_id:
            time.sleep(0.28)
            igdb_data = fetch_igdb_media(igdb_id, access_token)
            if igdb_data:
                stats['igdb'] += 1
                matched = ratings.get(fs_id, {}).get('matched_title', '')
                igdb_url = f"https://www.igdb.com/games/{matched.lower().replace(' ', '-').replace(':', '')}" if matched else None
                media_map[fs_id] = {
                    'screenshots': igdb_data['screenshots'],
                    'videos': igdb_data['videos'],
                    'igdb_url': igdb_url,
                    'source': 'igdb',
                    'last_updated': time.strftime('%Y-%m-%d'),
                }
            else:
                stats['none'] += 1
        else:
            stats['none'] += 1

    if (i + 1) % 10 == 0:
        m = media_map.get(fs_id)
        src = m['source'] if m else 'NONE'
        print(f"  [{i+1}/{len(new_games)}] {title} -> {src}", flush=True)

    if (i + 1) % SAVE_EVERY == 0:
        print(f"  Incremental save ({len(media_map)} entries)...", flush=True)
        result = save_to_vercel(media_map)
        if result:
            stats['saved'] += 1
            print(f"  Saved: {result}", flush=True)

    time.sleep(0.3)

# Final save
print(f"\nFinal save ({len(media_map)} entries)...", flush=True)
result = save_to_vercel(media_map)
print(f"Result: {result}", flush=True)

print(f"\n=== Done ===", flush=True)
print(f"Nintendo: {stats['nintendo']}, IGDB: {stats['igdb']}, None: {stats['none']}", flush=True)
print(f"Total media entries: {len(media_map)}", flush=True)
print(f"Finished: {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
