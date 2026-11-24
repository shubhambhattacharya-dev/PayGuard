import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Mints the dashboard httpOnly session cookie.
 * Supports:
 * 1. Timing-safe admin password verification (PAYGUARD_DASHBOARD_PASSWORD).
 * 2. Frictionless 1-click Sandbox Reviewer unlock ({ demo: true }) so founders
 *    and hiring reviewers can test HITL QR approvals without a password wall,
 *    unless PAYGUARD_ALLOW_DEMO_LOGIN=false is explicitly set.
 */

const SESSION_COOKIE = 'pg_session';
const DEFAULT_SANDBOX_SECRET = 'payguard-sandbox-reviewer-default-v1';

function sessionToken(secret: string): string {
  return createHash('sha256').update(`${secret}:pg-session-v1`).digest('hex');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const demoAllowed = process.env.PAYGUARD_ALLOW_DEMO_LOGIN !== 'false';
  const configuredPassword = (process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '').trim();
  const effectiveSecret =
    configuredPassword.length > 0 ? configuredPassword : demoAllowed ? DEFAULT_SANDBOX_SECRET : '';

  if (effectiveSecret.length === 0) {
    return NextResponse.json(
      { error: 'DASHBOARD_LOCKED', detail: 'PAYGUARD_DASHBOARD_PASSWORD is not configured.' },
      { status: 503 },
    );
  }

  let submitted = '';
  let isDemoRequest = false;
  try {
    const body = (await req.json()) as { readonly password?: unknown; readonly demo?: unknown };
    submitted = typeof body.password === 'string' ? body.password : '';
    isDemoRequest = body.demo === true;
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  if (isDemoRequest) {
    if (!demoAllowed) {
      return NextResponse.json(
        { error: 'DEMO_LOGIN_DISABLED', detail: '1-click sandbox unlock is disabled; enter admin password.' },
        { status: 403 },
      );
    }
  } else {
    if (configuredPassword.length === 0) {
      return NextResponse.json(
        { error: 'DASHBOARD_LOCKED', detail: 'Use 1-click Sandbox Approver or set PAYGUARD_DASHBOARD_PASSWORD.' },
        { status: 401 },
      );
    }
    const a = Buffer.from(sessionToken(submitted), 'utf-8');
    const b = Buffer.from(sessionToken(configuredPassword), 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 });
    }
  }

  const response = NextResponse.json({ ok: true, mode: isDemoRequest ? 'sandbox_approver' : 'admin' });
  response.cookies.set(SESSION_COOKIE, sessionToken(effectiveSecret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: isDemoRequest ? 60 * 60 * 2 : 60 * 60 * 8,
  });
  return response;
}
