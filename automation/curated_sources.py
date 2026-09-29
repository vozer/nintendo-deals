"""Small HTML parsers for the two curated-deal source pages."""

from __future__ import annotations

from html.parser import HTMLParser
import re
import unicodedata
from typing import Any

from automation.content_policy import is_original_switch_game


class _NintendoLifeSelectsParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.rank = 0
        self.in_title = False
        self.in_eu_price = False
        self.in_old_price = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if self.current is None:
            if tag == "article" and "item" in classes:
                self.rank += 1
                self.current = {
                    "rank": self.rank,
                    "source_reference": values.get("data-uri") or "",
                    "title_parts": [],
                    "price_parts": [],
                    "switch2": False,
                }
            return

        if tag == "img" and (
            "switch-2" in classes or "switch 2" in (values.get("alt") or "").lower()
        ):
            self.current["switch2"] = True
        if tag == "span" and "game-title" in classes:
            self.in_title = True
        if tag == "li" and "region-eu" in classes:
            self.in_eu_price = True
        if tag == "del" and self.in_eu_price:
            self.in_old_price = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "span" and self.in_title:
            self.in_title = False
        if tag == "del" and self.in_old_price:
            self.in_old_price = False
        if tag == "li" and self.in_eu_price:
            self.in_eu_price = False
        if tag != "article" or self.current is None:
            return

        entry = self.current
        self.current = None
        title = " ".join("".join(entry["title_parts"]).split())
        reference = entry["source_reference"].strip().lstrip("/")
        prices = re.findall(r"€\s*(\d+(?:[.,]\d{1,2})?)", "".join(entry["price_parts"]))
        if entry["switch2"] or re.search(r"\bswitch\s*2\b", title, re.IGNORECASE):
            return
        if not title or not reference.startswith("eshop/") or not prices:
            return
        entry.pop("title_parts")
        entry.pop("price_parts")
        entry.pop("switch2")
        entry["title"] = title
        entry["source_price_eur"] = float(prices[-1].replace(",", "."))
        entry["platform"] = "nintendoswitch"
        self.entries.append(entry)

    def handle_data(self, data: str) -> None:
        if self.current is None:
            return
        if self.in_title:
            self.current["title_parts"].append(data)
        if self.in_eu_price and not self.in_old_price:
            self.current["price_parts"].append(data)


class _NTDealsParser(HTMLParser):
    FIELD_CLASSES = {
        "details-title": "title",
        "item-discount": "discount",
        "item-price-discount": "price",
        "item-end-date": "end_text",
        "item-metascore": "metascore",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.games: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.div_depth = 0
        self.capture_field: str | None = None
        self.capture_tag: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        is_product = (
            self.current is None
            and tag == "div"
            and "game-collection-item" in classes
            and "itemscope" in values
        )
        if is_product:
            self.current = {"title": "", "discount": "", "price": "", "end_text": "", "metascore": "", "sku": "", "href": ""}
            self.div_depth = 1
            return
        if self.current is None:
            return

        if tag == "div":
            self.div_depth += 1
        if tag == "a" and any("item-link" in class_name for class_name in classes):
            self.current["href"] = values.get("href") or ""
        if tag == "span" and values.get("itemprop") == "sku":
            self.capture_field, self.capture_tag = "sku", tag
        for class_name, field in self.FIELD_CLASSES.items():
            if any(class_name in candidate for candidate in classes):
                self.capture_field, self.capture_tag = field, tag
                break

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        if tag == self.capture_tag:
            self.capture_field = self.capture_tag = None
        if tag != "div":
            return
        self.div_depth -= 1
        if self.div_depth == 0:
            entry = self.current
            self.current = None
            self.games.append(self._normalize(entry))

    def handle_data(self, data: str) -> None:
        if self.current is not None and self.capture_field:
            self.current[self.capture_field] += data

    @staticmethod
    def _normalize(entry: dict[str, str]) -> dict[str, Any]:
        def amount(value: str) -> float | None:
            match = re.search(r"\d+(?:[.,]\d{1,2})?", value.replace("\u00a0", " "))
            return float(match.group().replace(",", ".")) if match else None

        discount = amount(entry["discount"])
        score = amount(entry["metascore"])
        time_left = re.search(r"(\d+)\s*(day|d[ií]a|hour|hora)", entry["end_text"], re.IGNORECASE)
        days_remaining = None
        if time_left:
            days_remaining = int(time_left.group(1)) if time_left.group(2).lower().startswith(("day", "d")) else 0

        return {
            "title": " ".join(entry["title"].split()),
            "discount_pct": int(discount) if discount is not None else None,
            "price": amount(entry["price"]),
            "days_remaining": days_remaining,
            "end_text": " ".join(entry["end_text"].split()) or None,
            "metacritic_score": int(score) if score is not None else None,
            "sku": entry["sku"].strip() or None,
            "href": entry["href"].strip() or None,
        }


def parse_nintendolife_selects(markup: str) -> list[dict[str, Any]]:
    parser = _NintendoLifeSelectsParser()
    parser.feed(markup)
    parser.close()
    return parser.entries


def parse_ntdeals_games(markup: str) -> list[dict[str, Any]]:
    parser = _NTDealsParser()
    parser.feed(markup)
    parser.close()
    return [game for game in parser.games if game["title"]]


def normalize_title(title: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(title or "").lower().replace("’", "'"))
    return re.sub(r"[^a-z0-9]+", "", normalized.encode("ascii", "ignore").decode("ascii"))


def match_exact_catalog_title(title: str, docs: list[dict[str, Any]]) -> str | None:
    normalized = normalize_title(title)
    if not normalized:
        return None
    matches = {
        str(doc.get("fs_id"))
        for doc in docs
        if str(doc.get("fs_id", "")).isdigit()
        and is_original_switch_game(doc)
        and normalized in {
            normalize_title(doc.get("title")),
            normalize_title(doc.get("title_master_s")),
        }
    }
    return next(iter(matches)) if len(matches) == 1 else None
