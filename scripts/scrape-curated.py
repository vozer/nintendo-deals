import argparse
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import time
import uuid
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from automation.curated_sources import match_exact_catalog_title, parse_nintendolife_selects
from automation.content_policy import ORIGINAL_SWITCH_FILTER

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

SELECTS_URL = "https://www.nintendolife.com/eshop/eshop-selects"
SOLR_URL = "https://searching.nintendo-europe.com/es/select"


def safe_error_message(error):
    message = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[REDACTED]", str(error))
    message = re.sub(r"\b\d{8,}:[A-Za-z0-9_-]{20,}\b", "[REDACTED]", message)
    message = re.sub(r"(?i)(token|secret|authorization|cookie|password|api[_-]?key)(\s*[=:]\s*)[^\s,;]+",
                     r"\1\2[REDACTED]", message)
    return message[:500]


def atomic_write(path, value, compressed=False):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    opener = gzip.open if compressed else open
    with opener(temporary, "wt", encoding="utf-8") as output:
        if isinstance(value, str):
            output.write(value)
        else:
            json.dump(value, output, sort_keys=True, separators=(",", ":") if compressed else None)
    os.replace(temporary, target)


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
    response = data.get("response", {}) if isinstance(data, dict) else {}
    docs = response.get("docs", []) if isinstance(response, dict) else []
    candidates = [{key: doc.get(key) for key in ("fs_id", "title", "title_master_s", "system_type")}
                  for doc in docs if isinstance(doc, dict)] if isinstance(docs, list) else []
    fs_id = match_exact_catalog_title(title, docs) if isinstance(docs, list) else None
    num_found = response.get("numFound") if isinstance(response, dict) else None
    return fs_id, {"catalog_num_found": num_found if type(num_found) is int else None,
                   "catalog_candidates": candidates}


def publish_entries(base_url, api_key, entries):
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/curated",
        data=json.dumps({"source": "nintendolife", "entries": entries}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read())


def write_redacted_summary(source_count, match_count, duration_seconds, status="success", failure_type="",
                           failure_stage="", lookup_errors=0, failure_message=""):
    path = os.environ.get("NINTENDO_DEALS_CURATION_SUMMARY_PATH", "").strip()
    if path:
        summary = {
            "status": status,
            "nintendolife_source_entries": source_count,
            "nintendolife_matches": match_count,
            "nintendolife_rejections": max(0, source_count - match_count),
            "nintendolife_duration_seconds": duration_seconds,
            "nintendolife_lookup_errors": lookup_errors,
        }
        if failure_type:
            summary["failure_type"] = failure_type
        if failure_message:
            summary["failure_message"] = failure_message
        if failure_stage:
            summary["failure_stage"] = failure_stage
        atomic_write(path, summary)


def write_source_evidence(html):
    path = os.environ.get("NINTENDO_DEALS_CURATION_SOURCE_PATH", "").strip()
    if path:
        atomic_write(path, html, compressed=True)


def write_run_evidence(evidence):
    path = os.environ.get("NINTENDO_DEALS_CURATION_EVIDENCE_PATH", "").strip()
    if path:
        atomic_write(path, evidence)


def build_entries(items, run_id, refreshed_at, outcomes=None):
    entries = {}
    for item in items:
        started = time.monotonic()
        try:
            fs_id, lookup = search_solr(item["title"])
        except Exception as error:
            if outcomes is not None:
                outcomes.append({"rank": item["rank"], "title": item["title"], "status": "error",
                                 "error_type": type(error).__name__, "error": safe_error_message(error)})
            print(f"  [{item['rank']}] {item['title']} -> lookup failed ({type(error).__name__})", file=sys.stderr)
            continue
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
            status = "matched"
        else:
            print(f"  [{item['rank']}] {item['title']} -> no exact original-Switch match")
            status = "no_exact_match"
        if outcomes is not None:
            outcomes.append({"rank": item["rank"], "title": item["title"], "platform": item["platform"],
                             "source_reference": item["source_reference"], "status": status,
                             "fs_id": fs_id, **lookup,
                             "duration_ms": max(0, round((time.monotonic() - started) * 1000))})
        time.sleep(0.2)
    return entries


def main(argv=None):
    started_at = time.monotonic()
    started_at_utc = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(description="Refresh Nintendo Life eShop Selects curation")
    parser.add_argument("--base-url", help="Explicit Nintendo Deals API target; required with --apply")
    parser.add_argument("--apply", action="store_true", help="Publish the source snapshot; default is dry-run")
    args = parser.parse_args(argv)
    if args.apply and not args.base_url:
        parser.error("--apply requires an explicit --base-url target")
    api_key = os.environ.get("RATINGS_API_KEY", "").strip()
    if args.apply and not api_key:
        parser.error("--apply requires RATINGS_API_KEY")

    gha_run = os.environ.get("GITHUB_RUN_ID", "").strip()
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "").strip()
    correlation_id = f"gh-{gha_run}-a{attempt}" if gha_run and attempt else ""
    run_id = uuid.uuid4().hex[:12]
    refreshed_at = datetime.now(timezone.utc).isoformat()
    outcomes = []
    items = []
    entries = {}
    source_html = ""
    status = "failure"
    failure_type = ""
    failure_message = ""
    failure_stage = "source_fetch"
    try:
        source_html = fetch_html(SELECTS_URL)
        write_source_evidence(source_html)
        failure_stage = "source_parse"
        items = extract_entries(source_html)
        if not items:
            raise RuntimeError("Nintendo Life eShop Selects returned no valid original-Switch entries")
        failure_stage = "catalog_matching"
        entries = build_entries(items, run_id, refreshed_at, outcomes)
        if not entries:
            raise RuntimeError("No exact original-Switch matches; refusing to publish an empty source snapshot")
        lookup_errors = sum(item["status"] == "error" for item in outcomes)

        print(f"Nintendo Life Selects: {len(items)} source entries, {len(entries)} exact matches, "
              f"{lookup_errors} lookup errors, run {run_id}")
        if not args.apply:
            print("DRY RUN: no API writes performed. Pass --apply and an explicit --base-url to publish.")
            status = "partial_dry_run" if lookup_errors else "dry_run"
            return entries

        if lookup_errors:
            status = "partial"
            print("Not publishing an incomplete source snapshot; the previous Nintendo Life map is unchanged.",
                  file=sys.stderr)
            return entries

        failure_stage = "snapshot_publish"
        print("Published source snapshot:", publish_entries(args.base_url, api_key, entries))
        status = "partial" if lookup_errors else "success"
        return entries
    except Exception as error:
        failure_type = type(error).__name__
        failure_message = safe_error_message(error)
        raise
    finally:
        duration = int(time.monotonic() - started_at)
        lookup_errors = sum(item["status"] == "error" for item in outcomes)
        write_redacted_summary(len(items), len(entries), duration, status, failure_type,
                               failure_stage if failure_type else "", lookup_errors, failure_message)
        write_run_evidence({
            "schema_version": 1,
            "status": status,
            "curation_run_id": run_id,
            "correlation_id": correlation_id,
            "source_url": SELECTS_URL,
            "source_snapshot": "nintendolife-source.html.gz" if source_html else None,
            "started_at": started_at_utc.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": duration,
            "source_entries": len(items),
            "matched_entries": len(entries),
            "failure_stage": failure_stage if failure_type else "",
            "failure_type": failure_type,
            "failure_message": failure_message,
            "results": outcomes,
        })


if __name__ == "__main__":
    main()
