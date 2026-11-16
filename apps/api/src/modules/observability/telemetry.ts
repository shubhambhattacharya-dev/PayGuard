import { randomUUID } from 'node:crypto';

export interface TelemetrySpan {
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface TracePayload {
  readonly traceId: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly totalMs: number;
  readonly statusCode: number;
  readonly method: string;
  readonly path: string;
  readonly ownerId?: string;
  readonly llmMs?: number;
  readonly dbMs?: number;
  readonly paypalMs?: number;
  readonly decisionState?: string;
  readonly reasonCode?: string;
  readonly spans?: readonly TelemetrySpan[];
}

export interface LangfuseReporter {
  readonly enabled: boolean;
  emitTrace(trace: TracePayload): void;
}

/**
 * Zero-dependency, fail-open Langfuse ingestion reporter.
 * Never throws or blocks the payment/policy critical path.
 */
export function createLangfuseReporter(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): LangfuseReporter | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? '';
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? '';
  const baseUrl = (env.LANGFUSE_BASE_URL ?? env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com')
    .trim()
    .replace(/\/+$/, '');

  if (!publicKey || !secretKey) {
    return null;
  }

  const authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;

  return {
    enabled: true,
    emitTrace(trace: TracePayload): void {
      const batch: Array<Record<string, unknown>> = [
        {
          id: randomUUID(),
          timestamp: trace.endTime,
          type: 'trace-create',
          body: {
            id: trace.traceId,
            name: trace.name,
            userId: trace.ownerId,
            timestamp: trace.startTime,
            metadata: {
              method: trace.method,
              path: trace.path,
              statusCode: trace.statusCode,
              totalMs: trace.totalMs,
              ...(trace.llmMs !== undefined ? { llmMs: trace.llmMs } : {}),
              ...(trace.dbMs !== undefined ? { dbMs: trace.dbMs } : {}),
              ...(trace.paypalMs !== undefined ? { paypalMs: trace.paypalMs } : {}),
              ...(trace.decisionState ? { decisionState: trace.decisionState } : {}),
              ...(trace.reasonCode ? { reasonCode: trace.reasonCode } : {}),
            },
          },
        },
      ];

      for (const span of trace.spans ?? []) {
        batch.push({
          id: randomUUID(),
          timestamp: span.endTime,
          type: 'span-create',
          body: {
            id: randomUUID(),
            traceId: trace.traceId,
            name: span.name,
            startTime: span.startTime,
            endTime: span.endTime,
            metadata: {
              durationMs: span.durationMs,
              ...(span.metadata ?? {}),
            },
          },
        });
      }

      // Fire-and-forget with strict timeout so Langfuse outages never affect payments.
      void fetchFn(`${baseUrl}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch }),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => {
        // Intentionally swallowed: telemetry must fail open.
      });
    },
  };
}

export function emitStructuredLog(trace: TracePayload): void {
  const entry = {
    ts: trace.endTime,
    level: trace.statusCode >= 500 ? 'error' : 'info',
    traceId: trace.traceId,
    method: trace.method,
    path: trace.path,
    statusCode: trace.statusCode,
    totalMs: trace.totalMs,
    ...(trace.llmMs !== undefined ? { llmMs: trace.llmMs } : {}),
    ...(trace.dbMs !== undefined ? { dbMs: trace.dbMs } : {}),
    ...(trace.paypalMs !== undefined ? { paypalMs: trace.paypalMs } : {}),
    ...(trace.decisionState ? { decisionState: trace.decisionState } : {}),
    ...(trace.reasonCode ? { reasonCode: trace.reasonCode } : {}),
  };
  console.log(JSON.stringify(entry));
}
