"""Run ratings, price alerts, and the curated Telegram digest once."""

from __future__ import annotations

import html
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from automation.nintendo_worker import (
    best_title_match,
    build_digest_message,
    build_inline_keyboard,
    find_price_alerts,
    select_digest_games,
)


SOLR_URL = "https://searching.nintendo-europe.com/es/select"
IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_GAMES_URL = "https://api.igdb.com/v4/games"
IGDB_REQUEST_INTERVAL = 0.35
SOLR_FIELDS = ",".join(
    [
        "fs_id",
        "title",
        "title_master_s",
        "image_url_sq_s",
        "image_url_h2x1_s",
        "price_regular_f",
        "price_discounted_f",
        "price_discount_percentage_f",
        "price_has_discount_b",
        "price_sorting_f",
        "excerpt",
        "url",
        "pretty_game_categories_txt",
        "publisher",
    ]
)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def request_json(
    url: str,
    method: str = "GET",
    payload: Any = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> Any:
    request_headers = {"Accept": "application/json", "User-Agent": "nintendo-deals-worker/1.0"}
    request_headers.update(headers or {})
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {error.code} from {url}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network error calling {url}: {error.reason}") from error


def fetch_games() -> list[dict[str, Any]]:
    query = urllib.parse.urlencode(
        {
            "q": "*:*",
            "fq": "type:GAME AND system_type:nintendoswitch* AND price_has_discount_b:true AND price_sorting_f:[0 TO 14.99] AND language_availability:*english*",
            "rows": "1000",
            "start": "0",
            "wt": "json",
            "fl": SOLR_FIELDS,
        }
    )
    data = request_json(f"{SOLR_URL}?{query}", timeout=45)
    docs = data.get("response", {}).get("docs", [])
    if not isinstance(docs, list):
        raise RuntimeError("Nintendo Solr returned an invalid documents list")
    return [doc for doc in docs if isinstance(doc, dict)]


def fetch_app_json(base_url: str, path: str) -> Any:
    return request_json(f"{base_url.rstrip('/')}{path}", timeout=30)


def fetch_igdb_token(client_id: str, client_secret: str) -> str:
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        }
    ).encode("ascii")
    request = urllib.request.Request(
        IGDB_TOKEN_URL,
        data=payload,
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"IGDB token request failed with HTTP {error.code}: {detail}") from error
    token = data.get("access_token")
    if not token:
        raise RuntimeError("IGDB token response did not contain access_token")
    return str(token)


def fetch_igdb_candidates(title: str, client_id: str, token: str) -> list[dict[str, Any]]:
    escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
    query = (
        "fields id,name,total_rating,aggregated_rating,rating,rating_count,aggregated_rating_count; "
        f'search "{escaped_title}"; limit 10;'
    )
    request = urllib.request.Request(
        IGDB_GAMES_URL,
        data=query.encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Client-ID": client_id,
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        method="POST",
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, list) else []
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:300]
            if error.code != 429 or attempt == 3:
                raise RuntimeError(f"IGDB games request failed with HTTP {error.code}: {detail}") from error
            retry_after = error.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after else 2**attempt
            except ValueError:
                delay = 2**attempt
            time.sleep(max(delay, IGDB_REQUEST_INTERVAL))
    return []


def enrich_ratings(
    games: list[dict[str, Any]],
    existing: dict[str, Any],
    client_id: str,
    client_secret: str,
    limit: int = 100,
) -> dict[str, dict[str, Any]]:
    token = fetch_igdb_token(client_id, client_secret)
    updates: dict[str, dict[str, Any]] = {}
    candidates_left = [
        game for game in games if str(game.get("fs_id", "")).strip() and str(game.get("fs_id")) not in existing
    ][: max(0, limit)]

    for index, game in enumerate(candidates_left):
        fs_id = str(game["fs_id"])
        title = str(game.get("title_master_s") or game.get("title") or "").strip()
        if not title:
            continue
        if index:
            time.sleep(IGDB_REQUEST_INTERVAL)
        candidates = fetch_igdb_candidates(title, client_id, token)
        match, confidence = best_title_match(title, candidates)
        if not match:
            continue
        updates[fs_id] = {
            "igdb_id": int(match["id"]),
            "total_rating": match.get("total_rating"),
            "aggregated_rating": match.get("aggregated_rating"),
            "rating": match.get("rating"),
            "rating_count": int(match.get("rating_count") or 0),
            "aggregated_rating_count": int(match.get("aggregated_rating_count") or 0),
            "matched_title": str(match.get("name") or title),
            "confidence": round(confidence, 4),
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
    return updates


def telegram_request(bot_token: str, method: str, payload: dict[str, Any]) -> Any:
    return request_json(
        f"https://api.telegram.org/bot{bot_token}/{method}",
        method="POST",
        payload=payload,
        timeout=30,
    )


def send_price_alerts(bot_token: str, chat_id: str, alerts: list[tuple[dict[str, Any], dict[str, Any]]]) -> int:
    for game, watch in alerts:
        title = html.escape(str(game.get("title") or watch.get("title") or "Untitled game"))
        price = html.escape(f"{float(game.get('price_discounted_f')):.2f}€")
        threshold = html.escape(str(watch.get("threshold")))
        url = html.escape(str(game.get("url") or ""))
        telegram_request(
            bot_token,
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": f"<b>Price alert</b>\n{title}\nNow: {price} (under {threshold}€)\n{url}",
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
        )
    return len(alerts)


def send_digest(
    bot_token: str,
    chat_id: str,
    games: list[dict[str, Any]],
    curated: dict[str, dict[str, Any]],
    preferences: dict[str, Any],
    base_url: str,
) -> int:
    for game in games:
        fs_id = str(game["fs_id"])
        telegram_request(
            bot_token,
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": build_digest_message(game, curated[fs_id], preferences),
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
                "reply_markup": {"inline_keyboard": build_inline_keyboard(fs_id, base_url)},
            },
        )
    return len(games)


def run() -> dict[str, int]:
    base_url = os.environ.get("NINTENDO_DEALS_BASE_URL", "").strip() or "https://nintendo-deals.vercel.app"
    dry_run = os.environ.get("DRY_RUN", "0").lower() in {"1", "true", "yes"}
    games = fetch_games()
    if not games:
        raise RuntimeError("Nintendo Solr returned no active deal games; refusing a silent run")

    preferences = fetch_app_json(base_url, "/api/preferences")
    curated = fetch_app_json(base_url, "/api/curated")
    ratings = fetch_app_json(base_url, "/api/ratings")
    if not isinstance(preferences, dict) or not isinstance(curated, dict) or not isinstance(ratings, dict):
        raise RuntimeError("One or more app APIs returned an invalid JSON object")

    client_id = require_env("TWITCH_CLIENT_ID")
    client_secret = require_env("TWITCH_CLIENT_SECRET")
    updates = enrich_ratings(games, ratings, client_id, client_secret)
    merged_ratings = {**ratings, **updates}

    alerts = find_price_alerts(games, preferences)
    digest_games = select_digest_games(games, curated, preferences)
    summary = {"games": len(games), "rating_updates": len(updates), "price_alerts": len(alerts), "digest_items": len(digest_games)}

    if dry_run:
        print(json.dumps({"dry_run": True, **summary}, sort_keys=True))
        return summary

    ratings_api_key = require_env("RATINGS_API_KEY")
    bot_token = require_env("TELEGRAM_BOT_TOKEN")
    chat_id = require_env("TELEGRAM_CHAT_ID")
    if updates:
        request_json(
            f"{base_url.rstrip('/')}/api/ratings",
            method="PUT",
            payload=merged_ratings,
            headers={"x-api-key": ratings_api_key},
            timeout=45,
        )
    send_price_alerts(bot_token, chat_id, alerts)
    send_digest(bot_token, chat_id, digest_games, curated, preferences, base_url)
    print(json.dumps(summary, sort_keys=True))
    return summary


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(f"Nintendo Deals daily worker failed: {error}", file=sys.stderr)
        sys.exit(1)
