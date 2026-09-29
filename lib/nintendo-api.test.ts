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
