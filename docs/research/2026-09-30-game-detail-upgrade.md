# Game Detail Upgrade: Evidence

Retrieved 2026-09-30. Repository baseline `38f35ef`. Planning only; production reads only. No preferences, enrichment snapshots, Telegram messages, or deployments changed.

## User Intent

Detail-view hide/watch controls, English website copy, Steam links on cards and details, and the available images and videos needed to evaluate a game. Preserve Spanish EUR offers and all existing user lists. Retain Nintendo Life and Nintendo links alongside Steam.

## Repository Evidence

- `components/GameDetailModal.tsx:7`: props have no preference state or action callbacks. `components/DealsClient.tsx:840` opens the modal without them.
- `components/DealsClient.tsx:346`: serialized preference actions already call the authenticated atomic endpoint. Failure refreshes preferences but provides no explicit error; reuse and improve this path rather than build another writer.
- `components/GameCard.tsx:23`: category translations exist only here; unknown labels fall through unchanged. `:219` and `components/GameDetailModal.tsx:308` display the raw Spanish excerpt.
- `lib/nintendo-api.ts:4`: all public app catalog paths use ES Solr. Preserve that price/eligibility authority; overlay only presentation fields from EN records matched by exact Nintendo ID.
- `components/GameCard.tsx:269` and `components/GameDetailModal.tsx:330`: Steam links already exist when a cached entry exists. Adding more identical buttons cannot solve missing enrichment.
- `components/GameDetailModal.tsx:22`: only the first YouTube video is selectable. `:39` reopens/refocuses the dialog whenever the gallery key handler changes. Separate dialog lifecycle from gallery navigation.
- `scripts/media-backfill.py:126`: catalog `fl` omits `url`, but `:201` needs it for Nintendo page scraping. Existing entries are skipped; `:207` replaces Nintendo videos with IGDB videos rather than merging.
- `scripts/media-backfill.py:77` and `:91`: IGDB results have limits of 10 screenshots and 5 videos, without pagination. Request all results with bounded pagination rather than silently truncate.
- `scripts/steam-backfill.py:217`: a match is stored only when review scoring succeeds. A game without review counts can consequently lose its valid store link. Separate link identity from nullable review evidence.
- `lib/types.ts:59`, `lib/snapshot-validation.ts:44`: media supports only Nintendo/IGDB and YouTube/Limelight; validators must be upgraded together with consumers, retaining old snapshots.
- `lib/media-storage.ts:15`: whole-map last-writer-wins publication. Add bounded conditional update retries for enrichment updates before introducing another scheduled writer; never involve preferences.
- `.github/workflows/nintendo-deals-daily.yml`: curation and ratings/notification worker run daily, but media and Steam backfills are not scheduled.
- Existing testing: Vitest `lib/*.test.ts`, API contract tests under `app/api/`, Python `automation/tests/`, and local browser `e2e/game-deep-link.spec.ts` at 375/1200px.

## Live Findings

Public snapshots returned HTTP 200: Steam 1,335 entries and media 2,495 entries. ID `3151132` is absent from Steam, media, and ratings. No stored Steam title matched Future Knight.

Exact-ID Nintendo requests:

```text
GET https://searching.nintendo-europe.com/es/select?q=*&fq=type:GAME%20AND%20fs_id:3151132&rows=1&wt=json
GET https://searching.nintendo-europe.com/en/select?q=*&fq=type:GAME%20AND%20fs_id:3151132&rows=1&wt=json
Both: numFound=1; fs_id=3151132; title=Future Knight;
system_type=[nintendoswitch_downloadsoftware]
EN excerpt starts: Frantic action and LCD aesthetics!
```

The [official Nintendo English game page](https://www.nintendo.com/en-gb/Games/Nintendo-Switch-download-software/Future-Knight-3151132.html) contains six `_gItems.push` screenshot records with `image_url` values on `assets.nintendo.eu`; all six have `isVideo: false`. No trailer was exposed in that gallery. This does not prove Nintendo has no video anywhere else.

Steam store-search returned:

```json
[{"id":4235410,"name":"Future Knight"},
 {"id":4235520,"name":"Future Knight Demo"},
 {"id":2117200,"name":"Future Knight (CPC/Spectrum)"}]
```

Read-only `https://store.steampowered.com/api/appdetails?appids=4235410&l=english&cc=es` returned `success: true`, type `game`, developers Studio Koba/Aeternum Game Studios, publisher Aeternum Game Studios, 21 screenshots, and two movies. Movie fields include `id`, `name`, `thumbnail`, `dash_av1`, `dash_h264`, `hls_h264`, and `highlight`, not legacy MP4 fields. Current game and publisher agree with the Nintendo record. Cross-platform screenshots must be labelled PC/Steam, not represented as Switch footage.

## Primary References and Limits

- [IGDB API](https://api-docs.igdb.com/): game-video records provide video IDs and names; screenshots provide image IDs. Existing code already consumes these. Follow documented pagination and request-rate limits.
- [YouTube embed parameters](https://developers.google.com/youtube/player_parameters): construct approved embed URLs from video IDs; playback only after user choice, not forced autoplay. Keep a watch-on-YouTube escape link because iframe load does not prove playable content.
- [Valve trailer documentation](https://partner.steamgames.com/doc/store/trailer): provider context for Steam trailers. Exact Store appdetails fields above are live observed behavior, not a guaranteed documented API contract; fixture-test and preserve cached media on schema drift.
- [Valve review API](https://partner.steamgames.com/doc/store/getreviews): review evidence is separate from game/store identity. Missing reviews must not imply a missing valid Steam destination.

The web research reader could not access the authenticated application URL. The in-app browser reached `/login?next=%2F%3Fgame%3D3151132`; no password was entered and no authenticated visual audit is claimed. One incorrect Valve documentation path failed; the correct `/doc/store/trailer` page was retrieved. A helper-agent wait used an incorrect argument shape, then was corrected to its documented `targets` schema. No production operation was retried blindly.

## Planning Defaults

- Official English Nintendo copy, exact-ID join, no automatic paid translation provider. Missing copy displays an English unavailable state; never fall back to ES prose. Game proper names and publishers remain proper names; external pages/video language are not controlled by this app.
- English categories are presentation-only; retain original category fields for filtering. English date formatting uses the underlying date, not translated string substitution.
- Collect distinct provider assets through bounded pagination; do not promise nonexistent, inaccessible, or rights-restricted footage. Preserve all valid cached assets on provider failure. Mark Steam media explicitly as PC footage.
- No wholesale redesign, no changes to deal eligibility, Telegram scheduling, existing lists, or rating freshness policy.
- Durable lesson: an absent UI link may be absent enrichment rather than missing rendering. Keep this evidence in the feature plan; no agent-rule changes are needed.

## Needs Validation During Implementation

EN feed coverage beyond this spot-check; source matching across editions; Nintendo parser edge cases; actual HLS playback in Chromium/Safari; any provider host allowlist additions; source policy/attribution suitability; bounded daily enrichment throughput; authenticated visual checks locally. None is claimed verified by this planning pass.

## Independent Read-Only Review

A supporting research agent confirmed source-replacement and missing-URL defects with mocked providers and ran 14 existing mocked Python tests successfully. Clean direct `--help` invocations of both media and Steam maintenance scripts failed with `ModuleNotFoundError: automation`; reuse the import bootstrap in `scripts/scrape-curated.py:13`. The existing maintenance workflow is `.github/workflows/nintendo-deals-maintenance.yml`; use it rather than creating another workflow. `app/api/enrichment/route.test.ts` is a shared test file, not a production `/api/enrichment` route.

Chosen simplification: keep strict numeric `SteamRating` scores unchanged. Store an optional validated Steam match in the existing media entry so a valid link can exist independently of review counts. Keep maintenance manually dispatched initially; do not put enrichment acquisition on the Telegram critical path. Use existing storage, guarded publication, and provider provenance rather than a new database or service.

## Approval Correction

2026-09-30: user approved implementation and requested Spanish excerpt fallback when official English is unavailable. This supersedes the no-Spanish-fallback planning default. No paid translation service is added.
