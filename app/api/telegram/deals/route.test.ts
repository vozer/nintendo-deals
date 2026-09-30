import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const blobs = vi.hoisted(() => new Map<string, { raw: string; etag: string }>());
vi.mock('@vercel/blob', () => ({
  get: async (key: string) => {
    const entry = blobs.get(key);
    return entry ? { statusCode: 200, stream: new Response(entry.raw).body, blob: { etag: entry.etag } } : null;
  },
  put: async (key: string, raw: string, options: { ifMatch?: string; allowOverwrite: boolean }) => {
    const entry = blobs.get(key);
    if ((entry && !options.allowOverwrite) || (options.ifMatch && entry?.etag !== options.ifMatch)) {
      const error = new Error('conflict'); error.name = 'BlobPreconditionFailedError'; throw error;
    }
    blobs.set(key, { raw, etag: String(Number(entry?.etag ?? 0) + 1) });
  },
}));
import { POST, PUT } from './route';

function request(body: unknown, method = 'POST', key = 'test-key') {
  return new NextRequest('https://app.test/api/telegram/deals', { method,
    headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) });
}
function game(id: string, extra = {}) {
  return { fs_id: id, title: 'Adventure', price_discounted_f: 4.99, price_has_discount_b: true,
    publisher: 'Studio', pretty_game_categories_txt: [], game_categories_txt: [], system_type: ['nintendoswitch'], ...extra };
}
beforeEach(() => {
  blobs.clear(); process.env.RATINGS_API_KEY = 'test-key';
  for (const [key, value] of Object.entries({
    'preferences.json': { hiddenGames: ['2'], watchGames: { '3': { threshold: 10, title: 'Watch' } }, thinkingAbout: ['4'] },
    'ratings.json': Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(id => [id, { rating_count: 100 }])),
    'steam_ratings.json': {}, 'curated-nintendolife.json': {}, 'curated-ntdeals.json': {},
  })) blobs.set(key, { raw: JSON.stringify(value), etag: '1' });
});

it('baselines then reports only newly qualifying deals without modifying preferences', async () => {
  const before = blobs.get('preferences.json')!.raw;
  const games = [game('1'), game('2'), game('3'), game('4'), game('5', { title: 'Collection' }),
    game('6', { system_type: ['nintendoswitch2'] }), game('7', { price_discounted_f: 20 }),
    game('8', { pretty_game_categories_txt: ['Deportes'] }), game('9', { game_categories_txt: ['education', 'lifestyle'] })];
  const preview = await POST(request({ games, total: games.length }));
  const initial = await preview.json();
  expect(initial).toEqual({ eligibleIds: ['1'], newIds: [], initialized: false, etag: null });
  expect((await PUT(request({ eligibleIds: initial.eligibleIds, etag: null, date: '2026-09-30' }, 'PUT'))).status).toBe(200);
  const next = await POST(request({ games: [game('1'), game('10')], total: 2 }));
  expect((await next.json()).newIds).toEqual(['10']);
  expect(blobs.get('preferences.json')!.raw).toBe(before);
});

it('rejects unauthorized calls, incomplete catalogs, stale commits and corrupt state', async () => {
  expect((await POST(request({}, 'POST', ''))).status).toBe(401);
  expect((await PUT(request({}, 'PUT', 'wrong'))).status).toBe(401);
  expect((await POST(request({ games: [game('1')], total: 2 }))).status).toBe(400);
  expect((await POST(request({ games: [game('1'), game('1')], total: 2 }))).status).toBe(400);
  const body = { eligibleIds: ['1'], etag: null, date: '2026-09-30' };
  expect((await PUT(request(body, 'PUT'))).status).toBe(200);
  expect((await PUT(request(body, 'PUT'))).status).toBe(409);
  blobs.set('telegram-deals.json', { raw: '{"oops":true}', etag: '2' });
  expect((await POST(request({ games: [game('1')], total: 1 }))).status).toBe(500);
});

it('uses Nintendo Life trust only, respects Steam moderation, and detects re-entering offers', async () => {
  blobs.set('ratings.json', { raw: '{}', etag: '1' });
  blobs.set('curated-nintendolife.json', { raw: JSON.stringify({ '1': { source: 'nintendolife' } }), etag: '1' });
  blobs.set('curated-ntdeals.json', { raw: JSON.stringify({ '10': { source: 'ntdeals' } }), etag: '1' });
  let result = await (await POST(request({ games: [game('1'), game('10')], total: 2 }))).json();
  expect(result.eligibleIds).toEqual(['1']);
  await PUT(request({ eligibleIds: result.eligibleIds, etag: result.etag, date: '2026-09-30' }, 'PUT'));
  blobs.set('steam_ratings.json', { raw: JSON.stringify({ '1': { votes: 1000, score_pct: 90, tags: ['NSFW'] } }), etag: '1' });
  result = await (await POST(request({ games: [game('1')], total: 1 }))).json();
  expect(result.eligibleIds).toEqual([]);
  await PUT(request({ eligibleIds: [], etag: result.etag, date: '2026-09-30' }, 'PUT'));
  blobs.set('steam_ratings.json', { raw: '{}', etag: '1' });
  result = await (await POST(request({ games: [game('1')], total: 1 }))).json();
  expect(result.newIds).toEqual(['1']);
});
