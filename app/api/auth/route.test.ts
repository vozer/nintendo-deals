import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { verifySessionToken } from '@/lib/session';

function request(password: unknown, ip: string) {
  return new NextRequest('https://nintendo-deals.test/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ password }),
  });
}

describe('auth endpoint', () => {
  it('issues a signed, http-only session cookie after valid login', async () => {
    process.env.ACCESS_PASSWORD = 'synthetic-password';
    const response = await POST(request('synthetic-password', '198.51.100.1'));
    const cookie = response.cookies.get('nintendo-deals-auth');

    expect(response.status).toBe(200);
    expect(cookie?.value).not.toBe('synthetic-password');
    expect(cookie?.httpOnly).toBe(true);
    expect(await verifySessionToken(cookie?.value, 'synthetic-password')).toBe(true);
  });

  it('denies wrong passwords and rate-limits repeated attempts', async () => {
    process.env.ACCESS_PASSWORD = 'synthetic-password';
    const ip = '198.51.100.2';
    let response: Response | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      response = await POST(request('wrong', ip));
      expect(response.status).toBe(401);
    }
    response = await POST(request('wrong', ip));

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('fails closed when no access password is configured', async () => {
    delete process.env.ACCESS_PASSWORD;
    const response = await POST(request(undefined, '198.51.100.3'));

    expect(response.status).toBe(503);
  });
});
