import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listMemoryFeedback,
  flattenSpansToRows,
  AuthExpiredError,
  type FlattenedFeedbackRow,
  type MemoryEnv,
} from '../lib/memoryFeedback';

export interface UseMemoryFeedbackResult {
  /** One row per feedback comment (spans are flattened). */
  rows: FlattenedFeedbackRow[];
  loading: boolean;
  error: string | null;
  /**
   * True when the most recent list call failed with 401/403, OR when the
   * caller passed `env: null` (typically because `sdk.getToken()` returned
   * nothing). UI should show a "sign in again" prompt instead of an empty
   * list.
   */
  expired: boolean;
  reload: () => void;
  /** Optimistically drop a row from local state after a successful delete/ingest. */
  removeLocally: (feedbackId: string) => void;
}

/**
 * Loads feedback entries for the configured tenant inside the [startMs, endMs]
 * window. Re-fires when env/range identity changes or when `reload()` is called.
 *
 * `env` is null until the caller has its config + bearer token wired up
 * (e.g. while the SDK token is still resolving) — in that case we just sit
 * idle with an empty list.
 */
export function useMemoryFeedback(
  env: MemoryEnv | null,
  range: { startMs: number; endMs: number },
  /** Active target's memory id — used to scope the `inMemory` flag per row. */
  memoryId?: string,
): UseMemoryFeedbackResult {
  const [rows, setRows] = useState<FlattenedFeedbackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Stable identity so changing object refs with the same values don't refetch.
  // `agentFolderKey` is part of the key because the hook filters by it
  // post-fetch — switching the active agent target (which changes the
  // folder) needs to re-derive the visible rows. `memoryId` is in the key
  // too because it scopes the per-row `inMemory` flag.
  const envKey = env
    ? `${env.orgName}|${env.tenantName}|${env.internalTenantIdGuid}|${env.agentFolderKey}|${env.agentId}|${memoryId ?? ''}|${env.token.slice(0, 8)}`
    : '';
  const rangeKey = `${range.startMs}|${range.endMs}`;

  useEffect(() => {
    if (!env) {
      // No env = no token. Treat as expired so the UI can prompt re-auth
      // rather than silently rendering an empty list.
      setRows([]);
      setLoading(false);
      setError(null);
      setExpired(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setExpired(false);
      try {
        const spans = await listMemoryFeedback(env, range);
        if (cancelled) return;
        // The list endpoint is tenant-scoped (no folder filter in the URL),
        // so it returns spans from every folder the user can see. Filter
        // client-side to the active agent's folder — switching the header
        // dropdown from Perf Tests to Data Tests then narrows the triage
        // list to that environment's runs even though both folders share
        // the same agent definition (and therefore the same agentId).
        // Scope to the active target's folder AND agent. The list endpoint
        // is tenant-wide and returns spans from every agent that ran in
        // every accessible folder — without the agent filter, a folder
        // hosting multiple agents (Data Tests has DisputeAgent alongside
        // ResolutionDrafterAgent) would leak unrelated feedback into the
        // triage list.
        const scoped = spans.filter(
          (s) =>
            (!env.agentFolderKey || s.folderKey === env.agentFolderKey) &&
            (!env.agentId || s.referenceId === env.agentId),
        );
        setRows(flattenSpansToRows(scoped, memoryId));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthExpiredError) {
          setExpired(true);
          setRows([]);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load feedback');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envKey, rangeKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const removeLocally = useCallback((feedbackId: string) => {
    setRows((prev) => prev.filter((r) => r.feedbackId !== feedbackId));
  }, []);

  return useMemo(
    () => ({ rows, loading, error, expired, reload, removeLocally }),
    [rows, loading, error, expired, reload, removeLocally],
  );
}
