"""Run ratings, price alerts, and the curated Telegram digest once."""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
from calendar import monthrange
import urllib.request
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from automation.content_policy import (
    MAX_DISCOUNTED_PRICE_EUR,
    ORIGINAL_SWITCH_FILTER,
    is_original_switch_game,
)
from automation.nintendo_worker import (
    build_digest_message,
    build_inline_keyboard,
    find_price_alerts,
    is_active_deal,
    normalize_title,
    select_digest_games,
    title_similarity,
)


SOLR_URL = "https://searching.nintendo-europe.com/es/select"
SOLR_PAGE_SIZE = 1000
SOLR_DEALS_FILTER = (
    f"type:GAME AND {ORIGINAL_SWITCH_FILTER} "
    f"AND price_has_discount_b:true AND price_discounted_f:[0 TO {MAX_DISCOUNTED_PRICE_EUR}] "
    "AND language_availability:*english*"
)
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
        "system_type",
        "pretty_date_s",
    ]
)
SUMMARY_FIELDS = (
    "catalog_records", "games", "watched_games", "ratings_records",
    "nintendolife_entries", "ntdeals_entries", "rating_updates",
    "price_alerts", "digest_items", "price_alerts_sent",
    "digest_messages_sent", "duration_seconds",
)
RUN_STAGE = "startup"
RUN_STARTED_AT = time.monotonic()


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def write_redacted_summary(summary: dict[str, Any]) -> None:
    path = os.environ.get("NINTENDO_DEALS_SUMMARY_PATH", "").strip()
    if path:
        safe = {key: value for key, value in summary.items() if key in SUMMARY_FIELDS and type(value) is int}
        failure_stage = summary.get("failure_stage")
        if isinstance(failure_stage, str) and re.fullmatch(r"[a-z_]{1,40}", failure_stage):
            safe["failure_stage"] = failure_stage
        with open(path, "w", encoding="utf-8") as output:
            json.dump(safe, output, sort_keys=True)


def read_http_error_detail(error: urllib.error.HTTPError) -> str:
    try:
        return error.read().decode("utf-8", errors="replace")[:300]
    finally:
        error.close()


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
        detail = read_http_error_detail(error)
        safe_url = redact_url(url)
        raise RuntimeError(f"HTTP {error.code} from {safe_url}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network error calling {redact_url(url)}: {error.reason}") from error


def redact_url(url: str) -> str:
    destination = urllib.parse.urlsplit(url)
    safe_path = re.sub(r"/bot[^/]+(?=/|$)", "/bot[REDACTED]", destination.path)
    return urllib.parse.urlunsplit((destination.scheme, destination.netloc, safe_path, "", ""))


def fetch_games() -> list[dict[str, Any]]:
    games_by_id: dict[str, dict[str, Any]] = {}
    expected_total: int | None = None
    start = 0

    while expected_total is None or start < expected_total:
        rows = SOLR_PAGE_SIZE if expected_total is None else min(SOLR_PAGE_SIZE, expected_total - start)
        query = urllib.parse.urlencode(
            {
                "q": "*:*",
                "fq": SOLR_DEALS_FILTER,
                "rows": str(rows),
                "start": str(start),
                "wt": "json",
                "fl": SOLR_FIELDS,
            }
        )
        data = request_json(f"{SOLR_URL}?{query}", timeout=45)
        response = data.get("response") if isinstance(data, dict) else None
        if not isinstance(response, dict):
            raise RuntimeError("Nintendo Solr returned an invalid response")

        total = response.get("numFound")
        docs = response.get("docs")
        if type(total) is not int or total < 0 or not isinstance(docs, list):
            raise RuntimeError("Nintendo Solr returned invalid numFound or documents")
        if expected_total is not None and total != expected_total:
            raise RuntimeError(f"Nintendo Solr numFound changed during pagination: {expected_total} to {total}")
        expected_total = total

        if len(docs) > rows:
            raise RuntimeError("Nintendo Solr returned more documents than requested")
        if not docs and start < expected_total:
            raise RuntimeError(f"Nintendo Solr pagination stopped at {start} of {expected_total}")

        for doc in docs:
            if not isinstance(doc, dict):
                raise RuntimeError("Nintendo Solr returned an invalid game record")
            fs_id = str(doc.get("fs_id", "")).strip()
            if not fs_id.isdigit():
                raise RuntimeError("Nintendo Solr returned a game without a valid fs_id")
            games_by_id.setdefault(fs_id, doc)

        start += len(docs)

    if len(games_by_id) != expected_total:
        raise RuntimeError(
            f"Nintendo Solr returned {len(games_by_id)} distinct games; expected {expected_total}"
        )

    return [game for game in games_by_id.values() if is_active_deal(game)]


def fetch_game_by_id(fs_id: str) -> dict[str, Any] | None:
    if not fs_id.isdigit():
        return None
    query = urllib.parse.urlencode(
        {
            "q": "*:*",
            "fq": (
                f"type:GAME AND {ORIGINAL_SWITCH_FILTER} "
                f"AND fs_id:{fs_id}"
            ),
            "rows": "1",
            "start": "0",
            "wt": "json",
            "fl": SOLR_FIELDS,
        }
    )
    data = request_json(f"{SOLR_URL}?{query}", timeout=45)
    docs = data.get("response", {}).get("docs") if isinstance(data, dict) else None
    if not isinstance(docs, list):
        raise RuntimeError("Nintendo Solr returned an invalid direct-lookup response")
    game = next((
        doc for doc in docs
        if isinstance(doc, dict)
        and str(doc.get("fs_id")) == fs_id
        and is_original_switch_game(doc)
    ), None)
    return game


def fetch_watched_games(
    games: list[dict[str, Any]], preferences: dict[str, Any]
) -> list[dict[str, Any]]:
    games_by_id = {str(game.get("fs_id")): game for game in games if game.get("fs_id") is not None}
    watch_games = preferences.get("watchGames")
    if not isinstance(watch_games, dict):
        return list(games_by_id.values())

    for raw_id in watch_games:
        fs_id = str(raw_id).strip()
        if not fs_id.isdigit():
            continue
        game = fetch_game_by_id(fs_id)
        if game and str(game.get("fs_id")) == fs_id:
            games_by_id[fs_id] = game
    return list(games_by_id.values())


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
        detail = read_http_error_detail(error)
        raise RuntimeError(f"IGDB token request failed with HTTP {error.code}: {detail}") from error
    token = data.get("access_token")
    if not token:
        raise RuntimeError("IGDB token response did not contain access_token")
    return str(token)


def fetch_igdb_candidates(title: str, client_id: str, token: str) -> list[dict[str, Any]]:
    escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
    query = (
        "fields id,name,total_rating,aggregated_rating,rating,rating_count,aggregated_rating_count,platforms.name; "
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
            detail = read_http_error_detail(error)
            if error.code != 429 or attempt == 3:
                raise RuntimeError(f"IGDB games request failed with HTTP {error.code}: {detail}") from error
            retry_after = error.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after else 2**attempt
            except ValueError:
                delay = 2**attempt
            time.sleep(max(delay, IGDB_REQUEST_INTERVAL))
    return []


def parse_release_date(game: dict[str, Any]) -> date | None:
    raw = str(game.get("release_date") or game.get("pretty_date_s") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for pattern in ("%d/%m/%Y", "%d.%m.%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            continue
    return None


def two_months_before(value: date) -> date:
    year = value.year
    month = value.month - 2
    while month <= 0:
        year -= 1
        month += 12
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def compatible_igdb_candidates(title: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nintendo_title = normalize_title(re.sub(r"\bnintendo\s*switch\b", "", title, flags=re.IGNORECASE))
    version_words = {"deluxe", "definitive", "ultimate", "remastered", "remake", "complete", "edition", "dx", "gold", "directorscut"}

    def version_signature(value: str) -> tuple[str, ...]:
        tokens = normalize_title(value).split()
        return tuple(token for token in tokens if token.isdigit() or token in version_words or token in {"ii", "iii", "iv"})

    compatible = []
    for candidate in candidates:
        name = str(candidate.get("name") or "")
        platforms = candidate.get("platforms")
        if not isinstance(platforms, list) or not platforms:
            continue
        platform_names = [
            str(platform.get("name") or "").lower()
            for platform in platforms if isinstance(platform, dict)
        ]
        if any("switch 2" in platform for platform in platform_names):
            continue
        if not any(platform == "nintendo switch" for platform in platform_names):
            continue
        candidate_title = normalize_title(re.sub(r"\bnintendo\s*switch\b", "", name, flags=re.IGNORECASE))
        if not candidate_title or version_signature(title) != version_signature(name):
            continue
        if candidate_title == nintendo_title or title_similarity(candidate_title, nintendo_title) >= 0.88:
            compatible.append(candidate)
    return compatible


def enrich_ratings(
    games: list[dict[str, Any]],
    existing: dict[str, Any],
    client_id: str,
    client_secret: str,
    limit: int = 100,
    today: date | None = None,
) -> dict[str, dict[str, Any]]:
    today = today or datetime.now(timezone.utc).date()
    refresh_after = two_months_before(today)
    candidates_left = []
    for game in games:
        fs_id = str(game.get("fs_id", "")).strip()
        if not fs_id:
            continue
        release_date = parse_release_date(game)
        existing_rating = existing.get(fs_id)
        if existing_rating is None or (release_date is not None and release_date > refresh_after):
            candidates_left.append(game)
    candidates_left = candidates_left[: max(0, limit)]
    if not candidates_left:
        return {}

    token = fetch_igdb_token(client_id, client_secret)
    updates: dict[str, dict[str, Any]] = {}

    for index, game in enumerate(candidates_left):
        fs_id = str(game["fs_id"])
        title = str(game.get("title_master_s") or game.get("title") or "").strip()
        if not title:
            continue
        if index:
            time.sleep(IGDB_REQUEST_INTERVAL)
        candidates = compatible_igdb_candidates(title, fetch_igdb_candidates(title, client_id, token))
        scored = sorted(
            ((candidate, title_similarity(title, candidate.get("name", ""))) for candidate in candidates),
            key=lambda item: item[1],
            reverse=True,
        )
        if not scored or (len(scored) > 1 and scored[0][1] == scored[1][1]):
            continue
        match, confidence = scored[0]
        if confidence < 0.88 or not str(match.get("id", "")).isdigit():
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
            "release_date": parse_release_date(game).isoformat() if parse_release_date(game) else None,
        }
    return updates


def telegram_request(bot_token: str, method: str, payload: dict[str, Any]) -> Any:
    return request_json(
        f"https://api.telegram.org/bot{bot_token}/{method}",
        method="POST",
        payload=payload,
        timeout=30,
    )


def claim_daily_delivery(base_url: str, api_key: str, date: str, key: str) -> bool:
    result = request_json(
        f"{base_url.rstrip('/')}/api/telegram/deliveries/claim",
        method="POST",
        payload={"date": date, "key": key},
        headers={"x-api-key": api_key},
    )
    if not isinstance(result, dict) or type(result.get("claimed")) is not bool:
        raise RuntimeError("Delivery claim API returned an invalid response")
    return result["claimed"]


def send_price_alerts(
    bot_token: str,
    chat_id: str,
    alerts: list[tuple[dict[str, Any], dict[str, Any]]],
    base_url: str,
    api_key: str,
    delivery_date: str,
) -> int:
    sent = 0
    for game, watch in alerts:
        fs_id = str(game["fs_id"])
        threshold = str(watch.get("threshold"))
        if not claim_daily_delivery(base_url, api_key, delivery_date, f"alert:{fs_id}:{threshold}"):
            continue
        title = html.escape(str(game.get("title") or watch.get("title") or "Untitled game"))
        price = html.escape(f"{float(game.get('price_discounted_f')):.2f}€")
        threshold = html.escape(threshold)
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
        sent += 1
    return sent


def send_digest(
    bot_token: str,
    chat_id: str,
    games: list[dict[str, Any]],
    curated: dict[str, dict[str, Any]],
    preferences: dict[str, Any],
    base_url: str,
    api_key: str,
    delivery_date: str,
) -> int:
    sent = 0
    for game in games:
        fs_id = str(game["fs_id"])
        if not claim_daily_delivery(base_url, api_key, delivery_date, f"digest:{fs_id}"):
            continue
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
        sent += 1
    return sent


def run() -> dict[str, int]:
    global RUN_STAGE, RUN_STARTED_AT
    RUN_STARTED_AT = time.monotonic()
    base_url = os.environ.get("NINTENDO_DEALS_BASE_URL", "").strip() or "https://nintendo-deals.vercel.app"
    dry_run = os.environ.get("DRY_RUN", "0").lower() in {"1", "true", "yes"}
    RUN_STAGE = "nintendo_catalog"
    games = fetch_games()
    catalog_records = len(games)

    RUN_STAGE = "app_snapshots"
    preferences = fetch_app_json(base_url, "/api/preferences")
    curated_sources = fetch_app_json(base_url, "/api/curated")
    ratings = fetch_app_json(base_url, "/api/ratings")
    if not isinstance(preferences, dict) or not isinstance(curated_sources, dict) or not isinstance(ratings, dict):
        raise RuntimeError("One or more app APIs returned an invalid JSON object")
    curated = curated_sources.get("nintendolife")
    ntdeals = curated_sources.get("ntdeals")
    if not isinstance(curated, dict) or not isinstance(ntdeals, dict):
        raise RuntimeError("Curated API must return separate Nintendo Life and NT Deals maps")
    watched_games = len(preferences.get("watchGames", {}))
    games = fetch_watched_games(games, preferences)

    RUN_STAGE = "igdb_enrichment"
    client_id = require_env("TWITCH_CLIENT_ID")
    client_secret = require_env("TWITCH_CLIENT_SECRET")
    updates = enrich_ratings(games, ratings, client_id, client_secret)
    merged_ratings = {**ratings, **updates}

    alerts = find_price_alerts(games, preferences)
    digest_games = select_digest_games(games, curated, preferences)
    summary = {
        "catalog_records": catalog_records,
        "games": len(games),
        "watched_games": watched_games,
        "ratings_records": len(ratings),
        "nintendolife_entries": len(curated),
        "ntdeals_entries": len(ntdeals),
        "rating_updates": len(updates),
        "price_alerts": len(alerts),
        "digest_items": len(digest_games),
    }

    if dry_run:
        summary["duration_seconds"] = int(time.monotonic() - RUN_STARTED_AT)
        write_redacted_summary(summary)
        print(json.dumps({"dry_run": True, **summary}, sort_keys=True))
        return summary

    ratings_api_key = require_env("RATINGS_API_KEY")
    bot_token = require_env("TELEGRAM_BOT_TOKEN")
    chat_id = require_env("TELEGRAM_CHAT_ID")
    delivery_date = datetime.now(ZoneInfo("Europe/Madrid")).date().isoformat()
    RUN_STAGE = "ratings_publish"
    if updates:
        request_json(
            f"{base_url.rstrip('/')}/api/ratings",
            method="PUT",
            payload=merged_ratings,
            headers={"x-api-key": ratings_api_key},
            timeout=45,
        )
    RUN_STAGE = "price_alert_delivery"
    summary["price_alerts_sent"] = send_price_alerts(
        bot_token, chat_id, alerts, base_url, ratings_api_key, delivery_date
    )
    RUN_STAGE = "digest_delivery"
    summary["digest_messages_sent"] = send_digest(
        bot_token, chat_id, digest_games, curated, preferences, base_url, ratings_api_key, delivery_date
    )
    summary["duration_seconds"] = int(time.monotonic() - RUN_STARTED_AT)
    RUN_STAGE = "complete"
    write_redacted_summary(summary)
    print(json.dumps(summary, sort_keys=True))
    return summary


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        try:
            write_redacted_summary({
                "failure_stage": RUN_STAGE,
                "duration_seconds": int(time.monotonic() - RUN_STARTED_AT),
            })
        except Exception:
            print("Could not write the redacted failure summary", file=sys.stderr)
        print(f"Nintendo Deals daily worker failed: {error}", file=sys.stderr)
        sys.exit(1)
