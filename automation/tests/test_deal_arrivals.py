import io
import json
import os
import unittest
from unittest.mock import patch

from automation.run_daily import run


class DailyArrivalTests(unittest.TestCase):
    def execute(self, initialized=True, fail_photo=False, already_claimed=False, confirmed=True):
        calls = []
        game = {"fs_id": "123", "title": "Adventure", "price_discounted_f": 4.99,
                "price_has_discount_b": True, "system_type": ["nintendoswitch"],
                "image_url_sq_s": "https://cdn.test/title.jpg", "pretty_date_s": "2020-01-01"}

        def transport(req, **kwargs):
            url, method = req.full_url, req.get_method()
            body = json.loads(req.data) if req.data else None
            calls.append((url, method, body))
            if 'searching.nintendo' in url:
                response = {"response": {"numFound": 1, "docs": [game]}}
            elif url.endswith('/api/preferences'):
                response = {"hiddenGames": [], "watchGames": {}, "thinkingAbout": []}
            elif url.endswith('/api/curated'):
                response = {"nintendolife": {"123": {"source": "nintendolife", "review": "Excellent"}}, "ntdeals": {}}
            elif url.endswith('/api/ratings'):
                response = {"123": {"rating_count": 100}}
            elif url.endswith('/api/telegram/deals'):
                response = {"eligibleIds": ["123"], "newIds": ["123"] if initialized else [], "etag": '1' if initialized else None, "initialized": initialized}
            elif '/deliveries/claim' in url:
                response = {"claimed": confirmed if method == 'GET' else not already_claimed}
            elif url.endswith('/sendPhoto'):
                if fail_photo:
                    raise TimeoutError('synthetic timeout')
                response = {"ok": True, "result": {"message_id": 42}}
            else:
                raise AssertionError(f"Unexpected HTTP request: {method} {url}")
            return io.BytesIO(json.dumps(response).encode())

        with patch.dict(os.environ, {"DRY_RUN": "0", "RATINGS_API_KEY": "synthetic", "TWITCH_CLIENT_ID": "synthetic",
                                   "TWITCH_CLIENT_SECRET": "synthetic", "TELEGRAM_BOT_TOKEN": "synthetic", "TELEGRAM_CHAT_ID": "88",
                                   "NINTENDO_DEALS_SUMMARY_PATH": ""}), patch('urllib.request.urlopen', side_effect=transport):
            if fail_photo or (already_claimed and not confirmed):
                with self.assertRaises((TimeoutError, RuntimeError)):
                    run()
            else:
                summary = run()
                self.assertEqual(summary['new_deals'], int(initialized))
        return calls

    def test_new_arrival_is_sent_as_photo_once_not_repeated_in_digest_then_committed(self):
        calls = self.execute()
        photos = [body for url, _, body in calls if url.endswith('/sendPhoto')]
        self.assertEqual(len(photos), 1)
        self.assertIn('<b>New deal</b>', photos[0]['caption'])
        self.assertEqual(calls[-1][1], 'PUT')
        self.assertEqual(calls[-1][2]['eligibleIds'], ['123'])

    def test_first_snapshot_baselines_and_failed_or_ambiguous_send_does_not_advance_it(self):
        baseline = self.execute(initialized=False)
        photos = [body for url, _, body in baseline if url.endswith('/sendPhoto')]
        self.assertNotIn('<b>New deal</b>', photos[0]['caption'])  # Existing curated digest is retained.
        for calls in [self.execute(fail_photo=True), self.execute(already_claimed=True, confirmed=False)]:
            self.assertFalse(any(method == 'PUT' for _, method, _ in calls))
        replay = self.execute(already_claimed=True)
        self.assertFalse(any(url.endswith('/sendPhoto') for url, _, _ in replay))
        self.assertEqual(replay[-1][1], 'PUT')


if __name__ == '__main__':
    unittest.main()
