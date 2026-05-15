/**
 * The OTLP spans endpoint returns 16-char hex span IDs (W3C trace-context format),
 * but the LLM Ops Feedback API expects them as a GUID with the upper 8 bytes zeroed
 * (`00000000-0000-0000-XXXX-XXXXXXXXXXXX`). This pads the short form into that GUID.
 * Returns the input unchanged if it already looks like a GUID or doesn't fit either shape.
 */
export function normalizeSpanIdToGuid(spanId: string): string {
  if (!spanId) return spanId;
  if (spanId.includes('-')) return spanId.toLowerCase();
  if (/^[0-9a-f]{16}$/i.test(spanId)) {
    const lower = spanId.toLowerCase();
    return `00000000-0000-0000-${lower.slice(0, 4)}-${lower.slice(4)}`;
  }
  return spanId;
}

export interface FeedbackEnv {
  baseUrl: string;
  orgName: string;
  tenantName: string;
  token: string;
}

/**
 * Feedback category. The IM UI posts one entry per submit with the default
 * "Output" category and a zero-GUID id; absent categories cause the IM UI's
 * per-trace feedback view to filter our entries out even though the agents
 * portal feedback dashboard still shows them.
 */
export interface FeedbackCategory {
  id: string;
  category: string;
}

export const DEFAULT_FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  { id: '00000000-0000-0000-0000-000000000000', category: 'Output' },
];

export interface FeedbackPayload {
  traceId: string;
  spanId: string;
  agentId: string;
  /**
   * Deployed agent version (e.g. `"1.0.2"`), sourced at submit time from
   * `Jobs.getById(jobKey, folderId).process.processVersion`. **Required and
   * must be non-empty** — feedback submitted without it would drift away
   * from the actual run that produced the draft. `submitFeedback` throws if
   * this is missing or blank, well before the network call.
   */
  agentVersion: string;
  spanType: string;
  comment: string;
  isPositive: boolean;
  categories?: FeedbackCategory[];
  /**
   * Folder key (GUID) the agent ran in. Sent as `x-uipath-folderkey` — the LLM Ops
   * Feedback API rejects requests without it (`insufficient_scope: Insufficient context`).
   */
  folderKey: string;
}

export interface FeedbackResponse {
  id: string;
  traceId: string;
  spanId: string;
  agentId: string;
  agentVersion: string;
  comment: string;
  isPositive: boolean;
  folderKey?: string;
  feedbackCategories?: unknown[];
  userEmail?: string;
  status?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Submits feedback for an agent run span to the LLM Ops Feedback API.
 * Endpoint discovered from Orchestrator's job trace UI (POST .../llmopstenant_/api/Feedback → 201).
 */
export async function submitFeedback(
  env: FeedbackEnv,
  payload: FeedbackPayload,
): Promise<FeedbackResponse> {
  if (!payload.agentVersion) {
    throw new Error(
      'Cannot submit feedback: agentVersion is required. Resolve it from Jobs.getById(jobKey, folderId).process.processVersion before submitting.',
    );
  }
  const url = `${env.baseUrl}/${env.orgName}/${env.tenantName}/llmopstenant_/api/Feedback`;
  const body = {
    traceId: payload.traceId,
    // OTLP returns 16-char hex span IDs but this endpoint expects the GUID-padded
    // form `00000000-0000-0000-XXXX-XXXXXXXXXXXX`. See normalizeSpanIdToGuid above.
    spanId: normalizeSpanIdToGuid(payload.spanId),
    agentId: payload.agentId,
    // Sourced from Jobs.getById(...).process.processVersion at submit time
    // (resolveTraceForJob); not from any static config.
    agentVersion: payload.agentVersion,
    // Must be 'agentRun'. The agentRun span is nested under outer Orchestrator
    // spans (RobotJob → RunJob → RunJob.WaitForJob), so callers must find it via
    // findRootAgentRunSpanId — using the trace root produces a bogus spanId and
    // the IM per-trace feedback view will hide the entry.
    spanType: payload.spanType,
    comment: payload.comment,
    isPositive: payload.isPositive,
    // Empty/missing categories cause the IM per-trace feedback view to filter
    // our entries out. The IM UI itself sends the zero-GUID "Output" default,
    // so we match that when the caller doesn't supply categories.
    categories:
      payload.categories && payload.categories.length > 0
        ? payload.categories
        : DEFAULT_FEEDBACK_CATEGORIES,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Required. Without this header the API returns
      // `403 insufficient_scope: Insufficient context` even with a valid bearer token.
      'x-uipath-folderkey': payload.folderKey,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Feedback submit failed: ${r.status} ${r.statusText} ${text.slice(0, 300)}`);
  }
  return (await r.json()) as FeedbackResponse;
}
