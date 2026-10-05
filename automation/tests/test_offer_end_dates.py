import unittest
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from automation.run_daily import fetch_offer_end_dates


class OfferEndDateTests(unittest.TestCase):
    def test_uses_only_official_unambiguous_future_end_date_for_matching_sale_price(self):
        games = [
            {"fs_id": "1", "nsuid_txt": ["1001", "1002"], "price_discounted_f": 4.99},
            {"fs_id": "2", "nsuid_txt": "2001", "price_discounted_f": 2.50},
            {"fs_id": "3", "nsuid_txt": ["3001", "3002"], "price_discounted_f": 3.99},
        ]
        price_data = {"prices": [
            {"title_id": 1001, "discount_price": {"raw_value": "4.99", "end_datetime": "2026-10-14T21:59:59Z"}},
            {"title_id": 1002, "discount_price": {"raw_value": "4.99", "end_datetime": "2026-10-14T21:59:59Z"}},
            {"title_id": 2001, "discount_price": {"raw_value": "2.49", "end_datetime": "2026-10-14T21:59:59Z"}},
            {"title_id": 3001, "discount_price": {"raw_value": "3.99", "end_datetime": "2026-10-14T21:59:59Z"}},
            {"title_id": 3002, "discount_price": {"raw_value": "3.99"}},
        ]}
        now = datetime(2026, 10, 4, tzinfo=timezone.utc)
        with patch("automation.run_daily.request_json", return_value=price_data) as request:
            result = fetch_offer_end_dates(games, now)

        self.assertEqual(request.call_count, 1)
        self.assertIn("country=ES", request.call_args.args[0])
        self.assertIn("lang=es", request.call_args.args[0])
        self.assertEqual(result, {"1": {
            "price_cents": 499, "end_datetime": "2026-10-14T21:59:59Z", "checked_at": "2026-10-04T00:00:00Z",
        }})

    def test_batches_ids_by_fifty_and_never_infers_missing_or_expired_hook_values(self):
        games = [{"fs_id": str(index), "nsuid_txt": [str(10_000 + index)], "price_discounted_f": 1.00}
                 for index in range(51)]
        def response(url, **kwargs):
            ids = parse_qs(urlsplit(url).query)["ids"][0].split(",")
            if ids[0] == "10000":
                return {"prices": [{"title_id": int(ids[0]), "discount_price": {"raw_value": "1.00",
                    "end_datetime": "2026-10-03T21:59:59Z"}}]}
            return {"prices": [{"title_id": int(ids[0]), "discount_price": {"raw_value": "1.00"}}]}

        with patch("automation.run_daily.request_json", side_effect=response) as request:
            result = fetch_offer_end_dates(games, datetime(2026, 10, 4, tzinfo=timezone.utc))
        self.assertEqual(request.call_count, 2)
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
