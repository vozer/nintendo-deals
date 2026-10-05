import io
import json
import os
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from automation.run_daily import run


class DailyArrivalTests(unittest.TestCase):
    def execute(self, *, baseline=False, event=None, curated=True, already_claimed=False,
                confirmed=True, fail_photo=False, watched_backstop=False):
        calls = []
        audits = []
        game = {"fs_id": "123", "nsuid_txt": ["70010000121425"], "title": "Adventure",
                "price_regular_f": 6.99, "price_discounted_f": 4.99,
                "price_discount_percentage_f": 29, "price_has_discount_b": True,
                "system_type": ["nintendoswitch"], "url": "/es-es/Juegos/Adventure-123.html",
                "excerpt": "A useful game description.", "pretty_game_categories_txt": ["Acción"],
                "game_categories_txt": [], "publisher": "Studio",
                "image_url_sq_s": "https://cdn.test/title.jpg", "pretty_date_s": "2020-01-01"}
        offer_state = {"123": {"active": True, "price_cents": 499, "episode": 1,
                                "price_change_sequence": 0}}
        transition = event or {"fs_id": "123", "kind": "new", "previous_price_cents": None,
                               "price_cents": 499, "episode": 1, "price_change_sequence": 0}

        def transport(req, **kwargs):
            url, method = req.full_url, req.get_method()
            body = json.loads(req.data) if req.data else None
            calls.append((url, method, body))
            if "searching.nintendo" in url:
                query = parse_qs(urlsplit(url).query)
                is_direct_lookup = "fs_id:" in query.get("fq", [""])[0]
                if watched_backstop and not is_direct_lookup:
                    response = {"response": {"numFound": 0, "docs": []}}
                else:
                    response = {"response": {"numFound": 1, "docs": [game]}}
            elif "api.ec.nintendo.com/v1/price" in url:
                response = {"prices": [{"title_id": 70010000121425, "discount_price": {
                    "raw_value": "4.99", "end_datetime": "2026-10-14T21:59:59Z"}}]}
            elif url.endswith("/api/preferences"):
                response = {"hiddenGames": [],
                            "watchGames": {"123": {"threshold": 5, "title": "Adventure"}} if watched_backstop else {},
                            "thinkingAbout": []}
            elif url.endswith("/api/curated"):
                response = {"nintendolife": {"123": {"source": "nintendolife", "rank": 1,
                            "review": "Excellent", "source_url": "https://www.nintendolife.com/reviews/test"}}
                            if curated else {}, "ntdeals": {}}
            elif url.endswith("/api/ratings"):
                response = {"123": {"rating_count": 100, "rating": 88}}
            elif url.endswith("/api/steam"):
                response = {"123": {"steam_id": 570, "score_pct": 95, "votes": 3500}}
            elif url.endswith("/api/offer-end-dates"):
                response = {"checked_at": None, "records": {}, "etag": None} if method == "GET" else {"ok": True}
            elif url.endswith("/api/telegram/deals") and method == "POST":
                response = {"eligibleIds": [] if watched_backstop else ["123"],
                            "newIds": ["123"] if not baseline and not watched_backstop else [],
                            "events": [] if baseline or watched_backstop else [transition], "offers": offer_state,
                            "etag": "etag-1" if not baseline else None,
                            "initialized": not baseline, "baseline": baseline}
            elif url.endswith("/api/telegram/deals") and method == "PUT":
                response = {"ok": True}
            elif url.endswith("/api/telegram/deliveries/claim"):
                if body.get("operation") == "complete":
                    response = {"completed": True, "outcome": body["outcome"], "message_id": 42}
                else:
                    response = {"claimed": not already_claimed,
                                "outcome": "sent" if confirmed else "unknown" if already_claimed else None}
            elif url.endswith("/api/telegram/audit"):
                audits.append(body)
                response = {"stored": True, "created": True}
            elif url.endswith("/sendPhoto"):
                if fail_photo:
                    raise TimeoutError("synthetic timeout")
                response = {"ok": True, "result": {"message_id": 42}}
            elif url.endswith("/sendMessage"):
                response = {"ok": True, "result": {"message_id": 43}}
            else:
                raise AssertionError(f"Unexpected HTTP request: {method} {url}")
            return io.BytesIO(json.dumps(response).encode())

        env = {"DRY_RUN": "0", "RATINGS_API_KEY": "synthetic", "TWITCH_CLIENT_ID": "synthetic",
               "TWITCH_CLIENT_SECRET": "synthetic", "TELEGRAM_BOT_TOKEN": "synthetic",
               "TELEGRAM_CHAT_ID": "88", "NINTENDO_DEALS_BASE_URL": "https://app.test",
               "NINTENDO_DEALS_SUMMARY_PATH": ""}
        with patch.dict(os.environ, env), patch("urllib.request.urlopen", side_effect=transport):
            if fail_photo or (already_claimed and not confirmed):
                with self.assertRaises((TimeoutError, RuntimeError)):
                    run()
                summary = None
            else:
                summary = run()
        return calls, audits, summary

    def test_transition_is_sent_with_image_expiry_and_all_source_buttons_then_committed(self):
        calls, audits, summary = self.execute()
        photos = [body for url, _, body in calls if url.endswith("/sendPhoto")]
        self.assertEqual(len(photos), 1)
        photo = photos[0]
        self.assertIn("<b>New deal</b>", photo["caption"])
        self.assertIn("Offer ends: 14 Oct 2026", photo["caption"])
        self.assertEqual(photo["reply_markup"]["inline_keyboard"][2], [
            {"text": "Nintendo", "url": "https://www.nintendo.com/es-es/Juegos/Adventure-123.html"},
            {"text": "Steam", "url": "https://store.steampowered.com/app/570/"},
            {"text": "Nintendo Life", "url": "https://www.nintendolife.com/reviews/test"},
        ])
        self.assertEqual(summary["new_deals_sent"], 1)
        self.assertEqual(summary["digest_messages_sent"], 1)
        self.assertEqual(summary["offer_messages_sent"], 1)
        self.assertEqual([event["kind"] for event in audits], [
            "telegram.request.attempt", "telegram.request.result",
        ])
        self.assertTrue(any(url.endswith("/api/telegram/deals") and method == "PUT" for url, method, _ in calls))

    def test_quiet_baseline_sends_no_historical_digest(self):
        calls, audits, summary = self.execute(baseline=True)
        self.assertFalse(any(url.endswith(("/sendPhoto", "/sendMessage")) for url, _, _ in calls))
        self.assertEqual(audits, [])
        self.assertEqual(summary["new_deals_sent"], 0)
        self.assertEqual(summary["digest_messages_sent"], 0)
        self.assertTrue(any(url.endswith("/api/telegram/deals") and method == "PUT" for url, method, _ in calls))

    def test_noncurated_arrival_keeps_steam_link_but_is_not_counted_as_digest(self):
        calls, _, summary = self.execute(curated=False)
        photo = next(body for url, _, body in calls if url.endswith("/sendPhoto"))
        self.assertEqual(photo["reply_markup"]["inline_keyboard"][2][0]["text"], "Nintendo")
        self.assertEqual(photo["reply_markup"]["inline_keyboard"][2][1]["text"], "Steam")
        self.assertEqual(summary["digest_messages_sent"], 0)
        self.assertTrue(any(url.endswith("/api/steam") for url, _, _ in calls))

    def test_confirmed_replay_skips_message_but_commits_offer_snapshot(self):
        calls, _, summary = self.execute(already_claimed=True)
        self.assertFalse(any(url.endswith(("/sendPhoto", "/sendMessage")) for url, _, _ in calls))
        self.assertEqual(summary["offer_messages_sent"], 0)
        self.assertTrue(any(url.endswith("/api/telegram/deals") and method == "PUT" for url, method, _ in calls))

    def test_unresolved_claim_or_ambiguous_send_never_commits_offer_snapshot(self):
        for kwargs in ({"already_claimed": True, "confirmed": False}, {"fail_photo": True}):
            with self.subTest(kwargs=kwargs):
                calls, _, _ = self.execute(**kwargs)
                self.assertFalse(any(url.endswith("/api/telegram/deals") and method == "PUT"
                                     for url, method, _ in calls))

    def test_direct_watched_lookup_remains_an_alert_backstop_when_full_catalog_omits_game(self):
        calls, _, summary = self.execute(watched_backstop=True)
        photo = next(body for url, _, body in calls if url.endswith("/sendPhoto"))
        self.assertIn("<b>Price alert</b>", photo["caption"])
        self.assertTrue(any("fs_id%3A123" in url or "fs_id%3A123" in url.lower()
                            for url, _, _ in calls if "searching.nintendo" in url))
        comparison = next(body for url, method, body in calls
                          if url.endswith("/api/telegram/deals") and method == "POST")
        self.assertEqual(comparison["total"], 1)
        self.assertEqual(summary["price_alerts_sent"], 1)


if __name__ == "__main__":
    unittest.main()
