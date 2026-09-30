import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDeals, fetchGameById } from './nintendo-api';

function mockNintendoResponse(docs: Record<string, unknown>[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(JSON.stringify({
      response: { docs, numFound: docs.length },
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Nintendo catalog requests', () => {
  it('prefers exact-ID English copy without replacing ES prices, URLs or categories', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const english = new URL(String(input)).pathname.startsWith('/en/');
      return Response.json({ response: { numFound: 1, docs: [english
        ? { fs_id: '123', excerpt: 'An English adventure.', price_discounted_f: 99, url: '/en/store' }
        : { fs_id: '123', excerpt: 'Aventura.', price_discounted_f: 4.99, url: '/es/store', pretty_game_categories_txt: ['Aventura'] }] } });
    }));
    const { games } = await fetchDeals({});
    expect(games[0]).toMatchObject({ excerpt: 'An English adventure.', excerpt_language: 'en', price_discounted_f: 4.99, url: '/es/store', pretty_game_categories_txt: ['Aventura'] });
  });

  it('retains Spanish copy for missing English records, English outages and empty excerpts', async () => {
    for (const english of [[], [{ fs_id: '123', excerpt: ' ' }], null]) {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (new URL(String(input)).pathname.startsWith('/en/')) {
          if (english === null) throw new Error('offline');
          return Response.json({ response: { docs: english } });
        }
        return Response.json({ response: { numFound: 1, docs: [{ fs_id: '123', excerpt: 'Aventura.', price_discounted_f: 4.99 }] } });
      }));
      expect((await fetchGameById('123'))?.excerpt).toBe('Aventura.');
    }
  });
  it('uses the requested offset for search pages', async () => {
    const fetchMock = mockNintendoResponse([{ fs_id: '123', price_discounted_f: 18.99 }]);

    const result = await fetchDeals({ search: 'zelda', start: 100, rows: 48 });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get('start')).toBe('100');
    expect(result.games).toHaveLength(1);
  });

  it('filters to original Switch and the discounted price cap', async () => {
    const fetchMock = mockNintendoResponse([
      { fs_id: 'over-cap', price_discounted_f: 17.49 },
      { fs_id: 'at-cap', price_discounted_f: 14.99 },
    ]);

    const result = await fetchDeals({ rows: 48 });

    const filter = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('fq') || '';
    expect(filter).toContain('-system_type:nintendoswitch2');
    expect(filter).toContain('price_discounted_f:[0 TO 14.99]');
    expect(result.games.map((game) => game.fs_id)).toEqual(['at-cap']);
  });

  it('excludes Switch 2 from direct game lookups', async () => {
    const fetchMock = mockNintendoResponse();

    await fetchGameById('123');

    const filter = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('fq') || '';
    expect(filter).toContain('-system_type:nintendoswitch2');
  });
});
