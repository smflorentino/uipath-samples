import { useEffect, useMemo, useState } from 'react';
import { Jobs } from '@uipath/uipath-typescript/jobs';
import type { JobGetResponse } from '@uipath/uipath-typescript/jobs';
import { useAuth } from './useAuth';

export interface UseJobByKeyResult {
  job: JobGetResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazy fetch for a single job by key. Used by the cards panel when a deep
 * link points at a draft that isn't on the current page — calls
 * `Jobs.getById(jobKey, folderId)` so the detail view can open without
 * paginating until the job appears.
 */
export function useJobByKey(
  jobKey: string | null | undefined,
  folderId: number | null | undefined,
): UseJobByKeyResult {
  const { sdk } = useAuth();
  const jobsService = useMemo(() => new Jobs(sdk), [sdk]);

  const [job, setJob] = useState<JobGetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobKey || folderId == null) {
      setJob(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await jobsService.getById(jobKey, folderId);
        if (!cancelled) setJob(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load job');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobKey, folderId, jobsService]);

  return { job, loading, error };
}
