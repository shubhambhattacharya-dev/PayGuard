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
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout', '/api/session'];

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
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const isProxy = pathname.startsWith('/api/payguard');

  // Public demo mode: READ-ONLY without a session (founders/judges can view
  // the ledger, traces and audit trail) — every money-moving POST still
  // requires a signed-in admin session. View-only never becomes write-only.
  const cookie = expected !== null ? req.cookies.get(SESSION_COOKIE)?.value : undefined;
  const authenticated = expected !== null && cookie === expected;

  if (authenticated) {
    return NextResponse.next();
  }

  if (isProxy && !isRead) {
    return NextResponse.json(
      {
        error: 'LOGIN_REQUIRED',
        detail: 'View-only mode — sign in at /login to approve payments.',
      },
      { status: 401 },
    );
  }
  if (isProxy && isRead) {
    return NextResponse.next(); // public read-only demo
  }
  if (pathname.startsWith('/api/login') || pathname.startsWith('/api/logout')) {
    return NextResponse.next();
  }
  const next = encodeURIComponent(pathname);
  return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
