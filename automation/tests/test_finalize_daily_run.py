import importlib.util
import gzip
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("finalize_daily_run", REPO_ROOT / "scripts/finalize-daily-run.py")
FINALIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FINALIZER)


class FinalizeDailyRunTests(unittest.TestCase):
    def test_optional_stage_errors_mark_successful_run_partial(self):
        self.assertEqual(FINALIZER.workflow_status(["success", "success"], {"igdb_game_errors": 1}), "partial")
        self.assertEqual(FINALIZER.workflow_status(["success", "success"], {}), "success")
        self.assertEqual(FINALIZER.workflow_status(["failure", "success"], {"igdb_game_errors": 1}), "failure")

    def test_failure_to_persist_permanent_evidence_fails_the_finalizer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "evidence"
            env = {
                "NINTENDO_DEALS_EVIDENCE_DIR": str(root), "CURATION_OUTCOME": "success",
                "WORKER_OUTCOME": "success", "RUN_ID": "123456", "RUN_ATTEMPT": "1",
                "API_BASE_URL": "https://nintendo-deals.test", "RATINGS_API_KEY": "synthetic-secret",
            }
            with patch.dict(os.environ, env), patch("urllib.request.urlopen", side_effect=OSError("offline")):
                with self.assertRaises(SystemExit) as raised:
                    FINALIZER.main()

            self.assertEqual(raised.exception.code, 1)
            evidence = json.loads((root / "workflow-run.json").read_text(encoding="utf-8"))
            self.assertFalse(evidence["permanent_archive_saved"])
            self.assertFalse(evidence["permanent_audit_saved"])

    def test_creates_redacted_manifest_and_permanent_correlated_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "evidence"
            root.mkdir()
            summary_path = Path(directory) / "step-summary.md"
            (root / "curated-run-summary.json").write_text(json.dumps({
                "status": "success", "nintendolife_source_entries": 8, "nintendolife_matches": 6,
            }), encoding="utf-8")
            (root / "daily-run-summary.json").write_text(json.dumps({
                "status": "failure", "failure_stage": "deal_arrival_comparison",
                "failure_type": "RuntimeError", "catalog_records": 42,
            }), encoding="utf-8")
            (root / "daily-run-evidence.json").write_text(json.dumps({
                "stages": [{"stage": "deal_arrival_comparison", "status": "failure"}],
                "failure_message": "HTTP 400 from /api/telegram/deals",
                "metrics": {"catalog_pages": 1},
            }), encoding="utf-8")
            (root / "active-catalog.json.gz").write_bytes(b"duplicate merged catalog")
            (root / "catalog-pages").mkdir()
            (root / "catalog-pages/page-000000.json.gz").write_bytes(b"raw catalog page")
            with gzip.open(root / "private-run-inputs.json.gz", "wt", encoding="utf-8") as private:
                json.dump({"hiddenGames": ["private-game-marker"]}, private)
            (root / "preferences.json").write_text('{"hiddenGames":["private"]}', encoding="utf-8")
            env = {
                "NINTENDO_DEALS_EVIDENCE_DIR": str(root),
                "CURATION_OUTCOME": "success", "WORKER_OUTCOME": "failure",
                "RUN_ID": "123456", "RUN_ATTEMPT": "2", "COMMIT_SHA": "abc123",
                "EVENT_NAME": "schedule", "RUN_STARTED_AT": "2026-10-06T10:07:00Z",
                "RUN_URL": "https://github.com/vozer/nintendo-deals/actions/runs/123456",
                "API_BASE_URL": "https://nintendo-deals.test", "RATINGS_API_KEY": "synthetic-secret",
                "GITHUB_STEP_SUMMARY": str(summary_path),
            }
            requests = []

            def send(request, timeout):
                requests.append(request)
                return io.BytesIO(b'{"stored":true,"created":true}')

            with patch.dict(os.environ, env), patch("urllib.request.urlopen", side_effect=send):
                FINALIZER.main()

            evidence = json.loads((root / "workflow-run.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["status"], "failure")
            self.assertEqual(evidence["failure_stage"], "deal_arrival_comparison")
            self.assertEqual(evidence["metrics"]["catalog_records"], 42)
            self.assertTrue(evidence["permanent_archive_saved"])
            self.assertTrue(evidence["permanent_audit_saved"])
            self.assertEqual(evidence["excluded_file_count"], 1)
            self.assertNotIn("private-run-inputs.json.gz", [item["path"] for item in evidence["evidence_files"]])
            self.assertNotIn("private-game-marker", (root / "workflow-run.json").read_text(encoding="utf-8"))
            self.assertEqual(len(requests), 2)
            self.assertEqual(requests[0].full_url, "https://nintendo-deals.test/api/automation/runs")
            self.assertEqual(requests[0].get_header("Content-type"), "application/gzip")
            self.assertNotIn(b"synthetic-secret", requests[0].data)
            with tarfile.open(fileobj=io.BytesIO(requests[0].data), mode="r:gz") as archive:
                self.assertIn("daily-run-summary.json", archive.getnames())
                self.assertIn("catalog-pages/page-000000.json.gz", archive.getnames())
                self.assertNotIn("active-catalog.json.gz", archive.getnames())
                with archive.extractfile("private-run-inputs.json.gz") as private:
                    self.assertIn("private-game-marker", gzip.decompress(private.read()).decode("utf-8"))
                self.assertNotIn("preferences.json", archive.getnames())
            request_body = json.loads(requests[1].data)
            self.assertEqual(request_body["correlation_id"], "gh-123456-a2")
            self.assertNotIn("synthetic-secret", (root / "workflow-run.json").read_text(encoding="utf-8"))
            self.assertNotIn("synthetic-secret", (root / "redacted-summary.json").read_text(encoding="utf-8"))
            report = summary_path.read_text(encoding="utf-8")
            self.assertIn("Permanent private evidence archive saved: `True`", report)
            self.assertIn("Permanent private audit saved: `True`", report)


if __name__ == "__main__":
    unittest.main()
