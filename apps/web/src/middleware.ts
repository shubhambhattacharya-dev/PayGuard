import { NextRequest, NextResponse } from 'next/server';

/**
 * Dashboard session gate: the web proxy authenticates itself to the API with
 * a server-side key, so WITHOUT this gate any visitor would inherit full
 * admin powers on the money console. Every money-moving POST requires a
 * session cookie minted by /api/login (password from PAYGUARD_DASHBOARD_PASSWORD).
 *
 * Non-money sandbox evaluation routes (/v1/evaluate and /v1/agent/run) are
 * allowed in public demo mode so recruiters and founders can test the policy
 * gate and fixture agent without signing in, while money-moving settlement
 * routes (/v1/execute, /v1/hitl/approve, /v1/transactions/:id/approve)
 * strictly require authentication.
 */

const SESSION_COOKIE = 'pg_session';
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout', '/api/session'];
const PUBLIC_SANDBOX_POST_PATHS = [
  '/api/payguard/v1/evaluate',
  '/api/payguard/v1/agent/run',
];

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
        detail: 'View-only mode — sign in at /login to approve payments.',
      },
      { status: 401 },
    );
  }
  // Everything else (pages, reads, non-money sandbox evaluations) is public.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
