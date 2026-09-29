# Nintendo Deals System Audit And Remediation Plan

**Date:** 2026-09-28  
**Plan status:** Remediation implemented; final login-landmark fix is awaiting production redeploy, and the first scheduled worker run remains pending
**Audited revision:** `65bc1bac57313dea8f12c04bdf141a6bdf427ff0`  
**Evidence:** [Source audit](../research/2026-09-28-nintendo-deals-source-audit.md), [requirements](../requirements.md), [use cases](../use_cases.puml), [entity model](../entity_model.md)

## Executive Decision

Keep the small Vercel plus GitHub Actions architecture. Do not rebuild the product around a new crawler platform or reintroduce n8n. Fix the correctness boundaries first, refresh source semantics second, and use Vercel Blob's conditional writes for preference actions and Telegram replay state. Large read-mostly enrichment maps can remain validated Vercel Blob snapshots.

The current product is usable, but it cannot yet be trusted to find every eligible offer or to deliver a correct daily digest:

- The daily worker processes 1,000 of 3,145 live matching Nintendo records. The one live Nintendo Life digest candidate was outside the first 1,000, explaining the zero-item digest.
- Nintendo Life ingestion targets two guide URLs that resolve to one stale guide, and its parser no longer matches the live wrapper element. It does not consume Better eShop eShop Selects.
- Search load-more ignores its offset and can append the first 100 results repeatedly.
- `/?game=<id>` does not open a game under Next.js 16 because the page reads an asynchronous query object synchronously.
- The visible under-14.99-EUR list includes at least two games priced at 17.49 EUR because the Nintendo filter field and displayed discounted price disagree.
- Telegram confirms success before preference persistence and has no completed-update record.
- Preferences and enrichments are whole-map overwrites. Preference read-modify-write can lose a concurrent website or Telegram action.

## Verified Baseline

### Live Read-Only Data

| Boundary | Observation |
|---|---|
| Nintendo deal query | 3,145 matching rows |
| Original Switch-only query | 3,110 matching rows after excluding 35 Switch 2 records |
| Worker input | First 1,000 rows only |
| Nintendo Life overlap | 2 in first 1,000; 3 in all rows |
| Eligible digest items | 0 in first 1,000; 1 in all rows |
| Digital flags | 2,953 digital; 192 not marked digital |
| Actual prices above 14.99 EUR | 2 records at 17.49 EUR despite source filter |
| Preferences | 157 hidden, 10 watched, 4 thinking |
| Ratings snapshot | 2,281 records, approximately 501 KB |
| Media snapshot | 2,495 records, approximately 3.19 MB |
| Steam snapshot | 1,335 records, approximately 401 KB |
| Curated snapshot | 533 records: 45 Nintendo Life, 488 NT Deals |
| Anonymous writes | Preferences, actions, and ratings correctly returned 401 |

### Local And Repository Checks

| Check | Result |
|---|---|
| Worker unit tests | 6 passed |
| TypeScript | Passed |
| ESLint | Passed with 6 warnings |
| Production build | Passed; middleware deprecation warning |
| Desktop visual check | Responsive list rendered; deep-link modal did not open |
| Mobile visual check | One-column layout rendered; deep-link modal did not open |
| Browser runtime | Exact Next.js warning for synchronous `searchParams.game` access |

Screenshots: [`audit-desktop-deep-link.png`](../research/evidence/audit-desktop-deep-link.png) and [`audit-mobile-deep-link.png`](../research/evidence/audit-mobile-deep-link.png).

## Source Policy

| Source | Keep? | Correct role | Required change |
|---|---|---|---|
| Nintendo Europe search | Yes | Authority for Spanish original-Switch availability and EUR price | Paginate to reported count, validate actual discounted price, include Switch and explicitly exclude Switch 2, and fail visibly on schema/count drift. |
| Nintendo Life eShop Selects | Yes | Current editorial recommendation | Replace the stale guide scraper with a fixture-tested Selects parser and daily dry-run-safe refresh. |
| Nintendo Life Current Offers | Yes, secondary | Candidate discovery and drift comparison | Never override Nintendo price; use only for diagnostics or candidate discovery. |
| IGDB | Yes | Critic/user rating enrichment | Fetch missing records; refresh only games released less than two months ago; constrain title matches with platform/version evidence. Games at least two months old are write-once after a successful match. |
| Steam | Yes, optional enrichment | Cross-platform review count, positive percentage, and review link | Use the documented review response instead of scraping review text from store HTML; retain only confident title matches. |
| SteamSpy | Yes, non-authoritative | Cached tags for existing tag filters and shovelware heuristics | Keep last-known tags on provider failure; never let availability or empty fallback change eligibility or fail the worker. |
| NT Deals | Yes, secondary | Deal Pick signal from the Spanish Switch feed | Keep separate from editorial curation and Nintendo price; add parser fixtures and an explicit dependency manifest before scheduling. |

## Target Architecture

```text
Browser
  -> Vercel Next.js UI and read routes
      -> Nintendo Europe live catalog queries
      -> validated read-mostly Blob snapshots
      -> conditional preference document

Telegram callback
  -> Vercel webhook
      -> actor and replay validation
      -> ETag-guarded preference action
      -> Telegram message update

GitHub Actions at 10:07 Europe/Madrid
  -> refresh Nintendo Life editorial snapshot
  -> fetch complete Nintendo catalog
  -> refresh bounded missing/new-release IGDB queue
  -> calculate price alerts and digest
  -> send outbound Telegram messages
  -> publish redacted run summary and evidence artifact

Weekly or manual GitHub Actions
  -> Steam review refresh
  -> media refresh
  -> NT Deals refresh
```

### Persistence Split

- Keep preferences in Vercel Blob and add optimistic concurrency with `ifMatch`, a bounded conflict retry, and a server-only bounded set of completed Telegram update identifiers in the same state transition. Vercel documents conditional writes for exactly this concurrent-update case, so a second data store is unnecessary at current scale.
- Keep ratings, media, Steam, and source-specific curation as read-mostly Blob snapshots. Publish to a temporary versioned object, validate counts and shape, then update the current pointer only after success.
- Store Nintendo Life and NT Deals in separate snapshots so one provider cannot overwrite the other for the same game.
- Do not add a relational database unless multi-user accounts or query-heavy historical analysis becomes a real requirement.

## Delivery Phases

### Phase 1: Correctness At Existing Boundaries

1. Make the daily Nintendo fetch paginate until the number of distinct records equals `numFound`; abort notification generation when it does not.
2. Fetch every watched game directly by identifier as a price-alert backstop.
3. Apply the 14.99-EUR rule to `price_discounted_f` after retrieval, not only to `price_sorting_f` in the source query.
4. Honor `start` in text search and test that consecutive pages are disjoint.
5. Await the homepage query object so `/?game=<id>` opens the requested modal before and after login.
6. Persist Telegram actions before success feedback; make message editing HTML-safe and retry-safe.
7. Add a date-scoped delivery key so retrying or manually replaying a partial daily run cannot resend the same message that day.
8. Add deterministic route and browser regression tests for these boundaries.

**Exit gate:** full-catalog dry run reports fetched equals source count; the known deep link opens; the 17.49-EUR records are absent; search pages do not overlap; callback failure never claims success.

### Phase 2: Source Semantics And Freshness

1. Replace the old Nintendo Life guide inputs with Better eShop eShop Selects.
2. Capture sanitized provider fixtures and validate nonzero count, title, platform, EU price, source reference, and extraction drift.
3. Keep Current Offers as a comparison input only and confirm every candidate against Nintendo Europe.
4. Split missing IGDB records from games released less than two months ago; refresh the latter daily, retain older successful matches, and add platform/version checks before accepting a match.
5. Replace Steam HTML review parsing with the documented Steam review summary; keep SteamSpy only as failure-tolerant cached tag enrichment.
6. Keep NT Deals separately labelled, with no confidence bypass and no ability to overwrite Nintendo Life entries.
7. Add `refreshed_at`, source identity, source reference, and run identifier to every enrichment snapshot.

**Exit gate:** a source fixture test fails when the provider shape drifts; Nintendo Life refresh produces current Selects; only missing and under-two-month ratings enter a bounded queue; both curation sources can coexist for one game; SteamSpy failure preserves prior tags.

### Phase 3: State Integrity And Security

1. Replace unconditional preference overwrites with ETag-guarded conditional Blob writes and a bounded conflict retry.
2. Migrate the current 157 hidden, 10 watched, and 4 thinking entries with before/after counts and a reversible export.
3. Keep all mutation routes authenticated and add explicit denial tests for every route.
4. Replace the raw access password session value with an opaque signed session and add bounded login attempts.
5. Stop treating a failed enrichment read as an empty valid map; return an explicit unavailable state.
6. Strengthen snapshot replacement guards for curated, ratings, media, and Steam maps.
7. Validate every bulk payload's key format, source value, required fields, numeric ranges, and maximum size before publication.
8. Make every maintenance script dry-run by default and require an explicit target, explicit `--apply`, and successful strict current-state read.
9. Redact credential-bearing provider destinations from exception text.

**Exit gate:** concurrent website and Telegram actions preserve both changes; duplicate Telegram updates apply once; migration counts match; failed source reads preserve the last valid data; logs contain no provider secret.

### Phase 4: Scheduling, UX, And Operations

1. Replace dual top-of-hour UTC schedules and the 20-minute runtime gate with one timezone-aware 10:07 Europe/Madrid schedule.
2. Keep outbound daily work in GitHub Actions and inbound Telegram interaction in the Vercel webhook.
3. Emit one redacted run artifact containing source counts, matches, rejections, notification counts, durations, and failure stage.
4. Add dialog semantics, labelled controls, focus containment, and focus restoration to the game detail view.
5. Apply one shared original-Switch catalog filter that explicitly excludes `system_type:nintendoswitch2` in the website, worker, direct lookup, and source-matching paths.
6. Resolve current lint warnings and migrate the deprecated middleware convention when Next.js behavior is covered by route tests.
7. Pin GitHub Actions to immutable commit SHAs and add a pinned Python dependency manifest for every scheduled script.
8. Define one catalog/content policy and parity-test the TypeScript and Python implementations.
9. Add the AIUP documentation checker and PR checklist so future behavior changes keep requirements and use cases synchronized.

**Exit gate:** one scheduled run is visible each Madrid day; local accessibility automation reports no serious or critical issues; responsive browser checks pass at 375 and 1200 pixels; release docs list exact preview and production evidence.

## Test Strategy

### Deterministic Local Tests

- Nintendo pagination: multi-page fixture, duplicate identifier, empty page, count mismatch, actual-price mismatch, and watched-id backstop.
- Nintendo Life, NT Deals, and Steam: saved sanitized fixtures with success and shape-drift failures.
- Rating matching: exact title, edition collision, remake collision, wrong platform, missing record, 59-day refresh, two-month freeze, and provider rate-limit retry.
- Preference actions: valid and invalid thresholds, idempotent repeat, concurrent independent changes, failed read, and failed write.
- Telegram: invalid secret, wrong actor, malformed action, duplicate update, same-day delivery replay, persistence failure, edit failure, and HTML-sensitive title.
- Routes: authenticated success and unauthenticated denial for every mutation boundary.
- Browser: preserved login deep link, direct game lookup, search page disjointness, hide/watch refresh, modal keyboard/focus behavior, and mobile layout.

### Read-Only Live Checks

- Compare fetched distinct Nintendo records with `numFound` without writing data.
- Compare current Nintendo Life Selects extraction count and first/last canonical references.
- Check production snapshot counts and public read-route status.
- Inspect the latest GitHub Actions artifact instead of dispatching another production run when evidence already exists.

### Production-Mutation Gates

- A production scraper or worker dispatch requires a separate explicit approval naming production and the exact mode.
- Preference migration requires a dry-run manifest with every source and target count before mutation.
- Production Vercel promotion requires separate approval after preview verification; a push to `main` creates preview only.
- Telegram webhook re-registration is required only when the webhook configuration changes and must be verified read-only afterward.

## Risk Register

| Risk | Current evidence | Mitigation |
|---|---|---|
| Missing alerts or digest games | 2,145 matching offers excluded by worker cap | Full pagination plus direct watched-id fetch |
| Stale or false curation | Broken guide parser; source is not eShop Selects | Source-specific parser fixtures and separate snapshots |
| Lost hidden/watch state | Whole-document read-modify-write | Atomic key-value actions and count-checked migration |
| False Telegram success | Success acknowledgement precedes persistence | Persist first, replay record, truthful edit result |
| Wrong external match | Title-only IGDB and Steam matching | Platform/version evidence and reject ambiguity |
| Silent missed schedule | Top-of-hour delay plus 20-minute gate | Timezone-aware non-zero-minute schedule and visible run status |
| Secret disclosure in logs | Bot credential appears inside request destination | Provider-specific redacted errors |
| Empty-data corruption | Storage reads swallow failures as empty maps | Distinguish unavailable from empty; guarded snapshot publish |

## Defaults Requiring Approval With This Plan

- Include original Nintendo Switch offers only; explicitly exclude Switch 2 records in every Nintendo query path.
- Run the daily workflow at 10:07 Europe/Madrid rather than exactly 10:00 to avoid GitHub's top-of-hour congestion while remaining inside the 10:00-10:15 delivery window.
- Keep NT Deals as a blue Deal Pick signal from its Spanish Switch-only feed.
- Keep SteamSpy as non-authoritative cached tag enrichment; use Steam's documented review summary for score and vote count, and preserve known tags when SteamSpy is unavailable.
- Use conditional Blob writes for preference and replay state; do not add a second database at current scale.

## Approval Boundary

The original approval authorized implementation and local deterministic testing only. On 2026-09-29, the user separately authorized pushing to `main`, promoting to the existing production Vercel project, and read-only production HTTP smoke tests. A production worker/scraper run, preference mutation/migration, Telegram message delivery, and webhook reconfiguration remain unrun because they create persistent or irreversible effects and require a reviewed target manifest.

## Implementation And Release Evidence

- TypeScript: `npx tsc --noEmit` passed; ESLint passed without warnings; Vitest passed 38 tests.
- Python: 33 `unittest` tests and `py_compile` passed.
- Build and browser: `npm run build` passed; Playwright passed the deep-link/dialog journey at 375px and 1200px, with axe-core reporting zero serious or critical dialog findings at both sizes.
- Accessibility follow-up: axe-core reports zero login-page violations after adding the main landmark; that last markup fix is covered by the same 375px/1200px browser tests and is awaiting production redeploy.
- Documentation and automation syntax: `npm run check:aiup`, workflow YAML parsing, and shell syntax checks passed.
- Production release: commit `5e83df6` was pushed to `main`; Vercel production deployment `dpl_BX9KnqMtXPrujFqkcsuLRbrfPquC` is Ready and aliased to `https://nintendo-deals.vercel.app`.
- Production HTTP checks: deep-link login redirect preserved `/?game=1337462`; login returned 200; protected catalog/game APIs redirected to login; curated, ratings, media, and Steam GET APIs returned 200; unauthenticated preference/action writes returned 401.
- Worker configuration: GitHub repository variable `NINTENDO_DEALS_BASE_URL` is configured to the canonical public app URL; the workflow reads it as a variable, not a secret.
- Not exercised: a live GitHub Actions schedule/worker run, source snapshot publication, production preference writes/migration, real Telegram delivery/callback, or webhook reconfiguration. The worker can overwrite production snapshots and send irreversible messages; these require a specific reviewed run manifest and approval. The next daily schedule is the first natural end-to-end worker check.
