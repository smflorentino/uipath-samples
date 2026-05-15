import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getActiveTenant } from '../lib/activeTenant';

export interface FolderSummary {
  id: number;
  fullyQualifiedName: string;
  displayName: string;
  folderType: string;
  level: number;
  parentId: number | null;
  hasChildren: boolean;
}

interface OdataFolder {
  Id: number;
  FullyQualifiedName?: string;
  DisplayName?: string;
  FolderType?: string;
  ParentId?: number | null;
}

export interface UseFoldersResult {
  folders: FolderSummary[];
  selectedFolder: FolderSummary | null;
  setSelectedFolder: (f: FolderSummary | null) => void;
  loading: boolean;
  error: string | null;
}

export function useFolders(): UseFoldersResult {
  const { sdk } = useAuth();
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = sdk.getToken();
        if (!token) throw new Error('No access token available');
        const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
        const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
        const tenantName = getActiveTenant();
        const orchBase = `${baseUrl}/${orgName}/${tenantName}/orchestrator_`;
        const headers = { Authorization: `Bearer ${token}` };

        const fetchOdata = async (path: string): Promise<OdataFolder[]> => {
          const r = await fetch(`${orchBase}${path}`, { headers });
          if (!r.ok) return [];
          const data = (await r.json()) as { value?: OdataFolder[] };
          return data.value ?? [];
        };

        const stdFolders = await fetchOdata(
          `/odata/Folders?$select=Id,FullyQualifiedName,DisplayName,FolderType,ParentId&$orderby=FullyQualifiedName&$top=500`,
        );
        const personal = await fetchOdata(
          `/odata/Folders?$filter=FolderType eq 'Personal'&$select=Id,FullyQualifiedName,DisplayName,FolderType,ParentId&$top=50`,
        );

        const merged = new Map<number, OdataFolder>();
        for (const f of [...stdFolders, ...personal]) if (f?.Id) merged.set(f.Id, f);

        if (merged.size === 0) {
          throw new Error('Folders request returned no entries (check OR.Folders scope)');
        }

        const computeLevel = (id: number): number => {
          let level = 0;
          let cur = merged.get(id);
          const seen = new Set<number>();
          while (cur?.ParentId && !seen.has(cur.ParentId)) {
            seen.add(cur.ParentId);
            const parent = merged.get(cur.ParentId);
            if (!parent) break;
            level++;
            cur = parent;
          }
          return level;
        };

        if (cancelled) return;
        const childIds = new Set<number>();
        for (const f of merged.values()) if (f.ParentId != null) childIds.add(f.ParentId);

        const list: FolderSummary[] = Array.from(merged.values()).map((f) => ({
          id: f.Id,
          fullyQualifiedName: f.FullyQualifiedName ?? f.DisplayName ?? `Folder ${f.Id}`,
          displayName: f.DisplayName ?? f.FullyQualifiedName ?? `Folder ${f.Id}`,
          folderType: f.FolderType ?? 'Standard',
          level: computeLevel(f.Id),
          parentId: f.ParentId ?? null,
          hasChildren: childIds.has(f.Id),
        }));

        list.sort((a, b) => {
          if (a.folderType === 'Personal' && b.folderType !== 'Personal') return -1;
          if (b.folderType === 'Personal' && a.folderType !== 'Personal') return 1;
          return a.fullyQualifiedName.localeCompare(b.fullyQualifiedName);
        });

        setFolders(list);
        setSelectedFolder(list[0] ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load folders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  return { folders, selectedFolder, setSelectedFolder, loading, error };
}
