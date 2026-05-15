import { useCallback, useEffect, useMemo, useState } from 'react';
import { Jobs } from '@uipath/uipath-typescript/jobs';
import type { JobGetResponse } from '@uipath/uipath-typescript/jobs';
import type { PaginationCursor } from '@uipath/uipath-typescript/core';
import { useAuth } from './useAuth';

export interface UseAgentRunsCursorOptions {
  /** OData filter target — matches `ReleaseName` in Orchestrator (which is `processName` on JobGetResponse). */
  processName: string;
  /** Optional folder scope. */
  folderId?: number;
  pageSize?: number;
}

export interface UseAgentRunsCursorResult {
  jobs: JobGetResponse[];
  pageIndex: number; // 1-based
  hasNext: boolean;
  hasPrev: boolean;
  loading: boolean;
  error: string | null;
  next: () => void;
  prev: () => void;
  reload: () => void;
}

export interface PageState {
  /** cursors[i] is the cursor that loads page (i+1). cursors[0] is always undefined. */
  cursors: (PaginationCursor | undefined)[];
  pageIndex: number; // 1-based
  hasNext: boolean;
}

export const initialPageState: PageState = {
  cursors: [undefined],
  pageIndex: 1,
  hasNext: false,
};

/** Pure transition: advance to next page if a forward cursor is known. */
export function advanceState(prev: PageState): PageState {
  const cursorForNext = prev.cursors[prev.pageIndex];
  if (!prev.hasNext || !cursorForNext) return prev;
  return { ...prev, pageIndex: prev.pageIndex + 1 };
}

/** Pure transition: rewind one page if not already on page 1. */
export function rewindState(prev: PageState): PageState {
  return prev.pageIndex > 1 ? { ...prev, pageIndex: prev.pageIndex - 1 } : prev;
}

/** Pure transition: stash a freshly-discovered nextCursor at the right slot. */
export function ingestCursor(
  prev: PageState,
  nextCursor: PaginationCursor | undefined,
  hasNextPage: boolean,
): PageState {
  const nextCursors = prev.cursors.slice();
  if (hasNextPage && nextCursor && nextCursors[prev.pageIndex] === undefined) {
    nextCursors[prev.pageIndex] = nextCursor;
  }
  return { ...prev, cursors: nextCursors, hasNext: hasNextPage && !!nextCursor };
}

export function useAgentRunsCursor(
  options: UseAgentRunsCursorOptions,
): UseAgentRunsCursorResult {
  const { sdk } = useAuth();
  const jobsService = useMemo(() => new Jobs(sdk), [sdk]);

  const { processName, folderId, pageSize = 12 } = options;

  const [state, setState] = useState<PageState>(initialPageState);
  const [jobs, setJobs] = useState<JobGetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Reset to page 1 whenever the query identity changes.
  useEffect(() => {
    setState(initialPageState);
    setJobs([]);
    setError(null);
  }, [processName, folderId, pageSize]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cursor = state.cursors[state.pageIndex - 1];
        const req: Record<string, unknown> = {
          pageSize,
          orderby: 'CreationTime desc',
          filter: `ReleaseName eq '${processName.replace(/'/g, "''")}'`,
        };
        if (folderId != null) req.folderId = folderId;
        if (cursor) req.cursor = cursor;

        const result = await jobsService.getAll(req);
        if (cancelled) return;

        const paged = result as typeof result & {
          hasNextPage?: boolean;
          nextCursor?: PaginationCursor;
        };
        const nextCursor = paged.nextCursor;
        const hasNextPage = !!paged.hasNextPage && !!nextCursor;

        setJobs(result.items);
        setState((prev) => ingestCursor(prev, nextCursor, hasNextPage));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load runs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsService, processName, folderId, pageSize, state.pageIndex, reloadKey]);

  const next = useCallback(() => setState(advanceState), []);
  const prev = useCallback(() => setState(rewindState), []);
  const reload = useCallback(() => {
    setState(initialPageState);
    setReloadKey((k) => k + 1);
  }, []);

  return {
    jobs,
    pageIndex: state.pageIndex,
    hasNext: state.hasNext,
    hasPrev: state.pageIndex > 1,
    loading,
    error,
    next,
    prev,
    reload,
  };
}
