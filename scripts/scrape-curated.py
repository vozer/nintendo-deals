import urllib.request
import urllib.parse
import json
import re
import os
import ssl

# Configuration
API_KEY = os.environ.get('RATINGS_API_KEY', 'REDACTED_RATINGS_API_KEY')
BASE_URL = "https://nintendo-deals.vercel.app"

# Sources to scrape
SOURCES = [
    "https://www.nintendolife.com/guides/best-nintendo-switch-games",
    "https://www.nintendolife.com/guides/best-switch-games-for-short-sessions",
    "https://www.nintendolife.com/guides/best-switch-rpgs",
    "https://www.nintendolife.com/guides/best-switch-platformers",
    "https://www.nintendolife.com/guides/best-switch-fps-games",
    "https://www.nintendolife.com/guides/best-switch-puzzle-games",
    "https://www.nintendolife.com/guides/best-switch-strategy-games",
    "https://www.nintendolife.com/guides/best-switch-adventure-games",
    "https://www.nintendolife.com/guides/best-switch-metroidvania-games",
    "https://www.nintendolife.com/guides/best-switch-roguelikes-roguelites-and-run-based-games",
]

def fetch_html(url):
    print(f"Scraping {url}...")
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    )
    # Ignore SSL errors for scraping if needed (shouldn't be for nintendolife)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx) as res:
            return res.read().decode('utf-8')
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return ""

def extract_titles(html):
    # NintendoLife uses <h2> for game titles in guides
    # <h2><a href="...">The Legend of Zelda...</a></h2>
    # or just <h2>Title</h2>
    titles = []
    # Pattern: <h2>.*?<a.*?>(.*?)</a>.*?</h2> OR <h2>(.*?)</h2>
    # But usually simple regex finding text inside h2 is enough
    matches = re.findall(r'<h2[^>]*>(?:<a[^>]*>)?(.*?)(?:</a>)?</h2>', html)
    for m in matches:
        # Clean up
        clean = re.sub(r'<[^>]+>', '', m).strip()
        # Remove ranking numbers if present (e.g., "1. Zelda")
        clean = re.sub(r'^\d+\.\s+', '', clean)
        if clean and len(clean) < 100: # Sanity check
            titles.append(clean)
    return titles

def main():
    all_titles = set()
    
    for url in SOURCES:
        html = fetch_html(url)
        titles = extract_titles(html)
        print(f"Found {len(titles)} titles.")
        for t in titles:
            all_titles.add(t)
            
    print(f"Total unique curated games: {len(all_titles)}")
    
    # Save to API
    sorted_list = sorted(list(all_titles))
    
    print("Saving to API...")
    req = urllib.request.Request(
        f"{BASE_URL}/api/curated",
        data=json.dumps(sorted_list).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-api-key': API_KEY},
        method='PUT'
    )
    try:
        urllib.request.urlopen(req)
        print("Success!")
    except Exception as e:
        print(f"Save failed: {e}")

if __name__ == "__main__":
    main()
