import { NextRequest } from 'next/server';
import { verifySessionToken } from './session';

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

export async function hasValidSessionCookie(req: NextRequest): Promise<boolean> {
  const provided = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const expected = getExpectedPassword();
  return verifySessionToken(provided, expected);
}

export async function isAuthorizedRequest(req: NextRequest): Promise<boolean> {
  return hasValidApiKey(req) || await hasValidSessionCookie(req);
}
