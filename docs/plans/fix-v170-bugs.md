# Fix Plan: v1.7.0 Data Pipeline & Frontend Bugs

## Executive Summary

Fix 5 critical bugs from the v1.7.0 audit + incorporate user feedback on curated games. After this plan: Steam ratings pipeline works, curated games are fs_id-keyed with review text and pinned to the top of Deals, confidence threshold is 100, and all badges render correctly.

**Success Criteria:**
1. `steam-backfill.py` produces >0 matched games with real Steam review data
2. `scrape-curated.py` produces fs_id-keyed curated data with review text, matched via Nintendo Solr API
3. `GameCard` renders Steam and Curated badges
4. Curated games appear at the top of Deals (above sorted games), as their own section
5. Detail modal shows NintendoLife review text for curated games
6. Confidence threshold = 100 (sum of IGDB + Steam votes)
7. No duplicate entries — all matching is by fs_id
8. No regressions

---

## Current State Analysis

### Bug 1: `steam-backfill.py` produces 0 results
- **Evidence:** `curl -s "https://nintendo-deals.vercel.app/api/steam"` returns `{}`
- **Root cause:** Matching fails — only exact slug match + trivial "the" removal. No fuzzy or multi-strategy matching.
- **File:** `scripts/steam-backfill.py` lines 124-148

### Bug 2: `scrape-curated.py` returns HTML headings instead of game titles
- **Evidence:** API returns `["Best Nintendo Switch Games FAQ","Related Articles",...]`
- **Root cause:** Regex targets `<h2>` but NintendoLife uses `<h3>` with `### N. Game Title (Platform)` format. Most URLs 404.
- **File:** `scripts/scrape-curated.py` lines 43-58

### Bug 3: `GameCard` never receives `steam` or `isCurated` props
- **Evidence:** `DealsClient.tsx` lines 524-538 render `GameCard` without these props
- **File:** `components/DealsClient.tsx`

### Bug 4: Confidence threshold only checks IGDB `rating_count`, should be 100
- **Evidence:** `DealsClient.tsx` line 303: `(r?.rating_count ?? 0) < CONFIDENT_THRESHOLD`
- **File:** `components/DealsClient.tsx`, `lib/sort-utils.ts`

### Bug 5: Curated matching is brittle (`game.title.includes(t)`)
- **Evidence:** `DealsClient.tsx` line 298
- **File:** `components/DealsClient.tsx`

### New Requirement: Curated games pinned to top + review text in modal
- **User request:** Curated games always at the top of Deals view. NintendoLife review text shown in detail modal. Keyed by fs_id.

---

## Implementation Details

### Task 1: Create `normalizeTitle()` utility

**File:** `lib/sort-utils.ts` — add function

```typescript
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Complexity:** Low | **Risk:** None | **Dependencies:** None

---

### Task 2: Change curated data structure from `string[]` to `Record<fs_id, CuratedEntry>`

**File:** `lib/types.ts` — update type

```typescript
// Before:
export type CuratedList = string[];

// After:
export interface CuratedEntry {
  title: string;
  review: string;
  source_url: string;
  rank?: number;
}
export type CuratedMap = Record<string, CuratedEntry>; // keyed by fs_id
```

**File:** `lib/curated-storage.ts` — update return types from `CuratedList` to `CuratedMap`

**File:** `app/api/curated/route.ts` — update to use `CuratedMap` (GET returns `{}` instead of `[]` on error)

**File:** `components/DealsClient.tsx` — change state from `CuratedList` to `CuratedMap`

**Complexity:** Low | **Risk:** Breaking change to API contract, but no external consumers | **Dependencies:** None

---

### Task 3: Fix `scrape-curated.py` — proper parsing + fs_id matching

**File:** `scripts/scrape-curated.py` — full rewrite

**Key changes:**
- Parse `<h3>` numbered entries: regex `\d+\.\s*(.+?)\s*\((?:Switch|Switch eShop)[^)]*\)`
- For each extracted title, search Nintendo Solr API: `q={title}&fq=...&rows=5&fl=fs_id,title,title_master_s`
- Match using `normalizeTitle()` comparison (Python equivalent)
- Store review text (paragraph after the title heading)
- Output: `Record<fs_id, { title, review, source_url, rank }>` → PUT to `/api/curated`
- Fix URLs: keep only verified working URLs
- Dedup by fs_id — if same game appears in multiple lists, keep highest rank

**Complexity:** Medium | **Risk:** Solr search may not find exact matches for all titles | **Dependencies:** Task 2

---

### Task 4: Fix `steam-backfill.py` — multi-strategy title matching

**File:** `scripts/steam-backfill.py`

**Key changes:**
- Add `title_master_s` to Solr `fl` field list
- Use `title_master_s` (canonical English title) for matching
- Improve `slugify()` to strip ®, ™ before normalization
- Multi-strategy matching: exact → no-"the" → no-edition-suffix → no-subtitle → prefix (3+ words, 10+ chars)
- Add progress logging (`[123/2505] Matched: Game Title -> AppID 12345`)

**Complexity:** Medium | **Risk:** False positives from prefix matching (mitigated by min length) | **Dependencies:** None

---

### Task 5: Raise confidence threshold to 100, combine IGDB + Steam votes

**File:** `lib/sort-utils.ts` line 4

```typescript
export const CONFIDENT_THRESHOLD = 100;
```

**File:** `components/DealsClient.tsx` — `dealsGames` memo

```typescript
// Add steamRatings lookup:
const s = steamRatings[game.fs_id];
const totalVotes = (r?.rating_count ?? 0) + (s?.votes ?? 0);
// Use totalVotes instead of r?.rating_count for confidence check
const isCurated = game.fs_id in curatedMap;
if (!isCurated && totalVotes < CONFIDENT_THRESHOLD) return false;
```

Same change in `lowConfidenceGames` memo. Add `steamRatings` to dependency arrays.

**Complexity:** Low | **Risk:** More games in "Few Reviews" — intentional | **Dependencies:** Task 2 (curatedMap type)

---

### Task 6: Pass `steam` and `isCurated` props to `GameCard`

**File:** `components/DealsClient.tsx` — GameCard render

```tsx
<GameCard
  key={game.fs_id}
  game={game}
  preferences={preferences}
  rating={ratings[game.fs_id]}
  steam={steamRatings[game.fs_id]}
  media={media[game.fs_id]}
  isCurated={game.fs_id in curatedMap}
  globalMean={globalMean}
  // ... rest of props
/>
```

**Complexity:** Low | **Risk:** None | **Dependencies:** Task 2

---

### Task 7: Pin curated games to top of Deals + show review in modal

**File:** `components/DealsClient.tsx` — `sortedGames` memo

Split curated games from non-curated, render curated first:

```typescript
const sortedGames = useMemo((): NintendoGame[] => {
  // Separate curated from non-curated
  const curated = tabGames.filter(g => g.fs_id in curatedMap);
  const nonCurated = tabGames.filter(g => !(g.fs_id in curatedMap));

  // Sort non-curated as before (tiered)
  // ... existing scoring/sorting logic on nonCurated ...

  // Curated go first (sorted by rank if available, otherwise by value)
  curated.sort((a, b) => (curatedMap[a.fs_id]?.rank ?? 999) - (curatedMap[b.fs_id]?.rank ?? 999));

  return [...curated, ...sortedNonCurated];
}, [...]);
```

**File:** `components/GameDetailModal.tsx` — add curated review text section

- Add `curatedEntry?: CuratedEntry` prop
- If `curatedEntry` exists, render a section with the NintendoLife review quote and source link

**File:** `components/DealsClient.tsx` — pass `curatedEntry` to `GameDetailModal`

**Complexity:** Medium | **Risk:** None | **Dependencies:** Tasks 2, 5, 6

---

## Execution Order

| Step | Task | Depends On | Complexity |
|------|------|-----------|------------|
| 1 | Task 1: `normalizeTitle()` utility | — | Low |
| 2 | Task 2: Change curated type to `CuratedMap` | — | Low |
| 3 | Task 5: Confidence threshold 100 + combine votes | Tasks 1, 2 | Low |
| 4 | Task 6: Pass props to `GameCard` | Task 2 | Low |
| 5 | Task 7: Pin curated to top + review in modal | Tasks 2, 5, 6 | Medium |
| 6 | Task 4: Fix `steam-backfill.py` | — | Medium |
| 7 | Task 3: Fix `scrape-curated.py` | Task 2 | Medium |
| 8 | Run scripts, verify data | Tasks 4, 7 | Low |
| 9 | Deploy + verify in browser | Task 8 | Low |

---

## Checklists

### Senior Code Review
- [ ] `normalizeTitle()` handles edge cases (empty strings, unicode)
- [ ] Steam matching strategies don't produce false positives
- [ ] Curated regex tested against actual NintendoLife HTML
- [ ] `CuratedMap` type change propagated to all consumers
- [ ] No duplicate games in Deals (curated + non-curated sections)
- [ ] Confidence threshold change doesn't break sorting tiers
- [ ] Review text display doesn't break modal layout

### Code Simplification
- [ ] `normalizeTitle()` reused everywhere (no duplicate normalization)
- [ ] `fs_id in curatedMap` replaces all `curatedList.some()` calls
- [ ] Single source of truth for confidence check

### Security Audit
- [ ] API keys remain in env vars
- [ ] No new auth bypasses needed
- [ ] Curated review text sanitized (no raw HTML injection)

---

## Testing Strategy

### Manual Verification
1. Run `steam-backfill.py` → expect >50 matched games
2. Run `scrape-curated.py` → expect >20 fs_id-keyed entries with review text
3. Verify Steam badge renders on matched game cards
4. Verify Curated badge + top position for curated games
5. Open detail modal for curated game → verify NintendoLife review text shows
6. Verify "Few Reviews" tab has more games (threshold 100)
7. Verify no duplicate games between curated section and regular sorted section
8. `npx tsc --noEmit` passes

### Rollback
- Reset data: `PUT /api/steam` with `{}`, `PUT /api/curated` with `{}`
- Revert `CONFIDENT_THRESHOLD` to 10 if too aggressive

---

## Documentation Updates

### CHANGELOG.md
```markdown
## [1.7.1] - 2026-03-0X

### Fixed
- Steam backfill script: multi-strategy title matching (exact/no-prefix/no-edition/no-subtitle/prefix)
- Curated scraper: proper h3 parsing, fs_id matching via Solr API, review text extraction
- GameCard: steam and curated props now passed correctly — badges render
- Confidence threshold raised to 100 (sum IGDB + Steam votes) for "Few Reviews" filter
- Curated matching: fs_id-keyed instead of brittle title.includes()

### Changed
- Curated data structure: from string[] to Record<fs_id, CuratedEntry> with review text
- Curated games pinned to top of Deals view (above sorted games)
- Detail modal shows NintendoLife review text for curated games
```

### AGENTS.md
- Update `CONFIDENT_THRESHOLD` from 10 to 100
- Update curated data format description
- Add `normalizeTitle()` to key utilities
- Note curated games are pinned to top of Deals
