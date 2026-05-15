export interface RawSpan {
  Id: string;
  TraceId: string;
  ParentId: string | null;
  Name: string;
  StartTime: string;
  EndTime: string;
  Attributes?: string | Record<string, unknown> | null;
  Status?: number;
  SpanType?: string | null;
  JobKey?: string | null;
  FolderKey?: string | null;
  Attachments?: Array<Record<string, unknown>> | null;
}

export interface TraceSpan {
  id: string;
  traceId: string;
  parentId: string | null;
  name: string;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: number;
  spanType: string;
  attributes: Record<string, unknown>;
  attachments: Array<Record<string, unknown>>;
  raw: RawSpan;
}

export interface TraceNode extends TraceSpan {
  children: TraceNode[];
  depth: number;
}

const parseAttrs = (attrs: RawSpan['Attributes']): Record<string, unknown> => {
  if (!attrs) return {};
  if (typeof attrs === 'object') return attrs as Record<string, unknown>;
  try {
    const parsed = JSON.parse(attrs);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { _rawAttributes: attrs };
  }
};

export function normalizeSpan(raw: RawSpan): TraceSpan {
  const startMs = Date.parse(raw.StartTime);
  const endMs = Date.parse(raw.EndTime);
  return {
    id: raw.Id,
    traceId: raw.TraceId,
    parentId: raw.ParentId,
    name: raw.Name,
    startTime: raw.StartTime,
    endTime: raw.EndTime,
    startMs,
    endMs,
    durationMs: Number.isFinite(endMs - startMs) ? Math.max(0, endMs - startMs) : 0,
    status: raw.Status ?? 0,
    spanType: raw.SpanType ?? '',
    attributes: parseAttrs(raw.Attributes),
    attachments: Array.isArray(raw.Attachments) ? raw.Attachments : [],
    raw,
  };
}

/**
 * Builds a forest from a flat list of spans. Roots are spans whose ParentId
 * is null OR whose ParentId points to a span that isn't in the list (which
 * happens when the trace is partial). Children at each level are sorted by
 * StartTime ascending.
 */
export function buildTraceTree(rawSpans: RawSpan[]): TraceNode[] {
  const spans = rawSpans.map(normalizeSpan);
  const byId = new Map<string, TraceSpan>();
  for (const s of spans) byId.set(s.id, s);

  const childrenByParent = new Map<string | null, TraceSpan[]>();
  for (const s of spans) {
    const key = s.parentId && byId.has(s.parentId) ? s.parentId : null;
    const arr = childrenByParent.get(key) ?? [];
    arr.push(s);
    childrenByParent.set(key, arr);
  }

  const sortByStart = (a: TraceSpan, b: TraceSpan) => a.startMs - b.startMs;

  const build = (parentId: string | null, depth: number): TraceNode[] => {
    const kids = childrenByParent.get(parentId) ?? [];
    kids.sort(sortByStart);
    return kids.map((s) => ({
      ...s,
      depth,
      children: build(s.id, depth + 1),
    }));
  };

  return build(null, 0);
}

/** Flat depth-first traversal, useful for rendering a virtualized list. */
export function flattenTree(roots: TraceNode[]): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (n: TraceNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Computes overall trace bounds (min start / max end) for relative timing UI. */
export function getTraceBounds(spans: TraceSpan[]): { startMs: number; endMs: number; durationMs: number } {
  if (spans.length === 0) return { startMs: 0, endMs: 0, durationMs: 0 };
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of spans) {
    if (s.startMs < minStart) minStart = s.startMs;
    if (s.endMs > maxEnd) maxEnd = s.endMs;
  }
  return {
    startMs: minStart,
    endMs: maxEnd,
    durationMs: Math.max(0, maxEnd - minStart),
  };
}
