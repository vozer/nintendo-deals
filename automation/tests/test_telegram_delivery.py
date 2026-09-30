import unittest
from unittest.mock import patch

from automation import run_daily


class TelegramDeliveryTests(unittest.TestCase):
    def test_photo_message_has_caption_source_buttons_and_actions(self):
        game = {"fs_id": "123", "title": "Adventure", "price_discounted_f": 4.99,
                "image_url_h2x1_s": "https://cdn.test/title.jpg", "url": "/es-es/game.html"}
        with patch.object(run_daily, "telegram_request") as send:
            run_daily.send_game_message("synthetic", "88", game, {"source_url": "https://www.nintendolife.com/reviews/test"}, {}, "https://app.test")
        method, payload = send.call_args.args[1:]
        self.assertEqual(method, "sendPhoto")
        self.assertEqual(payload["photo"], "https://cdn.test/title.jpg")
        self.assertIn("Adventure", payload["caption"])
        self.assertEqual(payload["reply_markup"]["inline_keyboard"][2][0]["text"], "Nintendo")

    def test_missing_image_uses_text_and_timeout_does_not_double_send(self):
        game = {"fs_id": "123", "title": "Adventure"}
        with patch.object(run_daily, "telegram_request") as send:
            run_daily.send_game_message("synthetic", "88", game, {}, {}, "https://app.test")
            self.assertEqual(send.call_args.args[1], "sendMessage")
        game["image_url_sq_s"] = "https://cdn.test/title.jpg"
        with patch.object(run_daily, "telegram_request", side_effect=RuntimeError("Network error")) as send:
            with self.assertRaises(RuntimeError):
                run_daily.send_game_message("synthetic", "88", game, {}, {}, "https://app.test")
            self.assertEqual(send.call_count, 1)

    def test_explicit_image_rejection_falls_back_to_text(self):
        game = {"fs_id": "123", "title": "Adventure", "image_url_sq_s": "https://cdn.test/title.jpg"}
        with patch.object(run_daily, "telegram_request", side_effect=[RuntimeError("HTTP 400: wrong file identifier/HTTP URL specified"), {}]) as send:
            run_daily.send_game_message("synthetic", "88", game, {}, {}, "https://app.test")
        self.assertEqual([call.args[1] for call in send.call_args_list], ["sendPhoto", "sendMessage"])


if __name__ == "__main__":
    unittest.main()
