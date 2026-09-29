from datetime import date
import unittest
from unittest.mock import patch

from automation import run_daily


def game(fs_id, title="Example Game", release_date="2026-09-28"):
    return {"fs_id": fs_id, "title": title, "title_master_s": title, "pretty_date_s": release_date}


def candidate(title="Example Game", game_id=1, platforms=None):
    return {
        "id": game_id,
        "name": title,
        "platforms": platforms or [{"name": "Nintendo Switch"}],
        "total_rating": 80,
        "aggregated_rating": 82,
        "rating": 78,
        "rating_count": 100,
        "aggregated_rating_count": 20,
    }


class RatingRefreshTests(unittest.TestCase):
    def test_refreshes_existing_rating_at_59_days_but_freezes_at_two_month_boundary(self):
        games = [game("recent", release_date="31/07/2026"), game("boundary", release_date="2026-07-28")]
        existing = {"recent": {"igdb_id": 1}, "boundary": {"igdb_id": 2}}
        with patch.object(run_daily, "fetch_igdb_token", return_value="token"), patch.object(
            run_daily, "fetch_igdb_candidates", return_value=[candidate()]
        ) as fetch:
            result = run_daily.enrich_ratings(games, existing, "client", "secret", today=date(2026, 9, 28))

        self.assertEqual(set(result), {"recent"})
        fetch.assert_called_once()

    def test_unknown_release_date_fetches_missing_rating_once_but_does_not_refresh_existing(self):
        games = [game("missing", release_date="TBD"), game("existing", release_date="TBD")]
        with patch.object(run_daily, "fetch_igdb_token", return_value="token"), patch.object(
            run_daily, "fetch_igdb_candidates", return_value=[candidate()]
        ) as fetch:
            result = run_daily.enrich_ratings(
                games, {"existing": {"igdb_id": 2}}, "client", "secret", today=date(2026, 9, 28)
            )

        self.assertEqual(set(result), {"missing"})
        fetch.assert_called_once()

    def test_missing_old_rating_is_still_fetched_once_and_queue_is_bounded(self):
        games = [game("old", release_date="2020-01-01"), game("next", release_date="2026-09-28")]
        with patch.object(run_daily, "fetch_igdb_token", return_value="token"), patch.object(
            run_daily, "fetch_igdb_candidates", return_value=[candidate()]
        ) as fetch:
            result = run_daily.enrich_ratings(
                games, {}, "client", "secret", limit=1, today=date(2026, 9, 28)
            )

        self.assertEqual(set(result), {"old"})
        fetch.assert_called_once()

    def test_rejects_switch_2_edition_mismatch_and_ambiguous_matches(self):
        candidates = [
            candidate("Example Game", 1, [{"name": "Nintendo Switch 2"}]),
            candidate("Example Game Deluxe", 2),
            candidate("Example Game", 3),
            candidate("Example Game", 4),
        ]
        with patch.object(run_daily, "fetch_igdb_token", return_value="token"), patch.object(
            run_daily, "fetch_igdb_candidates", return_value=candidates
        ):
            result = run_daily.enrich_ratings(
                [game("ambiguous")], {}, "client", "secret", today=date(2026, 9, 28)
            )

        self.assertEqual(result, {})

    def test_does_not_request_token_when_no_rating_is_eligible(self):
        with patch.object(run_daily, "fetch_igdb_token") as token:
            result = run_daily.enrich_ratings(
                [game("frozen", release_date="2020-01-01")],
                {"frozen": {"igdb_id": 1}},
                "client",
                "secret",
                today=date(2026, 9, 28),
            )

        self.assertEqual(result, {})
        token.assert_not_called()


if __name__ == "__main__":
    unittest.main()
