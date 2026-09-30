"""Pure rules shared by the Nintendo Deals daily worker."""

from difflib import SequenceMatcher
import html
import re
import unicodedata
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

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
    def bounded(value: Any, limit: int) -> str:
        result = ""
        for character in str(value).strip():
            escaped = html.escape(character)
            if len((result + escaped).encode("utf-16-le")) // 2 > limit - 3:
                return result + "..."
            result += escaped
        return result

    title = bounded(game.get("title") or curated_entry.get("title") or "Untitled game", 110)
    excerpt = bounded(game.get("excerpt") or "No store description available.", 340)
    review = bounded(curated_entry.get("review") or "Meets the homepage Deals filters.", 160)
    categories = ", ".join(str(value) for value in (game.get("pretty_game_categories_txt") or [])[:3])
    publisher = bounded(game.get("publisher") or "Unknown publisher", 60)
    discount = game.get("price_discount_percentage_f")
    discount_text = f" (-{float(discount):.0f}%)" if discount is not None else ""
    fs_id = _game_id(game)
    watch = (preferences.get("watchGames") or {}).get(fs_id)
    status = f"Alert: under {watch.get('threshold')}€" if watch else "Alert: none"
    hidden = "Yes" if fs_id in {str(value) for value in preferences.get("hiddenGames", [])} else "No"

    lines = [
        f"<b>{title}</b>",
        f"{_format_price(game.get('price_discounted_f'))}{discount_text} (was {_format_price(game.get('price_regular_f'))})",
        f"Categories: {bounded(categories or 'Uncategorized', 70)}",
        f"Publisher: {publisher}",
        "",
        f"{excerpt}",
        "",
        f"<b>Why it is here:</b> {review}",
        f"Status: Hidden {hidden}; {status}",
    ]
    return "\n".join(lines)


def steam_store_url(value: Any, steam_id: Any = None) -> str:
    if isinstance(value, str):
        url = value.strip()
        try:
            parsed = urlsplit(url)
            if (parsed.scheme == "https" and parsed.netloc == "store.steampowered.com"
                    and re.match(r"^/app/[1-9]\d*(?:/|$)", parsed.path)):
                return url
        except ValueError:
            pass
    if re.fullmatch(r"[1-9]\d*", str(steam_id or "")):
        return f"https://store.steampowered.com/app/{steam_id}/"
    return ""


def build_inline_keyboard(fs_id: str, base_url: str, game: dict[str, Any] | None = None,
                          curated_entry: dict[str, Any] | None = None) -> list[list[dict[str, str]]]:
    base_url = base_url.rstrip("/")
    encoded_id = quote(str(fs_id), safe="")
    keyboard = [
        [
            {"text": "Show", "url": f"{base_url}/?game={encoded_id}"},
            {"text": "Hide", "callback_data": f"nd:hide:{fs_id}"},
        ],
        [
            {"text": f"Alert {threshold}€", "callback_data": f"nd:watch:{threshold}:{fs_id}"}
            for threshold in THRESHOLDS
        ],
    ]
    sources = []
    store = urljoin("https://www.nintendo.com/", str((game or {}).get("url") or "")) if (game or {}).get("url") else ""
    steam = steam_store_url((game or {}).get("steam_url"))
    review = ("Steam", steam) if steam else ("Nintendo Life", (curated_entry or {}).get("source_url", ""))
    for label, url in [("Nintendo", store), review]:
        if isinstance(url, str) and url.startswith("https://"):
            sources.append({"text": label, "url": url})
    if sources:
        keyboard.append(sources)
    return keyboard


def best_title_match(title: str, candidates: list[dict[str, Any]], minimum: float = 0.70) -> tuple[dict[str, Any] | None, float]:
    best: dict[str, Any] | None = None
    best_score = 0.0
    for candidate in candidates:
        score = title_similarity(title, candidate.get("name", ""))
        if score > best_score:
            best = candidate
            best_score = score
    return (best, best_score) if best_score >= minimum else (None, best_score)
