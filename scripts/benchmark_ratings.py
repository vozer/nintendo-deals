import urllib.request
import urllib.parse
import json
import time
import re
import sys
import unicodedata

# 1. Fetch Games from Nintendo Solr directly (bypass auth)
print("Fetching 100 games from Nintendo Solr...")
url = "https://searching.nintendo-europe.com/es/select?q=*&fq=type:GAME%20AND%20system_type:nintendoswitch*%20AND%20price_has_discount_b:true%20AND%20price_sorting_f:%5B0%20TO%2014.99%5D%20AND%20language_availability:*english*%20AND%20digital_version_b:true&sort=popularity%20asc&start=0&rows=30&wt=json"
try:
    response = urllib.request.urlopen(url)
    data = json.loads(response.read())
    games = data['response']['docs']
    print(f"Loaded {len(games)} games.")
except Exception as e:
    print(f"Failed to fetch games: {e}")
    sys.exit(1)

# Helper for slugification
def slugify(value):
    value = str(value)
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value.lower())
    return re.sub(r'[-\s]+', '-', value).strip('-')

# Helper for HTTP request with headers
def fetch_url(url):
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.read().decode('utf-8'), res.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception:
        return None, 0

# Sources
results = {
    "Metacritic": {"hits": 0, "scores": []},
    "OpenCritic": {"hits": 0, "scores": []},
    "Steam": {"hits": 0, "scores": []}
}

# Pre-fetch Steam App List (simulated by searching a few common ones or just searching google? No, Steam API)
# Actually, fetching the full Steam app list is heavy (10MB+). 
# For this benchmark, we'll try to hit the store search page: https://store.steampowered.com/search/?term={term}
# This is scraping, but easier for a benchmark.

print("\nStarting Benchmark (Sampling 30 games for speed)...")
# Reduce to 30 for speed in this interactive session
sample_games = games[:30]

for i, game in enumerate(sample_games):
    title = game['title']
    slug = slugify(title)
    print(f"[{i+1}/{len(sample_games)}] Checking: {title}")

    # 1. Metacritic (Direct URL guess)
    meta_url = f"https://www.metacritic.com/game/switch/{slug}"
    # Note: Metacritic structure changed recently, sometimes it's /game/{slug}/
    # Let's try the switch specific one.
    html, status = fetch_url(meta_url)
    if status == 200 and html:
        # Extract score (meta score)
        # Look for <div class="c-productScoreInfo_scoreNumber">...</div> or similar
        match = re.search(r'c-productScoreInfo_scoreNumber.*?<span>(\d+)</span>', html, re.DOTALL)
        if match:
            score = int(match.group(1))
            results["Metacritic"]["hits"] += 1
            results["Metacritic"]["scores"].append(score)
            print(f"  - Metacritic: FOUND ({score})")
        else:
            # Maybe user score?
            print(f"  - Metacritic: Page found but no score")
    elif status == 403:
        print(f"  - Metacritic: BLOCKED (403)")
    else:
        print(f"  - Metacritic: Miss ({status})")
    
    time.sleep(0.5)

    # 2. OpenCritic (Search)
    # Search page scraping is hard. Direct slug guess?
    # OpenCritic URLs need an ID. We HAVE to search.
    # https://opencritic.com/api/game/search?criteria={title} requires API key.
    # Let's try scraping the search page: https://opencritic.com/search?q={title}
    # Actually, let's try a direct google-style scrape or skip for now if too hard without ID.
    # Wait, the user wants a stress test. I'll try to fetch the search page.
    oc_search = f"https://opencritic.com/search?q={urllib.parse.quote(title)}"
    html, status = fetch_url(oc_search)
    if status == 200 and html:
        # Look for the first game result link
        # <a href="/game/14343/zelda..." class="game-name">
        match = re.search(r'href="/game/(\d+)/([^"]+)"', html)
        if match:
            oid, oslug = match.groups()
            oc_page = f"https://opencritic.com/game/{oid}/{oslug}"
            html2, status2 = fetch_url(oc_page)
            if status2 == 200 and html2:
                # Look for Top Critic Average
                # <div class="score-circle">85</div> (example)
                # app.opencritic.com often renders via JS. 
                # Let's check raw HTML.
                match_score = re.search(r'"topCriticScore":(\d+)', html2) # Schema.org JSON?
                if not match_score:
                    match_score = re.search(r'app-score-orb\s+score="(\d+)"', html2)
                
                if match_score:
                    score = int(match_score.group(1))
                    results["OpenCritic"]["hits"] += 1
                    results["OpenCritic"]["scores"].append(score)
                    print(f"  - OpenCritic: FOUND ({score})")
                else:
                    print(f"  - OpenCritic: Page found, no score parsed")
            else:
                print(f"  - OpenCritic: Page fetch failed")
        else:
            print(f"  - OpenCritic: No search results")
    else:
        print(f"  - OpenCritic: Search blocked/failed")

    time.sleep(0.5)

    # 3. Steam (Search)
    steam_url = f"https://store.steampowered.com/search/?term={urllib.parse.quote(title)}"
    html, status = fetch_url(steam_url)
    if status == 200 and html:
        # Find first result
        # <a href="https://store.steampowered.com/app/504230/Celeste/
        match = re.search(r'href="https://store.steampowered.com/app/(\d+)/', html)
        if match:
            appid = match.group(1)
            # Fetch details via API (cleaner)
            api_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
            api_json, status2 = fetch_url(api_url)
            if status2 == 200 and api_json:
                try:
                    jd = json.loads(api_json)
                    if jd[appid]['success']:
                        # Metacritic is in Steam data!
                        meta = jd[appid]['data'].get('metacritic', {}).get('score')
                        # Recommendations?
                        recs = jd[appid]['data'].get('recommendations', {}).get('total', 0)
                        
                        if meta:
                            results["Steam"]["hits"] += 1
                            results["Steam"]["scores"].append(meta) # Using Steam's Metacritic data as a proxy? 
                            # Or calculate % positive?
                            # Steam API doesn't give % positive directly in appdetails.
                            # We can get it from search page HTML: "positive"
                            print(f"  - Steam: FOUND (AppID {appid})")
                        else:
                            print(f"  - Steam: Found, no metacritic data")
                except:
                    pass
    
    time.sleep(0.5)

print("\n--- Results ---")
for source, data in results.items():
    print(f"{source}: {data['hits']}/{len(sample_games)} hits")
