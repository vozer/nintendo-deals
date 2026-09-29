import { describe, expect, it } from 'vitest';
import { isMediaSnapshot, isRatingsSnapshot, isSteamSnapshot } from './snapshot-validation';

describe('enrichment snapshot validation', () => {
  it('accepts complete provider records', () => {
    expect(isRatingsSnapshot({ '1001': {
      igdb_id: 10, total_rating: 80, aggregated_rating: null, rating: 80,
      rating_count: 3, aggregated_rating_count: 0, matched_title: 'Game', confidence: 1,
      last_updated: '2026-09-28T10:00:00Z', release_date: null,
    } })).toBe(true);
    expect(isMediaSnapshot({ '1001': {
      screenshots: ['https://example.test/image.jpg'], videos: [], igdb_url: null,
      source: 'nintendo', last_updated: '2026-09-28',
    } })).toBe(true);
    expect(isSteamSnapshot({ '1001': {
      steam_id: 10, score_pct: 90, votes: 10, url: 'https://store.steampowered.com/app/10/',
      matched_title: 'Game', tags: ['Adventure'],
    } })).toBe(true);
  });

  it('rejects empty, malformed, or out-of-range snapshots before publication', () => {
    expect(isRatingsSnapshot({})).toBe(false);
    expect(isRatingsSnapshot({ 'bad': { igdb_id: 1 } })).toBe(false);
    expect(isMediaSnapshot({ '1001': { screenshots: ['javascript:alert(1)'], videos: [] } })).toBe(false);
    expect(isSteamSnapshot({ '1001': { steam_id: 1, score_pct: 120, votes: 1 } })).toBe(false);
  });
});
