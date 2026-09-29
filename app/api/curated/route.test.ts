import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const storage = vi.hoisted(() => ({
  snapshots: {
    nintendolife: {} as Record<string, unknown>,
    ntdeals: {} as Record<string, unknown>,
  },
  saved: [] as Array<{ source: string; entries: Record<string, unknown> }>,
  failRead: false,
}));

vi.mock('@/lib/curated-storage', () => ({
  getCuratedSources: async () => {
    if (storage.failRead) throw new Error('synthetic blob read failure');
    return storage.snapshots;
  },
  saveCuratedSource: async (source: 'nintendolife' | 'ntdeals', entries: Record<string, unknown>) => {
    storage.saved.push({ source, entries });
    storage.snapshots[source] = entries;
  },
}));

import { GET, PUT } from './route';

function request(body: unknown, apiKey = 'test-api-key') {
  return new NextRequest('https://nintendo-deals.test/api/curated', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

const entry = (source: 'nintendolife' | 'ntdeals') => ({
  title: 'Synthetic game',
  review: '',
  source_url: 'https://example.test/game',
  source_reference: '/game',
  source_platform: 'nintendoswitch',
  source_price_eur: 1.99,
  refreshed_at: '2026-09-28T10:00:00Z',
  run_id: 'abc123def456',
  source,
  ...(source === 'nintendolife' ? { rank: 1 } : {}),
});

beforeEach(() => {
  storage.snapshots = { nintendolife: {}, ntdeals: {} };
  storage.saved = [];
  storage.failRead = false;
  process.env.RATINGS_API_KEY = 'test-api-key';
});

describe('curated source API', () => {
  it('returns both independent source maps', async () => {
    storage.snapshots = {
      nintendolife: { '1001': entry('nintendolife') },
      ntdeals: { '1001': entry('ntdeals') },
    };

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(storage.snapshots);
  });

  it('updates only the named source and rejects invalid/empty snapshots', async () => {
    storage.snapshots.nintendolife = { '1001': entry('nintendolife') };

    const response = await PUT(request({ source: 'ntdeals', entries: { '1001': entry('ntdeals') } }));
    const empty = await PUT(request({ source: 'ntdeals', entries: {} }));
    const mismatch = await PUT(request({ source: 'nintendolife', entries: { '1002': entry('ntdeals') } }));
    const invalidMetadata = await PUT(request({
      source: 'ntdeals',
      entries: { '1003': { ...entry('ntdeals'), discount_pct: 101 } },
    }));

    expect(response.status).toBe(200);
    expect(storage.snapshots.nintendolife).toEqual({ '1001': entry('nintendolife') });
    expect(storage.snapshots.ntdeals).toEqual({ '1001': entry('ntdeals') });
    expect(empty.status).toBe(400);
    expect(mismatch.status).toBe(400);
    expect(invalidMetadata.status).toBe(400);
  });

  it('denies anonymous writes and does not disguise read failure as empty data', async () => {
    const denied = await PUT(request({ source: 'ntdeals', entries: { '1001': entry('ntdeals') } }, ''));
    storage.failRead = true;
    const failed = await GET();

    expect(denied.status).toBe(401);
    expect(failed.status).toBe(500);
    expect(storage.saved).toHaveLength(0);
  });
});
