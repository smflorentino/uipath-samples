import { useEffect, useMemo, useState } from 'react';
import { Jobs } from '@uipath/uipath-typescript/jobs';
import { useAuth } from './useAuth';

export type ParsedInput = Record<string, unknown>;

export interface UseJobInputsByKeysResult {
  byJobKey: Record<string, ParsedInput | null>;
  loading: boolean;
}

/** Module-level cache so paginating between previously-seen pages is free. */
const INPUTS_CACHE = new Map<string, ParsedInput | null>();
const cacheKey = (folderId: number, jobKey: string) => `${folderId}::${jobKey}`;

const safeParse = (s: string | null | undefined): ParsedInput | null => {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ParsedInput)
      : null;
  } catch {
    return null;
  }
};

/**
 * Batched `Jobs.getById` for a list of jobs to surface their `inputArguments`
 * on the cards grid. The Orchestrator OData list endpoint always nulls those
 * fields, so a per-job round trip is unavoidable. We parallelize and cache.
 */
export function useJobInputsByKeys(
  jobKeys: string[],
  folderId: number | null | undefined,
): UseJobInputsByKeysResult {
  const { sdk } = useAuth();
  const jobsService = useMemo(() => new Jobs(sdk), [sdk]);

  const [byJobKey, setByJobKey] = useState<Record<string, ParsedInput | null>>(() => {
    if (folderId == null) return {};
    const seed: Record<string, ParsedInput | null> = {};
    for (const k of jobKeys) {
      const v = INPUTS_CACHE.get(cacheKey(folderId, k));
      if (v !== undefined) seed[k] = v;
    }
    return seed;
  });
  const [loading, setLoading] = useState(false);

  // Stable identity so we re-fetch only when the visible job set actually changes.
  const keysSig = jobKeys.slice().sort().join(',');

  useEffect(() => {
    if (folderId == null || jobKeys.length === 0) return;
    const work = jobKeys.filter((k) => !INPUTS_CACHE.has(cacheKey(folderId, k)));
    if (work.length === 0) {
      // Nothing to fetch — hydrate from cache.
      const next: Record<string, ParsedInput | null> = {};
      for (const k of jobKeys) next[k] = INPUTS_CACHE.get(cacheKey(folderId, k)) ?? null;
      setByJobKey(next);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all(
        work.map(async (jobKey) => {
          try {
            const j = await jobsService.getById(jobKey, folderId);
            INPUTS_CACHE.set(cacheKey(folderId, jobKey), safeParse(j.inputArguments));
          } catch {
            INPUTS_CACHE.set(cacheKey(folderId, jobKey), null);
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, ParsedInput | null> = {};
      for (const k of jobKeys) next[k] = INPUTS_CACHE.get(cacheKey(folderId, k)) ?? null;
      setByJobKey(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig, folderId, jobsService]);

  return { byJobKey, loading };
}

/** Test/debug helper. */
export function _resetJobInputsCache(): void {
  INPUTS_CACHE.clear();
}
