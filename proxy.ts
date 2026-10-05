import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/ratings') ||
    pathname.startsWith('/api/preferences') ||
    pathname.startsWith('/api/media') ||
    pathname.startsWith('/api/steam') ||
    pathname.startsWith('/api/curated') ||
    pathname.startsWith('/api/offer-end-dates') ||
    pathname.startsWith('/api/telegram')
  ) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get('nintendo-deals-auth')?.value;
  if (!await verifySessionToken(authCookie, process.env.ACCESS_PASSWORD)) {
    const loginUrl = new URL('/login', request.url);
    const nextPath = `${pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
