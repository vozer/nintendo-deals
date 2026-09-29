"""Refresh the NT Deals Spanish Switch deal-pick snapshot (dry-run by default)."""

import argparse
from datetime import datetime, timezone
import json
import os
import time
import urllib.parse
import urllib.request
import uuid

from automation.curated_sources import match_exact_catalog_title, parse_ntdeals_games
from automation.content_policy import ORIGINAL_SWITCH_FILTER

NTDEALS_URL = "https://ntdeals.net/es-store/discounts"
SOLR_URL = "https://searching.nintendo-europe.com/es/select"


def fetch_page(scraper, page):
    url = f"{NTDEALS_URL}?platforms=switch&sort=best-new-deals&page={page}"
    response = scraper.get(url, timeout=25)
    if response.status_code != 200:
        raise RuntimeError(f"NT Deals page {page} returned HTTP {response.status_code}")
    games = parse_ntdeals_games(response.text)
    if not games and "game-collection-item" in response.text:
        raise RuntimeError(f"NT Deals page {page} contained no recognizable products")
    return games


def search_solr(title):
    params = urllib.parse.urlencode({
        "q": title,
        "defType": "edismax",
        "qf": "title^3 title_master_s^3",
        "fq": f"type:GAME AND {ORIGINAL_SWITCH_FILTER}",
        "rows": "100",
        "wt": "json",
        "fl": "fs_id,title,title_master_s,system_type",
    })
    with urllib.request.urlopen(f"{SOLR_URL}?{params}", timeout=20) as response:
        data = json.loads(response.read())
    docs = data.get("response", {}).get("docs", [])
    if not isinstance(docs, list):
        raise RuntimeError(f"Nintendo catalog returned an invalid match list for {title!r}")
    return match_exact_catalog_title(title, docs)


def build_entries(games, run_id, refreshed_at):
    entries = {}
    for index, game in enumerate(games, start=1):
        if not game.get("title") or game.get("price") is None:
            raise RuntimeError(f"NT Deals product {index} is missing its title or current price")
        fs_id = search_solr(game["title"])
        if not fs_id:
            print(f"  [-] {game['title']} -> no exact original-Switch match")
            continue

        product_url = urllib.parse.urljoin(NTDEALS_URL, game.get("href") or "")
        entry = {
            "title": game["title"],
            "review": "",
            "source_url": product_url,
            "source_reference": game.get("sku") or game.get("href") or product_url,
            "source_platform": "nintendoswitch",
            "source_price_eur": game["price"],
            "source": "ntdeals",
            "refreshed_at": refreshed_at,
            "run_id": run_id,
        }
        for source_field, target_field in (
            ("discount_pct", "discount_pct"),
            ("days_remaining", "days_remaining"),
            ("metacritic_score", "metacritic_score"),
        ):
            if game.get(source_field) is not None:
                entry[target_field] = game[source_field]
        entries[fs_id] = entry
        print(f"  [+] {game['title']} -> fs_id={fs_id}")
        time.sleep(0.2)
    return entries


def publish_entries(base_url, api_key, entries):
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/curated",
        data=json.dumps({"source": "ntdeals", "entries": entries}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main(argv=None):
    parser = argparse.ArgumentParser(description="Refresh NT Deals Spain Switch deal picks")
    parser.add_argument("--pages", type=int, default=int(os.environ.get("NTDEALS_PAGES", "5")))
    parser.add_argument("--base-url", help="Explicit Nintendo Deals API target; required with --apply")
    parser.add_argument("--apply", action="store_true", help="Publish the source snapshot; default is dry-run")
    args = parser.parse_args(argv)
    if args.pages < 1 or args.pages > 20:
        parser.error("--pages must be between 1 and 20")
    if args.apply and not args.base_url:
        parser.error("--apply requires an explicit --base-url target")
    api_key = os.environ.get("RATINGS_API_KEY", "").strip()
    if args.apply and not api_key:
        parser.error("--apply requires RATINGS_API_KEY")

    try:
        import cloudscraper
    except ImportError as error:
        raise RuntimeError("cloudscraper is required; install the pinned automation requirements") from error

    scraper = cloudscraper.create_scraper()
    all_games = []
    seen_products = set()
    for page in range(1, args.pages + 1):
        print(f"Fetching NT Deals page {page} of {args.pages}")
        games = fetch_page(scraper, page)
        if not games:
            break
        new_count = 0
        for game in games:
            key = game.get("sku") or (game["title"], game.get("price"))
            if key not in seen_products:
                seen_products.add(key)
                all_games.append(game)
                new_count += 1
        if new_count == 0:
            break
        time.sleep(1)

    if not all_games:
        raise RuntimeError("NT Deals returned no products; refusing to publish an empty snapshot")

    run_id = uuid.uuid4().hex[:12]
    entries = build_entries(all_games, run_id, datetime.now(timezone.utc).isoformat())
    if not entries:
        raise RuntimeError("No exact original-Switch matches; refusing to publish an empty snapshot")
    print(f"NT Deals: {len(all_games)} products, {len(entries)} exact matches, run {run_id}")
    if not args.apply:
        print("DRY RUN: no API writes performed. Pass --apply and an explicit --base-url to publish.")
        return entries

    print("Published source snapshot:", publish_entries(args.base_url, api_key, entries))
    return entries


if __name__ == "__main__":
    main()
