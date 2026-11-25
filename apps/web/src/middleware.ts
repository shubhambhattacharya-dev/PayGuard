import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'pg_session';
const DEFAULT_SANDBOX_SECRET = 'payguard-sandbox-reviewer-default-v1';
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout', '/api/session'];
const PUBLIC_SANDBOX_POST_PATHS = [
  '/api/payguard/v1/evaluate',
  '/api/payguard/v1/agent/run',
];

async function expectedSessionToken(): Promise<string | null> {
  const demoAllowed = process.env.PAYGUARD_ALLOW_DEMO_LOGIN !== 'false';
  const configured = (process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '').trim();
  const secret = configured.length > 0 ? configured : demoAllowed ? DEFAULT_SANDBOX_SECRET : '';
  if (secret.length === 0) {
    return null;
  }
  const data = new TextEncoder().encode(`${secret}:pg-session-v1`);
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
  const isPublicSandboxPost =
    req.method === 'POST' && PUBLIC_SANDBOX_POST_PATHS.includes(pathname);
  const isProxy = pathname.startsWith('/api/payguard');

  const cookie = expected !== null ? req.cookies.get(SESSION_COOKIE)?.value : undefined;
  const authenticated = expected !== null && cookie === expected;

  if (authenticated) {
    return NextResponse.next();
  }

  if (isProxy && !isRead && !isPublicSandboxPost) {
    return NextResponse.json(
      {
        error: 'LOGIN_REQUIRED',
        detail: 'View-only mode — click "Unlock Approver" in the top bar (or sign in at /login) to approve payments.',
      },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
