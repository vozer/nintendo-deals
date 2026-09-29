import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const blobStore = vi.hoisted(() => ({ raw: null as string | null, revision: 0 }));

vi.mock('@vercel/blob', () => ({
  get: async () => {
    if (blobStore.raw === null) return null;
    return {
      statusCode: 200,
      stream: new Response(blobStore.raw).body,
      blob: { etag: String(blobStore.revision) },
    };
  },
  put: async (_pathname: string, body: string, options: Record<string, unknown>) => {
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
  },
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
}));

import { POST } from './route';

function request(body: unknown, apiKey = 'test-api-key') {
  return new NextRequest('https://nintendo-deals.test/api/telegram/deliveries/claim', {
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
  process.env.RATINGS_API_KEY = 'test-api-key';
});

describe('daily Telegram delivery claim', () => {
  it('claims a message once per date, including concurrent replays', async () => {
    const [first, second] = await Promise.all([
      POST(request({ date: '2026-09-28', key: 'digest:1001' })),
      POST(request({ date: '2026-09-28', key: 'digest:1001' })),
    ]);
    const results = await Promise.all([first.json(), second.json()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(results.map((result) => result.claimed).sort()).toEqual([false, true]);
    expect(JSON.parse(blobStore.raw!).telegram.deliveryKeysByDate['2026-09-28']).toEqual(['digest:1001']);
  });

  it('rejects invalid dates and anonymous callers', async () => {
    const invalid = await POST(request({ date: '2026-02-30', key: 'digest:1001' }));
    const malformedKey = await POST(request({ date: '2026-09-28', key: 'digest/1001' }));
    const anonymous = await POST(request({ date: '2026-09-28', key: 'digest:1001' }, ''));

    expect(invalid.status).toBe(400);
    expect(malformedKey.status).toBe(400);
    expect(anonymous.status).toBe(401);
    expect(blobStore.raw).toBeNull();
  });
});
