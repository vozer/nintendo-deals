import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { snapshotRevision } from '@/lib/blob-json';

const store = vi.hoisted(() => ({ saved: [] as string[], failRead: false, savedRatings: null as unknown }));

vi.mock('@/lib/ratings-storage', () => ({
  getRatings: async () => { if (store.failRead) throw new Error('read failed'); return {}; },
  saveRatings: async (ratings: unknown) => { store.saved.push('ratings'); store.savedRatings = ratings; },
}));
vi.mock('@/lib/media-storage', () => ({
  getMedia: async () => { if (store.failRead) throw new Error('read failed'); return {}; },
  saveMedia: async () => { store.saved.push('media'); },
}));
vi.mock('@/lib/steam-storage', () => ({
  getSteamRatings: async () => { if (store.failRead) throw new Error('read failed'); return {}; },
  saveSteamRatings: async () => { store.saved.push('steam'); },
}));

import { PUT as putRatings } from '../ratings/route';
import { GET as getMedia, PUT as putMedia } from '../media/route';
import { GET as getSteam, PUT as putSteam } from '../steam/route';

function request(path: string, body: unknown, apiKey = 'test-key') {
  return new NextRequest(`https://nintendo-deals.test/api/${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': snapshotRevision({}), ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.saved = [];
  store.failRead = false;
  store.savedRatings = null;
  process.env.RATINGS_API_KEY = 'test-key';
});

describe('enrichment snapshot API boundaries', () => {
  it('requires a current starting revision for Steam publication', async () => {
    const body = { '1001': { steam_id: 10, score_pct: 80, votes: 50, url: 'https://store.steampowered.com/app/10/', matched_title: 'Game' } };
    const missing = request('steam', body); missing.headers.delete('if-match');
    const stale = request('steam', body); stale.headers.set('if-match', '"stale"');
    expect((await putSteam(missing)).status).toBe(428);
    expect((await putSteam(stale)).status).toBe(409);
    expect(store.saved).toEqual([]);
  });
  it('requires a starting revision for authenticated media publication', async () => {
    const req = request('media', { '1001': { screenshots: [], videos: [], igdb_url: null, source: 'nintendo', last_updated: 'today' } });
    req.headers.delete('if-match');
    expect((await putMedia(req)).status).toBe(428);
    expect(store.saved).toEqual([]);
  });
  it('rejects a stale staged media write before storage', async () => {
    const req = request('media', { '1001': { screenshots: [], videos: [], igdb_url: null, source: 'nintendo', last_updated: 'today' } });
    req.headers.set('if-match', '"stale"');
    expect((await putMedia(req)).status).toBe(409);
    expect(store.saved).toEqual([]);
  });
  it('publishes mixed historical and worker confidence without changing existing values', async () => {
    const legacy = {
      igdb_id: 10, total_rating: 80, aggregated_rating: null, rating: 80,
      rating_count: 3, aggregated_rating_count: 0, matched_title: 'Game', confidence: 100,
      last_updated: '2026-09-28T10:00:00Z',
    };
    const rejected = await putRatings(request('ratings', { '1001': { ...legacy, confidence: 101 } }));
    expect(rejected.status).toBe(400);
    expect(store.saved).toHaveLength(0);
    const snapshot = { '1001': legacy, '1002': { ...legacy, igdb_id: 11, confidence: 0.93 } };
    const accepted = await putRatings(request('ratings', snapshot));
    expect(accepted.status).toBe(200);
    expect(store.savedRatings).toEqual(snapshot);
  });

  it('rejects malformed maps before storage and accepts valid staged snapshots', async () => {
    const invalidRatings = await putRatings(request('ratings', { 'bad': {} }));
    const invalidMedia = await putMedia(request('media', { '1001': { screenshots: [] } }));
    const invalidSteam = await putSteam(request('steam', { '1001': { score_pct: 120 } }));
    expect([invalidRatings.status, invalidMedia.status, invalidSteam.status]).toEqual([400, 400, 400]);
    expect(store.saved).toHaveLength(0);

    const ratings = await putRatings(request('ratings', { '1001': {
      igdb_id: 10, total_rating: 80, aggregated_rating: null, rating: 80,
      rating_count: 3, aggregated_rating_count: 0, matched_title: 'Game', confidence: 1,
      last_updated: '2026-09-28T10:00:00Z',
    } }));
    const media = await putMedia(request('media', { '1001': {
      screenshots: [], videos: [], igdb_url: null, source: 'nintendo', last_updated: '2026-09-28',
    } }));
    const steam = await putSteam(request('steam', { '1001': {
      steam_id: 10, score_pct: 90, votes: 10, url: 'https://store.steampowered.com/app/10/', matched_title: 'Game',
    } }));
    expect([ratings.status, media.status, steam.status]).toEqual([200, 200, 200]);
    expect(store.saved).toEqual(['ratings', 'media', 'steam']);
  });

  it('denies anonymous writes and reports storage read failures as 500', async () => {
    const denied = await Promise.all([
      putRatings(request('ratings', {}, '')),
      putMedia(request('media', {}, '')),
      putSteam(request('steam', {}, '')),
    ]);
    store.failRead = true;
    const [media, steam] = await Promise.all([getMedia(), getSteam()]);
    expect(denied.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(store.saved).toHaveLength(0);
    expect(media.status).toBe(500);
    expect(steam.status).toBe(500);
  });
});
