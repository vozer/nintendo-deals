import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@vercel/blob', () => ({
  get: async (pathname: string) => {
    const body = store.get(pathname);
    return body ? { statusCode: 200, stream: new Response(body).body } : null;
  },
  put: async (pathname: string, body: Buffer) => {
    if (store.has(pathname)) throw new Error('already exists');
    store.set(pathname, body.toString('utf-8'));
  },
}));

import { GET, POST } from './route';

function request(url: string, method = 'GET', body?: string, apiKey?: string) {
  return new NextRequest(`https://app.test${url}`, { method,
    headers: {
      ...(body ? { 'content-type': 'application/gzip' } : {}),
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(method === 'POST' ? { 'x-run-id': '12345', 'x-run-attempt': '2', 'x-run-date': '2026-10-06' } : {}),
    },
    ...(body ? { body } : {}),
  });
}

beforeEach(() => {
  store.clear();
  process.env.RATINGS_API_KEY = 'audit-test-key';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-test-token';
});

describe('Automation run evidence API', () => {
  it('requires the API key for uploads and downloads', async () => {
    expect((await POST(request('/api/automation/runs', 'POST', 'fixture'))).status).toBe(401);
    expect((await GET(request('/api/automation/runs?run_id=12345&run_attempt=2&date=2026-10-06'))).status).toBe(401);
  });

  it('stores immutable private archives and downloads the run by id and attempt', async () => {
    const body = 'gzip-fixture-bytes';
    const upload = () => POST(request('/api/automation/runs', 'POST', body, 'audit-test-key'));
    expect((await upload()).status).toBe(201);
    expect((await upload()).status).toBe(200);
    expect(store.has('automation-runs/2026-10-06/12345-attempt-2.tar.gz')).toBe(true);

    const download = await GET(request(
      '/api/automation/runs?run_id=12345&run_attempt=2&date=2026-10-06', 'GET', undefined, 'audit-test-key'));
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(body);
    expect(download.headers.get('content-type')).toBe('application/gzip');
  });

  it('rejects malformed identities and non-gzip upload content', async () => {
    expect((await GET(request('/api/automation/runs?run_id=12345&run_attempt=0&date=2026-10-06',
      'GET', undefined, 'audit-test-key'))).status).toBe(400);
    const wrongType = new NextRequest('https://app.test/api/automation/runs', { method: 'POST',
      headers: { 'x-api-key': 'audit-test-key', 'x-run-id': '12345', 'x-run-attempt': '2',
        'x-run-date': '2026-10-06', 'content-type': 'application/json' }, body: '{}' });
    expect((await POST(wrongType)).status).toBe(415);
  });
});
