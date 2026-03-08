import urllib.request
import urllib.parse
import json
import time
import re
import sys
import os
import unicodedata
from difflib import SequenceMatcher

# Configuration
API_KEY = os.environ.get('RATINGS_API_KEY', 'REDACTED_RATINGS_API_KEY') # Fallback to known key from previous context if env var missing
BASE_URL = "https://nintendo-deals.vercel.app"
SAVE_EVERY = 20

def slugify(value):
    value = str(value)
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value.lower())
    return re.sub(r'[-\s]+', ' ', value).strip()

def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()

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

def get_steam_rating(appid):
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        res = urllib.request.urlopen(url)
        data = json.loads(res.read())
        if data[str(appid)]['success']:
            d = data[str(appid)]['data']
            # Metacritic
            # meta = d.get('metacritic', {}).get('score')
            # Recommendations (proxy for votes?)
            # No, 'recommendations' is just a count. 
            # We need percent positive. AppDetails doesn't give it directly!
            # Use SteamSpy approach or store search HTML scraping?
            # User wants "ratings". Recommendations count is a popularity metric.
            # Metacritic score is available in API.
            # But the user specifically wanted "Bad End Theater" (25 IGDB vs 3700 Steam).
            # We need REVIEW COUNT and SCORE.
            # AppDetails DOES NOT provide review count/score directly.
            # We can use the 'user_reviews' query parameter for appdetails? No.
            # We can scrape the store page.
            
            return True, d.get('metacritic', {}).get('score')
    except:
        pass
    return False, None

def get_steam_review_stats(appid):
    # AppDetails doesn't provide review stats. We must scrape the store page or use a 3rd party API (SteamSpy).
    # Scraping store page is safest.
    url = f"https://store.steampowered.com/app/{appid}/"
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Nintendo Deals Bot)', 'Accept-Language': 'en-US,en;q=0.5'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode('utf-8')
            # Look for: <meta itemprop="ratingValue" content="5"/> (No, that's age rating)
            # Look for: "user_reviews_summary_bar"
            # data-tooltip-html="Overwhelmingly Positive<br>96% of the 3,752 user reviews..."
            
            match = re.search(r'data-tooltip-html="([^"]+)"', html)
            if match:
                tooltip = match.group(1)
                # "Very Positive<br>92% of the 1,234 user reviews..."
                # Extract % and count
                pct_match = re.search(r'(\d+)%', tooltip)
                count_match = re.search(r'([\d,]+) user reviews', tooltip)
                
                if pct_match and count_match:
                    pct = int(pct_match.group(1))
                    count = int(count_match.group(1).replace(',', ''))
                    return pct, count
    except Exception as e:
        # print(f"Error scraping {appid}: {e}")
        pass
    return None, None

def main():
    # 1. Load existing steam ratings
    print("Loading existing steam ratings...")
    existing = {}
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/steam", method='GET')
        with urllib.request.urlopen(req) as res:
            existing = json.loads(res.read())
            print(f"Loaded {len(existing)} existing ratings.")
    except:
        print("No existing ratings found.")

    # 2. Fetch Nintendo games
    print("Fetching Nintendo games...")
    solr_url = "https://searching.nintendo-europe.com/es/select?q=*&fq=type:GAME%20AND%20system_type:nintendoswitch*%20AND%20price_has_discount_b:true%20AND%20price_sorting_f:%5B0%20TO%2014.99%5D%20AND%20language_availability:*english*%20AND%20digital_version_b:true&sort=popularity%20asc&start=0&rows=3000&wt=json"
    res = urllib.request.urlopen(solr_url)
    n_games = json.loads(res.read())['response']['docs']
    print(f"Loaded {len(n_games)} Nintendo games.")

    # 3. Fetch Steam Apps
    steam_apps = fetch_steam_app_list()
    # Build simple index for exact match
    steam_index = {slugify(app['name']): app['appid'] for app in steam_apps if app['name']}
    
    # 4. Match and Update
    updates = 0
    save_counter = 0
    
    for game in n_games:
        fs_id = game['fs_id']
        if fs_id in existing:
            continue # Skip if already processed
            
        title = game['title']
        slug = slugify(title)
        
        # Exact match
        appid = steam_index.get(slug)
        
        # Fuzzy match if no exact
        if not appid:
            # Optimization: filter by first char or length to reduce comparisons?
            # Or just skip fuzzy for now to keep it fast?
            # Let's try basic fuzzy on a subset? No, 150k is too many.
            # Just do exact match + "The " removal
            if slug.startswith("the "):
                appid = steam_index.get(slug[4:])
            
            # Common Switch suffixes
            if not appid:
                clean_slug = slug.replace(" definitive edition", "").replace(" deluxe edition", "").replace(" complete edition", "")
                appid = steam_index.get(clean_slug)

        if appid:
            # Fetch rating
            print(f"Match: {title} -> AppID {appid}")
            pct, count = get_steam_review_stats(appid)
            if pct is not None:
                existing[fs_id] = {
                    "steam_id": appid,
                    "score_pct": pct,
                    "votes": count,
                    "url": f"https://store.steampowered.com/app/{appid}/",
                    "matched_title": title
                }
                print(f"  -> {pct}% ({count} votes)")
                updates += 1
                save_counter += 1
                time.sleep(1.5) # Rate limit respect
            else:
                print("  -> No rating found")
                # Mark as checked? No, maybe retry later
        
        if save_counter >= SAVE_EVERY:
            print("Saving batch...")
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

    # Final save
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

if __name__ == "__main__":
    main()
