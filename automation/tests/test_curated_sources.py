from pathlib import Path
import unittest

from automation.curated_sources import (
    match_exact_catalog_title,
    parse_nintendolife_selects,
    parse_ntdeals_games,
)


FIXTURES = Path(__file__).parents[1] / "fixtures"


class CuratedSourceParserTests(unittest.TestCase):
    def test_nintendolife_fixture_keeps_switch_1_eu_entry_and_rejects_switch_2(self):
        markup = (FIXTURES / "nintendolife-eshop-selects.html").read_text(encoding="utf-8")

        entries = parse_nintendolife_selects(markup)

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["title"], "Future Knight")
        self.assertEqual(entries[0]["source_reference"], "eshop/future_knight")
        self.assertEqual(entries[0]["source_price_eur"], 11.99)
        self.assertEqual(entries[0]["platform"], "nintendoswitch")

    def test_ntdeals_fixture_extracts_current_eu_price_and_provenance(self):
        markup = (FIXTURES / "ntdeals-spain-switch.html").read_text(encoding="utf-8")

        games = parse_ntdeals_games(markup)

        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["title"], "Disco Elysium - The Final Cut")
        self.assertEqual(games[0]["price"], 11.99)
        self.assertEqual(games[0]["discount_pct"], 70)
        self.assertEqual(games[0]["metacritic_score"], 86)
        self.assertEqual(games[0]["sku"], "398201")
        self.assertEqual(games[0]["href"], "/es-store/game/398201/disco-elysium-the-final-cut")

    def test_empty_markup_is_visible_as_source_drift(self):
        self.assertEqual(parse_nintendolife_selects("<html><body>No cards</body></html>"), [])
        self.assertEqual(parse_ntdeals_games("<html><body>No cards</body></html>"), [])

    def test_catalog_matching_requires_one_exact_original_switch_title(self):
        docs = [
            {"fs_id": "1001", "title": "Old Man's Journey", "system_type": ["NintendoSwitch"]},
            {"fs_id": "2001", "title": "Old Man's Journey", "system_type": ["NintendoSwitch2"]},
        ]

        self.assertEqual(match_exact_catalog_title("Old Mans Journey", docs), "1001")
        self.assertIsNone(match_exact_catalog_title("Old Mans Journey DX", docs))
        self.assertIsNone(match_exact_catalog_title("Old Mans Journey", [docs[1]]))

    def test_catalog_matching_normalizes_accented_titles(self):
        docs = [{"fs_id": "3001", "title": "Pokémon Violet", "system_type": ["NintendoSwitch"]}]

        self.assertEqual(match_exact_catalog_title("Pokemon Violet", docs), "3001")


if __name__ == "__main__":
    unittest.main()
