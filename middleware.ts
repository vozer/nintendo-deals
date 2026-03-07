import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/api/ratings')) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get('nintendo-deals-auth')?.value;
  if (!authCookie || authCookie !== process.env.ACCESS_PASSWORD) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
