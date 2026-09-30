# Requirements Catalog

This catalog reverse-engineers the current product and records the observable gaps found in the 2026-09-28 audit. `Verified` means the behavior was exercised in this audit; `Implemented` means code exists but the complete public boundary was not verified.

## Functional Requirements

| ID | Title | User Story | Priority | Status |
|---|---|---|---|---|
| FR-001 | Access Tracker | As a deal shopper, I want to authenticate before opening the tracker so that my private deal state is not exposed through the main interface. | High | Verified |
| FR-002 | Browse Active Deals | As a deal shopper, I want to browse active Spanish Nintendo discounts so that I can find games within my budget. | High | Implemented |
| FR-003 | Search Complete Catalog | As a deal shopper, I want search and pagination to return every distinct matching game so that I do not miss or repeatedly see results. | High | Verified |
| FR-004 | Evaluate A Game | As a deal shopper, I want price, description, media, ratings, editorial context, and external review links so that I can decide whether a game is worth buying. | High | Implemented |
| FR-005 | Manage Preferences | As a deal shopper, I want to hide, reconsider, watch, and unwatch games so that the website reflects my decisions across sessions. | High | Verified |
| FR-006 | Receive Price Alerts | As a deal shopper, I want an alert when a watched game falls below my selected threshold so that I can act on a meaningful price. | High | Implemented |
| FR-007 | Receive Curated Digest | As a deal shopper, I want up to ten current editorial deal recommendations each day so that I can discover games without reviewing the full catalog. | High | Implemented |
| FR-008 | Act From Telegram | As a Telegram user, I want to open, hide, or watch a recommended game and receive a persistent alert confirmation with a direct game link so that I can maintain preferences without returning to the website first. | High | Verified |
| FR-009 | Refresh Deal Intelligence | As a system operator, I want catalog, editorial, rating, media, and review enrichments refreshed according to explicit source policies so that displayed evidence remains current and traceable. | High | Implemented |
| FR-010 | Operate Safely | As a system operator, I want dry-run, bounded retry, validation, and run summaries so that I can diagnose failures without mutating production data. | High | Implemented |
| FR-011 | Explain Recommendation Source | As a deal shopper, I want Nintendo Life selections and NT Deals picks labelled separately so that I understand why a game is highlighted. | Medium | Verified |
| FR-012 | Receive Newly Eligible Deals | As a deal shopper, I want daily alerts for games entering or re-entering the homepage Deals selection, with available title images, source buttons and actions, excluding hidden, watched and thinking games. | High | Implemented |

FR-012 is deployed: quiet initialization and preference preservation were verified live; arrival/re-entry delivery and photo-caption callbacks were verified using deterministic local tests. The first naturally occurring production arrival and a shopper-initiated photo callback remain validation follow-ups, not missing implementation. See [release evidence](plans/2026-09-30-telegram-deal-arrivals.md) and [notification backlog](telegram-notification-backlog.md).

## Non-Functional Requirements

### Approved Game Detail Increment (2026-09-30)

- FR-004: Cards and details prefer official English excerpts joined by exact Nintendo ID; if English is missing or fails, retain the Spanish excerpt (user-approved fallback). Spanish Nintendo prices, links, eligibility, and raw policy categories remain authoritative. Both surfaces expose canonical Steam links from validated matches, even when no review score exists. Details expose every collected screenshot and selectable playable video with provenance and source-page fallback.
- FR-005: Detail and card controls share Hide/Unhide, fixed 2/5/10 EUR alert thresholds, remove-watch, and Thinking actions. Pending/success/error feedback reflects persistence; unrelated preferences and Telegram metadata are preserved. Hiding a game does not close its details.
- FR-009: Manual maintenance repairs missing/incomplete media, merges Nintendo/IGDB/validated Steam assets, reports bounded/incomplete acquisition, and preserves cached assets during provider failures. Enrichment publication uses conditional writes; no new notification-path scraper.
- NFR-008/NFR-009/NFR-010: Local synthetic tests cover 375/1200px, auth denial, preference failures, delayed enrichment, unsafe media, stale writes, multiple videos, and focus stability. No production preference mutations during verification.

| ID | Title | Requirement | Category | Priority | Status |
|---|---|---|---|---|---|
| NFR-001 | Catalog Completeness | Every catalog-driven run must either process exactly the source-reported `numFound` distinct games or fail with an explicit incomplete-run status. | Availability | High | Verified |
| NFR-002 | Preference Integrity | A failed read or concurrent action must remove zero previously stored hidden, watched, or thinking entries. | Availability | High | Verified |
| NFR-003 | Daily Delivery Window | The scheduler requests one run daily at 10:07 Europe/Madrid; if GitHub delays delivery, the run executes when delivered rather than being silently skipped, with a visible failed or completed result. | Availability | High | In Progress |
| NFR-004 | Mutation Authorization | One hundred percent of preference, enrichment, and webhook mutations must reject missing or invalid authorization. | Security | High | Verified |
| NFR-005 | Callback Truthfulness | A Telegram success state must be shown only after persistence succeeds, and replaying the same update must produce zero additional state changes. | Maintainability | High | Verified |
| NFR-006 | Source Provenance | Every persisted editorial or review enrichment must include its provider, canonical source reference, and refresh timestamp. | Maintainability | High | Verified |
| NFR-007 | Bounded Provider Use | Every external request must have a timeout and at most three retries; IGDB traffic must remain at or below four requests per second and eight concurrent requests. | Scalability | High | In Progress |
| NFR-008 | Responsive Usability | The primary browse and detail journeys must work at 375-pixel and 1200-pixel viewport widths without page-level horizontal overflow. | Usability | Medium | Verified |
| NFR-009 | Accessible Detail Dialog | The game detail view must expose dialog semantics, a labelled close control, focus containment, focus restoration, and zero serious or critical automated accessibility findings. | Usability | High | Verified |
| NFR-010 | Boundary Test Coverage | Authentication denial, catalog pagination, deep links, preference actions, digest selection, and Telegram callback replay must each have at least one deterministic automated success test and one relevant failure test. | Maintainability | High | Verified |
| NFR-011 | Daily Delivery Idempotency | Each digest or price-alert message may be claimed only once for a Europe/Madrid calendar date, including concurrent worker replays. | Availability | High | Verified |
| NFR-012 | Session Protection | Browser authentication must use an expiring signed session rather than storing the access password, and login attempts must be bounded per client within a time window. | Security | High | Verified |

## Constraints

| ID | Title | Constraint | Category | Priority | Status |
|---|---|---|---|---|---|
| C-001 | Web Runtime | The website and inbound webhook must run on the existing Next.js Vercel project. | Technical | High | Implemented |
| C-002 | Scheduled Runtime | Scheduled refresh and outbound notification work must run in GitHub Actions, not n8n or a Raspberry Pi. | Operational | High | Implemented |
| C-003 | Telegram Runtime | Inbound Telegram actions must use the Vercel webhook and must not use GitHub Actions or a polling listener. | Operational | High | Implemented |
| C-004 | Price Authority | Nintendo Europe must remain the authority for Spanish availability and EUR price; secondary sites may only discover or enrich candidates. | Business | High | In Progress |
| C-005 | Alert Thresholds | Price-alert thresholds are limited to 2 EUR, 5 EUR, and 10 EUR. | Business | High | Verified |
| C-006 | Current Audience | The current release serves one configured shopper and one configured Telegram actor rather than public multi-user registration. | Business | High | Implemented |
| C-007 | Read-Only Commerce | Source integrations and tests must not perform purchases or other commerce mutations. | Regulatory | High | Verified |
| C-008 | Secret Handling | Provider and application credentials must be injected through deployment secrets and must not be committed or printed in credential-bearing URLs. | Security | High | In Progress |
| C-009 | Platform Scope | Only original Nintendo Switch offers are eligible; Nintendo Switch 2 records must be excluded explicitly rather than by display-label inference. | Business | High | Verified |
| C-010 | Rating Refresh Window | A successful IGDB match is retained without routine refresh once the Nintendo release date is at least two months old; newer games are eligible for daily refresh until that boundary. | Business | Medium | Verified |
