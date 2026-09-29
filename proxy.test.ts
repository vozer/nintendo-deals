import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { createSessionToken } from './lib/session';

const originalPassword = process.env.ACCESS_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.ACCESS_PASSWORD;
  else process.env.ACCESS_PASSWORD = originalPassword;
});

describe('authentication redirect', () => {
  it('preserves the game deep link in the login destination', async () => {
    process.env.ACCESS_PASSWORD = 'test-only-password';
    const request = new NextRequest('https://nintendo-deals.test/?game=1337462');

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe('/?game=1337462');
  });

  it('accepts a valid signed session cookie', async () => {
    process.env.ACCESS_PASSWORD = 'test-only-password';
    const request = new NextRequest('https://nintendo-deals.test/');
    request.cookies.set('nintendo-deals-auth', await createSessionToken('test-only-password'));

    const response = await proxy(request);

    expect(response.headers.get('location')).toBeNull();
  });
});
