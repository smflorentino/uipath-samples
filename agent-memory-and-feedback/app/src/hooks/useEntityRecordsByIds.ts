import { useEffect, useMemo, useState } from 'react';
import { Entities } from '@uipath/uipath-typescript/entities';
import type { EntityRecord } from '@uipath/uipath-typescript/entities';
import { useAuth } from './useAuth';

export type ParsedRecord = Record<string, unknown>;

export interface UseEntityRecordsByIdsResult {
  byId: Record<string, ParsedRecord | null>;
  loading: boolean;
}

const CACHE = new Map<string, ParsedRecord | null>();
const cacheKey = (entityId: string, recordId: string) => `${entityId}::${recordId}`;

/**
 * Batched, cached `Entities.getRecordById` for a list of record IDs in the
 * same entity. Used to join Drafts → Disputes for customer info on the
 * cards grid. Module-level cache survives pagination so re-visiting a page
 * is free.
 */
export function useEntityRecordsByIds(
  entityId: string,
  recordIds: string[],
): UseEntityRecordsByIdsResult {
  const { sdk } = useAuth();
  const entitiesService = useMemo(() => new Entities(sdk), [sdk]);

  const [byId, setById] = useState<Record<string, ParsedRecord | null>>(() => {
    const seed: Record<string, ParsedRecord | null> = {};
    for (const id of recordIds) {
      const v = CACHE.get(cacheKey(entityId, id));
      if (v !== undefined) seed[id] = v;
    }
    return seed;
  });
  const [loading, setLoading] = useState(false);

  const sig = recordIds.slice().sort().join(',');

  useEffect(() => {
    if (!entityId || recordIds.length === 0) return;
    const work = recordIds.filter((id) => !CACHE.has(cacheKey(entityId, id)));
    if (work.length === 0) {
      const next: Record<string, ParsedRecord | null> = {};
      for (const id of recordIds) next[id] = CACHE.get(cacheKey(entityId, id)) ?? null;
      setById(next);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all(
        work.map(async (recordId) => {
          try {
            const r = await entitiesService.getRecordById(entityId, recordId);
            CACHE.set(cacheKey(entityId, recordId), r as unknown as ParsedRecord);
          } catch {
            CACHE.set(cacheKey(entityId, recordId), null);
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, ParsedRecord | null> = {};
      for (const id of recordIds) next[id] = CACHE.get(cacheKey(entityId, id)) ?? null;
      setById(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, sig, entitiesService]);

  return { byId, loading };
}

/** Test/debug helper. */
export function _resetEntityRecordsCache(): void {
  CACHE.clear();
}

// Re-export EntityRecord for callers that want to keep types tight.
export type { EntityRecord };
