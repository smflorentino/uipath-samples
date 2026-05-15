import { useEffect, useMemo, useState } from 'react';
import { Jobs } from '@uipath/uipath-typescript/jobs';
import type { JobGetResponse } from '@uipath/uipath-typescript/jobs';
import { useAuth } from './useAuth';

export interface UseJobsForFolderOptions {
  folderId: number | null;
  pageSize?: number;
  /** Optional client-side filter applied after the SDK call. */
  filter?: (job: JobGetResponse) => boolean;
}

export interface UseJobsForFolderResult {
  jobs: JobGetResponse[];
  loading: boolean;
  error: string | null;
}

export function useJobsForFolder({
  folderId,
  pageSize = 50,
  filter,
}: UseJobsForFolderOptions): UseJobsForFolderResult {
  const { sdk } = useAuth();
  const jobsService = useMemo(() => new Jobs(sdk), [sdk]);

  const [jobs, setJobs] = useState<JobGetResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (folderId == null) {
      setJobs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await jobsService.getAll({
          folderId,
          pageSize,
          orderby: 'CreationTime desc',
        });
        if (cancelled) return;
        const items = filter ? result.items.filter(filter) : result.items;
        setJobs(items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load jobs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, pageSize, filter, jobsService]);

  return { jobs, loading, error };
}
