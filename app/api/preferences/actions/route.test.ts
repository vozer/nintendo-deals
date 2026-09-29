import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const blobStore = vi.hoisted(() => ({
  raw: null as string | null,
  revision: 0,
  writes: 0,
  failWrites: false,
  failReads: false,
}));

vi.mock('@vercel/blob', () => ({
  get: async () => {
    if (blobStore.failReads) throw new Error('synthetic blob read failure');
    if (blobStore.raw === null) return null;
    return {
      statusCode: 200,
      stream: new Response(blobStore.raw).body,
      blob: { etag: String(blobStore.revision) },
    };
  },
  put: async (_pathname: string, body: string, options: Record<string, unknown>) => {
    if (blobStore.failWrites) throw new Error('synthetic blob write failure');
    if (options.ifMatch && options.ifMatch !== String(blobStore.revision)) {
      const error = new Error('precondition failed');
      error.name = 'BlobPreconditionFailedError';
      throw error;
    }
    if (!options.ifMatch && blobStore.raw !== null && options.allowOverwrite !== true) {
      throw new Error('blob already exists');
    }
    blobStore.raw = body;
    blobStore.revision += 1;
    blobStore.writes += 1;
  },
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
}));

import { GET, PUT } from '../route';
import { POST } from './route';

function request(body: unknown, apiKey = 'test-api-key') {
  return new NextRequest('https://nintendo-deals.test/api/preferences/actions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  blobStore.raw = null;
  blobStore.revision = 0;
  blobStore.writes = 0;
  blobStore.failWrites = false;
  blobStore.failReads = false;
  process.env.RATINGS_API_KEY = 'test-api-key';
});

afterEach(() => vi.restoreAllMocks());

describe('preference action API', () => {
  it('preserves concurrent independent actions with conditional writes', async () => {
    const [hide, think] = await Promise.all([
      POST(request({ action: 'hide', fs_id: '1001' })),
      POST(request({ action: 'think', fs_id: '1002' })),
    ]);

    expect(hide.status).toBe(200);
    expect(think.status).toBe(200);
    const response = await GET();
    const preferences = await response.json();
    expect(preferences.hiddenGames).toContain('1001');
    expect(preferences.thinkingAbout).toContain('1002');
    expect(preferences.telegram).toBeUndefined();
  });

  it('denies anonymous mutation requests', async () => {
    const response = await POST(request({ action: 'hide', fs_id: '1001' }, ''));
    const replace = await PUT(new NextRequest('https://nintendo-deals.test/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hiddenGames: ['1001'], watchGames: {}, thinkingAbout: [] }),
    }));

    expect(response.status).toBe(401);
    expect(replace.status).toBe(401);
    expect(blobStore.writes).toBe(0);
  });

  it('keeps the public PUT shape and internal callback metadata separate', async () => {
    blobStore.raw = JSON.stringify({
      version: 1,
      preferences: { hiddenGames: [], watchGames: {}, thinkingAbout: [] },
      telegram: { processedUpdateIds: ['callback-1'] },
    });
    blobStore.revision = 1;
    const response = await PUT(new NextRequest('https://nintendo-deals.test/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ hiddenGames: ['1001'], watchGames: {}, thinkingAbout: [] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hiddenGames: ['1001'],
      watchGames: {},
      thinkingAbout: [],
    });
    expect(JSON.parse(blobStore.raw!).telegram.processedUpdateIds).toEqual(['callback-1']);
  });

  it('returns unavailable rather than an empty preference snapshot when reads fail', async () => {
    blobStore.failReads = true;

    const response = await GET();

    expect(response.status).toBe(500);
  });

  it('reports persistence failure without claiming the action succeeded', async () => {
    blobStore.failWrites = true;

    const response = await POST(request({ action: 'hide', fs_id: '1001' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to apply action' });
  });

  it('excludes Switch 2 while resolving a watch title from Nintendo', async () => {
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      response: { docs: [{ fs_id: '1001', title_master_s: 'Test Game' }] },
    }));

    const response = await POST(request({ action: 'watch', fs_id: '1001', threshold: 5 }));

    expect(response.status).toBe(200);
    const url = new URL(String(fetchStub.mock.calls[0][0]));
    expect(url.searchParams.get('fq')).toContain('-system_type:nintendoswitch2');
  });
});
