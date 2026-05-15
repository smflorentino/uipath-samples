import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { EntityRecord } from '@uipath/uipath-typescript/entities';
import { useActiveAgentTarget, type AgentTarget } from '../config/agentTargets';
import { useEntityRecordsCursor } from '../hooks/useEntityRecordsCursor';
import { useLatestDraftsByDisputeIds } from '../hooks/useLatestDraftsByDisputeIds';
import { useFeedbackByTraceIds } from '../hooks/useFeedbackByTraceIds';
import type { FeedbackEntry } from '../hooks/useFeedbackForTrace';
import { DisputeDraftDetail } from './DisputeDraftDetail';

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

const getField = (rec: EntityRecord | null | undefined, key: string): unknown =>
  rec ? (rec as Record<string, unknown>)[key] : undefined;

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

export function DisputeDraftsPanel() {
  const target = useActiveAgentTarget();
  const df = target.dataFabric;

  if (!df) {
    return (
      <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Agent target is missing a `dataFabric` config — cannot list drafts from a Data Fabric entity.
      </div>
    );
  }

  return <DataFabricDraftsPanel target={target} df={df} />;
}

function DataFabricDraftsPanel({
  target,
  df,
}: {
  target: AgentTarget;
  df: NonNullable<AgentTarget['dataFabric']>;
}) {
  const navigate = useNavigate();
  const { disputeId: openDisputeId } = useParams<{ disputeId?: string }>();

  // Disputes are the primary list — one card per dispute, regardless of
  // whether a draft has been generated for it yet. Latest drafts are looked
  // up lazily per visible dispute via a separate hook.
  const disputesResult = useEntityRecordsCursor({
    entityId: df.disputesEntityId,
    pageSize: 100,
  });
  const disputes = disputesResult.records;

  const disputeIds = useMemo(
    () =>
      disputes
        .map((d) => asString(getField(d, 'Id')))
        .filter((id): id is string => !!id),
    [disputes],
  );

  const drafts = useLatestDraftsByDisputeIds(df.draftsEntityId, disputeIds);

  // Build the list of (traceId, folderKey) pairs to bulk-fetch feedback for.
  // Only drafts that have already resolved a traceId qualify — drafts in
  // their "drafting" window have no traceId yet.
  const feedbackInputs = useMemo(() => {
    const out: { traceId: string; folderKey: string | null }[] = [];
    for (const d of disputes) {
      const did = asString(getField(d, 'Id'));
      if (!did) continue;
      const latest = drafts.byDisputeId[did];
      const tid = latest ? asString(getField(latest, 'traceId')) : null;
      if (tid) out.push({ traceId: tid, folderKey: target.match.folderKey ?? null });
    }
    return out;
  }, [disputes, drafts.byDisputeId, target.match.folderKey]);
  const feedback = useFeedbackByTraceIds(feedbackInputs);

  // Open-detail lookup: URL param is the disputeId.
  const openDispute = useMemo(
    () =>
      openDisputeId
        ? disputes.find((d) => asString(getField(d, 'Id')) === openDisputeId) ?? null
        : null,
    [openDisputeId, disputes],
  );
  const openDraft = openDisputeId ? drafts.byDisputeId[openDisputeId] ?? null : null;
  const openTraceId = openDraft ? asString(getField(openDraft, 'traceId')) : null;
  const openFolderKey = target.match.folderKey ?? null;

  // Stale-URL guard. If the URL disputeId doesn't match any dispute on the
  // page (e.g. the dispute was deleted, or the URL was hand-edited), redirect
  // back to the grid once records have loaded.
  useEffect(() => {
    if (
      openDisputeId &&
      !disputesResult.loading &&
      disputes.length > 0 &&
      !openDispute
    ) {
      navigate('/drafts', { replace: true });
    }
  }, [openDisputeId, disputesResult.loading, disputes.length, openDispute, navigate]);

  // Stable identity — consumers (e.g. the detail page's drafting-state poll)
  // use this as a useEffect dep; a fresh function every render would restart
  // the timer every parent re-render.
  const refresh = useCallback(() => {
    disputesResult.reload();
    drafts.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputesResult.reload, drafts.reload]);
  const refreshing = disputesResult.loading || drafts.loading;

  const visibleIndex = openDispute
    ? disputes.findIndex((d) => asString(getField(d, 'Id')) === openDisputeId)
    : -1;

  // When a dispute is open, render only the detail in-flow under the PATH
  // Industries header. Otherwise render the cards grid + pager.
  if (openDispute) {
    return (
      <DisputeDraftDetail
        record={openDraft}
        dispute={openDispute}
        disputeId={openDisputeId!}
        target={target}
        df={df}
        traceId={openTraceId}
        folderKey={openFolderKey}
        onTraceIdResolved={(recordId, traceId) => {
          drafts.patchRecord(recordId, { traceId });
        }}
        onReviewed={
          df.reviewedField
            ? (recordId) =>
                drafts.patchRecord(recordId, { [df.reviewedField!]: true })
            : undefined
        }
        onRefresh={refresh}
        onClose={() => navigate('/drafts')}
        total={visibleIndex >= 0 ? disputes.length : undefined}
        index={visibleIndex >= 0 ? visibleIndex + 1 : undefined}
        onPrev={
          visibleIndex > 0
            ? () => {
                const prev = disputes[visibleIndex - 1];
                const k = asString(getField(prev, 'Id'));
                if (k) navigate(`/drafts/${k}`);
              }
            : undefined
        }
        onNext={
          visibleIndex >= 0 && visibleIndex < disputes.length - 1
            ? () => {
                const next = disputes[visibleIndex + 1];
                const k = asString(getField(next, 'Id'));
                if (k) navigate(`/drafts/${k}`);
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h2 className="text-xl font-semibold text-gray-900">{target.tabLabel}</h2>
            {target.description && (
              <p className="text-sm text-gray-600 max-w-2xl">{target.description}</p>
            )}
            <p className="text-xs text-gray-500">
              Source: Data Fabric · disputes{' '}
              <span className="font-mono">{df.disputesEntityId.slice(0, 8)}…</span>
              {target.match.tenantName && (
                <span className="text-gray-400"> · tenant: {target.match.tenantName}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="refresh-drafts"
            onClick={refresh}
            disabled={refreshing}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            title="Refresh disputes + drafts"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </header>

        {disputesResult.error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">{disputesResult.error}</div>
        )}
        {drafts.error && (
          <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded">
            Couldn't load drafts: {drafts.error}
          </div>
        )}

        {disputesResult.loading && disputes.length === 0 ? (
          <div className="text-sm text-gray-500">Loading disputes…</div>
        ) : disputes.length === 0 ? (
          <div className="text-sm text-gray-500 p-8 text-center bg-white border border-gray-200 rounded">
            No disputes found yet.
          </div>
        ) : (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            data-testid="drafts-grid"
          >
            {disputes.map((d) => {
              const disputeId = asString(getField(d, 'Id')) ?? '';
              const evalName = asString(getField(d, 'evalName'));
              const latest = drafts.byDisputeId[disputeId] ?? null;
              const jobKey = latest ? asString(getField(latest, df.jobKeyField)) : null;
              const traceId = latest ? asString(getField(latest, 'traceId')) : null;
              const entries = (traceId && feedback.byTraceId[traceId]) || [];
              const reviewed = df.reviewedField && latest
                ? !!getField(latest, df.reviewedField)
                : false;
              const body = latest ? asString(getField(latest, df.bodyField)) : null;
              const subject = latest ? asString(getField(latest, df.subjectField)) : null;
              const createdAt =
                latest && df.createdAtField
                  ? asString(getField(latest, df.createdAtField))
                  : null;
              // Three states: no draft yet, drafting (body missing), or final.
              const noDraft = !latest;
              const drafting = !noDraft && !body;
              const badgeClass = noDraft
                ? 'bg-gray-200 text-gray-700'
                : drafting
                  ? 'bg-blue-100 text-blue-800'
                  : reviewed
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800';
              const badgeLabel = noDraft
                ? 'No draft'
                : drafting
                  ? 'Drafting'
                  : reviewed
                    ? 'Reviewed'
                    : 'Pending review';
              return (
                <button
                  key={disputeId}
                  type="button"
                  data-testid="draft-card"
                  data-dispute-id={disputeId}
                  data-record-id={latest ? asString(getField(latest, 'Id')) ?? undefined : undefined}
                  data-job-key={jobKey ?? ''}
                  data-trace-id={traceId ?? ''}
                  data-feedback-count={entries.length}
                  onClick={() => disputeId && navigate(`/drafts/${disputeId}`)}
                  className="text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow transition focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-gray-500 font-mono truncate">
                      Dispute #{disputeId.slice(0, 8)}
                      {evalName && (
                        <span className="text-gray-700" data-testid="card-eval-name">
                          {' · '}
                          {evalName}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}
                    >
                      {badgeLabel}
                    </span>
                  </div>
                  <CardFields df={df} dispute={d} />
                  {subject && (
                    <div className="mt-2 text-xs text-gray-600 line-clamp-2" title={subject}>
                      {subject}
                    </div>
                  )}
                  {createdAt && (
                    <div className="mt-2 text-xs text-gray-500">
                      Drafted {fmtRelative(createdAt)}
                    </div>
                  )}
                  {noDraft && (
                    <div className="mt-2 text-xs text-gray-500 italic">
                      No draft generated yet.
                    </div>
                  )}
                  <FeedbackBadges entries={entries} />
                </button>
              );
            })}
          </div>
        )}

        <footer className="flex items-center justify-between pt-2 text-sm">
          <div className="text-gray-500">Page {disputesResult.pageIndex}</div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="prev-page"
              onClick={disputesResult.prev}
              disabled={!disputesResult.hasPrev || disputesResult.loading}
              className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              data-testid="next-page"
              onClick={disputesResult.next}
              disabled={!disputesResult.hasNext || disputesResult.loading}
              className="px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </footer>
      </div>

      {openDisputeId && !openDispute && disputesResult.loading && (
        <div
          className="text-sm text-gray-600 p-4 bg-gray-50 rounded border border-gray-200"
          data-testid="deep-link-loading"
        >
          Loading disputes…
        </div>
      )}
    </>
  );
}

const TIER_BADGE: Record<string, string> = {
  platinum: 'bg-purple-100 text-purple-800 border-purple-200',
  gold: 'bg-amber-100 text-amber-800 border-amber-200',
  silver: 'bg-slate-200 text-slate-700 border-slate-300',
  standard: 'bg-gray-100 text-gray-600 border-gray-200',
};

const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const stringifyFlags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === 'none') return [];
    return trimmed
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

function CardFields({
  df,
  dispute,
}: {
  df: NonNullable<AgentTarget['dataFabric']>;
  dispute: EntityRecord;
}) {
  const fields = df.cardFields;
  if (!fields) return null;
  const d = dispute as Record<string, unknown>;
  const primary =
    fields.primary && typeof d[fields.primary] === 'string'
      ? (d[fields.primary] as string)
      : null;

  return (
    <div className="mt-2 space-y-2" data-testid="card-fields">
      {primary && (
        <div className="text-base font-semibold text-gray-900 truncate" title={primary}>
          {primary}
        </div>
      )}
      {fields.badges && fields.badges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {fields.badges.flatMap((key) => {
            const v = d[key];
            if (key.toLowerCase().includes('flag') || (typeof v === 'string' && /[,\n]/.test(v))) {
              return stringifyFlags(v).map((flag) => (
                <span
                  key={`${key}:${flag}`}
                  className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 text-blue-800 border-blue-200"
                  title={df.disputeLabels[key] ?? titleCase(key)}
                >
                  {titleCase(flag)}
                </span>
              ));
            }
            if (typeof v === 'string') {
              const lower = v.toLowerCase();
              const tierClass = TIER_BADGE[lower];
              if (tierClass) {
                return [
                  <span
                    key={`${key}:${v}`}
                    className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${tierClass}`}
                    title={df.disputeLabels[key] ?? titleCase(key)}
                  >
                    {v}
                  </span>,
                ];
              }
              return [
                <span
                  key={`${key}:${v}`}
                  className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-700 border-gray-200"
                  title={df.disputeLabels[key] ?? titleCase(key)}
                >
                  {v}
                </span>,
              ];
            }
            return [];
          })}
        </div>
      )}
    </div>
  );
}

function FeedbackBadges({ entries }: { entries: FeedbackEntry[] }) {
  if (entries.length === 0) return null;
  const positive = entries.filter((e) => e.isPositive).length;
  const negative = entries.length - positive;
  return (
    <div className="mt-3 flex items-center gap-2" data-testid="card-feedback-badges">
      {positive > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200"
          title={`${positive} positive feedback${positive > 1 ? 's' : ''}`}
          data-testid="badge-positive"
        >
          <span aria-hidden>👍</span>
          {positive > 1 && <span className="tabular-nums">{positive}</span>}
        </span>
      )}
      {negative > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200"
          title={`${negative} negative feedback${negative > 1 ? 's' : ''}`}
          data-testid="badge-negative"
        >
          <span aria-hidden>👎</span>
          {negative > 1 && <span className="tabular-nums">{negative}</span>}
        </span>
      )}
    </div>
  );
}

export default DisputeDraftsPanel;
