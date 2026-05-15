import { useCallback, useEffect, useMemo, useState } from 'react';
import { Entities } from '@uipath/uipath-typescript/entities';
import type { EntityRecord } from '@uipath/uipath-typescript/entities';
import type { PaginationCursor } from '@uipath/uipath-typescript/core';
import { useAuth } from './useAuth';
import {
  advanceState,
  rewindState,
  ingestCursor,
  initialPageState,
  type PageState,
} from './useAgentRunsCursor';

export interface UseEntityRecordsCursorOptions {
  entityId: string;
  pageSize?: number;
}

export interface UseEntityRecordsCursorResult {
  records: EntityRecord[];
  pageIndex: number;
  hasNext: boolean;
  hasPrev: boolean;
  loading: boolean;
  error: string | null;
  next: () => void;
  prev: () => void;
  reload: () => void;
  /**
   * Locally merge a partial update into the row whose primary `Id` matches.
   * Used after a write-back to Data Fabric so the UI reflects the change
   * without re-fetching the whole page.
   */
  patchRecord: (recordId: string, partial: Record<string, unknown>) => void;
}

/**
 * Cursor-paginated list of Data Fabric entity records. Mirrors
 * `useAgentRunsCursor` but goes through the `Entities.getAllRecords` SDK call.
 * Shares the cursor reducer (`advanceState`, `rewindState`, `ingestCursor`).
 */
export function useEntityRecordsCursor(
  options: UseEntityRecordsCursorOptions,
): UseEntityRecordsCursorResult {
  const { sdk } = useAuth();
  const entitiesService = useMemo(() => new Entities(sdk), [sdk]);
  const { entityId, pageSize = 12 } = options;

  const [state, setState] = useState<PageState>(initialPageState);
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setState(initialPageState);
    setRecords([]);
    setError(null);
  }, [entityId, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cursor = state.cursors[state.pageIndex - 1];
        // Use queryRecordsById (POST /query) instead of getAllRecords (GET /read)
        // so we can sort by CreateTime DESC server-side. Without this, /read
        // returns rows in insertion order (oldest first) and `latestPerDispute`
        // on the cards grid would dedup against a stale page-1 view once the
        // genuinely-newest row falls off the page.
        const req: Record<string, unknown> = {
          pageSize,
          sortOptions: [{ fieldName: 'CreateTime', isDescending: true }],
        };
        if (cursor) req.cursor = cursor;
        const result = await entitiesService.queryRecordsById(entityId, req);
        if (cancelled) return;
        const paged = result as typeof result & {
          hasNextPage?: boolean;
          nextCursor?: PaginationCursor;
        };
        const nextCursor = paged.nextCursor;
        const hasNextPage = !!paged.hasNextPage && !!nextCursor;
        setRecords(result.items);
        setState((prev) => ingestCursor(prev, nextCursor, hasNextPage));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load records');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitiesService, entityId, pageSize, state.pageIndex, reloadKey]);

  const next = useCallback(() => setState(advanceState), []);
  const prev = useCallback(() => setState(rewindState), []);
  const reload = useCallback(() => {
    setState(initialPageState);
    setReloadKey((k) => k + 1);
  }, []);
  const patchRecord = useCallback((recordId: string, partial: Record<string, unknown>) => {
    setRecords((prev) =>
      prev.map((r) =>
        (r as Record<string, unknown>).Id === recordId
          ? ({ ...r, ...partial } as EntityRecord)
          : r,
      ),
    );
  }, []);

  return {
    records,
    pageIndex: state.pageIndex,
    hasNext: state.hasNext,
    hasPrev: state.pageIndex > 1,
    loading,
    error,
    next,
    prev,
    reload,
    patchRecord,
  };
}
