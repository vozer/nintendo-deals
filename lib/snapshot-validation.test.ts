import { describe, expect, it } from 'vitest';
import { isMediaSnapshot, isRatingsSnapshot, isSteamSnapshot } from './snapshot-validation';

describe('enrichment snapshot validation', () => {
  it('accepts verified IGDB identity and recoverable legacy URL but rejects inconsistent evidence', () => {
    const entry = { screenshots: [], videos: [], source: 'igdb', last_updated: 'today', igdb_url: 'https://www.igdb.com/games/base', legacy_igdb_url: 'https://www.igdb.com/games/addon', igdb_match: { igdb_id: 123, matched_title: 'Base', url: 'https://www.igdb.com/games/base', last_updated: 'today' } };
    expect(isMediaSnapshot({ '1001': entry })).toBe(true);
    expect(isMediaSnapshot({ '1001': { ...entry, igdb_url: entry.legacy_igdb_url } })).toBe(false);
    expect(isMediaSnapshot({ '1001': { ...entry, igdb_match: { ...entry.igdb_match, url: 'https://attacker.test/base' } } })).toBe(false);
    expect(isMediaSnapshot({ '1001': { ...entry, legacy_igdb_url: 'https://attacker.test/addon' } })).toBe(false);
  });

  it('accepts complete provider records', () => {
    expect(isRatingsSnapshot({ '1001': {
      igdb_id: 10, total_rating: 80, aggregated_rating: null, rating: 80,
      rating_count: 3, aggregated_rating_count: 0, matched_title: 'Game', confidence: 1,
      last_updated: '2026-09-28T10:00:00Z', release_date: null,
    } })).toBe(true);
    expect(isMediaSnapshot({ '1001': {
      screenshots: ['https://images.igdb.com/image.jpg'], videos: [], igdb_url: null,
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

  it('rejects untrusted images, forged Steam destinations and arbitrary embeds', () => {
    const media = { screenshots: ['https://attacker.test/image.jpg'], videos: [], igdb_url: null, source: 'nintendo', last_updated: 'today' };
    expect(isMediaSnapshot({ '1001': media })).toBe(false);
    expect(isMediaSnapshot({ '1001': { ...media, screenshots: [], videos: [{ type: 'youtube', video_id: 'bad', youtube_url: 'https://attacker.test/embed' }] } })).toBe(false);
    expect(isSteamSnapshot({ '1001': { steam_id: 10, score_pct: 80, votes: 50, matched_title: 'Game', url: 'https://attacker.test/app/10/' } })).toBe(false);
  });

  it('accepts a Steam match without rating evidence and streaming media', () => {
    expect(isMediaSnapshot({ '1001': {
      screenshots: ['https://shared.fastly.steamstatic.com/image.jpg'], source: 'mixed', last_updated: 'today', igdb_url: null,
      steam_match: { steam_id: 4235410, matched_title: 'Future Knight', publisher: 'Aeternum Game Studios', last_updated: 'today' },
      videos: [{ type: 'steam', video_id: '257386668', hls_url: 'https://video.fastly.steamstatic.com/movie.m3u8', source: 'steam', source_url: 'https://store.steampowered.com/app/4235410/' }],
    } })).toBe(true);
  });
});
