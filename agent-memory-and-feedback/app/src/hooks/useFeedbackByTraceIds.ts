import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getActiveTenant } from '../lib/activeTenant';
import type { FeedbackEntry } from './useFeedbackForTrace';

export interface FeedbackTallies {
  /** Map traceId → list of feedback entries (empty array means "fetched, none exist"). */
  byTraceId: Record<string, FeedbackEntry[]>;
  loading: boolean;
}

const FEEDBACK_CACHE = new Map<string, FeedbackEntry[]>();

/** Build a cache key per (traceId, folderKey) so a folder change re-fetches. */
const cacheKey = (traceId: string, folderKey: string | null) =>
  `${folderKey ?? ''}::${traceId}`;

interface FetchInput {
  traceId: string;
  folderKey: string | null;
}

/**
 * Fetches LLM Ops feedback for many traces in parallel and exposes a
 * traceId → entries map. Used by the cards grid to render presence badges
 * without an N+1 wave on every render.
 *
 * Trade-off: this still performs one HTTP call per trace (the API has no
 * batch endpoint we know of), but it dedupes via an in-memory cache so
 * paginating back to a previously-seen page is free.
 */
export function useFeedbackByTraceIds(inputs: FetchInput[]): FeedbackTallies {
  const { sdk } = useAuth();
  const [byTraceId, setByTraceId] = useState<Record<string, FeedbackEntry[]>>(() => {
    const seed: Record<string, FeedbackEntry[]> = {};
    for (const { traceId, folderKey } of inputs) {
      const cached = FEEDBACK_CACHE.get(cacheKey(traceId, folderKey));
      if (cached) seed[traceId] = cached;
    }
    return seed;
  });
  const [loading, setLoading] = useState(false);

  // Stringify input identity so the effect runs only when the trace list actually changes.
  const inputsKey = inputs
    .map((i) => `${i.traceId}|${i.folderKey ?? ''}`)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const work = inputs.filter((i) => !FEEDBACK_CACHE.has(cacheKey(i.traceId, i.folderKey)));
    if (work.length === 0) return;

    (async () => {
      setLoading(true);
      const token = sdk.getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
      const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
      const tenantName = getActiveTenant();

      await Promise.all(
        work.map(async ({ traceId, folderKey }) => {
          try {
            const url = `${baseUrl}/${orgName}/${tenantName}/llmopstenant_/api/Feedback?traceId=${encodeURIComponent(traceId)}`;
            const headers: Record<string, string> = {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            };
            if (folderKey) headers['x-uipath-folderkey'] = folderKey;
            const r = await fetch(url, { headers });
            if (!r.ok) {
              FEEDBACK_CACHE.set(cacheKey(traceId, folderKey), []);
              return;
            }
            const parsed = (await r.json()) as unknown;
            let list: FeedbackEntry[] = [];
            if (Array.isArray(parsed)) list = parsed as FeedbackEntry[];
            else if (parsed && typeof parsed === 'object') {
              const obj = parsed as Record<string, unknown>;
              if (Array.isArray(obj.items)) list = obj.items as FeedbackEntry[];
              else if (Array.isArray(obj.value)) list = obj.value as FeedbackEntry[];
              else if (typeof obj.id === 'string') list = [obj as unknown as FeedbackEntry];
            }
            FEEDBACK_CACHE.set(cacheKey(traceId, folderKey), list);
          } catch {
            FEEDBACK_CACHE.set(cacheKey(traceId, folderKey), []);
          }
        }),
      );

      if (cancelled) return;
      // Snapshot every input from the cache.
      const next: Record<string, FeedbackEntry[]> = {};
      for (const { traceId, folderKey } of inputs) {
        next[traceId] = FEEDBACK_CACHE.get(cacheKey(traceId, folderKey)) ?? [];
      }
      setByTraceId(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey, sdk]);

  return { byTraceId, loading };
}

/**
 * Test/debug helper — clears the in-memory cache so a fresh test sees no
 * preloaded entries. Not exported for app code.
 */
export function _resetFeedbackCache(): void {
  FEEDBACK_CACHE.clear();
}
