import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

const TARGET_BASE = process.env.PAYGUARD_API_URL ?? 'http://localhost:4000';
const API_KEY = process.env.PAYGUARD_API_KEY ?? '';
const SESSION_COOKIE = 'pg_session';
const DEFAULT_SANDBOX_SECRET = 'payguard-sandbox-reviewer-default-v1';

export const dynamic = 'force-dynamic';

function hasValidApproverSession(request: NextRequest): boolean {
  const demoAllowed = process.env.PAYGUARD_ALLOW_DEMO_LOGIN !== 'false';
  const configured = (process.env.PAYGUARD_DASHBOARD_PASSWORD ?? '').trim();
  const secret = configured.length > 0 ? configured : demoAllowed ? DEFAULT_SANDBOX_SECRET : '';
  if (secret.length === 0) return false;
  const expected = createHash('sha256').update(`${secret}:pg-session-v1`).digest('hex');
  return request.cookies.get(SESSION_COOKIE)?.value === expected;
}

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly text: string;
}

function rawRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const requestFn = url.startsWith('https://') ? httpsRequest : httpRequest;
    const req = requestFn(
      url,
      { method, headers },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const flat: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            const first = Array.isArray(value) ? value[0] : value;
            if (typeof first === 'string') {
              flat[key.toLowerCase()] = first;
            }
          }
          resolve({
            status: res.statusCode ?? 502,
            headers: flat,
            text: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(45_000, () => req.destroy(new Error('upstream timeout')));
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function forward(request: NextRequest, pathSegments: readonly string[]): Promise<NextResponse> {
  const joinedPath = pathSegments.join('/');
  const target = `${TARGET_BASE}/${joinedPath}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (API_KEY.length > 0) {
    headers.authorization = `Bearer ${API_KEY}`;
  }

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
    if (request.method === 'POST' && joinedPath === 'v1/agent/run' && !hasValidApproverSession(request)) {
      try {
        const parsed = body.length > 0 ? (JSON.parse(body) as Record<string, unknown>) : {};
        body = JSON.stringify({ ...parsed, proposeOnly: true });
      } catch {
      }
    }
    if (body.length > 0) {
      headers['content-type'] = 'application/json';
    }
  }

  try {
    const upstream = await rawRequest(target, request.method, headers, body);
    const response = new NextResponse(upstream.text, { status: upstream.status });
    response.headers.set('content-type', 'application/json; charset=utf-8');
    const requestId = upstream.headers['x-request-id'];
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
