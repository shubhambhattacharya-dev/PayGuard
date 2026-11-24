import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

/** Public endpoint: tells the UI whether an approver session is active and whether 1-click sandbox unlock is enabled. */
const SESSION_COOKIE = 'pg_session';
const DEFAULT_SANDBOX_SECRET = 'payguard-sandbox-reviewer-default-v1';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const demoAllowed = process.env.PAYGUARD_ALLOW_DEMO_LOGIN !== 'false';
  const configuredPassword = (process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '').trim();
  const effectiveSecret =
    configuredPassword.length > 0 ? configuredPassword : demoAllowed ? DEFAULT_SANDBOX_SECRET : '';
  const adminConfigured = effectiveSecret.length > 0;
  let authenticated = false;
  if (adminConfigured) {
    const token = createHash('sha256').update(`${effectiveSecret}:pg-session-v1`).digest('hex');
    authenticated = req.cookies.get(SESSION_COOKIE)?.value === token;
  }
  return NextResponse.json({
    adminConfigured,
    demoAllowed,
    authenticated,
    viewOnly: !authenticated,
  });
}
