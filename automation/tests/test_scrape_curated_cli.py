import gzip
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("scrape_curated", REPO_ROOT / "scripts/scrape-curated.py")
SCRAPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCRAPER)


class CuratedScraperCliTests(unittest.TestCase):
    def test_direct_script_invocation_loads_project_modules(self):
        result = subprocess.run(
            [sys.executable, "scripts/scrape-curated.py", "--help"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--apply", result.stdout)

    def test_single_catalog_lookup_error_is_recorded_and_later_entries_continue(self):
        items = [
            {"rank": 1, "title": "Lookup Error", "platform": "Switch", "source_reference": "eshop/a",
             "source_price_eur": 1.99},
            {"rank": 2, "title": "Matched Game", "platform": "Switch", "source_reference": "eshop/b",
             "source_price_eur": 2.99},
        ]
        outcomes = []
        with patch.object(SCRAPER, "search_solr", side_effect=[RuntimeError("temporary lookup error"),
            ("123", {"catalog_num_found": 1, "catalog_candidates": [{"fs_id": "123"}]})]), \
             patch.object(SCRAPER.time, "sleep"):
            entries = SCRAPER.build_entries(items, "a" * 12, "2026-10-06T00:00:00Z", outcomes)

        self.assertEqual(set(entries), {"123"})
        self.assertEqual([entry["status"] for entry in outcomes], ["error", "matched"])
        self.assertEqual(outcomes[0]["error"], "temporary lookup error")

    def test_partial_apply_keeps_previous_published_curation_snapshot(self):
        entries = [
            {"rank": 1, "title": "Lookup Error", "platform": "Switch", "source_reference": "eshop/a",
             "source_price_eur": 1.99},
            {"rank": 2, "title": "Matched Game", "platform": "Switch", "source_reference": "eshop/b",
             "source_price_eur": 2.99},
        ]
        with tempfile.TemporaryDirectory() as directory:
            summary_path = Path(directory) / "summary.json"
            evidence_path = Path(directory) / "evidence.json"
            source_path = Path(directory) / "source.html.gz"
            with patch.dict(os.environ, {"RATINGS_API_KEY": "test-key",
                "NINTENDO_DEALS_CURATION_SUMMARY_PATH": str(summary_path),
                "NINTENDO_DEALS_CURATION_EVIDENCE_PATH": str(evidence_path),
                "NINTENDO_DEALS_CURATION_SOURCE_PATH": str(source_path)}), \
                 patch.object(SCRAPER, "fetch_html", return_value="<html>fixture</html>"), \
                 patch.object(SCRAPER, "extract_entries", return_value=entries), \
                 patch.object(SCRAPER, "search_solr", side_effect=[RuntimeError("lookup failed"),
                    ("123", {"catalog_num_found": 1, "catalog_candidates": [{"fs_id": "123"}]})]), \
                 patch.object(SCRAPER, "publish_entries") as publish, patch.object(SCRAPER.time, "sleep"):
                result = SCRAPER.main(["--base-url", "https://nintendo-deals.test", "--apply"])

            self.assertEqual(set(result), {"123"})
            publish.assert_not_called()
            self.assertEqual(json.loads(summary_path.read_text(encoding="utf-8"))["status"], "partial")
            self.assertEqual(json.loads(evidence_path.read_text(encoding="utf-8"))["results"][0]["status"],
                             "error")

    def test_dry_run_captures_source_and_per_entry_match_outcomes(self):
        entries = [
            {"rank": 1, "title": "Matched Game", "platform": "Switch", "source_reference": "/review/matched",
             "source_price_eur": 1.99},
            {"rank": 2, "title": "Unmatched Game", "platform": "Switch", "source_reference": "/review/unmatched",
             "source_price_eur": None},
        ]
        with tempfile.TemporaryDirectory() as directory:
            summary_path = Path(directory) / "curated-run-summary.json"
            evidence_path = Path(directory) / "curation-evidence.json"
            source_path = Path(directory) / "nintendolife-source.html.gz"
            with patch.dict(os.environ, {
                "NINTENDO_DEALS_CURATION_SUMMARY_PATH": str(summary_path),
                "NINTENDO_DEALS_CURATION_EVIDENCE_PATH": str(evidence_path),
                "NINTENDO_DEALS_CURATION_SOURCE_PATH": str(source_path),
                "GITHUB_RUN_ID": "123456", "GITHUB_RUN_ATTEMPT": "3",
            }), patch.object(SCRAPER, "fetch_html", return_value="<html>fixture</html>"), \
                 patch.object(SCRAPER, "extract_entries", return_value=entries), \
                 patch.object(SCRAPER, "search_solr", side_effect=[
                     ("123", {"catalog_num_found": 1,
                              "catalog_candidates": [{"fs_id": "123", "title": "Matched Game"}]}),
                     (None, {"catalog_num_found": 2,
                            "catalog_candidates": [{"fs_id": "456", "title": "Different Game"}]}),
                 ]), \
                 patch.object(SCRAPER.time, "sleep"):
                result = SCRAPER.main([])

            self.assertEqual(len(result), 1)
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual([item["status"] for item in evidence["results"]], ["matched", "no_exact_match"])
            self.assertEqual(evidence["results"][0]["fs_id"], "123")
            self.assertEqual(evidence["results"][0]["catalog_candidates"][0]["fs_id"], "123")
            self.assertEqual(evidence["results"][1]["catalog_num_found"], 2)
            self.assertRegex(evidence["curation_run_id"], r"^[a-f0-9]{12}$")
            self.assertEqual(evidence["correlation_id"], "gh-123456-a3")
            self.assertEqual(json.loads(summary_path.read_text(encoding="utf-8"))["status"], "dry_run")
            with gzip.open(source_path, "rt", encoding="utf-8") as source:
                self.assertEqual(source.read(), "<html>fixture</html>")


if __name__ == "__main__":
    unittest.main()
