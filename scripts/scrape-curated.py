import argparse
from datetime import datetime, timezone
import json
import os
import urllib.parse
import urllib.request
import time
import uuid
from urllib.parse import urljoin

from automation.curated_sources import match_exact_catalog_title, parse_nintendolife_selects
from automation.content_policy import ORIGINAL_SWITCH_FILTER

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

SELECTS_URL = "https://www.nintendolife.com/eshop/eshop-selects"
SOLR_URL = "https://searching.nintendo-europe.com/es/select"


def fetch_html(url):
    print(f"Scraping {url}...")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as res:
        return res.read().decode('utf-8')


def extract_entries(html):
    return parse_nintendolife_selects(html)


def search_solr(title):
    params = urllib.parse.urlencode({
        "q": title,
        "defType": "edismax",
        "qf": "title^3 title_master_s^3 title_extras_txt^2",
        "fq": f"type:GAME AND {ORIGINAL_SWITCH_FILTER}",
        "rows": "100",
        "wt": "json",
        "fl": "fs_id,title,title_master_s,system_type",
    })
    with urllib.request.urlopen(f"{SOLR_URL}?{params}", timeout=20) as response:
        data = json.loads(response.read())
    docs = data.get("response", {}).get("docs", [])
    return match_exact_catalog_title(title, docs) if isinstance(docs, list) else None


def publish_entries(base_url, api_key, entries):
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/curated",
        data=json.dumps({"source": "nintendolife", "entries": entries}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read())


def write_redacted_summary(source_count, match_count, duration_seconds):
    path = os.environ.get("NINTENDO_DEALS_CURATION_SUMMARY_PATH", "").strip()
    if path:
        summary = {
            "nintendolife_source_entries": source_count,
            "nintendolife_matches": match_count,
            "nintendolife_rejections": max(0, source_count - match_count),
            "nintendolife_duration_seconds": duration_seconds,
        }
        with open(path, "w", encoding="utf-8") as output:
            json.dump(summary, output, sort_keys=True)


def build_entries(items, run_id, refreshed_at):
    entries = {}
    for item in items:
        fs_id = search_solr(item["title"])
        if fs_id:
            current = entries.get(fs_id)
            if not current or item["rank"] < current["rank"]:
                entries[fs_id] = {
                    "title": item["title"],
                    "review": "Hand-picked by the Nintendo Life team.",
                    "source_url": urljoin("https://www.nintendolife.com/", item["source_reference"]),
                    "source_reference": item["source_reference"],
                    "source_platform": item["platform"],
                    "source_price_eur": item["source_price_eur"],
                    "source": "nintendolife",
                    "rank": item["rank"],
                    "refreshed_at": refreshed_at,
                    "run_id": run_id,
                }
                print(f"  [{item['rank']}] {item['title']} -> fs_id={fs_id}")
        else:
            print(f"  [{item['rank']}] {item['title']} -> no exact original-Switch match")
        time.sleep(0.2)
    return entries


def main(argv=None):
    started_at = time.monotonic()
    parser = argparse.ArgumentParser(description="Refresh Nintendo Life eShop Selects curation")
    parser.add_argument("--base-url", help="Explicit Nintendo Deals API target; required with --apply")
    parser.add_argument("--apply", action="store_true", help="Publish the source snapshot; default is dry-run")
    args = parser.parse_args(argv)
    if args.apply and not args.base_url:
        parser.error("--apply requires an explicit --base-url target")
    api_key = os.environ.get("RATINGS_API_KEY", "").strip()
    if args.apply and not api_key:
        parser.error("--apply requires RATINGS_API_KEY")

    items = extract_entries(fetch_html(SELECTS_URL))
    if not items:
        raise RuntimeError("Nintendo Life eShop Selects returned no valid original-Switch entries")
    run_id = uuid.uuid4().hex[:12]
    refreshed_at = datetime.now(timezone.utc).isoformat()
    entries = build_entries(items, run_id, refreshed_at)
    if not entries:
        raise RuntimeError("No exact original-Switch matches; refusing to publish an empty source snapshot")

    write_redacted_summary(len(items), len(entries), int(time.monotonic() - started_at))
    print(f"Nintendo Life Selects: {len(items)} source entries, {len(entries)} exact matches, run {run_id}")
    if not args.apply:
        print("DRY RUN: no API writes performed. Pass --apply and an explicit --base-url to publish.")
        return entries

    print("Published source snapshot:", publish_entries(args.base_url, api_key, entries))
    return entries


if __name__ == "__main__":
    main()
