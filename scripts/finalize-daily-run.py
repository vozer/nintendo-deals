#!/usr/bin/env python3
"""Build redacted GitHub evidence and append a permanent private run summary."""

import hashlib
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone


METRIC_NAMES = {
    "catalog_records", "catalog_pages", "catalog_documents_received", "catalog_expected_total",
    "games", "watched_games", "watched_games_added", "ratings_records", "steam_records",
    "nintendolife_entries", "ntdeals_entries", "nintendolife_duration_seconds",
    "nintendolife_source_entries", "nintendolife_matches", "nintendolife_rejections",
    "nintendolife_lookup_errors", "watched_lookup_errors", "igdb_enrichment_failures", "igdb_game_errors",
    "rating_updates",
    "duration_seconds", "price_alerts", "digest_items", "price_alerts_sent", "digest_messages_sent",
    "new_deals", "new_deals_sent", "price_changed_deals", "price_changed_deals_sent",
    "reentered_deals", "reentered_deals_sent", "offer_events", "offer_messages_sent",
    "offer_end_dates", "offer_end_date_refresh_failed", "eligible_deals", "deals_baseline_initialized",
}
PUBLIC_EVIDENCE_FILES = {
    "active-catalog.json.gz", "curated-run-summary.json", "curation-evidence.json",
    "daily-run-evidence.json", "daily-run-summary.json", "nintendolife-source.html.gz",
    "redacted-summary.json", "workflow-run.json",
}
PRIVATE_EVIDENCE_FILES = {"private-run-inputs.json.gz"}


def is_allowed_evidence_file(path, root, include_private=False):
    relative = path.relative_to(root).as_posix()
    return relative in PUBLIC_EVIDENCE_FILES or (include_private and relative in PRIVATE_EVIDENCE_FILES) or bool(
        re.fullmatch(r"catalog-pages/page-\d{6}\.json\.gz", relative))


def read_json(root, name, errors):
    path = root / name
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("not a JSON object")
        return value
    except Exception as error:
        errors.append({"file": name, "error_type": type(error).__name__})
        return {}


def workflow_status(outcomes, metrics=None):
    if "failure" in outcomes:
        return "failure"
    if "cancelled" in outcomes:
        return "cancelled"
    status = "skipped" if all(value == "skipped" for value in outcomes) else "success"
    partial_metrics = ("nintendolife_lookup_errors", "watched_lookup_errors", "igdb_enrichment_failures",
                       "igdb_game_errors", "offer_end_date_refresh_failed")
    if status == "success" and any((metrics or {}).get(key, 0) for key in partial_metrics):
        return "partial"
    return status


def upload_private_archive(root, summary, api_base, api_key):
    run_id, attempt = summary["run_id"], summary["run_attempt"]
    if not run_id.isdigit() or not attempt.isdigit():
        return False, "missing_run_identity", 0
    with tempfile.TemporaryDirectory() as directory:
        archive_path = Path(directory) / "run-evidence.tar.gz"
        with tarfile.open(archive_path, "w:gz") as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file() and path.name != "workflow-run.json" \
                        and path.name != "active-catalog.json.gz" \
                        and is_allowed_evidence_file(path, root, include_private=True):
                    archive.add(path, arcname=str(path.relative_to(root)))
        body = archive_path.read_bytes()
    date = summary["finished_at"][:10]
    request = urllib.request.Request(f"{api_base.rstrip('/')}/api/automation/runs", data=body,
        headers={"Content-Type": "application/gzip", "x-api-key": api_key,
                 "x-run-id": run_id, "x-run-attempt": attempt, "x-run-date": date}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
            return result.get("stored") is True, "", len(body)
    except urllib.error.HTTPError as error:
        return False, f"HTTP {error.code}", len(body)
    except Exception as error:
        return False, type(error).__name__, len(body)


def post_private_audit(summary, worker, curation, api_base, api_key):
    event = {
        "event_id": f"automation-run:{summary['run_id']}:attempt:{summary['run_attempt']}",
        "occurred_at": summary["finished_at"],
        "direction": "internal",
        "kind": "automation.run.summary",
        "correlation_id": summary["correlation_id"],
        "request": {"workflow": "nintendo-deals-daily", "run_url": summary["run_url"],
                    "commit": summary["commit"], "trigger": summary["trigger"], "mode": summary["mode"]},
        "response": {"status": summary["status"], "failure_stage": summary.get("failure_stage"),
                     "failure_type": summary.get("failure_type"),
                     "failure_message": summary.get("failure_message", ""),
                     "metrics": summary["metrics"], "stages": worker.get("stages", []),
                     "curation": {key: value for key, value in curation.items()
                                  if key.startswith("nintendolife_")},
                     "permanent_archive_saved": summary.get("permanent_archive_saved", False)},
    }
    request = urllib.request.Request(f"{api_base.rstrip('/')}/api/telegram/audit",
        data=json.dumps(event).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            saved = json.loads(response.read())
            return saved.get("stored") is True, ""
    except urllib.error.HTTPError as error:
        return False, f"HTTP {error.code}"
    except Exception as error:
        return False, type(error).__name__


def main():
    root = Path(os.environ.get("NINTENDO_DEALS_EVIDENCE_DIR", "run-evidence"))
    root.mkdir(parents=True, exist_ok=True)
    read_errors = []
    curation = read_json(root, "curated-run-summary.json", read_errors)
    worker = read_json(root, "daily-run-summary.json", read_errors)
    curation_detail = read_json(root, "curation-evidence.json", read_errors)
    worker_detail = read_json(root, "daily-run-evidence.json", read_errors)
    outcomes = [os.environ.get("CURATION_OUTCOME", ""), os.environ.get("WORKER_OUTCOME", "")]
    status = workflow_status(outcomes)
    failure_stage = worker.get("failure_stage") or curation_detail.get("failure_stage")
    if status == "failure" and not failure_stage:
        failure_stage = "nintendolife_refresh" if outcomes[0] == "failure" else "daily_worker"
    failure_type = worker.get("failure_type") or curation_detail.get("failure_type") or ""
    metrics = {key: value for source in (curation, worker) for key, value in source.items()
               if key in METRIC_NAMES and type(value) is int}
    status = workflow_status(outcomes, metrics)
    run_id = os.environ.get("RUN_ID", "")
    attempt = os.environ.get("RUN_ATTEMPT", "")
    run_mode = os.environ.get("DRY_RUN", "")
    summary = {
        "schema_version": 1,
        "status": status,
        "run_id": run_id,
        "run_attempt": attempt,
        "correlation_id": f"gh-{run_id}-a{attempt}" if run_id and attempt else "",
        "commit": os.environ.get("COMMIT_SHA", ""),
        "ref": os.environ.get("REF", ""),
        "trigger": os.environ.get("EVENT_NAME", ""),
        "mode": "dry_run" if run_mode == "1" else "live" if run_mode == "0" else "unknown",
        "run_url": os.environ.get("RUN_URL", ""),
        "started_at": os.environ.get("RUN_STARTED_AT", ""),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "step_outcomes": {"curation": outcomes[0], "worker": outcomes[1]},
        "metrics": metrics,
    }
    if failure_stage:
        summary["failure_stage"] = failure_stage
    if failure_type:
        summary["failure_type"] = failure_type
    failure_message = worker_detail.get("failure_message") or curation_detail.get("failure_message")
    if failure_message:
        summary["failure_message"] = failure_message

    api_base = os.environ.get("API_BASE_URL", "").strip() or "https://nintendo-deals.vercel.app"
    (root / "redacted-summary.json").write_text(json.dumps(summary, sort_keys=True) + "\n", encoding="utf-8")
    files = []
    excluded_file_count = 0
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "workflow-run.json" \
                and not is_allowed_evidence_file(path, root, include_private=True):
            excluded_file_count += 1
        elif path.is_file() and path.name != "workflow-run.json" and is_allowed_evidence_file(path, root):
            body = path.read_bytes()
            files.append({"path": str(path.relative_to(root)), "bytes": len(body),
                          "sha256": hashlib.sha256(body).hexdigest()})
    archive_saved, archive_error, archive_bytes = upload_private_archive(
        root, summary, api_base, os.environ.get("RATINGS_API_KEY", ""))
    summary["permanent_archive_saved"] = archive_saved
    summary["permanent_archive_bytes"] = archive_bytes
    if archive_error:
        summary["permanent_archive_error"] = archive_error
    saved, audit_error = post_private_audit(summary, worker_detail, curation, api_base,
                                            os.environ.get("RATINGS_API_KEY", ""))
    evidence = {**summary,
        "catalog_pages": worker_detail.get("metrics", {}).get("catalog_pages", 0),
        "stages": worker_detail.get("stages", []),
        "curation": {key: value for key, value in curation.items() if key.startswith("nintendolife_")},
        "evidence_files": files,
        "excluded_file_count": excluded_file_count,
        "permanent_archive_saved": archive_saved,
        "permanent_archive_bytes": archive_bytes,
        "evidence_read_errors": read_errors,
        "permanent_audit_saved": saved,
    }
    if archive_error:
        evidence["permanent_archive_error"] = archive_error
    if audit_error:
        evidence["permanent_audit_error"] = audit_error
    (root / "workflow-run.json").write_text(json.dumps(evidence, sort_keys=True) + "\n", encoding="utf-8")
    (root / "redacted-summary.json").write_text(json.dumps(summary, sort_keys=True) + "\n", encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as output:
            output.write(f"## Nintendo Deals run: {status}\n\n")
            output.write(f"Run `{run_id}` attempt `{attempt}` at `{summary['finished_at']}`.\n")
            output.write(f"Correlation: `{summary['correlation_id']}`.\n\n")
            output.write(f"Failure stage: `{failure_stage or 'none'}`; type: `{failure_type or 'none'}`.\n\n")
            if summary.get("failure_message"):
                output.write(f"Safe failure detail: `{summary['failure_message']}`.\n\n")
            output.write(f"Permanent private evidence archive saved: `{archive_saved}` ({archive_bytes} bytes).\n\n")
            output.write(f"Permanent private audit saved: `{saved}`.\n\n")
            output.write("Counts: " + json.dumps(metrics, sort_keys=True) + "\n")
    if not saved:
        print(f"::error::Permanent private run audit was not saved ({audit_error or 'unconfirmed'})")
    if not archive_saved:
        print(f"::error::Permanent private run archive was not saved ({archive_error or 'unconfirmed'})")
    if not saved or not archive_saved:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
