import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy: the browser talks ONLY to this same-origin route; the
 * API key never ships to client JavaScript (two-app pattern: UI holds no
 * secrets). Forwards path segments verbatim to the PayGuard API.
 */

const TARGET_BASE = process.env.PAYGUARD_API_URL ?? 'http://localhost:4000';
const API_KEY = process.env.PAYGUARD_API_KEY ?? '';

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

async function forward(request: NextRequest, pathSegments: readonly string[]): Promise<NextResponse> {
  const target = `${TARGET_BASE}/${pathSegments.join('/')}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (API_KEY.length > 0) {
    headers.authorization = `Bearer ${API_KEY}`;
  }

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
    if (body.length > 0) {
      headers['content-type'] = 'application/json';
    }
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: 'no-store',
    });
    const text = await upstream.text();
    const response = new NextResponse(text, { status: upstream.status });
    response.headers.set('content-type', 'application/json; charset=utf-8');
    const requestId = upstream.headers.get('x-request-id');
    if (requestId) {
      response.headers.set('x-request-id', requestId);
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: 'API_UNREACHABLE', detail: `PayGuard API at ${TARGET_BASE} is unreachable.` },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  return forward(request, path);
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}
