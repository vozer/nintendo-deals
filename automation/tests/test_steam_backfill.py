import importlib.util
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error


SCRIPT = Path(__file__).parents[2] / "scripts" / "steam-backfill.py"
SPEC = importlib.util.spec_from_file_location("steam_backfill", SCRIPT)
steam = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(steam)


class SteamBackfillTests(unittest.TestCase):
    def test_matching_is_exact_and_does_not_cross_edition(self):
        items = [
            {"id": 1, "name": "Example Game"},
            {"id": 2, "name": "Example Game Deluxe"},
        ]

        self.assertEqual(steam._match_items(items, steam.normalize("Example Game")), 1)
        self.assertEqual(steam._match_items(items, steam.normalize("Example Game Deluxe")), 2)
        self.assertIsNone(steam._match_items(items, steam.normalize("Example Game Ultimate")))

    def test_review_stats_use_valve_summary_endpoint(self):
        response = BytesIO(b'{"success":1,"query_summary":{"total_positive":8,"total_negative":2}}')
        with patch("urllib.request.urlopen", return_value=response) as request:
            self.assertEqual(steam.get_steam_review_stats(123), (80, 10))

        self.assertIn("/appreviews/123?", request.call_args.args[0].full_url)

    def test_provider_failure_is_not_an_authoritative_empty_tag_list(self):
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            self.assertIsNone(steam.get_steamspy_tags(123))


if __name__ == "__main__":
    unittest.main()
