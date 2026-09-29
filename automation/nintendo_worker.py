"""Pure rules shared by the Nintendo Deals daily worker."""

from difflib import SequenceMatcher
import html
import re
import unicodedata
from typing import Any
from urllib.parse import quote

from automation.content_policy import MAX_DISCOUNTED_PRICE_EUR, is_blocked_title

THRESHOLDS = (2, 5, 10)
GAME_ID_RE = re.compile(r"^\d+$")


def normalize_title(value: Any) -> str:
    value = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    value = re.sub(r"['’]", "", value)
    value = re.sub(r"[^a-zA-Z0-9\s]", " ", value.lower())
    return re.sub(r"\s+", " ", value).strip()


def title_similarity(left: Any, right: Any) -> float:
    left_normalized = normalize_title(left)
    right_normalized = normalize_title(right)
    if left_normalized == right_normalized:
        return 1.0
    return SequenceMatcher(None, left_normalized, right_normalized).ratio()


def _game_id(game: dict[str, Any]) -> str:
    return str(game.get("fs_id", "")).strip()


def _price(game: dict[str, Any]) -> float | None:
    value = game.get("price_discounted_f")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def is_active_deal(game: dict[str, Any]) -> bool:
    price = _price(game)
    if price is None or price > MAX_DISCOUNTED_PRICE_EUR:
        return False
    if game.get("price_has_discount_b") is False:
        return False
    return True


def _is_blocked(game: dict[str, Any]) -> bool:
    return is_blocked_title(game.get("title", ""))


def select_digest_games(
    games: list[dict[str, Any]],
    curated: dict[str, dict[str, Any]],
    preferences: dict[str, Any],
    max_items: int = 10,
) -> list[dict[str, Any]]:
    hidden = {str(value) for value in preferences.get("hiddenGames", [])}
    watched = {str(value) for value in (preferences.get("watchGames") or {}).keys()}
    selected: list[dict[str, Any]] = []

    for game in games:
        fs_id = _game_id(game)
        entry = curated.get(fs_id)
        if not fs_id or not entry or entry.get("source") != "nintendolife":
            continue
        if fs_id in hidden or fs_id in watched or _is_blocked(game) or not is_active_deal(game):
            continue
        selected.append(game)

    selected.sort(
        key=lambda game: (
            int(curated[_game_id(game)].get("rank") or 999),
            -float(game.get("price_discount_percentage_f") or 0),
            _price(game) or 99,
        )
    )
    return selected[:max(0, max_items)]


def find_price_alerts(
    games: list[dict[str, Any]], preferences: dict[str, Any]
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    watch_games = preferences.get("watchGames") or {}
    alerts: list[tuple[dict[str, Any], dict[str, Any]]] = []
    by_id = {_game_id(game): game for game in games}

    for raw_id, watch in watch_games.items():
        fs_id = str(raw_id)
        if not isinstance(watch, dict) or fs_id not in by_id:
            continue
        try:
            threshold = float(watch.get("threshold"))
        except (TypeError, ValueError):
            continue
        price = _price(by_id[fs_id])
        if threshold in THRESHOLDS and price is not None and price < threshold:
            alerts.append((by_id[fs_id], watch))
    return alerts


def parse_callback_data(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, str):
        return None
    parts = data.split(":")
    if len(parts) == 3 and parts[0] == "nd" and parts[1] == "hide" and GAME_ID_RE.fullmatch(parts[2]):
        return {"action": "hide", "fs_id": parts[2]}
    if (
        len(parts) == 4
        and parts[0] == "nd"
        and parts[1] == "watch"
        and parts[2].isdigit()
        and int(parts[2]) in THRESHOLDS
        and GAME_ID_RE.fullmatch(parts[3])
    ):
        return {"action": "watch", "threshold": int(parts[2]), "fs_id": parts[3]}
    return None


def _format_price(value: Any) -> str:
    try:
        return f"{float(value):.2f}€"
    except (TypeError, ValueError):
        return "Price unavailable"


def build_digest_message(
    game: dict[str, Any],
    curated_entry: dict[str, Any],
    preferences: dict[str, Any],
) -> str:
    title = html.escape(str(game.get("title") or curated_entry.get("title") or "Untitled game"))
    excerpt = html.escape(str(game.get("excerpt") or "No store description available.").strip())
    review = html.escape(str(curated_entry.get("review") or "No editorial note available.").strip())
    categories = ", ".join(str(value) for value in (game.get("pretty_game_categories_txt") or [])[:3])
    publisher = html.escape(str(game.get("publisher") or "Unknown publisher"))
    discount = game.get("price_discount_percentage_f")
    discount_text = f" (-{float(discount):.0f}%)" if discount is not None else ""
    fs_id = _game_id(game)
    watch = (preferences.get("watchGames") or {}).get(fs_id)
    status = f"Alert: under {watch.get('threshold')}€" if watch else "Alert: none"
    hidden = "Yes" if fs_id in {str(value) for value in preferences.get("hiddenGames", [])} else "No"

    lines = [
        f"<b>{title}</b>",
        f"{_format_price(game.get('price_discounted_f'))}{discount_text} (was {_format_price(game.get('price_regular_f'))})",
        f"Categories: {html.escape(categories or 'Uncategorized')}",
        f"Publisher: {publisher}",
        "",
        f"{excerpt}",
        "",
        f"<b>Why it is here:</b> {review}",
        f"Status: Hidden {hidden}; {status}",
        f"Store: {html.escape(str(game.get('url') or ''))}",
    ]
    return "\n".join(lines)


def build_inline_keyboard(fs_id: str, base_url: str) -> list[list[dict[str, str]]]:
    base_url = base_url.rstrip("/")
    encoded_id = quote(str(fs_id), safe="")
    return [
        [
            {"text": "Show", "url": f"{base_url}/?game={encoded_id}"},
            {"text": "Hide", "callback_data": f"nd:hide:{fs_id}"},
        ],
        [
            {"text": f"Alert {threshold}€", "callback_data": f"nd:watch:{threshold}:{fs_id}"}
            for threshold in THRESHOLDS
        ],
    ]


def best_title_match(title: str, candidates: list[dict[str, Any]], minimum: float = 0.70) -> tuple[dict[str, Any] | None, float]:
    best: dict[str, Any] | None = None
    best_score = 0.0
    for candidate in candidates:
        score = title_similarity(title, candidate.get("name", ""))
        if score > best_score:
            best = candidate
            best_score = score
    return (best, best_score) if best_score >= minimum else (None, best_score)
