import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const blob = vi.hoisted(() => ({ raw: null as string | null, etag: 0 }));
vi.mock('@vercel/blob', () => ({
  get: async () => blob.raw === null ? null : { statusCode: 200, stream: new Response(blob.raw).body,
    blob: { etag: String(blob.etag) } },
  put: async (_key: string, raw: string, options: Record<string, unknown>) => {
    if ((blob.raw !== null && !options.allowOverwrite) || (options.ifMatch && options.ifMatch !== String(blob.etag))) {
      const error = new Error('conflict'); error.name = 'BlobPreconditionFailedError'; throw error;
    }
    blob.raw = raw;
    blob.etag += 1;
  },
  BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
}));

import { GET, PUT } from './route';

function request(path: string, method = 'GET', body?: unknown, apiKey?: string) {
  return new NextRequest(`https://app.test${path}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  blob.raw = null; blob.etag = 0;
  process.env.RATINGS_API_KEY = 'test-key';
});

describe('offer end-date snapshot API', () => {
  it('requires an authenticated reader and API-key writer', async () => {
    expect((await GET(request('/api/offer-end-dates'))).status).toBe(401);
    expect((await PUT(request('/api/offer-end-dates', 'PUT', { checked_at: '2026-10-04T10:00:00Z', records: {}, etag: null }))).status).toBe(401);
  });

  it('replaces only a complete validated snapshot with the expected ETag', async () => {
    const url = '/api/offer-end-dates';
    const initial = await (await GET(request(url, 'GET', undefined, 'test-key'))).json();
    expect(initial).toMatchObject({ checked_at: null, records: {}, etag: null });
    const body = { checked_at: '2026-10-04T10:00:00Z', etag: null,
      records: { '123': { price_cents: 499, end_datetime: '2026-10-14T21:59:59Z' } } };
    expect((await PUT(request(url, 'PUT', body, 'test-key'))).status).toBe(200);
    const current = await (await GET(request(url, 'GET', undefined, 'test-key'))).json();
    expect(current.records['123'].end_datetime).toBe(body.records['123'].end_datetime);
    expect(current.etag).toBe('1');
    expect((await PUT(request(url, 'PUT', body, 'test-key'))).status).toBe(409);
    expect(JSON.parse(blob.raw!).records).toEqual(body.records);
  });

  it('rejects malformed dates, records, and empty/future identifiers', async () => {
    expect((await PUT(request('/api/offer-end-dates', 'PUT', { checked_at: 'bad', records: {}, etag: null }, 'test-key'))).status).toBe(400);
    expect((await PUT(request('/api/offer-end-dates', 'PUT', { checked_at: '2026-10-04T10:00:00Z', records: {
      bad: { price_cents: -1, end_datetime: '2026-10-14T21:59:59Z' },
    }, etag: null }, 'test-key'))).status).toBe(400);
    expect((await PUT(request('/api/offer-end-dates', 'PUT', { checked_at: '2026-02-30T10:00:00Z', records: {}, etag: null }, 'test-key'))).status).toBe(400);
  });
});
