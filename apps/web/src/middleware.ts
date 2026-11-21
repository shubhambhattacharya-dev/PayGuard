import { NextRequest, NextResponse } from 'next/server';

/**
 * Dashboard session gate: the web proxy authenticates itself to the API with
 * a server-side key, so WITHOUT this gate any visitor would inherit full
 * admin powers on the money console. Every page and proxy call now requires
 * a session cookie minted by /api/login (password from the
 * PAYGUARD_DASHBOARD_PASSWORD server env — never shipped to the browser).
 * Fail closed: no password configured = dashboard locked.
 */

const SESSION_COOKIE = 'pg_session';
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout'];

async function expectedSessionToken(): Promise<string | null> {
  const password = process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '';
  if (password.trim().length === 0) {
    return null; // fail closed — dashboard locked until configured
  }
  const data = new TextEncoder().encode(`${password}:pg-session-v1`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const expected = await expectedSessionToken();
  if (expected === null) {
    if (pathname.startsWith('/api/payguard')) {
      return NextResponse.json(
        { error: 'DASHBOARD_LOCKED', detail: 'PAYGUARD_DASHBOARD_PASSWORD is not configured.' },
        { status: 503 },
      );
    }
    return NextResponse.redirect(new URL('/login?locked=1', req.url));
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/payguard')) {
    return NextResponse.json(
      { error: 'UNAUTHENTICATED', detail: 'Dashboard login required.' },
      { status: 401 },
    );
  }
  const next = encodeURIComponent(pathname);
  return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
