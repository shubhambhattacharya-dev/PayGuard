import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Mints the dashboard session cookie after a timing-safe password check.
 * The password lives only in the server env; the cookie is its SHA-256
 * derivative (useless to an attacker who steals it — it cannot be reversed
 * into the password, and middleware recomputes the same digest).
 */

const SESSION_COOKIE = 'pg_session';

function sessionToken(password: string): string {
  return createHash('sha256').update(`${password}:pg-session-v1`).digest('hex');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const password = process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '';
  if (password.trim().length === 0) {
    return NextResponse.json(
      { error: 'DASHBOARD_LOCKED', detail: 'PAYGUARD_DASHBOARD_PASSWORD is not configured.' },
      { status: 503 },
    );
  }

  let submitted = '';
  try {
    const body = (await req.json()) as { readonly password?: unknown };
    submitted = typeof body.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ error: 'INVALID_PAYLOAD' }, { status: 400 });
  }

  const a = Buffer.from(sessionToken(submitted), 'utf-8');
  const b = Buffer.from(sessionToken(password), 'utf-8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'INVALID_PASSWORD' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8, // 8-hour finance-console session
  });
  return response;
}
