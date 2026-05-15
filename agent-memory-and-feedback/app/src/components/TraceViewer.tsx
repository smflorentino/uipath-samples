import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  buildTraceTree,
  flattenTree,
  getTraceBounds,
  type RawSpan,
  type TraceNode,
} from '../lib/traceTree';
import { fetchSpans as fetchSpansFromService } from '../lib/traceFetch';
import { getActiveTenant } from '../lib/activeTenant';

interface TraceViewerProps {
  traceId: string;
  jobKey: string;
  jobLabel?: string;
  onClose: () => void;
  /** Override the default fetch — used by tests to inject a sample trace. */
  fetchSpans?: (traceId: string) => Promise<RawSpan[]>;
}

const fmtDuration = (ms: number): string => {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const STATUS_LABEL: Record<number, { text: string; className: string }> = {
  0: { text: 'Unset', className: 'bg-gray-100 text-gray-700' },
  1: { text: 'OK', className: 'bg-emerald-100 text-emerald-800' },
  2: { text: 'Error', className: 'bg-red-100 text-red-800' },
};

const SPAN_TYPE_BADGE: Record<string, string> = {
  agentRun: 'bg-blue-100 text-blue-800',
  llmCall: 'bg-purple-100 text-purple-800',
  completion: 'bg-indigo-100 text-indigo-800',
  toolCall: 'bg-amber-100 text-amber-800',
  agentOutput: 'bg-emerald-100 text-emerald-800',
};


export function TraceViewer({
  traceId,
  jobKey,
  jobLabel,
  onClose,
  fetchSpans,
}: TraceViewerProps) {
  const { sdk } = useAuth();
  const [rawSpans, setRawSpans] = useState<RawSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let spans: RawSpan[];
        if (fetchSpans) {
          spans = await fetchSpans(traceId);
        } else {
          const token = sdk.getToken();
          if (!token) throw new Error('No access token');
          spans = await fetchSpansFromService(traceId, {
            baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
            orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
            tenantName: getActiveTenant(),
            token,
          });
        }
        if (cancelled) return;
        setRawSpans(spans);
        if (spans.length > 0) {
          // Pre-select the first root.
          const roots = buildTraceTree(spans);
          if (roots[0]) setSelectedId(roots[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load trace');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId, sdk, fetchSpans]);

  const roots = useMemo(() => buildTraceTree(rawSpans), [rawSpans]);
  const flat = useMemo(() => flattenTree(roots), [roots]);
  const bounds = useMemo(() => getTraceBounds(flat), [flat]);
  const selected = useMemo(() => flat.find((s) => s.id === selectedId) ?? null, [flat, selectedId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl flex flex-col w-full max-w-7xl">
        <header className="flex items-center justify-between px-5 py-3 border-b">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">
              Trace · {jobLabel ?? jobKey.slice(0, 8)}
            </h2>
            <p className="text-xs text-gray-500 font-mono truncate">
              traceId: {traceId} · {flat.length} spans · {fmtDuration(bounds.durationMs)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Tree pane */}
          <aside className="w-1/2 max-w-[480px] border-r overflow-y-auto" data-testid="trace-tree">
            {loading && <div className="p-4 text-sm text-gray-500">Loading spans...</div>}
            {error && (
              <div className="p-4 text-sm text-red-700 bg-red-50">{error}</div>
            )}
            {!loading && !error && flat.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No spans for this trace.</div>
            )}
            {!loading && !error && roots.length > 0 && (
              <ul className="py-2">
                {flat.map((node) => (
                  <SpanRow
                    key={node.id}
                    node={node}
                    isSelected={selectedId === node.id}
                    onSelect={() => setSelectedId(node.id)}
                  />
                ))}
              </ul>
            )}
          </aside>

          {/* Detail pane */}
          <section className="flex-1 overflow-y-auto p-5" data-testid="trace-detail">
            {selected ? (
              <SpanDetail span={selected} />
            ) : (
              <div className="text-sm text-gray-500">Select a span to inspect.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SpanRow({
  node,
  isSelected,
  onSelect,
}: {
  node: TraceNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const status = STATUS_LABEL[node.status] ?? STATUS_LABEL[0];
  const typeClass = SPAN_TYPE_BADGE[node.spanType] ?? 'bg-gray-100 text-gray-700';
  return (
    <li>
      <button
        onClick={onSelect}
        data-testid="span-row"
        data-span-id={node.id}
        className={`w-full text-left py-1.5 text-sm hover:bg-gray-50 ${
          isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-800'
        }`}
        style={{ paddingLeft: `${12 + node.depth * 14}px`, paddingRight: '12px' }}
      >
        <div className="flex items-center gap-2">
          <span className="truncate flex-1">{node.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeClass}`}>{node.spanType}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${status.className}`}>{status.text}</span>
          <span className="text-xs text-gray-500 tabular-nums">{fmtDuration(node.durationMs)}</span>
        </div>
      </button>
    </li>
  );
}

function SpanDetail({ span }: { span: TraceNode }) {
  const status = STATUS_LABEL[span.status] ?? STATUS_LABEL[0];
  const typeClass = SPAN_TYPE_BADGE[span.spanType] ?? 'bg-gray-100 text-gray-700';
  const attrEntries = Object.entries(span.attributes);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900 break-all">{span.name}</h3>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className={`text-xs px-2 py-0.5 rounded ${typeClass}`}>{span.spanType}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${status.className}`}>{status.text}</span>
          <span className="text-xs text-gray-500">{fmtDuration(span.durationMs)}</span>
          <span className="text-xs text-gray-500 font-mono">id: {span.id.slice(0, 8)}</span>
          {span.parentId && (
            <span className="text-xs text-gray-500 font-mono">parent: {span.parentId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <Row label="Start" value={span.startTime} />
        <Row label="End" value={span.endTime} />
        <Row label="Trace ID" value={span.traceId} mono />
        <Row label="Job Key" value={span.raw.JobKey ?? '—'} mono />
      </dl>

      {span.attachments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-1">Attachments</h4>
          <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
            {span.attachments.map((a, i) => {
              const name = typeof a.FileName === 'string' ? a.FileName : typeof a.Id === 'string' ? a.Id : `#${i}`;
              const mime = typeof a.MimeType === 'string' ? a.MimeType : null;
              return (
                <li key={i}>
                  <span className="font-mono text-xs">{name}</span>
                  {mime && <span className="text-gray-500"> ({mime})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Attributes</h4>
        {attrEntries.length === 0 ? (
          <div className="text-sm text-gray-500">No attributes.</div>
        ) : (
          <div className="space-y-2">
            {attrEntries.map(([key, value]) => (
              <AttributeRow key={key} k={key} v={value} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`text-sm text-gray-800 ${mono ? 'font-mono break-all' : ''}`}>{value}</dd>
    </>
  );
}

function AttributeRow({ k, v }: { k: string; v: unknown }) {
  const isPrimitive = v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  return (
    <div className="border border-gray-200 rounded px-3 py-2 bg-gray-50">
      <div className="text-xs font-semibold text-gray-700 font-mono">{k}</div>
      {isPrimitive ? (
        <div className="text-sm text-gray-800 break-all whitespace-pre-wrap">{String(v ?? '')}</div>
      ) : (
        <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {JSON.stringify(v, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default TraceViewer;
