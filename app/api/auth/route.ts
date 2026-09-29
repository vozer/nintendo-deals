import { NextRequest, NextResponse } from 'next/server';
import { checkLoginAttempt, clearLoginAttempts } from '@/lib/login-rate-limit';
import { createSessionToken } from '@/lib/session';

const COOKIE_NAME = 'nintendo-deals-auth';
const MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  const client = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const attempt = checkLoginAttempt(client);
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfter) } },
    );
  }

  const expectedPassword = process.env.ACCESS_PASSWORD;
  if (!expectedPassword) {
    return NextResponse.json({ error: 'Login is not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const password = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).password
    : undefined;
  if (typeof password !== 'string' || password !== expectedPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  clearLoginAttempts(client);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, await createSessionToken(expectedPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: MAX_AGE,
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
