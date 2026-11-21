import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

/** Public endpoint: tells the UI whether an admin session is active. */
const SESSION_COOKIE = 'pg_session';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const password = process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '';
  const adminConfigured = password.trim().length > 0;
  let authenticated = false;
  if (adminConfigured) {
    const token = createHash('sha256').update(`${password}:pg-session-v1`).digest('hex');
    authenticated = req.cookies.get(SESSION_COOKIE)?.value === token;
  }
  return NextResponse.json({ adminConfigured, authenticated, viewOnly: !authenticated });
}
