import unittest

from automation.nintendo_worker import (
    build_digest_message,
    build_inline_keyboard,
    find_price_alerts,
    parse_callback_data,
    select_digest_games,
    title_similarity,
)


def game(fs_id, title, price=9.99, discount=50, **extra):
    return {
        "fs_id": fs_id,
        "title": title,
        "price_discounted_f": price,
        "price_regular_f": 19.99,
        "price_discount_percentage_f": discount,
        "price_has_discount_b": True,
        "excerpt": extra.get("excerpt", "A short game description."),
        "url": extra.get("url", "https://store.nintendo.es/game"),
        "publisher": extra.get("publisher", "Publisher"),
        "pretty_game_categories_txt": ["Adventure"],
        "title_master_s": title,
    }


class WorkerRulesTests(unittest.TestCase):
    def test_digest_is_source_aware_and_excludes_hidden_and_watched(self):
        games = [
            game("1", "Visible Pick", price=4.99),
            game("2", "Hidden Pick", price=2.99),
            game("3", "Watched Pick", price=3.99),
            game("4", "Deal Pick", price=1.99),
        ]
        curated = {
            "1": {"title": "Visible Pick", "review": "Worth playing.", "source": "nintendolife", "rank": 2},
            "2": {"title": "Hidden Pick", "review": "", "source": "nintendolife", "rank": 1},
            "3": {"title": "Watched Pick", "review": "", "source": "nintendolife", "rank": 3},
            "4": {"title": "Deal Pick", "review": "", "source": "ntdeals", "rank": 1},
        }
        preferences = {
            "hiddenGames": ["2"],
            "watchGames": {"3": {"threshold": 2, "title": "Watched Pick"}},
        }

        result = select_digest_games(games, curated, preferences)

        self.assertEqual([item["fs_id"] for item in result], ["1"])
        self.assertNotIn("4", [item["fs_id"] for item in result])

    def test_price_alert_requires_price_below_threshold(self):
        games = [game("1", "Cheap", price=1.99), game("2", "At Limit", price=5.0)]
        preferences = {
            "watchGames": {
                "1": {"threshold": 2, "title": "Cheap"},
                "2": {"threshold": 5, "title": "At Limit"},
            }
        }

        alerts = find_price_alerts(games, preferences)

        self.assertEqual([(item["fs_id"], watch["threshold"]) for item, watch in alerts], [("1", 2)])

    def test_callback_parser_rejects_malformed_data(self):
        self.assertEqual(parse_callback_data("nd:hide:123"), {"action": "hide", "fs_id": "123"})
        self.assertEqual(
            parse_callback_data("nd:watch:5:123"),
            {"action": "watch", "threshold": 5, "fs_id": "123"},
        )
        self.assertIsNone(parse_callback_data("nd:watch:3:123"))
        self.assertIsNone(parse_callback_data("nd:hide:not-an-id"))

    def test_digest_message_contains_context_not_only_an_id(self):
        text = build_digest_message(
            game("123", "Visible Pick", price=4.99, excerpt="Explore a hand-painted world."),
            {"review": "A thoughtful adventure.", "rank": 2, "source": "nintendolife"},
            {"hiddenGames": [], "watchGames": {}},
        )

        self.assertIn("Visible Pick", text)
        self.assertIn("Explore a hand-painted world.", text)
        self.assertIn("A thoughtful adventure.", text)
        self.assertNotEqual(text.strip(), "123")

    def test_digest_message_makes_relative_nintendo_store_url_absolute(self):
        text = build_digest_message(
            game(
                "123",
                "Visible Pick",
                url="/es-es/Juegos/Programas-descargables-Nintendo-Switch/Future-Knight-3151132.html",
            ),
            {"review": "A thoughtful adventure.", "rank": 2, "source": "nintendolife"},
            {"hiddenGames": [], "watchGames": {}},
        )

        self.assertIn(
            "Store: https://www.nintendo.com/es-es/Juegos/Programas-descargables-Nintendo-Switch/Future-Knight-3151132.html",
            text,
        )

    def test_keyboard_uses_deep_link_and_callback_actions(self):
        keyboard = build_inline_keyboard("123", "https://nintendo-deals.vercel.app")

        self.assertEqual(keyboard[0][0]["url"], "https://nintendo-deals.vercel.app/?game=123")
        self.assertEqual(keyboard[0][1]["callback_data"], "nd:hide:123")
        self.assertEqual(keyboard[1][2]["callback_data"], "nd:watch:10:123")

    def test_title_similarity_accepts_exact_and_close_titles(self):
        self.assertEqual(title_similarity("Old Man's Journey", "Old Mans Journey"), 1.0)
        self.assertGreaterEqual(title_similarity("The Last Campfire", "Last Campfire"), 0.7)
        self.assertLess(title_similarity("Mario Kart", "Zelda"), 0.7)


if __name__ == "__main__":
    unittest.main()
