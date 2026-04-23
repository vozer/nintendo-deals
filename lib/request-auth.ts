import { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'nintendo-deals-auth';

function getExpectedApiKey(): string | undefined {
  return process.env.RATINGS_API_KEY;
}

function getExpectedPassword(): string | undefined {
  return process.env.ACCESS_PASSWORD;
}

export function hasValidApiKey(req: NextRequest): boolean {
  const provided = req.headers.get('x-api-key');
  const expected = getExpectedApiKey();
  return Boolean(expected && provided && provided === expected);
}

export function hasValidSessionCookie(req: NextRequest): boolean {
  const provided = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const expected = getExpectedPassword();
  return Boolean(expected && provided && provided === expected);
}

export function isAuthorizedRequest(req: NextRequest): boolean {
  return hasValidApiKey(req) || hasValidSessionCookie(req);
}
