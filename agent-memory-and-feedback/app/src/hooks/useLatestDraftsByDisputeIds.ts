import { useCallback, useEffect, useMemo, useState } from 'react';
import { Entities, QueryFilterOperator } from '@uipath/uipath-typescript/entities';
import type { EntityRecord } from '@uipath/uipath-typescript/entities';
import { useAuth } from './useAuth';

export interface UseLatestDraftsResult {
  /** Map disputeId → latest DRD row for that dispute, or undefined when none exists yet. */
  byDisputeId: Record<string, EntityRecord | undefined>;
  loading: boolean;
  error: string | null;
  /** Re-fetches the drafts for the current set of disputeIds. */
  reload: () => void;
  /** Locally patches a draft row by its `Id`, mirroring useEntityRecordsCursor.patchRecord. */
  patchRecord: (recordId: string, partial: Record<string, unknown>) => void;
}

/**
 * Batched lookup: given a set of disputeIds, returns the most recent draft
 * (by `CreateTime`) per disputeId. One round-trip to the drafts entity using
 * `disputeId IN (…)` + `sortOptions: [CreateTime DESC]`; the first-seen row
 * per disputeId is the winner since results arrive newest-first.
 *
 * Used by the disputes-primary cards grid to render one card per dispute
 * with its current draft state (or "no draft yet").
 */
export function useLatestDraftsByDisputeIds(
  draftsEntityId: string,
  disputeIds: readonly string[],
): UseLatestDraftsResult {
  const { sdk } = useAuth();
  const entities = useMemo(() => new Entities(sdk), [sdk]);

  // Stable key for the disputeIds set — sorted+joined so reordering doesn't
  // trigger a refetch.
  const idsKey = useMemo(() => [...disputeIds].sort().join(','), [disputeIds]);

  const [byDisputeId, setByDisputeId] = useState<Record<string, EntityRecord | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (idsKey === '') {
      setByDisputeId({});
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await entities.queryRecordsById(draftsEntityId, {
          filterGroup: {
            queryFilters: [
              {
                fieldName: 'disputeId',
                operator: QueryFilterOperator.In,
                valueList: idsKey.split(','),
              },
            ],
          },
          sortOptions: [{ fieldName: 'CreateTime', isDescending: true }],
          // Generous: 10 disputes × up to ~20 drafts each fits well under this.
          // Swap to per-dispute grouping (df records query --groupBy) if it grows.
          pageSize: 200,
        });
        if (cancelled) return;
        const map: Record<string, EntityRecord> = {};
        for (const rec of result.items) {
          const did = (rec as Record<string, unknown>).disputeId;
          if (typeof did === 'string' && did.length > 0 && !(did in map)) {
            map[did] = rec;
          }
        }
        setByDisputeId(map);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to fetch drafts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entities, draftsEntityId, idsKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const patchRecord = useCallback(
    (recordId: string, partial: Record<string, unknown>) => {
      setByDisputeId((prev) => {
        let changed = false;
        const next: Record<string, EntityRecord | undefined> = {};
        for (const [did, rec] of Object.entries(prev)) {
          if (rec && (rec as Record<string, unknown>).Id === recordId) {
            next[did] = { ...rec, ...partial } as EntityRecord;
            changed = true;
          } else {
            next[did] = rec;
          }
        }
        return changed ? next : prev;
      });
    },
    [],
  );

  return { byDisputeId, loading, error, reload, patchRecord };
}
