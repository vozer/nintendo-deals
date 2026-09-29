import json
from pathlib import Path
import unittest

from automation.content_policy import ORIGINAL_SWITCH_FILTER, is_blocked_title, is_original_switch_game


ROOT = Path(__file__).resolve().parents[2]


class ContentPolicyTests(unittest.TestCase):
    def test_shared_title_cases(self):
        cases = json.loads((ROOT / "shared" / "content-policy-cases.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(title=case["title"]):
                self.assertEqual(is_blocked_title(case["title"]), case["blocked"])

    def test_original_switch_filter_excludes_switch_2(self):
        self.assertEqual(
            ORIGINAL_SWITCH_FILTER,
            "system_type:nintendoswitch* AND -system_type:nintendoswitch2",
        )
        self.assertTrue(is_original_switch_game({"system_type": ["nintendoswitch"]}))
        self.assertFalse(is_original_switch_game({"system_type": ["nintendoswitch2"]}))
        self.assertFalse(is_original_switch_game({"system_type": ["nintendoswitch", "nintendoswitch2"]}))


if __name__ == "__main__":
    unittest.main()
