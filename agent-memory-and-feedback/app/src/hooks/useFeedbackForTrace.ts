import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getActiveTenant } from '../lib/activeTenant';

export interface FeedbackEntry {
  id: string;
  traceId: string;
  spanId: string;
  agentId?: string;
  agentVersion?: string;
  comment?: string;
  isPositive: boolean;
  folderKey?: string;
  userEmail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UseFeedbackForTraceResult {
  entries: FeedbackEntry[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useFeedbackForTrace(
  traceId: string | null,
  folderKey: string | null,
): UseFeedbackForTraceResult {
  const { sdk } = useAuth();
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!traceId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = sdk.getToken();
        if (!token) throw new Error('No access token');
        const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
        const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
        const tenantName = getActiveTenant();
        const url = `${baseUrl}/${orgName}/${tenantName}/llmopstenant_/api/Feedback?traceId=${encodeURIComponent(traceId)}`;
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
        if (folderKey) headers['x-uipath-folderkey'] = folderKey;
        const r = await fetch(url, { headers });
        if (!r.ok) {
          throw new Error(`Feedback fetch failed: ${r.status} ${r.statusText}`);
        }
        const parsed = (await r.json()) as unknown;
        if (cancelled) return;
        // Tolerate shapes: array | { items: [...] } | { value: [...] } | single object
        let list: FeedbackEntry[] = [];
        if (Array.isArray(parsed)) list = parsed as FeedbackEntry[];
        else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj.items)) list = obj.items as FeedbackEntry[];
          else if (Array.isArray(obj.value)) list = obj.value as FeedbackEntry[];
          else if (typeof obj.id === 'string') list = [obj as unknown as FeedbackEntry];
        }
        setEntries(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load feedback');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId, folderKey, sdk, reloadKey]);

  return { entries, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
