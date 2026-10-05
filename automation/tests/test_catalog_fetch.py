import unittest
import urllib.error
from io import BytesIO
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from automation import run_daily


def game(fs_id, price=4.99):
    return {
        "fs_id": fs_id,
        "title": f"Game {fs_id}",
        "price_discounted_f": price,
        "price_has_discount_b": True,
    }


def solr_response(total, docs):
    return {"response": {"numFound": total, "docs": docs}}


class CatalogFetchTests(unittest.TestCase):
    def test_fetch_games_paginates_to_all_distinct_results(self):
        docs = [game(str(index)) for index in range(1001)]
        with patch.object(
            run_daily,
            "request_json",
            side_effect=[solr_response(1001, docs[:1000]), solr_response(1001, docs[1000:])],
        ) as request:
            result = run_daily.fetch_games()

        starts = [int(parse_qs(urlparse(call.args[0]).query)["start"][0]) for call in request.call_args_list]
        self.assertEqual(len({item["fs_id"] for item in result}), 1001)
        self.assertEqual(starts, [0, 1000])

    def test_fetch_games_rejects_count_drift(self):
        with patch.object(
            run_daily,
            "request_json",
            side_effect=[solr_response(2, [game("1")]), solr_response(3, [game("2")])],
        ):
            with self.assertRaisesRegex(RuntimeError, "numFound changed"):
                run_daily.fetch_games()

    def test_fetch_games_rejects_duplicate_ids_that_hide_missing_records(self):
        with patch.object(run_daily, "request_json", return_value=solr_response(2, [game("1"), game("1")])):
            with self.assertRaisesRegex(RuntimeError, "distinct"):
                run_daily.fetch_games()

    def test_fetch_games_rejects_an_empty_page_before_num_found(self):
        first_page = [game(str(index)) for index in range(1000)]
        with patch.object(
            run_daily,
            "request_json",
            side_effect=[solr_response(1001, first_page), solr_response(1001, [])],
        ):
            with self.assertRaisesRegex(RuntimeError, "pagination stopped"):
                run_daily.fetch_games()

    def test_fetch_games_enforces_actual_discounted_price(self):
        with patch.object(
            run_daily,
            "request_json",
            return_value=solr_response(2, [game("1", 14.99), game("2", 17.49)]),
        ):
            result = run_daily.fetch_games()

        self.assertEqual([item["fs_id"] for item in result], ["1"])

    def test_watched_game_lookup_replaces_stale_or_missing_catalog_record(self):
        current = [game("1", 12.99)]
        fresh = game("1", 1.99)
        with patch.object(
            run_daily,
            "fetch_game_by_id",
            side_effect=lambda fs_id: fresh if fs_id == "1" else None,
        ) as lookup:
            result = run_daily.fetch_watched_games(
                current,
                {"watchGames": {"1": {"threshold": 2}, "2": {"threshold": 5}}},
            )

        lookup.assert_any_call("1")
        lookup.assert_any_call("2")
        self.assertEqual({item["fs_id"]: item["price_discounted_f"] for item in result}, {"1": 1.99})

    def test_direct_lookup_explicitly_excludes_switch_2(self):
        with patch.object(run_daily, "request_json", return_value=solr_response(0, [])) as request:
            self.assertIsNone(run_daily.fetch_game_by_id("123"))

        query = parse_qs(urlparse(request.call_args.args[0]).query)
        self.assertIn("-system_type:nintendoswitch2", query["fq"][0])
        self.assertIn("fs_id:123", query["fq"][0])

    def test_offer_delivery_claim_uses_a_permanent_event_id_and_authenticated_endpoint(self):
        with patch.object(run_daily, "request_json", return_value={"claimed": True}) as request:
            self.assertTrue(run_daily.claim_offer_delivery(
                "https://nintendo-deals.test/", "test-key", "offer:123:1:0:499", {"fs_id": "123"}
            ))

        self.assertEqual(request.call_args.args[0], "https://nintendo-deals.test/api/telegram/deliveries/claim")
        self.assertEqual(request.call_args.kwargs["headers"], {"x-api-key": "test-key"})
        self.assertEqual(request.call_args.kwargs["payload"], {
            "event_id": "offer:123:1:0:499", "metadata": {"fs_id": "123"},
        })

    def test_offer_transition_replay_skips_already_sent_messages(self):
        claimed = set()

        def claim(_base_url, _api_key, event_id, _metadata):
            if event_id in claimed:
                return False
            claimed.add(event_id)
            return True

        game_record = {
            "fs_id": "123",
            "title": "Test Game",
            "price_discounted_f": 4.99,
            "price_regular_f": 9.99,
            "price_discount_percentage_f": 50,
            "excerpt": "A short description.",
            "url": "https://store.nintendo.es/game",
            "publisher": "Publisher",
        }
        curated = {"123": {"source": "nintendolife", "review": "A good pick."}}
        events = [{"fs_id": "123", "kind": "new", "previous_price_cents": None,
                   "price_cents": 499, "episode": 1, "price_change_sequence": 0}]
        kwargs = ("token", "chat", [game_record], events, ["123"], curated, {},
                  "https://nintendo-deals.test", "api-key", "run-1")
        with patch.object(run_daily, "claim_offer_delivery", side_effect=claim), \
             patch.object(run_daily, "complete_offer_delivery") as complete, \
             patch.object(run_daily, "send_game_message", return_value={"result": {"message_id": 7}}) as send:
            first = run_daily.send_offer_events(*kwargs)
            replay = run_daily.send_offer_events(*kwargs)

        self.assertEqual(first["offer_messages_sent"], 1)
        self.assertEqual(first["new_deals_sent"], 1)
        self.assertEqual(first["digest_messages_sent"], 1)
        self.assertEqual(replay["offer_messages_sent"], 0)
        self.assertEqual(send.call_count, 1)
        complete.assert_called_once_with("https://nintendo-deals.test", "api-key",
                                         "offer:123:1:0:499", "sent", {"message_id": 7})

    def test_telegram_request_errors_redact_bot_token_from_destination(self):
        error = urllib.error.HTTPError(
            "https://api.telegram.org/bot123456:secret/sendMessage",
            500,
            "failure",
            {},
            BytesIO(b"synthetic error"),
        )
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(RuntimeError) as raised:
                run_daily.request_json("https://api.telegram.org/bot123456:secret/sendMessage")

        self.assertNotIn("123456:secret", str(raised.exception))
        self.assertIn("bot[REDACTED]", str(raised.exception))

    def test_telegram_network_errors_also_redact_bot_token(self):
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            with self.assertRaises(RuntimeError) as raised:
                run_daily.request_json("https://api.telegram.org/bot123456:secret/sendMessage?chat_id=1")

        self.assertNotIn("123456:secret", str(raised.exception))
        self.assertNotIn("chat_id=1", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
