import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveAgentTarget } from '../config/agentTargets';
import { getActiveTenant } from '../lib/activeTenant';
import {
  deleteFeedback,
  ingestFeedbackToMemory,
  AuthExpiredError,
  type FlattenedFeedbackRow,
  type MemoryEnv,
} from '../lib/memoryFeedback';
import { useMemoryFeedback } from '../hooks/useMemoryFeedback';
import { buildAgentsImUrl } from '../lib/orchestratorLinks';
import { FeedbackReviewPanel } from './FeedbackReviewPanel';

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

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

// Format a Date as the value for an <input type="datetime-local"> (local time, no TZ suffix).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Forward buffer applied to the "To" end of every range. Without it,
 * feedback submitted seconds ago can sit just outside the window and
 * disappear from the triage list — the API filters strictly by
 * `absoluteEndTime` and there's typically a small write-propagation
 * delay between submit and list-visibility.
 */
const END_BUFFER_MS = 5 * 60 * 1000;

function endNowWithBuffer(): Date {
  return new Date(Date.now() + END_BUFFER_MS);
}

interface ShortcutDef {
  label: string;
  ms: number;
}

const RANGE_SHORTCUTS: readonly ShortcutDef[] = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '1d', ms: 24 * 60 * 60 * 1000 },
  { label: '1w', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '1mo', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

type ShortcutLabel = (typeof RANGE_SHORTCUTS)[number]['label'];

const DEFAULT_SHORTCUT: ShortcutLabel = '1d';

export function FeedbackTriagePanel() {
  const target = useActiveAgentTarget();
  const memory = target.memorySpace;

  if (!memory || !target.match.folderKey) {
    return (
      <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Memory space is not configured for this agent target. Add a{' '}
        <code className="font-mono">memorySpace</code> block to{' '}
        <code className="font-mono">src/config/agentTargets.ts</code> to enable triage.
      </div>
    );
  }

  return <ConfiguredTriagePanel />;
}

function ConfiguredTriagePanel() {
  const { sdk, login } = useAuth();
  const navigate = useNavigate();
  const { feedbackId: openFeedbackId } = useParams<{ feedbackId?: string }>();
  const target = useActiveAgentTarget();
  const memory = target.memorySpace!;
  const agentFolderKey = target.match.folderKey!;

  // Default range comes from the DEFAULT_SHORTCUT (last 1 day). The "to" end
  // has a 5-min forward buffer — see END_BUFFER_MS above.
  const defaultMs = useMemo(
    () => RANGE_SHORTCUTS.find((s) => s.label === DEFAULT_SHORTCUT)!.ms,
    [],
  );
  const [startInput, setStartInput] = useState(() =>
    toLocalInput(new Date(Date.now() - defaultMs)),
  );
  const [endInput, setEndInput] = useState(() => toLocalInput(endNowWithBuffer()));
  /**
   * Tracks which preset is "active" so the matching button can render
   * highlighted. Null when the user has typed a custom from/to. Initialized
   * to the default shortcut to match the initial start/end state.
   */
  const [activeShortcut, setActiveShortcut] = useState<ShortcutLabel | null>(DEFAULT_SHORTCUT);
  /**
   * Hide feedbacks that have already been ingested into ANY memory space —
   * they've been triaged. Off-by-default keeps the list focused on the
   * unprocessed queue. Toggle on to see the full history.
   */
  const [showInMemory, setShowInMemory] = useState(false);

  const range = useMemo(
    () => ({ startMs: Date.parse(startInput) || 0, endMs: Date.parse(endInput) || Date.now() }),
    [startInput, endInput],
  );

  const env: MemoryEnv | null = useMemo(() => {
    const token = sdk.getToken();
    if (!token) return null;
    return {
      baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
      orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
      tenantName: getActiveTenant(),
      internalTenantIdGuid: memory.internalTenantIdGuid,
      internalAccountId: memory.internalAccountId,
      agentFolderKey,
      memoryFolderKey: memory.memoryFolderKey,
      agentId: target.agentId,
      token,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, memory.internalTenantIdGuid, memory.internalAccountId, memory.memoryFolderKey, agentFolderKey, target.agentId]);

  const result = useMemoryFeedback(env, range, memory.memoryId);

  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const [rowState, setRowState] = useState<Record<string, { busy?: boolean; err?: string }>>({});

  const filteredRows = useMemo(
    () => (showInMemory ? result.rows : result.rows.filter((r) => !r.inMemory)),
    [result.rows, showInMemory],
  );

  const hiddenInMemoryCount = useMemo(
    () => result.rows.filter((r) => r.inMemory).length,
    [result.rows],
  );

  const sortedRows = useMemo(() => {
    // Newest first by `createdAt`, missing timestamps last.
    const rows = filteredRows.slice();
    rows.sort((a, b) => {
      const ta = Date.parse(asString(a.createdAt) ?? '') || 0;
      const tb = Date.parse(asString(b.createdAt) ?? '') || 0;
      return tb - ta;
    });
    return rows;
  }, [filteredRows]);

  // Newest agentVersion seen across the (unfiltered) results for this
  // target. Drives the Agents IM deep link — that page is per-version, and
  // there's no other surface that exposes the deployed version cheaply.
  const latestAgentVersion = useMemo(() => {
    const sorted = result.rows.slice().sort((a, b) => {
      const ta = Date.parse(asString(a.createdAt) ?? '') || 0;
      const tb = Date.parse(asString(b.createdAt) ?? '') || 0;
      return tb - ta;
    });
    return sorted.find((r) => r.agentVersion)?.agentVersion ?? null;
  }, [result.rows]);

  const agentsImUrl =
    latestAgentVersion &&
    target.match.folderKey &&
    target.match.processKey &&
    target.agentId
      ? buildAgentsImUrl({
          baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
          orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
          folderKey: target.match.folderKey,
          processKey: target.match.processKey,
          agentId: target.agentId,
          version: latestAgentVersion,
          tab: 'feedback',
        })
      : null;

  const handleIngest = async (row: FlattenedFeedbackRow) => {
    if (!env) return;
    if (!row.attributes) {
      setRowState((s) => ({
        ...s,
        [row.feedbackId]: { err: "Can't ingest — no attributes blob on this entry." },
      }));
      return;
    }
    setRowState((s) => ({ ...s, [row.feedbackId]: { busy: true } }));
    try {
      await ingestFeedbackToMemory(env, memory.memoryId, memory.memoryName, {
        feedbackId: row.feedbackId,
        attributes: row.attributes,
      });
      result.removeLocally(row.feedbackId);
      setToast({ kind: 'ok', text: `Added to ${memory.memoryName}` });
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        // Reload the list — it'll 401 and the panel-level "Session expired"
        // banner will appear, replacing the row-level error.
        result.reload();
        return;
      }
      setRowState((s) => ({
        ...s,
        [row.feedbackId]: { err: err instanceof Error ? err.message : 'Ingest failed' },
      }));
    }
  };

  const handleDelete = async (row: FlattenedFeedbackRow) => {
    if (!env) return;
    const yes = window.confirm("Delete this feedback? This can't be undone.");
    if (!yes) return;
    setRowState((s) => ({ ...s, [row.feedbackId]: { busy: true } }));
    try {
      await deleteFeedback(env, row.feedbackId);
      result.removeLocally(row.feedbackId);
      setToast({ kind: 'ok', text: 'Feedback deleted.' });
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        result.reload();
        return;
      }
      setRowState((s) => ({
        ...s,
        [row.feedbackId]: { err: err instanceof Error ? err.message : 'Delete failed' },
      }));
    }
  };

  // Detail-mode lookup. URL param `feedbackId` selects a single row to
  // review in depth. If the row isn't in the loaded list (stale link, time
  // range too narrow, etc.) once loading finishes we redirect back.
  const openRow = useMemo(
    () => (openFeedbackId ? sortedRows.find((r) => r.feedbackId === openFeedbackId) ?? null : null),
    [openFeedbackId, sortedRows],
  );
  useEffect(() => {
    if (openFeedbackId && !result.loading && sortedRows.length > 0 && !openRow) {
      navigate('/feedback-triage', { replace: true });
    }
  }, [openFeedbackId, result.loading, sortedRows.length, openRow, navigate]);

  if (openFeedbackId && openRow && env) {
    return (
      <FeedbackReviewPanel
        row={openRow}
        env={env}
        target={target}
        onClose={() => navigate('/feedback-triage')}
        onDeleted={(id) => {
          result.removeLocally(id);
          navigate('/feedback-triage');
        }}
        onPromoted={(id) => {
          result.removeLocally(id);
          navigate('/feedback-triage');
        }}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="feedback-triage">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-gray-900">Feedback Triage</h2>
            {agentsImUrl && (
              <a
                href={agentsImUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-agents-im"
                title={`Open ${target.match.processName} v${latestAgentVersion} in Agents Instance Management`}
                className="text-sm px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                ↗ Agents IM
              </a>
            )}
          </div>
          <p className="text-sm text-gray-600 max-w-2xl">
            Review LLM Ops feedback for{' '}
            <span className="font-mono text-gray-700">{target.match.processName}</span>. Add
            useful entries to{' '}
            <span className="font-medium text-gray-700">{memory.memoryName}</span>, or delete
            ones that aren't worth keeping.
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-600">Quick range</span>
            <div className="flex gap-1" data-testid="range-shortcuts">
              {RANGE_SHORTCUTS.map((s) => {
                const active = activeShortcut === s.label;
                return (
                  <button
                    key={s.label}
                    type="button"
                    data-testid={`range-shortcut-${s.label}`}
                    data-active={active ? '' : undefined}
                    aria-pressed={active}
                    onClick={() => {
                      const now = Date.now();
                      setEndInput(toLocalInput(new Date(now + END_BUFFER_MS)));
                      setStartInput(toLocalInput(new Date(now - s.ms)));
                      setActiveShortcut(s.label);
                    }}
                    className={`text-xs px-2 py-1 rounded border ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex flex-col text-xs text-gray-600">
            From
            <input
              type="datetime-local"
              value={startInput}
              onChange={(e) => {
                setStartInput(e.target.value);
                setActiveShortcut(null);
              }}
              data-testid="range-from"
              className="text-sm px-2 py-1 border border-gray-300 rounded"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            To
            <input
              type="datetime-local"
              value={endInput}
              onChange={(e) => {
                setEndInput(e.target.value);
                setActiveShortcut(null);
              }}
              data-testid="range-to"
              className="text-sm px-2 py-1 border border-gray-300 rounded"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 self-end pb-1.5">
            <input
              type="checkbox"
              data-testid="show-in-memory"
              checked={showInMemory}
              onChange={(e) => setShowInMemory(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show triaged
            {hiddenInMemoryCount > 0 && !showInMemory && (
              <span className="text-gray-400">({hiddenInMemoryCount} hidden)</span>
            )}
          </label>
          <button
            type="button"
            data-testid="refresh-feedback"
            onClick={result.reload}
            disabled={result.loading}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {result.loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      {toast && (
        <div
          aria-live="polite"
          data-testid="triage-toast"
          className={`text-sm px-3 py-2 rounded border ${
            toast.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {toast.text}
        </div>
      )}

      {result.expired && (
        <div
          className="flex items-center justify-between gap-4 p-3 bg-amber-50 text-amber-900 rounded border border-amber-200"
          data-testid="session-expired"
        >
          <div className="text-sm">
            <span className="font-medium">Session expired.</span> Sign in again to load
            feedback — your data hasn't been lost.
          </div>
          <button
            type="button"
            onClick={() => {
              void login();
            }}
            className="text-sm px-3 py-1.5 rounded bg-amber-600 text-white font-medium hover:bg-amber-700"
          >
            Sign in
          </button>
        </div>
      )}

      {result.error && !result.expired && (
        <div className="text-sm p-3 bg-red-50 text-red-700 rounded border border-red-200">
          {result.error}
        </div>
      )}

      {result.expired ? null : result.loading && sortedRows.length === 0 ? (
        <div className="text-sm text-gray-500">Loading feedback…</div>
      ) : sortedRows.length === 0 ? (
        <div className="text-sm text-gray-500 p-8 text-center bg-white border border-gray-200 rounded">
          No feedback in the selected window. Try widening the date range.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="feedback-list">
          {sortedRows.map((row) => (
            <FeedbackRow
              key={row.feedbackId}
              row={row}
              state={rowState[row.feedbackId] ?? {}}
              onOpen={() => navigate(`/feedback-triage/${row.feedbackId}`)}
              onIngest={() => handleIngest(row)}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackRow({
  row,
  state,
  onOpen,
  onIngest,
  onDelete,
}: {
  row: FlattenedFeedbackRow;
  state: { busy?: boolean; err?: string };
  onOpen: () => void;
  onIngest: () => void;
  onDelete: () => void;
}) {
  const isPositive = row.isPositive === true;
  const isNegative = row.isPositive === false;
  const comment = asString(row.comment);
  const agentLabel = asString(row.agentId) ?? '—';
  const userEmail = asString(row.userEmail);
  const createdAt = asString(row.createdAt);
  const hasAttributes = !!row.attributes;

  return (
    <li
      data-testid="feedback-row"
      data-feedback-id={row.feedbackId}
      data-span-id={row.spanId}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-4 cursor-pointer hover:border-blue-300 hover:shadow transition focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
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
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span className="font-mono truncate" title={`feedback ${row.feedbackId}`}>
            {row.feedbackId.slice(0, 8)}…
          </span>
          <span className="text-gray-700 truncate" title={`agent ${agentLabel}`}>
            agent {agentLabel.slice(0, 8)}…
          </span>
          {row.agentVersion && (
            <span className="text-gray-500">v{row.agentVersion}</span>
          )}
          {userEmail && <span className="text-gray-500 truncate">{userEmail}</span>}
          {createdAt && <span className="text-gray-400">{fmtRelative(createdAt)}</span>}
          {row.inMemory && (
            <span
              data-testid="in-memory-badge"
              className="px-1.5 py-0.5 rounded uppercase tracking-wide text-[10px] bg-emerald-100 text-emerald-800"
            >
              In memory
            </span>
          )}
        </div>
        {comment ? (
          <p
            className="text-sm text-gray-900 mt-1 whitespace-pre-wrap line-clamp-3"
            title={comment}
          >
            {comment}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic mt-1">No comment.</p>
        )}
        {state.err && (
          <p className="text-xs text-red-700 mt-2" data-testid="feedback-row-error">
            {state.err}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          data-testid="add-to-memory"
          onClick={(e) => {
            e.stopPropagation();
            onIngest();
          }}
          disabled={state.busy || !hasAttributes}
          title={hasAttributes ? 'Add to memory' : 'No attributes blob — cannot ingest'}
          className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.busy ? '…' : '+ Memory'}
        </button>
        <button
          type="button"
          data-testid="delete-feedback"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={state.busy}
          className="text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export default FeedbackTriagePanel;
