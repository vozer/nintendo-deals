"""Run ratings, price alerts, and the curated Telegram digest once."""

from __future__ import annotations

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
from uuid import uuid4

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
    steam_store_url,
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
NINTENDO_PRICE_URL = "https://api.ec.nintendo.com/v1/price"
NINTENDO_PRICE_BATCH_SIZE = 50
IGDB_REQUEST_INTERVAL = 0.35
SOLR_FIELDS = ",".join(
    [
        "fs_id",
        "nsuid_txt",
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
        "game_categories_txt",
        "publisher",
        "system_type",
        "pretty_date_s",
    ]
)
SUMMARY_FIELDS = (
    "catalog_records", "games", "watched_games", "ratings_records",
    "nintendolife_entries", "ntdeals_entries", "rating_updates",
    "price_alerts", "digest_items", "price_alerts_sent", "digest_messages_sent",
    "new_deals", "new_deals_sent", "price_changed_deals", "price_changed_deals_sent",
    "reentered_deals", "reentered_deals_sent", "offer_events", "offer_messages_sent",
    "offer_end_dates", "offer_end_date_refresh_failed", "eligible_deals", "deals_baseline_initialized", "duration_seconds",
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


def fetch_offer_end_dates(games: list[dict[str, Any]], now: datetime | None = None) -> dict[str, dict[str, Any]]:
    """Read Nintendo's official price hook and keep only unambiguous current-price matches."""
    now = now or datetime.now(timezone.utc)
    nsuid_to_games: dict[str, list[dict[str, Any]]] = {}
    for game in games:
        raw_ids = game.get("nsuid_txt")
        ids = raw_ids if isinstance(raw_ids, list) else [raw_ids]
        for raw_id in ids:
            nsuid = str(raw_id or "").strip()
            if nsuid.isdigit():
                nsuid_to_games.setdefault(nsuid, []).append(game)

    ids = sorted(nsuid_to_games)
    candidates: dict[str, list[tuple[int, str | None]]] = {}
    checked_at = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    for start in range(0, len(ids), NINTENDO_PRICE_BATCH_SIZE):
        batch = ids[start:start + NINTENDO_PRICE_BATCH_SIZE]
        query = urllib.parse.urlencode({"country": "ES", "lang": "es", "ids": ",".join(batch)})
        data = request_json(f"{NINTENDO_PRICE_URL}?{query}", timeout=30)
        prices = data.get("prices") if isinstance(data, dict) else None
        if not isinstance(prices, list):
            raise RuntimeError("Nintendo official price response did not contain prices")
        for price in prices:
            if not isinstance(price, dict):
                continue
            nsuid = str(price.get("title_id", ""))
            sale = price.get("discount_price")
            if nsuid not in nsuid_to_games or not isinstance(sale, dict):
                continue
            raw_price = sale.get("raw_value")
            raw_end = sale.get("end_datetime")
            try:
                price_cents = round(float(raw_price) * 100)
            except (TypeError, ValueError, OverflowError):
                continue
            end_value: str | None = None
            if isinstance(raw_end, str) and raw_end.strip():
                try:
                    end = datetime.fromisoformat(raw_end.replace("Z", "+00:00"))
                    if end.tzinfo is None:
                        end = end.replace(tzinfo=timezone.utc)
                    if end > now:
                        end_value = end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                except ValueError:
                    pass
            for game in nsuid_to_games[nsuid]:
                try:
                    catalog_cents = round(float(game.get("price_discounted_f")) * 100)
                except (TypeError, ValueError, OverflowError):
                    continue
                if catalog_cents == price_cents:
                    candidates.setdefault(str(game["fs_id"]), []).append((price_cents, end_value))

    result: dict[str, dict[str, Any]] = {}
    for fs_id, matches in candidates.items():
        unique = set(matches)
        if len(unique) != 1 or next(iter(unique))[1] is None:
            continue
        price_cents, end_datetime = unique.pop()
        result[fs_id] = {"price_cents": price_cents, "end_datetime": end_datetime, "checked_at": checked_at}
    return result


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
    result = request_json(
        f"https://api.telegram.org/bot{bot_token}/{method}",
        method="POST",
        payload=payload,
        timeout=30,
    )
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError(f"Telegram {method} rejected the request")
    return result


def append_worker_audit_event(base_url: str, api_key: str, event: dict[str, Any]) -> None:
    result = request_json(f"{base_url.rstrip('/')}/api/telegram/audit", method="POST", payload=event,
                          headers={"x-api-key": api_key})
    if not isinstance(result, dict) or result.get("stored") is not True:
        raise RuntimeError("Telegram audit API did not confirm the event")


def audited_telegram_request(bot_token: str, method: str, payload: dict[str, Any],
                             base_url: str, api_key: str, correlation_id: str) -> Any:
    request_id = uuid4().hex
    request_time = datetime.now(timezone.utc).isoformat()
    append_worker_audit_event(base_url, api_key, {
        "event_id": f"worker:{request_id}:attempt", "occurred_at": request_time,
        "direction": "outbound", "kind": "telegram.request.attempt", "correlation_id": correlation_id,
        "request": {"source": "github_worker", "method": method, "payload": payload},
    })
    try:
        response = telegram_request(bot_token, method, payload)
    except Exception as error:
        message = str(error)
        rejected = bool(re.search(r"HTTP 4\d\d", message))
        try:
            append_worker_audit_event(base_url, api_key, {
                "event_id": f"worker:{request_id}:result", "occurred_at": datetime.now(timezone.utc).isoformat(),
                "direction": "outbound", "kind": "telegram.request.result", "correlation_id": correlation_id,
                "response": {"outcome": "rejected" if rejected else "unknown",
                             "error": message[:1000], "error_type": type(error).__name__},
            })
        except Exception as audit_error:
            raise RuntimeError("Telegram request outcome is unknown and its audit result could not be stored") from audit_error
        raise
    append_worker_audit_event(base_url, api_key, {
        "event_id": f"worker:{request_id}:result", "occurred_at": datetime.now(timezone.utc).isoformat(),
        "direction": "outbound", "kind": "telegram.request.result", "correlation_id": correlation_id,
        "response": {"outcome": "sent", "body": response},
    })
    return response


def send_game_message(bot_token: str, chat_id: str, game: dict[str, Any],
                      curated_entry: dict[str, Any], preferences: dict[str, Any],
                      base_url: str, heading: str = "", audit_context: dict[str, str] | None = None) -> Any:
    def send(method: str, payload: dict[str, Any]) -> Any:
        if not audit_context:
            return telegram_request(bot_token, method, payload)
        return audited_telegram_request(bot_token, method, payload, audit_context["base_url"],
                                        audit_context["api_key"], audit_context["correlation_id"])

    text = (f"<b>{heading}</b>\n" if heading else "") + build_digest_message(game, curated_entry, preferences)
    payload = {"chat_id": chat_id, "parse_mode": "HTML",
               "reply_markup": {"inline_keyboard": build_inline_keyboard(str(game["fs_id"]), base_url, game, curated_entry)}}
    photo = str(game.get("image_url_h2x1_s") or game.get("image_url_sq_s") or "").strip()
    if photo.startswith("//"):
        photo = "https:" + photo
    if photo.startswith("https://"):
        try:
            return send("sendPhoto", {**payload, "photo": photo, "caption": text})
        except RuntimeError as error:
            # Only a definite image rejection is safe to retry as text, not a timeout.
            image_errors = ("wrong file identifier", "failed to get http url content", "photo_invalid", "image_process_failed", "wrong type of the web page content")
            if "HTTP 400" not in str(error) or not any(reason in str(error).lower() for reason in image_errors):
                raise
            print("Telegram rejected the title image; sending the game as text.", file=sys.stderr)
    return send("sendMessage", {**payload, "text": text, "disable_web_page_preview": True})


def claim_offer_delivery(base_url: str, api_key: str, event_id: str, metadata: dict[str, Any]) -> bool:
    result = request_json(f"{base_url.rstrip('/')}/api/telegram/deliveries/claim", method="POST",
        payload={"event_id": event_id, "metadata": metadata}, headers={"x-api-key": api_key})
    if not isinstance(result, dict) or type(result.get("claimed")) is not bool:
        raise RuntimeError("Offer delivery claim API returned an invalid response")
    if result["claimed"]:
        return True
    if result.get("outcome") == "sent":
        return False
    raise RuntimeError("Offer delivery has an unresolved prior attempt; review Telegram audit before retrying")


def complete_offer_delivery(base_url: str, api_key: str, event_id: str, outcome: str,
                            details: dict[str, Any]) -> None:
    result = request_json(f"{base_url.rstrip('/')}/api/telegram/deliveries/claim", method="POST",
        payload={"operation": "complete", "event_id": event_id, "outcome": outcome, "details": details},
        headers={"x-api-key": api_key})
    if not isinstance(result, dict) or result.get("outcome") != outcome:
        raise RuntimeError("Offer delivery result was not persisted")


def telegram_message_id(response: Any) -> Any:
    result = response.get("result") if isinstance(response, dict) else None
    return result.get("message_id") if isinstance(result, dict) else None


def send_price_alerts(
    bot_token: str,
    chat_id: str,
    alerts: list[tuple[dict[str, Any], dict[str, Any]]],
    base_url: str,
    api_key: str,
    offer_states: dict[str, dict[str, Any]],
    run_id: str,
    curated: dict[str, dict[str, Any]] | None = None,
    preferences: dict[str, Any] | None = None,
) -> int:
    sent = 0
    for game, watch in alerts:
        fs_id = str(game["fs_id"])
        threshold = str(watch.get("threshold"))
        state = offer_states.get(fs_id)
        if not isinstance(state, dict) or not state.get("active"):
            continue
        event_id = f"alert:{fs_id}:{state['episode']}:{state['price_change_sequence']}:{state['price_cents']}"
        metadata = {"fs_id": fs_id, "price_cents": state["price_cents"], "threshold": threshold,
                    "episode": state["episode"], "price_change_sequence": state["price_change_sequence"]}
        if not claim_offer_delivery(base_url, api_key, event_id, metadata):
            continue
        entry = {**(curated or {}).get(fs_id, {}), "review": f"Price alert: now below your {threshold} EUR threshold."}
        try:
            response = send_game_message(bot_token, chat_id, game, entry, preferences or {}, base_url, "Price alert",
                {"base_url": base_url, "api_key": api_key, "correlation_id": f"{run_id}:{event_id}"})
            complete_offer_delivery(base_url, api_key, event_id, "sent", {"message_id": telegram_message_id(response)})
        except Exception:
            complete_offer_delivery(base_url, api_key, event_id, "unknown", {})
            raise
        sent += 1
    return sent


def send_offer_events(
    bot_token: str,
    chat_id: str,
    games: list[dict[str, Any]],
    events: list[dict[str, Any]],
    eligible_ids: list[str],
    curated: dict[str, dict[str, Any]],
    preferences: dict[str, Any],
    base_url: str,
    api_key: str,
    run_id: str,
) -> dict[str, int]:
    by_id = {str(game["fs_id"]): game for game in games}
    curated_ids = {str(game["fs_id"]) for game in select_digest_games(games, curated, preferences)}
    eligible = set(eligible_ids)
    transition_by_id = {event["fs_id"]: event for event in events}
    selected_ids = [fs_id for fs_id in transition_by_id if fs_id in eligible or fs_id in curated_ids]
    selected_ids.sort(key=lambda fs_id: (-float(by_id[fs_id].get("price_discount_percentage_f") or 0), fs_id))

    headings = {"new": "New deal", "price_changed": "Offer price changed", "reentered": "Offer returned"}
    counts = {
        "offer_messages_sent": 0,
        "new_deals_sent": 0,
        "price_changed_deals_sent": 0,
        "reentered_deals_sent": 0,
        "digest_messages_sent": 0,
    }
    for fs_id in selected_ids:
        event = transition_by_id[fs_id]
        game = by_id[fs_id]
        event_id = f"offer:{fs_id}:{event['episode']}:{event['price_change_sequence']}:{event['price_cents']}"
        metadata = {key: event[key] for key in ("fs_id", "kind", "previous_price_cents", "price_cents", "episode", "price_change_sequence")}
        if not claim_offer_delivery(base_url, api_key, event_id, metadata):
            continue
        if counts["offer_messages_sent"]:
            time.sleep(1)
        try:
            response = send_game_message(bot_token, chat_id, game, curated.get(fs_id, {}), preferences, base_url,
                headings[event["kind"]], {"base_url": base_url, "api_key": api_key,
                                          "correlation_id": f"{run_id}:{event_id}"})
            complete_offer_delivery(base_url, api_key, event_id, "sent", {"message_id": telegram_message_id(response)})
        except Exception:
            complete_offer_delivery(base_url, api_key, event_id, "unknown", {})
            raise
        counts["offer_messages_sent"] += 1
        sent_key = {
            "new": "new_deals_sent",
            "price_changed": "price_changed_deals_sent",
            "reentered": "reentered_deals_sent",
        }[event["kind"]]
        counts[sent_key] += 1
        if fs_id in curated_ids:
            counts["digest_messages_sent"] += 1
    return counts


def compare_deal_arrivals(base_url: str, api_key: str, games: list[dict[str, Any]]) -> dict[str, Any]:
    # Send only fields used by the shared homepage filter, not descriptions/media.
    catalog = []
    for game in games:
        systems = game.get("system_type") or []
        catalog.append({"fs_id": str(game["fs_id"]), "title": str(game.get("title") or ""),
            "publisher": str(game.get("publisher") or ""), "price_discounted_f": game.get("price_discounted_f"),
            "price_has_discount_b": game.get("price_has_discount_b"),
            "pretty_game_categories_txt": game.get("pretty_game_categories_txt") or [],
            "game_categories_txt": game.get("game_categories_txt") or [],
            "system_type": systems if isinstance(systems, list) else [systems]})
    result = request_json(f"{base_url.rstrip('/')}/api/telegram/deals", method="POST",
                          payload={"games": catalog, "total": len(catalog)}, headers={"x-api-key": api_key}, timeout=45)
    if not isinstance(result, dict) or type(result.get("initialized")) is not bool \
            or type(result.get("baseline")) is not bool or not isinstance(result.get("offers"), dict) \
            or not isinstance(result.get("events"), list) or not (
        result.get("etag") is None or isinstance(result.get("etag"), str)
    ):
        raise RuntimeError("Invalid deal comparison response")
    for field in ("eligibleIds", "newIds"):
        ids = result.get(field)
        if not isinstance(ids, list) or any(not isinstance(value, str) or not value.isdigit() for value in ids) or len(set(ids)) != len(ids):
            raise RuntimeError("Invalid deal comparison IDs")
    if not set(result["newIds"]).issubset(result["eligibleIds"]) or not set(result["eligibleIds"]).issubset(str(game["fs_id"]) for game in games):
        raise RuntimeError("Deal comparison IDs do not match the catalog")
    seen_events: set[str] = set()
    for event in result["events"]:
        if not isinstance(event, dict) or event.get("kind") not in {"new", "price_changed", "reentered"} \
                or not isinstance(event.get("fs_id"), str) or not event["fs_id"].isdigit() \
                or event["fs_id"] in seen_events or not all(type(event.get(key)) is int for key in
                    ("price_cents", "episode", "price_change_sequence")):
            raise RuntimeError("Invalid offer transition event")
        seen_events.add(event["fs_id"])
    return result


def publish_offer_end_dates(base_url: str, api_key: str, checked_at: str,
                            records: dict[str, dict[str, Any]]) -> None:
    current = request_json(f"{base_url.rstrip('/')}/api/offer-end-dates", headers={"x-api-key": api_key})
    if not isinstance(current, dict) or not (current.get("etag") is None or isinstance(current.get("etag"), str)):
        raise RuntimeError("Invalid offer end-date snapshot response")
    request_json(f"{base_url.rstrip('/')}/api/offer-end-dates", method="PUT",
        payload={"checked_at": checked_at, "records": records, "etag": current.get("etag")},
        headers={"x-api-key": api_key}, timeout=45)


def run() -> dict[str, int]:
    global RUN_STAGE, RUN_STARTED_AT
    RUN_STARTED_AT = time.monotonic()
    base_url = os.environ.get("NINTENDO_DEALS_BASE_URL", "").strip() or "https://nintendo-deals.vercel.app"
    dry_run = os.environ.get("DRY_RUN", "0").lower() in {"1", "true", "yes"}
    RUN_STAGE = "nintendo_catalog"
    games = fetch_games()
    catalog_records = len(games)
    catalog_games = games

    RUN_STAGE = "app_snapshots"
    preferences = fetch_app_json(base_url, "/api/preferences")
    curated_sources = fetch_app_json(base_url, "/api/curated")
    ratings = fetch_app_json(base_url, "/api/ratings")
    steam = fetch_app_json(base_url, "/api/steam")
    if not all(isinstance(snapshot, dict) for snapshot in (preferences, curated_sources, ratings, steam)):
        raise RuntimeError("One or more app APIs returned an invalid JSON object")
    curated = curated_sources.get("nintendolife")
    ntdeals = curated_sources.get("ntdeals")
    if not isinstance(curated, dict) or not isinstance(ntdeals, dict):
        raise RuntimeError("Curated API must return separate Nintendo Life and NT Deals maps")
    watched_games = len(preferences.get("watchGames", {}))
    games = fetch_watched_games(games, preferences)
    offer_checked_at = datetime.now(timezone.utc)
    try:
        offer_end_dates = fetch_offer_end_dates(games, offer_checked_at)
        offer_end_date_refresh_failed = 0
    except Exception as error:
        print(f"Nintendo offer end-date refresh unavailable: {type(error).__name__}", file=sys.stderr)
        offer_end_dates = {}
        offer_end_date_refresh_failed = 1
    for game in games:
        fs_id = str(game["fs_id"])
        steam_entry = steam.get(fs_id)
        game["steam_url"] = steam_store_url(steam_entry.get("url"), steam_entry.get("steam_id")) if isinstance(steam_entry, dict) else ""
        if isinstance(steam_entry, dict):
            game["steam_rating"] = steam_entry
        if isinstance(ratings.get(fs_id), dict):
            game["igdb_rating"] = ratings[fs_id]
        end_entry = offer_end_dates.get(fs_id)
        if isinstance(end_entry, dict) and end_entry.get("price_cents") == round(float(game.get("price_discounted_f") or 0) * 100):
            game["offer_end_date"] = end_entry.get("end_datetime")

    RUN_STAGE = "igdb_enrichment"
    client_id = require_env("TWITCH_CLIENT_ID")
    client_secret = require_env("TWITCH_CLIENT_SECRET")
    updates = enrich_ratings(games, ratings, client_id, client_secret)
    merged_ratings = {**ratings, **updates}
    for game in games:
        rating = merged_ratings.get(str(game["fs_id"]))
        if isinstance(rating, dict):
            game["igdb_rating"] = rating

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
        "offer_end_dates": len(offer_end_dates),
        "offer_end_date_refresh_failed": offer_end_date_refresh_failed,
    }

    ratings_api_key = require_env("RATINGS_API_KEY")
    run_id = uuid4().hex
    RUN_STAGE = "ratings_publish"
    if updates and not dry_run:
        request_json(
            f"{base_url.rstrip('/')}/api/ratings",
            method="PUT",
            payload=merged_ratings,
            headers={"x-api-key": ratings_api_key},
            timeout=45,
        )
    if offer_end_date_refresh_failed == 0 and not dry_run:
        RUN_STAGE = "offer_end_date_publish"
        try:
            publish_offer_end_dates(base_url, ratings_api_key,
                offer_checked_at.isoformat().replace("+00:00", "Z"), offer_end_dates)
        except Exception as error:
            print(f"Nintendo offer end-date publication unavailable: {type(error).__name__}", file=sys.stderr)
            summary["offer_end_date_refresh_failed"] = 1
    RUN_STAGE = "deal_arrival_comparison"
    # Direct watched-ID lookups are a notification backstop even when the full query omitted that game.
    arrivals = compare_deal_arrivals(base_url, ratings_api_key, games)
    event_kinds = [event["kind"] for event in arrivals["events"]]
    event_ids = {event["fs_id"] for event in arrivals["events"]}
    curated_event_ids = {str(game["fs_id"]) for game in digest_games if str(game["fs_id"]) in event_ids}
    summary.update({"eligible_deals": len(arrivals["eligibleIds"]),
                    "new_deals": event_kinds.count("new"),
                    "price_changed_deals": event_kinds.count("price_changed"),
                    "reentered_deals": event_kinds.count("reentered"),
                    "offer_events": len(arrivals["events"]),
                    "digest_items": len(curated_event_ids),
                    "deals_baseline_initialized": int(arrivals["baseline"])})
    if dry_run:
        summary["duration_seconds"] = int(time.monotonic() - RUN_STARTED_AT)
        write_redacted_summary(summary)
        print(json.dumps({"dry_run": True, **summary}, sort_keys=True))
        return summary
    bot_token = require_env("TELEGRAM_BOT_TOKEN")
    chat_id = require_env("TELEGRAM_CHAT_ID")
    RUN_STAGE = "new_deal_delivery"
    summary.update(send_offer_events(bot_token, chat_id, catalog_games, arrivals["events"],
        arrivals["eligibleIds"], curated, preferences, base_url, ratings_api_key, run_id))
    RUN_STAGE = "price_alert_delivery"
    summary["price_alerts_sent"] = send_price_alerts(
        bot_token, chat_id, alerts, base_url, ratings_api_key, arrivals["offers"], run_id, curated, preferences
    )
    RUN_STAGE = "deal_snapshot_commit"
    request_json(f"{base_url.rstrip('/')}/api/telegram/deals", method="PUT",
                 payload={"eligibleIds": arrivals["eligibleIds"], "offers": arrivals["offers"],
                          "etag": arrivals["etag"], "date": datetime.now(ZoneInfo("Europe/Madrid")).date().isoformat()},
                 headers={"x-api-key": ratings_api_key})
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
