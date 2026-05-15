import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export interface TenantInfo {
  name: string;
  id: string;
  region?: string;
}

export interface UseTenantsResult {
  tenants: TenantInfo[];
  loading: boolean;
  error: string | null;
}

interface RawResponse {
  organization?: { name?: string };
  tenants?: Array<{ name?: string; id?: string; region?: string }>;
}

export function useTenants(): UseTenantsResult {
  const { sdk } = useAuth();
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = sdk.getToken();
        if (!token) throw new Error('No access token');
        const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
        const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
        const url = `${baseUrl}/${orgName}/portal_/api/filtering/leftnav/tenantsAndOrganizationInfo`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`Tenants request failed: ${r.status} ${r.statusText}`);
        const data = (await r.json()) as RawResponse;
        if (cancelled) return;
        const list: TenantInfo[] = (data.tenants ?? [])
          .filter((t): t is { name: string; id: string; region?: string } => !!t.name && !!t.id)
          .map((t) => ({ name: t.name, id: t.id, region: t.region }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setTenants(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tenants');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  return { tenants, loading, error };
}
