import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { Entities, type EntityRecord } from '@uipath/uipath-typescript/entities';
import { useAuth } from '../hooks/useAuth';
import type { AgentTarget } from '../config/agentTargets';
import { fetchSpans } from '../lib/traceFetch';
import { findRootAgentRunSpanId } from '../lib/agentRunSpan';
import { submitFeedback } from '../lib/feedback';
import {
  pollListForFeedbackThenIngest,
  type MemoryEnv,
} from '../lib/memoryFeedback';
import { getActiveTenant } from '../lib/activeTenant';
import { resolveTraceForJob, type ResolvedTrace } from '../lib/traceResolver';
import { rerunDrafter } from '../lib/rerunDrafter';
import { buildJobDetailUrl } from '../lib/orchestratorLinks';
import { useFeedbackForTrace } from '../hooks/useFeedbackForTrace';

export interface DisputeDraftDetailProps {
  /**
   * Latest DRD row for this dispute, or `null` when no draft has been
   * generated yet. When null the detail page shows a "No draft yet" state
   * with a Generate-draft button (same wiring as Re-run).
   */
  record: EntityRecord | null;
  /** The dispute itself. Always present — the URL is keyed by disputeId. */
  dispute: EntityRecord;
  /** Disputed Id — same as `dispute.Id`, passed explicitly for clarity. */
  disputeId: string;
  target: AgentTarget;
  df: NonNullable<AgentTarget['dataFabric']>;
  /**
   * traceId stored on the entity row, if present. When missing, the detail
   * view runs the chain (`row.jobKey → Jobs → traceId`) once on open and
   * writes the result back to the row via Data Fabric.
   */
  traceId: string | null;
  /** Default folderKey from the agent target. The chain may discover a more accurate value. */
  folderKey: string | null;
  /**
   * Called once we resolve a traceId for a row that didn't have one. The
   * panel uses this to patch the row in-memory so subsequent renders read
   * the new traceId straight from the entity (no chain re-run).
   */
  onTraceIdResolved?: (recordId: string, traceId: string) => void;
  /**
   * Called after a successful feedback submit so the parent can flip the row's
   * `isReviewed` flag in-memory (same shape as `onTraceIdResolved`). The
   * server-side write happens inside this component; the callback just
   * propagates the new value to the cards grid for instant badge updates.
   */
  onReviewed?: (recordId: string) => void;
  /**
   * Re-fetches the parent panel's disputes + drafts so this detail receives
   * fresh `record` and `dispute` props without a full browser reload. Used
   * by the "Refresh" links in the drafting placeholder and the auto-refresh
   * after Re-run agent.
   */
  onRefresh?: () => void;
  onClose: () => void;
  total?: number;
  index?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

const STATE_BADGES = {
  noDraft: { label: 'No draft', className: 'bg-gray-200 text-gray-700' },
  drafting: { label: 'Drafting', className: 'bg-blue-100 text-blue-800' },
  reviewed: { label: 'Reviewed', className: 'bg-emerald-100 text-emerald-800' },
  pending: { label: 'Pending review', className: 'bg-amber-100 text-amber-800' },
};

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

const getField = (rec: EntityRecord | null, key: string): unknown =>
  rec ? (rec as Record<string, unknown>)[key] : undefined;

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

function renderDisputeValue(v: unknown): React.ReactNode {
  if (v == null || v === '') return <span className="text-gray-400">—</span>;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function DisputeDraftDetail({
  record,
  dispute,
  disputeId,
  target,
  df,
  traceId: traceIdProp,
  folderKey: folderKeyProp,
  onTraceIdResolved,
  onReviewed,
  onRefresh,
  onClose,
  total,
  index,
  onPrev,
  onNext,
}: DisputeDraftDetailProps) {
  const { sdk } = useAuth();

  const [rating, setRating] = useState<'positive' | 'negative' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const recordId = asString(getField(record, 'Id')) ?? '';
  const jobKey = asString(getField(record, df.jobKeyField)) ?? '';
  const evalName = asString(getField(dispute, 'evalName'));
  const body = asString(getField(record, df.bodyField));
  const subject = asString(getField(record, df.subjectField));
  // Three states:
  //   noDraft  → no DRD row exists for this dispute yet
  //   drafting → row exists but no body yet (pre-jobKey or RPA still running)
  //   final    → body present, ready for review
  const noDraft = !record;
  const drafting = !noDraft && !body;

  const [rerunning, setRerunning] = useState(false);
  const [rerunMsg, setRerunMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Always resolve job metadata on detail open. Even when row.traceId is
  // already populated we still need `agentVersion` (which comes off the job
  // and has no entity column), so the chain runs unconditionally per open.
  //
  // The resolved set is stored as a SINGLE atomic value so traceId +
  // agentVersion update together. Earlier code split them into three
  // useState slots, reset them whenever `traceIdProp` changed, and the
  // resolver itself triggered a `traceIdProp` change via writeback — which
  // wiped `resolvedAgentVersion` immediately after it was set, opening a
  // ~render-tick window where Submit was enabled with an empty version.
  //
  // The reset is keyed only on `recordId` — the stable identity of the open
  // draft. Switching disputes (new recordId) clears the resolved state so
  // dispute A's metadata can't leak into dispute B's submit.
  const [resolvedJob, setResolvedJob] = useState<ResolvedTrace | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const writebackAttempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    setResolvedJob(null);
    setResolveError(null);
  }, [recordId]);

  useEffect(() => {
    // Skip the trace + feedback chain while the agent is still drafting —
    // the trace may not exist yet, and submitting feedback on an in-flight
    // draft is not meaningful. Re-fires once `body` is populated.
    if (!jobKey || !recordId || !body) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      setResolveError(null);
      try {
        const r = await resolveTraceForJob(sdk, jobKey, target.match.folderId ?? null);
        if (cancelled) return;
        if (!r) {
          setResolveError(
            'Could not resolve job metadata for this draft. The signed-in user likely lacks read access to the agent\'s Orchestrator folder.',
          );
          return;
        }
        setResolvedJob(r);

        // Best-effort writeback of the traceId on the first resolve per
        // record, so the cards grid can show feedback badges without
        // re-running the chain. `agentVersion` lives on the job itself —
        // we don't duplicate it onto the DF row.
        const rowHadTraceId = !!traceIdProp;
        if (!rowHadTraceId && !writebackAttempted.current.has(recordId)) {
          writebackAttempted.current.add(recordId);
          try {
            const entities = new Entities(sdk);
            await entities.updateRecordById(df.draftsEntityId, recordId, {
              traceId: r.traceId,
            });
            onTraceIdResolved?.(recordId, r.traceId);
          } catch (err) {
            setResolveError(
              err instanceof Error
                ? `Resolved traceId but couldn't persist it: ${err.message}`
                : 'Resolved traceId but couldn\'t persist it.',
            );
          }
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, jobKey, body, sdk, target.match.folderId, df.draftsEntityId]);

  // Two views of the resolved data:
  //   - READ side ("Previous feedback" list): falls back to the row's
  //     persisted `traceIdProp` so the list paints fast on second-and-later
  //     opens without waiting for the resolver round-trip.
  //   - SUBMIT side: only the fully-resolved set counts. Both `traceId`
  //     AND `agentVersion` must be present, or the button stays disabled.
  const traceIdForRead = resolvedJob?.traceId ?? traceIdProp;
  const folderKey =
    resolvedJob?.folderKey ?? folderKeyProp ?? target.match.folderKey ?? null;
  const traceId = resolvedJob?.traceId ?? null;
  const agentVersion = resolvedJob?.agentVersion ?? null;
  const submitReady = !!traceId && !!agentVersion;

  // Reset feedback form whenever the open record changes.
  useEffect(() => {
    setRating(null);
    setComment('');
    setSubmitting(false);
    setSubmitMsg(null);
    setSubmitted(false);
    setRerunning(false);
    setRerunMsg(null);
  }, [recordId]);

  // Auto-poll for the agent's body output while the draft is still in
  // progress. 1-second cadence, 60-second cap. Stops the moment `drafting`
  // flips false (the body arrives → parent prop change → re-render → effect
  // cleanup) or the user navigates away (component unmounts → cleanup). The
  // user can still trigger an immediate refresh via the "refresh" link in
  // the placeholder.
  useEffect(() => {
    if (!drafting || !onRefresh) return;
    const startedAt = Date.now();
    const MAX_POLL_MS = 60_000;
    const POLL_INTERVAL_MS = 1_000;
    const id = setInterval(() => {
      if (Date.now() - startedAt >= MAX_POLL_MS) {
        clearInterval(id);
        return;
      }
      onRefresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [drafting, onRefresh]);

  const orchestratorUrl = useMemo(() => {
    if (!jobKey || !target.match.folderId || !target.match.orchestratorTenantIdLong) return null;
    return buildJobDetailUrl({
      baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
      orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
      tenantName: getActiveTenant(),
      tenantIdLong: target.match.orchestratorTenantIdLong,
      folderId: target.match.folderId,
      jobKey,
    });
  }, [jobKey, target.match.folderId, target.match.orchestratorTenantIdLong]);

  const onRerun = async () => {
    if (!target.match.rpaProcessName || !target.match.folderId || !disputeId || rerunning) return;
    setRerunning(true);
    setRerunMsg(null);
    try {
      const { jobKey: newKey, draftRecordId } = await rerunDrafter({
        sdk,
        processName: target.match.rpaProcessName,
        folderId: target.match.folderId,
        disputeId,
        draftsEntityId: df.draftsEntityId,
        disputeIdField: df.disputeIdField,
      });
      setRerunMsg({
        kind: 'ok',
        text: `New draft queued — record ${draftRecordId.slice(0, 8)}…, job ${newKey.slice(0, 8)}…  Loading…`,
      });
      // Refresh the parent panel's data so the new (drafting) row shows up
      // in this same dispute's detail. Brief delay so the user reads the
      // status before the in-page swap; falls back to a full window reload
      // when no callback is wired (defensive — shouldn't happen in normal
      // mounting).
      setTimeout(() => {
        if (onRefresh) onRefresh();
        else window.location.reload();
      }, 800);
    } catch (err) {
      setRerunMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Re-run failed' });
    } finally {
      setRerunning(false);
    }
  };

  const existingFeedback = useFeedbackForTrace(traceIdForRead, folderKey);

  const orderedDisputeKeys = useMemo<string[]>(() => {
    const known = new Set(Object.keys(df.disputeLabels));
    const present = Object.keys(dispute).filter((k) => known.has(k));
    const order = df.disputeFieldOrder ?? [];
    const orderSet = new Set(order);
    const ordered = order.filter((k) => present.includes(k));
    const rest = present.filter((k) => !orderSet.has(k)).sort();
    return [...ordered, ...rest];
  }, [dispute, df.disputeLabels, df.disputeFieldOrder]);

  const reviewed = df.reviewedField ? !!getField(record, df.reviewedField) : false;
  const createdAt = df.createdAtField ? asString(getField(record, df.createdAtField)) : null;

  const status = noDraft
    ? STATE_BADGES.noDraft
    : drafting
      ? STATE_BADGES.drafting
      : reviewed
        ? STATE_BADGES.reviewed
        : STATE_BADGES.pending;

  const onSubmit = async (promote = false) => {
    if (!rating) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const token = sdk.getToken();
      if (!token) throw new Error('No access token');
      if (!traceId) throw new Error('Job has no traceId — cannot submit feedback');

      // Promote requires memorySpace + agentFolderKey for the ingest call.
      const memory = target.memorySpace;
      if (promote && !memory) {
        throw new Error('Memory space is not configured for this agent target.');
      }

      // Lazy span lookup at submit time, to find the root agentRun spanId.
      const spans = await fetchSpans(traceId, {
        baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
        orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
        tenantName: getActiveTenant(),
        token,
      });
      const spanId = findRootAgentRunSpanId(spans);
      if (!spanId) throw new Error('Could not find an agentRun span for this trace');

      const fk = folderKey ?? target.match.folderKey ?? '';
      if (!fk) throw new Error('Missing folderKey for feedback');

      if (!agentVersion) {
        throw new Error(
          "Agent version unknown for this job — can't submit feedback. Refresh once Jobs.getById resolves.",
        );
      }

      const response = await submitFeedback(
        {
          baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
          orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
          tenantName: getActiveTenant(),
          token,
        },
        {
          traceId,
          spanId,
          agentId: target.agentId,
          agentVersion,
          spanType: 'agentRun',
          comment: comment.trim(),
          isPositive: rating === 'positive',
          categories: [],
          folderKey: fk,
        },
      );

      // Mark the DRD row as reviewed once feedback lands. Swallow errors here
      // because the feedback POST already succeeded — the user shouldn't see
      // a failure message for a secondary writeback. Worst case the badge
      // stays "Pending review" until the next refresh.
      if (df.reviewedField && recordId) {
        try {
          const entities = new Entities(sdk);
          await entities.updateRecordById(df.draftsEntityId, recordId, {
            [df.reviewedField]: true,
          });
          onReviewed?.(recordId);
        } catch {
          // intentionally swallowed
        }
      }

      setSubmitMsg({ kind: 'ok', text: 'Feedback recorded.' });
      setSubmitted(true);
      existingFeedback.reload();

      // Second leg — promote to memory. Build the same MemoryEnv shape the
      // Feedback Triage page uses; the helper polls the list endpoint for
      // up to 5s waiting for the new feedback to surface (write-propagation
      // lag can mean it's not immediately visible).
      if (promote && memory && response.id) {
        setSubmitMsg({ kind: 'ok', text: 'Feedback recorded. Promoting to memory…' });
        try {
          const memoryEnv: MemoryEnv = {
            baseUrl: import.meta.env.VITE_UIPATH_BASE_URL,
            orgName: import.meta.env.VITE_UIPATH_ORG_NAME,
            tenantName: getActiveTenant(),
            internalTenantIdGuid: memory.internalTenantIdGuid,
            internalAccountId: memory.internalAccountId,
            agentFolderKey: fk,
            memoryFolderKey: memory.memoryFolderKey,
            agentId: target.agentId,
            token,
          };
          await pollListForFeedbackThenIngest(
            memoryEnv,
            memory.memoryId,
            memory.memoryName,
            response.id,
          );
          setSubmitMsg({
            kind: 'ok',
            text: `Feedback recorded and promoted to ${memory.memoryName}.`,
          });
        } catch (err) {
          // Submit succeeded but promote didn't — surface a non-blocking
          // warning rather than overwriting the "feedback recorded" success.
          setSubmitMsg({
            kind: 'err',
            text:
              'Saved feedback but couldn\'t promote to memory — try from Feedback Triage. ' +
              (err instanceof Error ? err.message : String(err)),
          });
        }
      }
    } catch (err) {
      setSubmitMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Submit failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="dispute-draft-detail">
      <header className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            {typeof index === 'number' && typeof total === 'number' && total > 1 && (
              <div className="flex items-center gap-1" data-testid="draft-carousel">
                <button
                  type="button"
                  data-testid="carousel-prev"
                  onClick={onPrev}
                  disabled={!onPrev || index <= 1}
                  aria-label="Previous draft"
                  className="w-8 h-8 rounded border border-gray-300 text-gray-700 text-base hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                <span className="text-xs text-gray-600 px-2 tabular-nums">
                  {index} of {total}
                </span>
                <button
                  type="button"
                  data-testid="carousel-next"
                  onClick={onNext}
                  disabled={!onNext || index >= total}
                  aria-label="Next draft"
                  className="w-8 h-8 rounded border border-gray-300 text-gray-700 text-base hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                Dispute #{disputeId.slice(0, 8)}
                {evalName && (
                  <span className="text-gray-600 font-normal" data-testid="detail-eval-name">
                    {' · '}
                    {evalName}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-600 mt-0.5">
                <span className={`px-1.5 py-0.5 rounded ${status.className}`}>{status.label}</span>
                {noDraft ? (
                  <span className="text-gray-500">No draft generated yet</span>
                ) : (
                  <span>Drafted {fmtRelative(createdAt)}</span>
                )}
                {jobKey && (
                  <span className="font-mono text-gray-400" title={`Job ${jobKey}`}>
                    Job {jobKey.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="rerun-agent"
              onClick={onRerun}
              disabled={
                !target.match.rpaProcessName ||
                !target.match.folderId ||
                !disputeId ||
                rerunning
              }
              title={
                target.match.rpaProcessName
                  ? `${noDraft ? 'Generate' : 'Re-run'} ${target.match.rpaProcessName} for this dispute`
                  : 'No rpaProcessName configured'
              }
              className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rerunning
                ? noDraft
                  ? 'Generating…'
                  : 'Re-running…'
                : noDraft
                  ? 'Generate draft'
                  : 'Re-run agent'}
            </button>
            {orchestratorUrl ? (
              <a
                href={orchestratorUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-in-orchestrator"
                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                ↗ Orchestrator
              </a>
            ) : (
              <span
                data-testid="open-in-orchestrator"
                className="text-sm px-3 py-1.5 rounded border border-gray-200 text-gray-300 cursor-not-allowed"
              >
                ↗ Orchestrator
              </span>
            )}
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Back
            </button>
          </div>
        </div>
        {rerunMsg && (
          <div className="px-4 pb-2">
            <div
              data-testid="rerun-status"
              className={`text-xs ${rerunMsg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {rerunMsg.text}
            </div>
          </div>
        )}
      </header>

      <div className="space-y-6">
          {resolving && !traceIdForRead && (
            <section
              className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500"
              data-testid="trace-resolving"
            >
              Resolving trace for this draft…
            </section>
          )}
          {!resolving && !traceIdForRead && resolveError && (
            <section
              className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900"
              data-testid="trace-resolve-error"
            >
              {resolveError}
            </section>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-6">
              <section
                className="bg-white rounded-lg border border-gray-200"
                data-testid="draft-input"
              >
                <header className="px-4 py-2 border-b bg-blue-50/60">
                  <h3 className="text-sm font-semibold text-blue-900">Dispute details</h3>
                </header>
                <div className="p-4">
                  {orderedDisputeKeys.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No dispute details found.
                    </div>
                  ) : (
                    <dl className="grid grid-cols-1 gap-y-3 text-sm">
                      {orderedDisputeKeys.map((key) => {
                        const label = df.disputeLabels[key] ?? titleCase(key);
                        return (
                          <div key={key}>
                            <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
                            <dd className="text-gray-900 mt-0.5">
                              {renderDisputeValue((dispute as Record<string, unknown>)[key])}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                </div>
              </section>
              {traceId && <ExistingFeedbackList feedback={existingFeedback} />}
            </div>

            <section
              className="bg-white rounded-lg border border-gray-200"
              data-testid="draft-output"
            >
              <header className="px-4 py-2 border-b bg-emerald-50/60">
                <h3 className="text-sm font-semibold text-emerald-900">Drafted letter</h3>
              </header>
              <div className="p-6">
                {noDraft ? (
                  <div
                    className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-4 space-y-2"
                    data-testid="no-draft-placeholder"
                  >
                    <div className="font-medium">No draft generated yet</div>
                    <div className="text-xs text-gray-600">
                      Click <span className="font-medium">Generate draft</span> in the
                      header to kick off the resolution drafter for this dispute.
                    </div>
                  </div>
                ) : drafting ? (
                  <div
                    className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-4 flex items-start gap-3"
                    data-testid="drafting-placeholder"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0"
                    />
                    <div className="space-y-2">
                      <div className="font-medium">Letter generation in progress</div>
                      {orchestratorUrl ? (
                        <div className="text-xs">
                          The agent is still writing the letter. You can{' '}
                          <a
                            href={orchestratorUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="drafting-orchestrator-link"
                            className="underline hover:text-blue-900"
                          >
                            open the job in Orchestrator
                          </a>{' '}
                          to check progress, or{' '}
                          <button
                            type="button"
                            onClick={() => (onRefresh ? onRefresh() : window.location.reload())}
                            data-testid="drafting-refresh-link"
                            className="underline hover:text-blue-900 cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit"
                          >
                            refresh
                          </button>{' '}
                          once it's done.
                        </div>
                      ) : (
                        <div className="text-xs">
                          The drafter job hasn't been queued yet.{' '}
                          <button
                            type="button"
                            onClick={() => (onRefresh ? onRefresh() : window.location.reload())}
                            data-testid="drafting-refresh-link"
                            className="underline hover:text-blue-900 cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit"
                          >
                            Refresh
                          </button>{' '}
                          once it has.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
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
                      <div className="text-sm text-gray-500">No letter recorded.</div>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
      </div>

      {!drafting && !noDraft && (
      <footer
        className="bg-white border border-gray-200 rounded-lg shadow-sm"
        data-testid="feedback-bar"
      >
        <div className="px-4 py-4">
          <div className="flex items-start gap-4">
            <textarea
              data-testid="feedback-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                submitReady
                  ? 'Add a comment (optional)…'
                  : resolving
                    ? 'Resolving trace and agent version…'
                    : 'Feedback unavailable — couldn\'t resolve agent metadata for this job.'
              }
              rows={2}
              disabled={submitting || submitted || !submitReady}
              className="flex-1 p-2 border border-gray-300 rounded text-sm disabled:bg-gray-50"
            />
            <div className="flex flex-col gap-2 pt-1 min-w-[160px]">
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  aria-label="Thumbs up"
                  data-testid="thumb-up"
                  onClick={() => setRating('positive')}
                  disabled={submitting || submitted || !submitReady}
                  className={`text-xl w-10 h-10 rounded-full border ${
                    rating === 'positive'
                      ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                      : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  👍
                </button>
                <button
                  type="button"
                  aria-label="Thumbs down"
                  data-testid="thumb-down"
                  onClick={() => setRating('negative')}
                  disabled={submitting || submitted || !submitReady}
                  className={`text-xl w-10 h-10 rounded-full border ${
                    rating === 'negative'
                      ? 'bg-red-100 border-red-400 text-red-700'
                      : 'border-gray-300 text-gray-500 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  👎
                </button>
              </div>
              <button
                type="button"
                onClick={() => onSubmit(false)}
                disabled={!rating || submitting || submitted || !submitReady}
                data-testid="submit-feedback"
                className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : submitted ? 'Submitted' : 'Submit feedback'}
              </button>
              <button
                type="button"
                onClick={() => onSubmit(true)}
                disabled={
                  !rating ||
                  submitting ||
                  submitted ||
                  !submitReady ||
                  !target.memorySpace
                }
                data-testid="submit-and-promote"
                title={
                  target.memorySpace
                    ? `Submit feedback and promote it into ${target.memorySpace.memoryName}`
                    : 'No memory space configured for this target'
                }
                className="px-4 py-2 rounded border border-emerald-300 text-emerald-800 bg-emerald-50 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Working…' : submitted ? 'Submitted' : '+ Submit & Add to Memory'}
              </button>
              {submitMsg && (
                <div
                  className={`text-xs ${submitMsg.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}
                  data-testid="feedback-status"
                >
                  {submitMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
      )}
    </div>
  );
}

function ExistingFeedbackList({
  feedback,
}: {
  feedback: ReturnType<typeof useFeedbackForTrace>;
}) {
  if (feedback.loading && feedback.entries.length === 0) {
    return (
      <section
        className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500"
        data-testid="existing-feedback"
      >
        Loading existing feedback…
      </section>
    );
  }
  if (feedback.error) {
    return (
      <section
        className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-red-700"
        data-testid="existing-feedback"
      >
        Couldn't load existing feedback: {feedback.error}
      </section>
    );
  }
  if (feedback.entries.length === 0) {
    return (
      <section
        className="bg-white rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500"
        data-testid="existing-feedback"
      >
        No feedback recorded yet.
      </section>
    );
  }
  return (
    <section
      className="bg-white rounded-lg border border-gray-200"
      data-testid="existing-feedback"
    >
      <header className="px-4 py-2 border-b bg-gray-50/60 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          Previous feedback
          <span className="ml-2 text-xs text-gray-500 font-normal">
            ({feedback.entries.length})
          </span>
        </h3>
      </header>
      <ul className="divide-y divide-gray-100">
        {feedback.entries.map((e) => (
          <li
            key={e.id}
            className="px-4 py-3 flex items-start gap-3"
            data-testid="existing-feedback-row"
          >
            <span
              className={`mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full text-base ${
                e.isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}
              aria-label={e.isPositive ? 'Positive' : 'Negative'}
            >
              {e.isPositive ? '👍' : '👎'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500">
                {e.userEmail ?? 'Unknown user'}
                {e.createdAt && <span> · {new Date(e.createdAt).toLocaleString()}</span>}
              </div>
              {e.comment ? (
                <p className="text-sm text-gray-900 whitespace-pre-wrap mt-0.5">{e.comment}</p>
              ) : (
                <p className="text-sm text-gray-400 italic mt-0.5">No comment</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DisputeDraftDetail;
