import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const store = vi.hoisted(() => new Map<string, { raw: string; etag: string }>());
vi.mock('@vercel/blob', () => ({
  get: async (pathname: string) => {
    const entry = store.get(pathname);
    return entry ? { statusCode: 200, stream: new Response(entry.raw).body, blob: { etag: entry.etag } } : null;
  },
  put: async (pathname: string, raw: string, options: Record<string, unknown>) => {
    if (store.has(pathname) && options.allowOverwrite === false) {
      const error = new Error('already exists'); error.name = 'BlobPreconditionFailedError'; throw error;
    }
    store.set(pathname, { raw, etag: '1' });
  },
  list: async ({ prefix, limit }: { prefix: string; limit: number }) => ({
    blobs: [...store.keys()].filter(path => path.startsWith(prefix)).slice(0, limit)
      .map(pathname => ({ pathname })), hasMore: false,
  }),
}));

import { GET, POST } from './route';

const event = {
  event_id: 'callback:one', occurred_at: '2026-10-04T12:00:00.000Z', direction: 'inbound', kind: 'webhook.received',
  correlation_id: 'update-1', request: { callback_query: { id: 'callback-1', from: { id: 77 }, data: 'nd:hide:123' },
    bot_token: 'secret-value', url: 'https://api.telegram.org/bot123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ/sendMessage' },
};
function request(url: string, method = 'GET', body?: unknown, apiKey?: string) {
  return new NextRequest(`https://app.test${url}`, { method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  store.clear();
  process.env.RATINGS_API_KEY = 'audit-test-key';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-test-token';
});

describe('Telegram audit API', () => {
  it('requires the API key for both append and history reads', async () => {
    expect((await POST(request('/api/telegram/audit', 'POST', event))).status).toBe(401);
    expect((await GET(request('/api/telegram/audit?date=2026-10-04'))).status).toBe(401);
  });

  it('keeps immutable private events, redacts secrets and paginates by date', async () => {
    const append = () => POST(request('/api/telegram/audit', 'POST', event, 'audit-test-key'));
    expect((await append()).status).toBe(201);
    expect((await append()).status).toBe(200);
    expect(store.size).toBe(1);
    const [pathname, stored] = [...store.entries()][0];
    expect(pathname).toMatch(/^telegram-audit\/2026-10-04\//);
    const saved = JSON.parse(stored.raw);
    expect(saved.request.callback_query.from.id).toBe(77);
    expect(saved.request.bot_token).toBe('[REDACTED]');
    expect(saved.request.url).toBe('https://api.telegram.org/bot[REDACTED]/sendMessage');

    const response = await GET(request('/api/telegram/audit?date=2026-10-04&limit=20', 'GET', undefined, 'audit-test-key'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ date: '2026-10-04', hasMore: false,
      events: [{ event_id: 'callback:one', kind: 'webhook.received' }] });
  });

  it('supports bounded searchable history filters', async () => {
    const second = { ...event, event_id: 'outgoing:two', direction: 'outbound', kind: 'telegram.request.result',
      correlation_id: 'run-456', request: { method: 'sendPhoto', title: 'Adventure' } };
    await POST(request('/api/telegram/audit', 'POST', event, 'audit-test-key'));
    await POST(request('/api/telegram/audit', 'POST', second, 'audit-test-key'));

    const byCorrelation = await GET(request('/api/telegram/audit?date=2026-10-04&correlation_id=run-456',
      'GET', undefined, 'audit-test-key'));
    expect(await byCorrelation.json()).toMatchObject({ events: [{ event_id: 'outgoing:two' }] });
    const byText = await GET(request('/api/telegram/audit?date=2026-10-04&q=nd%3Ahide%3A123',
      'GET', undefined, 'audit-test-key'));
    expect(await byText.json()).toMatchObject({ events: [{ event_id: 'callback:one' }] });
  });

  it('accepts opaque printable cursors and defaults to the UTC storage date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T23:30:00.000Z'));
    const response = await GET(request('/api/telegram/audit?cursor=opaque.cursor%2Bpart%2F',
      'GET', undefined, 'audit-test-key'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ date: '2026-10-04' });
    vi.useRealTimers();
  });

  it('rejects invalid dates and malformed records', async () => {
    expect((await GET(request('/api/telegram/audit?date=2026-02-30', 'GET', undefined, 'audit-test-key'))).status).toBe(400);
    expect((await POST(request('/api/telegram/audit', 'POST', { ...event, direction: 'sideways' }, 'audit-test-key'))).status).toBe(400);
  });
});
