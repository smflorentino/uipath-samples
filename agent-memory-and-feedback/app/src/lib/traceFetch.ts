import type { RawSpan } from './traceTree';

export interface FetchSpansEnv {
  baseUrl: string;
  orgName: string;
  tenantName: string;
  token: string;
}

/** Fetches OTEL spans for a trace from the LLM Ops service. */
export async function fetchSpans(traceId: string, env: FetchSpansEnv): Promise<RawSpan[]> {
  const traceIdNoHyphens = traceId.replaceAll('-', '');
  const url = `${env.baseUrl}/${env.orgName}/${env.tenantName}/llmopstenant_/api/Traces/v2/spans/otel?traceId=${encodeURIComponent(traceIdNoHyphens)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.token}`,
      Accept: 'application/json',
    },
  });
  if (r.status === 404) return [];
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Spans request failed: ${r.status} ${r.statusText} ${body.slice(0, 200)}`);
  }
  const parsed = (await r.json()) as unknown;
  if (Array.isArray(parsed)) return parsed as RawSpan[];
  const obj = parsed as { Spans?: RawSpan[] };
  return obj.Spans ?? [];
}
