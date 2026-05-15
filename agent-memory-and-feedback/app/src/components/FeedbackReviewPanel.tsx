import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import type { AgentTarget } from '../config/agentTargets';
import {
  deleteFeedback,
  ingestFeedbackToMemory,
  type FlattenedFeedbackRow,
  type MemoryEnv,
} from '../lib/memoryFeedback';
import { buildJobDetailUrl, buildMemorySpaceUrl } from '../lib/orchestratorLinks';
import { getActiveTenant } from '../lib/activeTenant';

/**
 * Minimal typed view of the JSON-string `attributes` blob the list endpoint
 * returns per feedback span. Fields outside the few the UI reads are kept
 * loose because the schema is owned by LLM Ops, not us.
 */
interface FeedbackAttributes {
  type?: string;
  agentId?: string;
  agentName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  input?: Record<string, unknown>;
  output?: { subject?: string; body?: string; [k: string]: unknown };
  source?: string;
  error?: unknown;
}

export interface FeedbackReviewPanelProps {
  row: FlattenedFeedbackRow;
  env: MemoryEnv;
  target: AgentTarget;
  onClose: () => void;
  /** Fired after a successful Delete — parent removes from list + navigates back. */
  onDeleted: (feedbackId: string) => void;
  /** Fired after a successful Promote — same as Delete from the list's perspective. */
  onPromoted: (feedbackId: string) => void;
}

const fmtRelative = (iso?: string | null): string => {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return new Date(ms).toLocaleString();
};

const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

function renderInputValue(v: unknown): React.ReactNode {
  if (v == null || v === '') return <span className="text-gray-400">—</span>;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return <code className="text-xs">{JSON.stringify(v)}</code>;
}

export function FeedbackReviewPanel({
  row,
  env,
  target,
  onClose,
  onDeleted,
  onPromoted,
}: FeedbackReviewPanelProps) {
  // Parse the attributes blob once. If it fails (malformed JSON, missing,
  // etc.) we render the raw string in the input column rather than crashing.
  const parsed = useMemo<{ attrs: FeedbackAttributes | null; parseError: string | null }>(() => {
    if (!row.attributes) return { attrs: null, parseError: null };
    try {
      return { attrs: JSON.parse(row.attributes) as FeedbackAttributes, parseError: null };
    } catch (err) {
      return { attrs: null, parseError: err instanceof Error ? err.message : 'JSON parse failed' };
    }
  }, [row.attributes]);

  // Pull input key order from the agent target config (same order the draft
  // detail page uses). Unknown keys fall through alphabetically.
  const orderedInputKeys = useMemo<string[]>(() => {
    const input = parsed.attrs?.input ?? {};
    const known = new Set(Object.keys(target.inputLabels ?? {}));
    const present = Object.keys(input);
    const ordering = target.inputFieldOrder ?? [];
    const orderSet = new Set(ordering);
    const ordered = ordering.filter((k) => present.includes(k));
    const restKnown = present.filter((k) => !orderSet.has(k) && known.has(k)).sort();
    const restUnknown = present.filter((k) => !known.has(k)).sort();
    return [...ordered, ...restKnown, ...restUnknown];
  }, [parsed.attrs?.input, target.inputLabels, target.inputFieldOrder]);

  const subject = asString(parsed.attrs?.output?.subject);
  const body = asString(parsed.attrs?.output?.body);

  const isPositive = row.isPositive === true;
  const isNegative = row.isPositive === false;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDelete = async () => {
    if (busy) return;
    const yes = window.confirm("Delete this feedback? This can't be undone.");
    if (!yes) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteFeedback(env, row.feedbackId);
      onDeleted(row.feedbackId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setBusy(false);
    }
  };

  const onPromote = async () => {
    if (busy) return;
    if (!row.attributes) {
      setErr("Can't promote — no attributes blob on this entry.");
      return;
    }
    if (!target.memorySpace) {
      setErr('memorySpace is not configured for this agent target.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await ingestFeedbackToMemory(
        env,
        target.memorySpace.memoryId,
        target.memorySpace.memoryName,
        { feedbackId: row.feedbackId, attributes: row.attributes },
      );
      onPromoted(row.feedbackId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Promote failed');
      setBusy(false);
    }
  };

  const agentIdShort = row.agentId ? row.agentId.slice(0, 8) : '—';
  const feedbackIdShort = row.feedbackId.slice(0, 8);

  // Optional deep links. `Orchestrator trace` requires the row's jobKey
  // (every feedback we list has one — but guard anyway). `Memory space`
  // is hidden when no memorySpace is configured. Both reuse the same
  // `.api.` → portal host strip we use elsewhere.
  const orchestratorUrl =
    row.jobKey && target.match.folderId && target.match.orchestratorTenantIdLong
      ? buildJobDetailUrl({
          baseUrl: env.baseUrl,
          orgName: env.orgName,
          tenantName: getActiveTenant(),
          tenantIdLong: target.match.orchestratorTenantIdLong,
          folderId: target.match.folderId,
          jobKey: row.jobKey,
        })
      : null;
  const memoryUrl = target.memorySpace
    ? buildMemorySpaceUrl({
        baseUrl: env.baseUrl,
        orgName: env.orgName,
        memoryId: target.memorySpace.memoryId,
      })
    : null;

  return (
    <div className="space-y-4" data-testid="feedback-review">
      <header className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex items-center gap-3">
            <span
              aria-label={isPositive ? 'Positive' : isNegative ? 'Negative' : 'Unrated'}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xl shrink-0 ${
                isPositive
                  ? 'bg-emerald-100 text-emerald-700'
                  : isNegative
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {isPositive ? '👍' : isNegative ? '👎' : '·'}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                Feedback #{feedbackIdShort}
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-600 mt-0.5 flex-wrap">
                <span title={`agent ${row.agentId ?? '—'}`}>Agent {agentIdShort}…</span>
                {row.agentVersion && <span>v{row.agentVersion}</span>}
                {row.createdAt && <span>{fmtRelative(row.createdAt)}</span>}
                {row.userEmail && (
                  <span className="text-gray-500 truncate">{row.userEmail}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {orchestratorUrl && (
              <a
                href={orchestratorUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-orchestrator-trace"
                title="Open the Orchestrator job trace in a new tab"
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                ↗ Orchestrator trace
              </a>
            )}
            {memoryUrl && (
              <a
                href={memoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-memory-space"
                title={`Browse contents of ${target.memorySpace?.memoryName ?? 'the memory space'}`}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                ↗ Memory space
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Back
            </button>
          </div>
        </div>
      </header>

      {parsed.parseError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          Couldn't parse the feedback's attributes blob: {parsed.parseError}. The agent's input
          and output won't render below.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section
          className="bg-white rounded-lg border border-gray-200"
          data-testid="review-input"
        >
          <header className="px-4 py-2 border-b bg-blue-50/60">
            <h3 className="text-sm font-semibold text-blue-900">Agent input</h3>
          </header>
          <div className="p-4">
            {orderedInputKeys.length === 0 ? (
              <div className="text-sm text-gray-500">No input recorded.</div>
            ) : (
              <dl className="grid grid-cols-1 gap-y-3 text-sm">
                {orderedInputKeys.map((key) => {
                  const label = target.inputLabels?.[key] ?? titleCase(key);
                  return (
                    <div key={key}>
                      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
                      <dd className="text-gray-900 mt-0.5">
                        {renderInputValue(parsed.attrs?.input?.[key])}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </div>
        </section>

        <section
          className="bg-white rounded-lg border border-gray-200"
          data-testid="review-output"
        >
          <header className="px-4 py-2 border-b bg-emerald-50/60">
            <h3 className="text-sm font-semibold text-emerald-900">Agent output</h3>
          </header>
          <div className="p-6">
            {subject && (
              <div className="mb-4 pb-3 border-b border-gray-200">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                  Subject
                </div>
                <div className="text-sm font-semibold text-gray-900">{subject}</div>
              </div>
            )}
            {body ? (
              <article className="prose prose-sm max-w-none font-serif text-gray-900 whitespace-normal leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkBreaks]}>{body}</ReactMarkdown>
              </article>
            ) : (
              <div className="text-sm text-gray-500">No output recorded.</div>
            )}
          </div>
        </section>
      </div>

      <section
        className="bg-white border border-gray-200 rounded-lg shadow-sm"
        data-testid="feedback-comment-card"
      >
        <header className="px-4 py-2 border-b bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-800">Reviewer feedback</h3>
        </header>
        <div className="px-4 py-4 flex items-start gap-3">
          <span
            aria-label={isPositive ? 'Positive' : isNegative ? 'Negative' : 'Unrated'}
            className={`mt-0.5 inline-flex items-center justify-center w-9 h-9 rounded-full text-xl shrink-0 ${
              isPositive
                ? 'bg-emerald-100 text-emerald-700'
                : isNegative
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {isPositive ? '👍' : isNegative ? '👎' : '·'}
          </span>
          <div className="flex-1 min-w-0">
            <div
              className="flex items-center gap-2 text-sm flex-wrap"
              data-testid="reviewer-byline"
            >
              <span className="font-medium text-gray-900 truncate">
                {row.userEmail ?? 'Unknown reviewer'}
              </span>
              <span className="text-xs text-gray-500">
                left {isPositive ? 'positive' : isNegative ? 'negative' : 'unrated'} feedback
              </span>
              {row.createdAt && (
                <span className="text-xs text-gray-400">
                  · {new Date(row.createdAt).toLocaleString()}
                </span>
              )}
            </div>
            {row.comment ? (
              <p className="text-sm text-gray-900 whitespace-pre-wrap mt-2">{row.comment}</p>
            ) : (
              <p className="text-sm text-gray-400 italic mt-2">No comment.</p>
            )}
          </div>
        </div>
      </section>

      <section
        className="bg-white border border-gray-200 rounded-lg shadow-sm"
        data-testid="review-actions"
      >
        <div className="px-4 py-4 flex items-center justify-end gap-2 flex-wrap">
          {err && (
            <span
              className="text-xs text-red-700 mr-auto"
              data-testid="review-error"
            >
              {err}
            </span>
          )}
          <button
            type="button"
            data-testid="delete-feedback"
            onClick={onDelete}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete feedback
          </button>
          <button
            type="button"
            data-testid="promote-to-memory"
            onClick={onPromote}
            disabled={busy || !row.attributes || !target.memorySpace}
            title={
              target.memorySpace
                ? `Promote this feedback into ${target.memorySpace.memoryName}`
                : 'No memory space configured'
            }
            className="text-sm px-4 py-1.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Promoting…' : '+ Promote to Memory'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default FeedbackReviewPanel;
