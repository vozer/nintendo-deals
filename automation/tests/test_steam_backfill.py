import importlib.util
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error


SCRIPT = Path(__file__).parents[2] / "scripts" / "steam-backfill.py"
SPEC = importlib.util.spec_from_file_location("steam_backfill", SCRIPT)
steam = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(steam)


class SteamBackfillTests(unittest.TestCase):
    def test_search_outage_is_not_an_authoritative_no_match(self):
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('offline')):
            with self.assertRaisesRegex(RuntimeError, 'Steam search unavailable'):
                steam.get_validated_steam_details({'title': 'Future Knight', 'publisher': 'Aeternum Game Studios'})

    def test_tags_only_honors_game_selector_and_limit(self):
        response = BytesIO(b'{"1":{"steam_id":1,"matched_title":"One"},"2":{"steam_id":2,"matched_title":"Two"}}')
        response.headers = {'ETag': 'synthetic'}
        with patch('urllib.request.urlopen', return_value=response), patch.object(steam, 'get_steamspy_tags', return_value=['Adventure']) as tags, patch.object(steam.time, 'sleep'):
            steam.backfill_tags('https://app.test', False, 'synthetic', limit=1, game_id='2')
        tags.assert_called_once_with(2)
    def test_details_reject_demo_namesake_and_publisher_mismatch(self):
        game = {'title': 'Future Knight', 'publisher': 'Aeternum Game Studios'}
        for name, kind, publisher, accepted in [
            ('Future Knight', 'game', 'Aeternum Game Studios', True),
            ('Future Knight Demo', 'demo', 'Aeternum Game Studios', False),
            ('Future Knight (CPC/Spectrum)', 'game', 'Aeternum Game Studios', False),
            ('Future Knight', 'game', 'Unrelated Publisher', False),
        ]:
            response = BytesIO(json.dumps({'4235410': {'success': True, 'data': {'name': name, 'type': kind, 'publishers': [publisher], 'developers': []}}}).encode())
            with patch('urllib.request.urlopen', return_value=response):
                self.assertEqual(steam.get_validated_steam_details(game, 4235410) is not None, accepted)
    def test_matching_is_exact_and_does_not_cross_edition(self):
        items = [
            {"id": 1, "name": "Example Game"},
            {"id": 2, "name": "Example Game Deluxe"},
        ]

        self.assertEqual(steam._match_items(items, steam.normalize("Example Game")), 1)
        self.assertEqual(steam._match_items(items, steam.normalize("Example Game Deluxe")), 2)
        self.assertIsNone(steam._match_items(items, steam.normalize("Example Game Ultimate")))

    def test_review_stats_use_valve_summary_endpoint(self):
        response = BytesIO(b'{"response":{"query_summary":{"total_positive":11,"total_negative":1}}}')
        with patch("urllib.request.urlopen", return_value=response) as request:
            self.assertEqual(steam.get_steam_review_stats(123), (91, 12))

        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(request.call_args.args[0].full_url)
        self.assertEqual(parsed.path, "/IUserReviewsService/GetAppReviews/v1/")
        params = json.loads(parse_qs(parsed.query)["input_json"][0])
        self.assertEqual(params["appid"], 123)
        self.assertEqual(params["languages"], ["english"])
        self.assertEqual(params["review_type"], 0)
        self.assertEqual(params["purchase_type"], 0)

    def test_review_api_rate_limit_is_reported_without_aborting_the_batch(self):
        error = urllib.error.HTTPError("https://api.steampowered.com/", 429, "rate limited", {}, None)
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "HTTP 429"):
                steam.get_steam_review_stats(123)
        error.close()

    def test_refresh_existing_is_bounded_and_provider_failure_preserves_cached_data(self):
        existing = {
            "1": {"steam_id": 11, "score_pct": 70, "votes": 100, "matched_title": "One",
                  "last_updated": "2026-08-01T00:00:00+00:00", "tags": ["Adventure"]},
            "2": {"steam_id": 22, "score_pct": 60, "votes": 200, "matched_title": "Two",
                  "last_updated": "2026-08-02T00:00:00+00:00", "tags": ["Puzzle"]},
            "3": {"steam_id": 33, "score_pct": 80, "votes": 300,
                  "last_updated": "2026-08-03T00:00:00+00:00"},
            "4": {"steam_id": 44, "score_pct": 85, "votes": 400,
                  "last_updated": "2026-10-25T00:00:00+00:00"},
            "5": {"steam_id": 55, "score_pct": 50, "votes": 50,
                  "review_attempted_at": "2026-10-25T00:00:00+00:00"},
            "test_entry": {"steam_id": 99, "score_pct": 70, "votes": 20},
        }
        now = datetime(2026, 10, 26, tzinfo=timezone.utc)

        with patch.object(steam, "get_steam_review_stats", side_effect=[(92, 1100), RuntimeError("offline")]) as fetch, \
             patch.object(steam.time, "sleep"):
            summary = steam.refresh_existing_reviews(existing, limit=2, now=now)

        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(summary["selected"], 2)
        self.assertEqual(summary["updated"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(existing["1"]["score_pct"], 92)
        self.assertEqual(existing["1"]["votes"], 1100)
        self.assertEqual(existing["1"]["tags"], ["Adventure"])
        self.assertEqual(existing["2"]["score_pct"], 60)
        self.assertEqual(existing["2"]["votes"], 200)
        self.assertEqual(existing["2"]["tags"], ["Puzzle"])
        self.assertEqual(existing["2"]["last_updated"], "2026-08-02T00:00:00+00:00")
        self.assertEqual(existing["2"]["review_attempted_at"], "2026-10-26T00:00:00+00:00")
        self.assertNotIn("review_attempted_at", existing["3"])
        self.assertEqual(existing["4"]["score_pct"], 85)
        self.assertEqual(existing["5"]["score_pct"], 50)
        self.assertNotIn("review_attempted_at", existing["test_entry"])

    def test_refresh_cli_uses_snapshot_and_conditional_save_without_catalog_fetch(self):
        snapshot = {"1": {
            "steam_id": 11, "score_pct": 70, "votes": 100, "matched_title": "One",
            "url": "https://store.steampowered.com/app/11/", "last_updated": "2026-08-01T00:00:00+00:00",
            "tags": ["Adventure"],
        }, "test_entry": {"steam_id": 99, "score_pct": 70, "votes": 20}}
        response = BytesIO(json.dumps(snapshot).encode())
        response.headers = {"ETag": '"synthetic-revision"'}

        with patch("urllib.request.urlopen", return_value=response), \
             patch.object(steam, "API_KEY", "synthetic-key"), \
             patch.object(steam, "get_steam_review_stats", return_value=(91, 1200)), \
             patch.object(steam, "save_snapshot") as save, \
             patch.object(steam, "fetch_games", side_effect=AssertionError("catalog must not be fetched")), \
             patch.object(steam.time, "sleep"):
            steam.main(["--base-url", "https://app.test", "--refresh-existing", "--limit", "1", "--apply"])

        save.assert_called_once()
        self.assertEqual(save.call_args.args[:2], ("https://app.test", "synthetic-key"))
        self.assertEqual(save.call_args.args[3], '"synthetic-revision"')
        saved_snapshot = save.call_args.args[2]
        self.assertEqual(set(saved_snapshot), {"1"})
        self.assertEqual(saved_snapshot["1"]["score_pct"], 91)
        self.assertEqual(saved_snapshot["1"]["tags"], ["Adventure"])

    def test_provider_failure_is_not_an_authoritative_empty_tag_list(self):
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            self.assertIsNone(steam.get_steamspy_tags(123))


if __name__ == "__main__":
    unittest.main()
