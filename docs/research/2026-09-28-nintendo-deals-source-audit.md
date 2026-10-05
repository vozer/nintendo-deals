# Nintendo Deals external source audit

**Date:** 2026-09-28  
**Repository revision:** [`65bc1bac57313dea8f12c04bdf141a6bdf427ff0`](https://github.com/vozer/nintendo-deals/tree/65bc1bac57313dea8f12c04bdf141a6bdf427ff0)  
**Method:** Primary sources only: live provider pages/payloads, official API documentation, and the repository at the revision above. Live checks were limited to small read-only HTTP requests. No scraper, authenticated provider API, webhook, message send, or production mutation was run.

## Executive conclusion

The intended source split is sound: Nintendo for catalog/prices, Nintendo Life for editorial curation, IGDB for ratings, Telegram for delivery/actions, and GitHub Actions for orchestration. The current contracts do not fully implement that split:

1. **Nintendo daily processing is incomplete.** The worker asks for 1,000 rows once, while the same live filter reported **3,145** matches. Price alerts, digest selection, and IGDB discovery therefore operate on an unspecified first subset.
2. **Nintendo Life ingestion is currently broken and semantically stale.** Its regex expects `<div class="list-item">`; the canonical guide now emits `<section class="list-item">`. Its two source URLs also resolve to the same 2026 page, and neither Better eShop eShop Selects nor Current Offers is consumed.
3. **Rating refresh has no release-age policy.** The worker only queries IGDB for Nintendo IDs absent from stored ratings. That is correct for games at least two months old, but newly released games need temporary refreshes while their rating evidence is still developing.
4. **Nintendo search pagination is internally inconsistent.** A live `Hollow Knight` eDisMax query reported 111 hits, but repository search caps at 100 and ignores `start`, so load-more repeats the first page.
5. **The GitHub schedule can silently skip a day.** Both schedules run at minute zero, which GitHub identifies as a high-load period, while the repository discards a run that starts 20 or more minutes late.
6. **Telegram acknowledges success before persistence.** A callback can show “Game hidden” or “Alert set” before the preference write succeeds; retries are not deduplicated by `update_id`.

## Recommended source-of-truth split

| Concern | Source of truth | Role and boundary |
|---|---|---|
| Spanish availability and EUR price | Nintendo Europe search endpoint | Authoritative operational input, but treat it as an undocumented public endpoint: validate schema/counts and fail visibly on drift. |
| Editorial selection | Nintendo Life eShop Selects | Nintendo Life's own current editorial signal. Do not infer it from the all-time “best games” guide. |
| Sale discovery cross-check | Nintendo Life Better eShop Current Offers | Secondary discovery/monitoring only. Nintendo Life states Better eShop aggregates data from various sources, so it should not override Nintendo price data. |
| Ratings and review counts | IGDB | Enrichment only; refresh through the first two months after release, then retain the first successful older-game result. |
| Secondary deal picks | NT Deals Spanish Switch feed | Discovery signal only; Nintendo remains price/availability authority and Nintendo Life remains editorial authority. |
| Notifications and user actions | Telegram Bot API | Transport only; local preference storage remains the state authority. |
| Timing and credentials | GitHub Actions | Orchestration and secret injection; use native timezone scheduling and avoid token-bearing log text. |

## 1. Nintendo Life: Better eShop, eShop Selects, and Current Offers

### Primary-source observations

- Nintendo Life says Better eShop sits on its own game database, gathers data from various sources, updates daily, and currently supports US, UK, and EU regions. That makes it first-party evidence for **Nintendo Life curation**, but not an authoritative Nintendo price feed. See [Better eShop: About](https://www.nintendolife.com/eshop/about).
- [Nintendo Life eShop Selects](https://www.nintendolife.com/eshop/eshop-selects) describes games as hand selected by the Nintendo Life team. On 2026-09-28, its first visible August 2026 item was represented as:

  ```html
  <article class="item" data-uri="eshop/big-walk">
    <span class="game-title">Big Walk</span>
    <li class="region-eu last"><sup class="cur">&euro;</sup>18.99</li>
  </article>
  ```

  The same card explicitly identified the platform as Nintendo Switch 2. The page also links each month heading to the corresponding Nintendo Life editorial article.
- [Better eShop: Current Offers](https://www.nintendolife.com/eshop/offers) describes itself as games currently discounted. Its first visible item on 2026-09-28 carried `region-eu region-uk region-us`, separate regional discounts/prices, and a Switch 2 marker:

  ```html
  <article class="region-eu region-uk region-us item">
    <li class="region-eu last">10% off</li>
    <del>&euro;39.99</del><sup class="cur">&euro;</sup>35.99
  </article>
  ```
- The repository's first configured guide URL redirects to the second configured URL, [`the-best-nintendo-switch-games-2026`](https://www.nintendolife.com/guides/the-best-nintendo-switch-games-2026). The canonical page currently starts its ranked list with:

  ```html
  <section class="list-item" id="games-switch-eshop-okami_hd">
    <h3 class="heading">50. <a>Okami HD <span class="sys">Switch eShop</span></a></h3>
  </section>
  ```

### Repository comparison

- [`scripts/scrape-curated.py`](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-curated.py#L16-L24) configures two URLs that now resolve to one canonical guide. This provides no independent second source.
- Its parser requires `<div class="list-item">` at [lines 48-54](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-curated.py#L48-L54), while the live page uses `<section class="list-item">`. The current parser therefore has no matching list-item wrapper.
- Even after changing the wrapper, the extraction order at [lines 55-57](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-curated.py#L55-L57) removes a parenthesized suffix before stripping markup. On current HTML, that produces a title such as `Okami HD Switch eShop`, not `Okami HD`, weakening Solr matching.
- The scraper writes to a hard-coded production base URL and has no dry-run mode at [lines 146-172](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-curated.py#L146-L172). It is not invoked by the daily workflow. Stored curation is therefore manually refreshed, despite Better eShop itself changing daily.
- Neither [eShop Selects](https://www.nintendolife.com/eshop/eshop-selects) nor [Current Offers](https://www.nintendolife.com/eshop/offers) appears in repository source configuration.

### Contract decision

Use **eShop Selects** as the editorial-curation contract. Use **Current Offers** only to detect potential source drift or discover candidates; confirm price and eligibility against Nintendo Europe. Retire the duplicate all-time-guide URL as a current-deals source. Any HTML consumer needs a small fixture/smoke check for item count, title, platform, EU price, and source URL before publishing.

## 2. Nintendo Europe search/Solr behavior

No public Nintendo API specification for this endpoint was found. The following is therefore an observed contract, not a supported API guarantee.

### Concrete payload evidence

A read-only request to the [Spanish `select` endpoint with the worker's deal filter and `rows=1`](https://searching.nintendo-europe.com/es/select?q=%2A&fq=type%3AGAME%20AND%20system_type%3Anintendoswitch%2A%20AND%20price_has_discount_b%3Atrue%20AND%20price_sorting_f%3A%5B0%20TO%2014.99%5D%20AND%20language_availability%3A%2Aenglish%2A&rows=1&wt=json&fl=fs_id%2Ctitle%2Ctitle_master_s%2Cprice_regular_f%2Cprice_discounted_f%2Cprice_has_discount_b%2Cprice_sorting_f%2Curl) returned this shape on 2026-09-28:

```json
{
  "responseHeader": { "status": 0, "params": { "q": "*", "rows": "1" } },
  "response": {
    "numFound": 3145,
    "docs": [{
      "fs_id": "2874684",
      "title": "Mortal Glory 2",
      "price_regular_f": 11.99,
      "price_discounted_f": 9.59,
      "price_has_discount_b": true,
      "url": "/es-es/Juegos/Programas-descargables-Nintendo-Switch/Mortal-Glory-2-2874684.html"
    }]
  }
}
```

The endpoint echoes effective request parameters under `responseHeader.params`; both `q=*` and `q=*:*` returned the same `numFound` for this filter.

A read-only [eDisMax query for `Hollow Knight`](https://searching.nintendo-europe.com/es/select?defType=edismax&q=Hollow%20Knight&qf=title%5E3%20title_extras_txt%5E2%20title_master_s%5E3&pf=title%5E10%20title_extras_txt%5E5%20title_master_s%5E10&fq=type%3AGAME%20AND%20system_type%3Anintendoswitch%2A%20AND%20language_availability%3A%2Aenglish%2A&rows=2&wt=json&fl=fs_id%2Ctitle%2Ctitle_master_s%2Csystem_type%2Cprice_sorting_f%2Curl) reported 111 matches and ranked `Hollow Knight` first, followed by `Hollow Knight: Silksong`. This supports the repository's eDisMax field/phrase boosts as an observed search behavior.

An exact `system_type:nintendoswitch2` query with the same price/language constraints returned **35** discounted results at or below EUR 14.99, including explicit Nintendo Switch 2 URLs. Because the repository uses `system_type:nintendoswitch*`, its catalog currently includes Switch 2 records as well as Switch records. Repeating the complete filter with `AND -system_type:nintendoswitch2` returned **3,110** original-Switch matches, compared with **3,145** under the current wildcard.

### Repository comparison

- The daily worker requests `rows=1000` once and never paginates at [`automation/run_daily.py` lines 80-95](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L80-L95). Against `numFound=3145`, at least 2,145 current matches are outside that run's input. With no explicit sort, the omitted set is not a stable business selection.
- That incomplete list drives price alerts, digest selection, and IGDB discovery at [lines 253-273](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L253-L273). A watched game outside the first 1,000 cannot alert.
- UI bulk fetches do paginate above 1,000 at [`lib/nintendo-api.ts` lines 70-90](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/lib/nintendo-api.ts#L70-L90), so worker and UI do not share one catalog contract.
- Search caps results at 100 and ignores `start` at [lines 118-135](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/lib/nintendo-api.ts#L118-L135). The client nevertheless invokes load-more while `games.length < total`, passing increasing `start` values. For queries over 100 hits, the same first 100 are appended repeatedly.
- Product scope is original Nintendo Switch only. A positive `system_type:nintendoswitch` query is not sufficient because the field is analyzed/multivalued and some Switch 2 records also carry Nintendo Switch labels. Every catalog path needs the explicit negative clause `-system_type:nintendoswitch2`.

### Contract decision

Centralize one paginated Nintendo query contract using the existing Switch inclusion plus `-system_type:nintendoswitch2`, and continue until the accumulated count reaches `response.numFound` (or a response is empty). Add a stable sort with a unique tie-breaker if the endpoint accepts one. For alerts, a direct `fs_id` lookup of every watched game is the smallest correctness backstop even if full-catalog ingestion later fails.

## 3. IGDB/Twitch authentication and limits

### Official contract

- IGDB requires a Twitch account/application and a confidential client to generate a client secret. It documents the OAuth client-credentials request and an access-token response containing `expires_in`. See [IGDB Authentication](https://api-docs.igdb.com/#authentication) and Twitch's [client credentials grant flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth#client-credentials-grant-flow).
- IGDB requests normally use `POST https://api.igdb.com/v4/{endpoint}`, with `Client-ID` and `Authorization: Bearer ...` headers and an APICalypse query in the body. See [IGDB Requests](https://api-docs.igdb.com/#requests).
- The official limit is **4 requests per second** and no more than **8 open requests**; excess rate returns HTTP 429. See [IGDB Rate Limits](https://api-docs.igdb.com/#rate-limits).
- The Games schema defines `aggregated_rating` as external critic score, `aggregated_rating_count` as its count, and `rating_count` as the number of IGDB user ratings. See the [Games endpoint fields](https://api-docs.igdb.com/#game).

### Repository comparison

- Token endpoint, grant, request method, and headers match the official contracts at [`automation/run_daily.py` lines 102-143](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L102-L143).
- Requests are sequential and spaced by 0.35 seconds at [lines 176-183](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L176-L183), a nominal maximum of about 2.86 requests/second after response time. HTTP 429 receives bounded retry/backoff. This is within the documented limit.
- The requested rating fields exist and their stored meanings are consistent with the IGDB schema.
- Candidates are restricted to IDs not already present at [lines 163-174](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L163-L174). This already provides the desired write-once behavior for established games, but it cannot refresh ratings for games still inside their first two months after release.
- Matching is title-only and the IGDB query has no platform/version constraint at [lines 128-133](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L128-L133). This is valid API usage but a semantic mismatch risk for ports, editions, remakes, and same-name games.

### Contract decision

Keep the current authentication and throttle. Define two bounded queues: missing ratings, and existing ratings whose Nintendo release date is less than two months old. Refresh the latter daily until the boundary; once a game is at least two months old, retain its first successful match without routine refresh. Request enough platform/version metadata to reject clearly incompatible title matches; matching correctness remains separate from refresh cadence. Do not increase request volume until Nintendo pagination is fixed, because the current 1,000-row subset hides the real queue.

## 4. Telegram webhook and callback behavior

### Official contract

- Telegram delivers a JSON `Update` by HTTPS POST. Any non-2xx response is retried; `update_id` exists specifically to ignore repeats or restore order. A webhook and `getUpdates` are mutually exclusive. See [Telegram `setWebhook`](https://core.telegram.org/bots/api#setwebhook) and [Update](https://core.telegram.org/bots/api#update).
- When `secret_token` is configured, Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`; valid values are 1-256 characters from letters, digits, underscore, and hyphen. See [`setWebhook`](https://core.telegram.org/bots/api#setwebhook).
- `callback_data` is limited to 1-64 bytes. Telegram clients show progress until the bot calls `answerCallbackQuery`, which Telegram says is necessary even without notification text. See [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton) and [CallbackQuery](https://core.telegram.org/bots/api#callbackquery).
- `editMessageText` identifies a normal bot message by `chat_id` and `message_id`. See [`editMessageText`](https://core.telegram.org/bots/api#editmessagetext).

### Repository comparison

- The route validates the official secret header with a timing-safe comparison before parsing the body at [`app/api/telegram/webhook/route.ts` lines 21-30](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/app/api/telegram/webhook/route.ts#L21-L30).
- Generated callback strings are comfortably below 64 bytes for numeric `fs_id` values, and the parser rejects unknown forms at [`lib/telegram.ts` lines 7-26](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/lib/telegram.ts#L7-L26).
- The route answers every recognized callback, satisfying Telegram's progress-bar requirement. However, it sends a success message **before** `applyPreferencesAction` at [route lines 57-63](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/app/api/telegram/webhook/route.ts#L57-L63). Storage failure can therefore produce a false success acknowledgement.
- The route does not record `update_id`. The hide/watch operations are state-idempotent, which limits duplicate damage, but a retried delivery can repeat callback answering and message editing. If persistence succeeds and `editMessageText` fails, the handler returns 500 and Telegram retries the whole sequence.
- README's `setWebhook` example omits `allowed_updates`. Telegram documents that omission preserves the previous setting; a new webhook therefore receives the default update set, while this route only uses `callback_query` and silently ignores the rest.

### Contract decision

Answer quickly with a neutral acknowledgement, then report success only through the edited message after persistence. Track handled `update_id` values for a short retention window or make the complete callback transaction safely replayable. Configure `allowed_updates=["callback_query"]` when setting the webhook. These are configuration/code recommendations only; no webhook change was made during this audit.

## 5. GitHub Actions scheduling and secrets

### Official contract

- GitHub scheduled workflows use the latest default-branch commit. GitHub now supports an IANA `timezone` on `on.schedule`; otherwise schedules are UTC. See [workflow syntax: `on.schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule).
- GitHub warns that scheduled events can be delayed during high load, especially at the start of an hour, and can be dropped. Public-repository schedules are disabled after 60 days without repository activity. See [events that trigger workflows: `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- A concurrency group allows one running and, by default, one pending run; a new pending run replaces the existing pending run even when `cancel-in-progress` is false. See [control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
- Unset secret expressions resolve to an empty string. GitHub redacts registered secrets from logs, but its security guidance says transformed values may not be reliably redacted and warns against printing secrets. See [using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [Secrets](https://docs.github.com/en/actions/concepts/security/secrets).

### Repository comparison

- The workflow schedules `0 8 * * *` and `0 9 * * *`, then runs only if Madrid local time is 10:00-10:19 at [`.github/workflows/nintendo-deals-daily.yml` lines 11-44](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/.github/workflows/nintendo-deals-daily.yml#L11-L44). A top-of-hour delay beyond 19 minutes makes the workflow finish without running the worker, creating a silent missed day.
- Native `timezone: "Europe/Madrid"` now makes the dual UTC schedules and runtime DST gate unnecessary. Scheduling at a non-zero minute also follows GitHub's advice to avoid peak load.
- The fixed concurrency group prevents simultaneous whole-map writes, but it does not preserve every pending run. A newly queued manual or scheduled run can replace another pending run.
- Secrets are passed as step environment variables, matching GitHub guidance, and the worker explicitly rejects empty required values.
- Telegram requests embed the bot token in the required Bot API URL. The generic HTTP error at [`automation/run_daily.py` lines 56-75](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/automation/run_daily.py#L56-L75) includes the full request URL, and the top-level handler prints the exception. GitHub should mask the registered token, but the safer contract is never to construct token-bearing error text.

### Contract decision

Use one timezone-aware schedule at a non-zero minute, for example 10:07 Europe/Madrid, and remove the 20-minute acceptance gate. Keep explicit `require_env` checks. Redact provider URLs at the request wrapper boundary so errors report provider, method, and status without credentials.

## 6. Steam reviews and SteamSpy tags

### Primary-source observations

- Valve documents `GET store.steampowered.com/appreviews/<appid>?json=1` and exposes `query_summary.total_positive`, `total_negative`, and `total_reviews`. This is the appropriate source for the aggregate score and review count used by the product. See [Steamworks: User Reviews - Get List](https://partner.steamgames.com/doc/store/getreviews?language=english).
- SteamSpy is a third-party tag enrichment, not a review authority. Its availability is not required for the score and review count already provided by Valve's documented review endpoint.

### Repository comparison

- [`scripts/steam-backfill.py`](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/steam-backfill.py#L105-L139) first scrapes review text from Steam store HTML and only then falls back to Valve's documented review response. The order should be reversed: the structured documented response already contains the product's required totals.
- App matching uses an undocumented store-search endpoint and title-only heuristics at [lines 31-90](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/steam-backfill.py#L31-L90). It does not retain a match confidence, platform evidence, or rejection reason, so editions and remakes can be attached incorrectly.
- Tags come from SteamSpy at [lines 93-102](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/steam-backfill.py#L93-L102), and the UI then uses those tags for exclusion. A failure returns an empty list, which is indistinguishable from a game with no tags.
- The backfill writes the entire Steam map every 20 accepted games and can continue after an intermediate save failure. It has no dry-run mode, provider fixture, dependency manifest, or refresh timestamp per Steam entry.

### Contract decision

Use Valve's documented review response for score and vote count. Keep the Steam link only when matching is supported by title plus edition/platform evidence; reject ambiguity. Retain SteamSpy because its tags already power tag exclusion and shovelware heuristics, but treat it as optional cached enrichment: a failed request must preserve the last known tags, must not be converted to an authoritative empty list, and must not fail the worker or change deal eligibility.

## 7. NT Deals

The earlier research-browser failure was not evidence that NT Deals was unavailable. A second read-only check reached [NT Deals Germany](https://ntdeals.net/de-store), [NT Deals Spain](https://ntdeals.net/es-store), and the explicit [Spanish Nintendo Switch discounts feed](https://ntdeals.net/es-store/discounts?platforms=switch). The Switch-only page reported 1,800 results and exposed title, platform, discount, current price, offer end, and Metascore fields. No production scraper run was performed, so live reachability is verified while the repository parser still requires a saved-fixture contract test.

### Repository and stored-data observations

- Production currently stores 488 `ntdeals` entries, compared with 45 Nintendo Life entries. This explains why a merged map can appear dominated by the secondary source even though the UI now labels it separately.
- [`scripts/scrape-ntdeals.py`](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-ntdeals.py#L18-L27) already targets the Spanish discounts page and appends `platforms=switch`, which matches the intended region and original-Switch scope. It depends on `cloudscraper`, but the repository has no Python dependency manifest, so a fresh GitHub runner cannot reproduce the script from the repository alone.
- The parser is a set of HTML regular expressions at [lines 83-155](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-ntdeals.py#L83-L155), and the script scrapes three overlapping sort orders before title-matching only the first five Nintendo candidates.
- The computed `Excellent`, `Great`, and `Good` labels at [lines 158-171](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/scripts/scrape-ntdeals.py#L158-L171) are repository-authored heuristics, not provider facts. They should not be displayed as provider-authored ratings without explicit wording.
- The script correctly preserves non-NT-Deals entries during merge, but the physical `curated.json` shape permits only one source entry per Nintendo game. If both sources match the same game, one signal necessarily wins.

### Contract decision

Keep NT Deals as a secondary blue Deal Pick signal from the Spanish Switch-only feed. It must not override Nintendo price, bypass vote-confidence rules, or replace a Nintendo Life editorial signal. Before scheduling it, add a pinned dependency manifest, a sanitized HTML fixture, parser count/field assertions, a dry-run artifact, and separate source storage.

## 8. Website, state, and architecture audit

### Live read-only evidence

| Boundary | 2026-09-28 observation |
|---|---|
| `/login` | HTTP 200, approximately 1.0 seconds |
| `/api/preferences` | HTTP 200; 157 hidden, 10 watched, 4 thinking |
| `/api/ratings` | HTTP 200; 2,281 entries, approximately 501 KB |
| `/api/media` | HTTP 200; 2,495 entries, approximately 3.19 MB |
| `/api/steam` | HTTP 200; 1,335 entries, approximately 401 KB |
| `/api/curated` | HTTP 200; 533 entries, approximately 135 KB |
| Anonymous preference, action, and rating mutations | HTTP 401; no write occurred |
| Nintendo worker filter | 3,145 distinct live records |
| First 1,000 records | 2 Nintendo Life overlaps, 0 eligible digest items |
| All records | 3 Nintendo Life overlaps, 1 eligible digest item |
| Platform flag | 2,953 digital records and 192 not marked digital |
| Displayed price mismatch | 2 records pass the source field filter but have an actual discounted price of 17.49 EUR |

The single all-catalog digest candidate was `FINAL FANTASY VI` (`fs_id` 2368849, 10.79 EUR). This is direct evidence that the 1,000-row worker cap, not only curation scarcity, caused the observed empty digest.

### Visible browser evidence

- A local Next.js 16 run using the production read-only Blob data rendered at desktop and 375-pixel mobile widths. The card grid became one column on mobile and the tab strip remained horizontally scrollable.
- Opening `/?game=1337462`, authenticating, and returning to the preserved destination did **not** open the detail dialog. The runtime emitted: `Route "/" used searchParams.game. searchParams is a Promise and must be unwrapped`. Next.js 16 documents that synchronous `searchParams` access has been removed. See [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) and repository [`app/page.tsx` lines 3-17](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/app/page.tsx#L3-L17).
- The first visible card was `MONSTER HUNTER RISE` at 17.49 EUR despite the intended maximum of 14.99 EUR. Nintendo's `price_sorting_f` was 4.79 while `price_discounted_f` was 17.49, so the source filter needs a post-retrieval actual-price check.
- Steam and IGDB buttons render when a confident stored mapping exists. The previously reported missing Steam link is not a missing component; games without a stored Steam match intentionally have no Steam link.
- The detail overlay handles Escape but has no dialog role, `aria-modal`, focus trap, focus restoration, or accessible labels on the close and carousel-dot controls at [`components/GameDetailModal.tsx` lines 24-115](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/components/GameDetailModal.tsx#L24-L115).

Visual evidence is stored at [`docs/research/evidence/audit-desktop-deep-link.png`](evidence/audit-desktop-deep-link.png) and [`docs/research/evidence/audit-mobile-deep-link.png`](evidence/audit-mobile-deep-link.png).

### State integrity

- Preference actions are idempotent at the business-operation level, but they read the full document, clone it, and overwrite it at [`lib/preferences-actions.ts` lines 68-150](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/lib/preferences-actions.ts#L68-L150). Two concurrent actions can both read version A and then overwrite each other.
- Vercel Blob officially supports `ifMatch` conditional writes and raises `BlobPreconditionFailedError` when another writer changes the object. It also recommends immutable, versioned objects for read-mostly data. See [Vercel Blob: conditional writes and update guidance](https://vercel.com/docs/vercel-blob). The minimum architecture change is therefore ETag-guarded preference writes with bounded retry, not a second database.
- Ratings, media, Steam, and curated readers catch every storage error and return an empty map. Callers cannot distinguish a legitimate empty dataset from provider or storage failure.
- All five data families use fixed-path whole-map overwrites. The curated write route rejects only zero entries at [`app/api/curated/route.ts` lines 18-38](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/app/api/curated/route.ts#L18-L38), so an accidental one-entry payload can replace 533 records.
- Maintenance scripts are unsafe by default. Media and Steam backfills hard-code the production base URL, and media, Steam, and both curation scripts can continue from `{}` after a failed current-state read before issuing a whole-map write. Every script needs dry-run default, an explicit target, an explicit `--apply`, and a successful strict current-state read before mutation.
- Bulk enrichment routes count top-level keys but do not validate game identifiers, required value fields, numeric ranges, payload size, or source values. A non-empty malformed object can therefore become the current snapshot.
- Daily and manually replayed worker runs have no delivery key, message ledger, last-alerted price, or run identifier. A retry after partial delivery can resend the same message. A date-scoped key such as `(delivery_date, kind, game_id, threshold, observed_price)` would prevent same-day retry duplicates while still allowing a later daily reminder.

### Authentication and exposure

- Anonymous mutating requests were correctly denied in live tests.
- The access endpoint stores the configured password itself in the session cookie at [`app/api/auth/route.ts` lines 3-17](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/app/api/auth/route.ts#L3-L17), and middleware compares that cookie directly with the environment value. Use an opaque signed session value instead, and add bounded login attempts.
- Middleware deliberately bypasses all enrichment and preference routes at [`middleware.ts` lines 6-16](https://github.com/vozer/nintendo-deals/blob/65bc1bac57313dea8f12c04bdf141a6bdf427ff0/middleware.ts#L6-L16). Writes add route-level authorization, but preference reads expose the single shopper's hidden/watch state publicly. This should be an explicit product choice, not a middleware side effect.
- Next.js 16 deprecates the `middleware` file convention in favor of `proxy`; the build warns today. See [Next.js: Renaming Middleware to Proxy](https://nextjs.org/docs/messages/middleware-to-proxy).

### Payload and consistency costs

- Initial page load independently retrieves preferences plus the full ratings, media, Steam, and curated maps. The media response alone was about 3.19 MB, and a 3,000-row local catalog request took 2.3-3.2 seconds during the visual run.
- Client-side rating/value sort asks for at most 3,000 catalog rows, while the live source reported 3,145. The UI can therefore omit 145 candidates even though the TypeScript helper itself can paginate larger requests.
- Hidden, watched, and thinking tabs are intersections with the currently loaded active-offer collection. Their badge counts come from all preferences, so a tab can show a count that is larger than the number of cards it can render.
- A single curated map keyed only by Nintendo identifier cannot preserve simultaneous Nintendo Life and NT Deals signals for one game. Source-specific snapshots or a nested per-source value are required.
- Content rules differ by runtime: the web and worker omit the digital-only filter that Steam backfill includes; search bypasses ordinary title, Steam-tag, and quality filtering; and Python's blocked-title pattern is narrower than TypeScript's. One policy contract needs parity tests in both runtimes.

### Test and documentation gaps

- The six worker-rule unit tests passed. TypeScript, ESLint, and the production build passed; ESLint emitted six warnings and the build emitted the expected middleware deprecation warning.
- No automated test exercises route authorization, Blob failure/concurrency, Nintendo pagination, search pagination, the homepage deep link, Telegram replay/failure behavior, or scraper fixture drift.
- A green production build did not detect the deep-link defect because the homepage was statically generated and the fault occurs only when the runtime query value is accessed.
- README claims and current behavior have drifted: the catalog includes records not marked digital, ratings described as daily are never refreshed once stored, and the old curation source is not the current Better eShop editorial selection.
- The card's detail trigger is a clickable `div` rather than a native keyboard-operable control, compounding the modal semantics and focus gaps.
- The GitHub workflow uses action tags rather than immutable commit SHAs, and `cloudscraper` has no pinned Python dependency manifest. These are supply-chain and reproducibility gaps rather than evidence of current compromise.

## 9. Reverse-engineered system model

The audit created an AI Unified Process baseline so the remediation can be reviewed against stable behavior identifiers:

- [`docs/vision.md`](../vision.md)
- [`docs/requirements.md`](../requirements.md)
- [`docs/use_cases.puml`](../use_cases.puml)
- [`docs/use_cases/`](../use_cases/)
- [`docs/entity_model.md`](../entity_model.md)
- [`docs/plans/2026-09-28-nintendo-deals-system-audit-plan.md`](../plans/2026-09-28-nintendo-deals-system-audit-plan.md)
- [`docs/plans/2026-09-28-nintendo-deals-system-audit-plan.html`](../plans/2026-09-28-nintendo-deals-system-audit-plan.html)

## Prioritized remediation backlog

| Priority | Minimal change | Acceptance evidence |
|---|---|---|
| P0 | Paginate the daily Nintendo query to `numFound`; directly fetch watched IDs as an alert backstop. | Synthetic pagination test plus a read-only run where fetched count equals reported count. |
| P0 | Replace the broken Nintendo Life wrapper/title assumptions and use eShop Selects as the curation input. | Saved HTML fixture extracts nonzero items, clean titles, platform, EU price, and canonical source URL. |
| P1 | Honor `start` in eDisMax search or stop advertising more than the first 100. | A query with more than 100 hits returns disjoint first/second pages. |
| P1 | Implement the IGDB release-age refresh rule. | Missing records and games less than two months old enter a bounded queue; older successful matches do not. |
| P1 | Make Telegram callback handling replay-safe and avoid success-before-write. | Duplicate `update_id` and storage/edit failure tests show one state mutation and truthful user status. |
| P1 | Replace dual top-of-hour UTC schedules with one timezone-aware non-zero-minute schedule. | Workflow syntax validation and documented Madrid trigger time. |
| P2 | Enforce original-Switch-only scope with an explicit Switch 2 exclusion. | Every Nintendo query contract excludes a known `nintendoswitch2` payload and the live deal count matches the Switch-only source count. |
| P2 | Remove token-bearing URLs from exception messages. | Failure test confirms logs contain method/status but no credential-bearing URL. |
| P2 | Add `ifMatch` conflict handling to preferences and retain completed Telegram update identifiers in the same conditional state transition. | Two simultaneous independent actions survive, and a replay produces no additional mutation. |
| P2 | Publish enrichment maps as validated versioned snapshots instead of unconditional fixed-path replacements. | A partial or malformed refresh cannot replace the current pointer. |
| P2 | Replace Steam HTML review scraping with Valve's documented review summary and make SteamSpy tag refresh failure-tolerant. | Fixture test derives score/count from `query_summary`; SteamSpy outage preserves last-known tags and does not change deal eligibility. |

## Source list

- [Nintendo Life Better eShop: About](https://www.nintendolife.com/eshop/about)
- [Nintendo Life Better eShop: eShop Selects](https://www.nintendolife.com/eshop/eshop-selects)
- [Nintendo Life Better eShop: Current Offers](https://www.nintendolife.com/eshop/offers)
- [Nintendo Life: The Best Nintendo Switch Games (2026)](https://www.nintendolife.com/guides/the-best-nintendo-switch-games-2026)
- [Nintendo Europe Spanish search endpoint, observed deal query](https://searching.nintendo-europe.com/es/select?q=%2A&fq=type%3AGAME%20AND%20system_type%3Anintendoswitch%2A%20AND%20price_has_discount_b%3Atrue%20AND%20price_sorting_f%3A%5B0%20TO%2014.99%5D%20AND%20language_availability%3A%2Aenglish%2A&rows=1&wt=json)
- [IGDB API documentation](https://api-docs.igdb.com/)
- [Twitch OAuth client credentials](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth#client-credentials-grant-flow)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions schedule event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [Steamworks: User Reviews - Get List](https://partner.steamgames.com/doc/store/getreviews?language=english)
- [NT Deals Spain: Nintendo Switch discounts](https://ntdeals.net/es-store/discounts?platforms=switch)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js: Renaming Middleware to Proxy](https://nextjs.org/docs/messages/middleware-to-proxy)

## 2026-10-04 offer expiry hook verification

The official [Future Knight product page](https://www.nintendo.com/es-es/Juegos/Programas-descargables-Nintendo-Switch/Future-Knight-3151132.html) renders a sale end date from its selected title's price data. A read-only query to Nintendo's public [`/v1/price` endpoint](https://api.ec.nintendo.com/v1/price?country=ES&lang=es&ids=70010000121425) returned `title_id`, `discount_price.raw_value`, and `discount_price.end_datetime`. The matching Spanish Solr record exposes the Nintendo Shop ID as `nsuid_txt`.

This is an observed source integration, not a published API stability guarantee. The worker batches Shop IDs by 50, accepts only unambiguous future `end_datetime` values whose raw sale price matches the catalog's discounted cents, and omits absent or stale dates rather than inferring an expiry. The website accepts a date only when the published snapshot is at most 36 hours old and still matches the currently displayed discounted price.
