import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from automation.run_daily import write_redacted_summary


class RunSummaryTests(unittest.TestCase):
    def test_summary_keeps_only_allowlisted_metrics_and_failure_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "summary.json"
            with patch.dict(os.environ, {"NINTENDO_DEALS_SUMMARY_PATH": str(path)}):
                write_redacted_summary({
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


if __name__ == "__main__":
    unittest.main()
