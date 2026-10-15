import json
import gzip
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from automation import run_daily


class RunSummaryTests(unittest.TestCase):
    def test_interrupted_private_snapshot_write_keeps_previous_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private-run-inputs.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as output:
                json.dump({"checkpoint": "prior-complete"}, output)
            with patch.dict(os.environ, {"NINTENDO_DEALS_PRIVATE_EVIDENCE_PATH": str(path)}), \
                 patch.object(run_daily, "RUN_PRIVATE_EVIDENCE", {"bad": object()}):
                with self.assertRaises(TypeError):
                    run_daily.write_private_run_evidence()

            with gzip.open(path, "rt", encoding="utf-8") as source:
                self.assertEqual(json.load(source), {"checkpoint": "prior-complete"})

    def test_summary_keeps_only_allowlisted_metrics_and_failure_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "summary.json"
            with patch.dict(os.environ, {"NINTENDO_DEALS_SUMMARY_PATH": str(path)}):
                run_daily.write_redacted_summary({
                    "games": 123,
                    "duration_seconds": 5,
                    "failure_stage": "igdb_enrichment",
                    "bot_token": "synthetic-secret",
                    "provider_url": "https://example.test/?token=synthetic-secret",
                })

            summary = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(summary, {
                "duration_seconds": 5,
                "failure_stage": "igdb_enrichment",
                "games": 123,
            })

    def test_detailed_evidence_keeps_partial_stage_and_catalog_without_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence_path = Path(directory) / "daily-run-evidence.json"
            catalog_path = Path(directory) / "catalog.json.gz"
            env = {"NINTENDO_DEALS_EVIDENCE_PATH": str(evidence_path),
                   "NINTENDO_DEALS_CATALOG_EVIDENCE_PATH": str(catalog_path),
                   "GITHUB_RUN_ID": "12345", "GITHUB_RUN_ATTEMPT": "2",
                   "GITHUB_REPOSITORY": "vozer/nintendo-deals", "GITHUB_EVENT_NAME": "schedule"}
            with patch.dict(os.environ, env), patch.object(run_daily, "RUN_STAGES", []), \
                    patch.object(run_daily, "RUN_METRICS", {"catalog_pages": 2}):
                run_daily.RUN_STARTED_AT = run_daily.time.monotonic()
                run_daily.RUN_STARTED_AT_UTC = "2026-10-06T10:00:00+00:00"
                run_daily.set_run_stage("deal_arrival_comparison")
                run_daily.write_catalog_evidence([{"fs_id": "123", "title": "Public Game"}])
                run_daily.write_run_evidence("failure", RuntimeError(
                    "HTTP 400 from https://example.test/api?token=do-not-persist"))

            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["metrics"], {"catalog_pages": 2})
            self.assertEqual(evidence["stages"][0]["status"], "failure")
            self.assertEqual(evidence["run_id"], "12345")
            self.assertNotIn("do-not-persist", evidence_path.read_text(encoding="utf-8"))
            with gzip.open(catalog_path, "rt", encoding="utf-8") as source:
                self.assertEqual(json.load(source)["records"][0]["fs_id"], "123")


if __name__ == "__main__":
    unittest.main()
