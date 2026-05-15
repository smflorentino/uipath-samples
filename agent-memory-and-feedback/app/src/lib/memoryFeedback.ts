/**
 * LLM Ops feedback-triage helpers: list, ingest-to-memory, delete.
 *
 * Endpoints discovered by capturing the staging `/agents_/feedback` page's
 * network trace via Chrome DevTools Protocol. All three sit on the portal
 * host (`https://cloud.uipath.com`), NOT the API host our SDK uses. We
 * derive the portal host by stripping `.api.` from `baseUrl`, the same
 * trick `src/lib/orchestratorLinks.ts` uses.
 *
 * All three URLs use the *internal tenant GUID* in the path (e.g.
 * `11111111-…`), not the tenant slug ("Memory") our existing `/api/Feedback`
 * POST uses. The three internal headers
 * (`X-UiPath-Internal-{AccountId,TenantId,TenantName}`) authorize the
 * request against the user's org + tenant context. Ingest and delete also
 * carry an `X-UiPath-FolderKey` — different folders for each:
 *   - INGEST → the *memory* folder (the folder the memory space lives in).
 *   - DELETE → the *agent* folder (the folder the agent runs originated in).
 */

export interface MemoryEnv {
  /** API host (e.g. https://cloud.api.uipath.com). Portal host is derived. */
  baseUrl: string;
  orgName: string;
  /** Tenant slug like "Memory" — for `X-UiPath-Internal-TenantName`. */
  tenantName: string;
  /** Tenant GUID (e.g. "11111111-…") — URL path + `X-UiPath-Internal-TenantId`. */
  internalTenantIdGuid: string;
  internalAccountId: string;
  /** Folder key of the *agent* — sent on DELETE. */
  agentFolderKey: string;
  /** Folder key of the *memory space* — sent on INGEST. */
  memoryFolderKey: string;
  /**
   * Agent definition id. Spans from the list endpoint carry the agent on
   * `span.referenceId`; the triage hook filters to this id so a folder
   * that hosts multiple agents (e.g. ResolutionDrafterAgent + DisputeAgent
   * sharing `Shared/Data Tests/DevCon26-DataTests`) doesn't bleed.
   */
  agentId: string;
  token: string;
}

/**
 * One feedback comment nested inside a span entry. Each span can carry
 * multiple feedbacks (multiple users submitting thumbs on the same run).
 */
export interface FeedbackComment {
  /** The actual feedback id — used for ingest and delete. */
  id: string;
  isPositive?: boolean;
  comment?: string;
  userEmail?: string;
  userId?: string;
  agentVersion?: string;
  updateTime?: string;
  /**
   * Memory spaces this feedback has already been ingested into. Empty when
   * not yet promoted. Each entry has shape
   * `{ memorySpaceId, memoryItemId, status, memoryType }`. The triage list
   * hides entries whose `memorySpaceId` matches the *active target's*
   * memory id (a feedback promoted to one space should NOT hide itself
   * when the user is triaging against another space).
   */
  memories?: { memorySpaceId?: string; [key: string]: unknown }[];
  /** Loosely-typed: surface fields not enumerated here as-is. */
  [key: string]: unknown;
}

/**
 * One span entry as returned by the spans/memories list endpoint.
 *
 * Surprising shape: `id` here is the *spanId* (GUID-padded form, e.g.
 * `00000000-0000-0000-XXXX-XXXXXXXXXXXX`), NOT a feedback id. The actual
 * feedback ids live inside `feedbacks[].id`. The `attributes` blob is at
 * the span level — every feedback ingested from this span uses the same
 * attributes string.
 */
export interface FeedbackSpanEntry {
  id: string;
  feedbacks?: FeedbackComment[];
  traceId?: string;
  jobKey?: string;
  /** Agent id is exposed as `referenceId` on the span. */
  referenceId?: string;
  agentVersion?: string;
  spanType?: string;
  folderKey?: string;
  startTime?: string;
  endTime?: string;
  /**
   * JSON-string blob containing prompts, schemas, agent metadata, input,
   * and output of the run. Passed verbatim to the ingest endpoint.
   */
  attributes?: string;
  [key: string]: unknown;
}

/**
 * UI-friendly flattened row — one per feedback comment. The triage page
 * iterates over these. `attributes` is copied down from the parent span so
 * `ingestFeedbackToMemory` only needs the row.
 */
export interface FlattenedFeedbackRow {
  feedbackId: string;
  spanId: string;
  traceId?: string;
  jobKey?: string;
  agentId?: string;
  agentVersion?: string;
  isPositive?: boolean;
  comment?: string;
  userEmail?: string;
  createdAt?: string;
  /** From the parent span — required for ingest. */
  attributes?: string;
  /** True when the feedback has been ingested into one or more memory spaces. */
  inMemory: boolean;
}

/** Flattens spans → one row per feedback comment. */
/**
 * @param spans     Raw list response.
 * @param memoryId  Active target's memorySpaceId. When set, `inMemory` is
 *                  true only if the feedback was ingested into THIS space.
 *                  When omitted, falls back to "any memory space".
 */
export function flattenSpansToRows(
  spans: FeedbackSpanEntry[],
  memoryId?: string,
): FlattenedFeedbackRow[] {
  const rows: FlattenedFeedbackRow[] = [];
  for (const span of spans) {
    const fbs = span.feedbacks ?? [];
    for (const fb of fbs) {
      rows.push({
        feedbackId: fb.id,
        spanId: span.id,
        traceId: span.traceId,
        jobKey: span.jobKey,
        agentId: span.referenceId,
        agentVersion: fb.agentVersion ?? span.agentVersion,
        isPositive: fb.isPositive,
        comment: typeof fb.comment === 'string' ? fb.comment : undefined,
        userEmail: typeof fb.userEmail === 'string' ? fb.userEmail : undefined,
        createdAt: typeof fb.updateTime === 'string' ? fb.updateTime : span.endTime,
        attributes: span.attributes,
        inMemory: memoryId
          ? Array.isArray(fb.memories) &&
            fb.memories.some((m) => m?.memorySpaceId === memoryId)
          : Array.isArray(fb.memories) && fb.memories.length > 0,
      });
    }
  }
  return rows;
}

function portalBase(env: MemoryEnv): string {
  return env.baseUrl.replace('.api.', '.');
}

/**
 * Marker class for `401 Unauthorized` / `403 Forbidden` responses. The
 * triage panel inspects `err instanceof AuthExpiredError` to show a "sign
 * in again" prompt instead of the generic red error banner.
 */
export class AuthExpiredError extends Error {
  status: number;
  constructor(status: number, statusText: string, bodySnippet: string) {
    super(`Auth required: ${status} ${statusText} ${bodySnippet}`.trim());
    this.name = 'AuthExpiredError';
    this.status = status;
  }
}

async function throwIfNotOk(r: Response, prefix: string): Promise<void> {
  if (r.ok) return;
  const text = await r.text().catch(() => '');
  if (r.status === 401 || r.status === 403) {
    throw new AuthExpiredError(r.status, r.statusText, text.slice(0, 200));
  }
  throw new Error(`${prefix}: ${r.status} ${r.statusText} ${text.slice(0, 300)}`);
}

function internalHeaders(env: MemoryEnv): Record<string, string> {
  return {
    Authorization: `Bearer ${env.token}`,
    Accept: 'application/json',
    'X-UiPath-Internal-AccountId': env.internalAccountId,
    'X-UiPath-Internal-TenantId': env.internalTenantIdGuid,
    'X-UiPath-Internal-TenantName': env.tenantName,
  };
}

/**
 * Lists feedback entries (with their full `attributes` blob) for the
 * configured tenant, scoped to the [startMs, endMs] window.
 */
export async function listMemoryFeedback(
  env: MemoryEnv,
  range: { startMs: number; endMs: number },
): Promise<FeedbackSpanEntry[]> {
  const url =
    `${portalBase(env)}/${env.orgName}/${env.internalTenantIdGuid}/llmopstenant_/api/Agent/feedback/spans/memories/` +
    `?absoluteStartTime=${range.startMs}&absoluteEndTime=${range.endMs}`;
  const r = await fetch(url, { method: 'GET', headers: internalHeaders(env) });
  await throwIfNotOk(r, 'List feedback failed');
  const body = await r.json();
  // The endpoint returns either a bare array or an envelope; accept both.
  if (Array.isArray(body)) return body as FeedbackSpanEntry[];
  if (body && Array.isArray((body as { value?: unknown[] }).value)) {
    return (body as { value: FeedbackSpanEntry[] }).value;
  }
  return [];
}

/**
 * Ingests a single feedback entry into the configured memory space.
 * `entry.attributes` should be the verbatim string the list endpoint
 * returned for that entry.
 */
export async function ingestFeedbackToMemory(
  env: MemoryEnv,
  memoryId: string,
  memoryName: string,
  entry: { feedbackId: string; attributes: string },
): Promise<void> {
  if (!entry.attributes) {
    throw new Error('Cannot ingest feedback without an attributes blob from the list endpoint.');
  }
  const url =
    `${portalBase(env)}/${env.orgName}/${env.internalTenantIdGuid}/llmopstenant_/api/Agent/memory/${memoryId}/ingest` +
    `?memorySpaceName=${encodeURIComponent(memoryName)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...internalHeaders(env),
      'Content-Type': 'application/json',
      'X-UiPath-FolderKey': env.memoryFolderKey,
    },
    body: JSON.stringify({ feedbackId: entry.feedbackId, attributes: entry.attributes }),
  });
  await throwIfNotOk(r, 'Ingest failed');
}

/**
 * Deletes a feedback entry from LLM Ops. The staging UI's confirmation
 * dialog notes that this also unlinks the entry from any memory spaces it
 * was previously ingested into — a single call handles both cases.
 */
export async function deleteFeedback(env: MemoryEnv, feedbackId: string): Promise<void> {
  const url = `${portalBase(env)}/${env.orgName}/${env.internalTenantIdGuid}/llmopstenant_/api/Feedback/${feedbackId}`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...internalHeaders(env),
      'X-UiPath-FolderKey': env.agentFolderKey,
    },
  });
  await throwIfNotOk(r, 'Delete feedback failed');
}

/**
 * Locates a freshly-submitted feedback in the list endpoint and ingests it
 * into the configured memory space. Built for the draft-detail "Submit + Add
 * to Memory" button — feedback submitted via `POST /api/Feedback` is usually
 * visible on the spans/memories list within a second, but there's
 * occasional write-propagation lag, so we poll with a deadline.
 *
 * Why we have to do this dance instead of constructing `attributes`
 * ourselves: the `attributes` JSON-string blob (prompts, schemas, input,
 * output, agent metadata) is computed server-side per span at trace-write
 * time. We never reconstruct it client-side — we read what the list
 * endpoint gives us and pass it through verbatim to `/ingest`.
 *
 * @throws AuthExpiredError on 401/403 (re-uses the underlying list helper).
 * @throws Error if the feedback never shows up within `timeoutMs`.
 */
export async function pollListForFeedbackThenIngest(
  env: MemoryEnv,
  memoryId: string,
  memoryName: string,
  feedbackId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const intervalMs = opts?.intervalMs ?? 500;
  // 30-day window is generous enough to cover spans for old drafts the user
  // just submitted feedback on. The list endpoint is filtered by span time,
  // not feedback time.
  const range = {
    startMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    endMs: Date.now() + 5 * 60 * 1000,
  };
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const spans = await listMemoryFeedback(env, range);
      for (const span of spans) {
        if (env.agentFolderKey && span.folderKey !== env.agentFolderKey) continue;
        const fb = span.feedbacks?.find((f) => f.id === feedbackId);
        if (fb && span.attributes) {
          await ingestFeedbackToMemory(env, memoryId, memoryName, {
            feedbackId,
            attributes: span.attributes,
          });
          return;
        }
      }
    } catch (err) {
      // Propagate auth errors immediately — no point polling through them.
      if (err instanceof AuthExpiredError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Submitted feedback ${feedbackId.slice(0, 8)}… but couldn't find it in the LLM Ops list endpoint within ${timeoutMs / 1000}s — try promoting from Feedback Triage.` +
      (lastError ? ` Last poll error: ${lastError.message}` : ''),
  );
}
