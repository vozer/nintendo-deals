"""Shared catalog and content rules for the site and scheduled worker."""

import json
from pathlib import Path
import re
from typing import Any


CONTENT_POLICY = json.loads(
    (Path(__file__).resolve().parents[1] / "shared" / "content-policy.json").read_text(encoding="utf-8")
)
SWITCH_SYSTEM_PREFIX = CONTENT_POLICY["switchSystemPrefix"]
EXCLUDED_SYSTEM_TYPE = CONTENT_POLICY["excludedSystemType"]
MAX_DISCOUNTED_PRICE_EUR = CONTENT_POLICY["maxDiscountedPriceEur"]
ORIGINAL_SWITCH_FILTER = (
    f"system_type:{SWITCH_SYSTEM_PREFIX}* AND -system_type:{EXCLUDED_SYSTEM_TYPE}"
)
BLOCKED_TITLE_RES = tuple(
    re.compile(pattern, re.IGNORECASE) for pattern in CONTENT_POLICY["blockedTitlePatterns"]
)
def is_original_switch_game(game: dict[str, Any]) -> bool:
    systems = game.get("system_type") or []
    systems = systems if isinstance(systems, list) else [systems]
    normalized = [str(system).casefold() for system in systems]
    return not any(EXCLUDED_SYSTEM_TYPE in system for system in normalized) and any(
        SWITCH_SYSTEM_PREFIX in system for system in normalized
    )


def is_blocked_title(title: Any) -> bool:
    value = str(title or "")
    return any(pattern.search(value) for pattern in BLOCKED_TITLE_RES)
