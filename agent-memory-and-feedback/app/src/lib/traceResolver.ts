import type { UiPath } from '@uipath/uipath-typescript/core';
import { Jobs } from '@uipath/uipath-typescript/jobs';
import { getActiveTenant } from './activeTenant';

export interface ResolvedTrace {
  traceId: string;
  folderKey: string | null;
  /**
   * The deployed agent version captured from `Jobs.getById(...).processVersion`.
   * Used in the LLM Ops Feedback POST body so the dashboard records the actual
   * version that produced the draft (not a stale config string).
   */
  agentVersion: string | null;
}

/**
 * Resolves a job's traceId + folderKey using a two-hop pattern:
 *   1. `GET /api/Jobs/GetJobInfo` (folder-less) → discovers `organizationUnitId`.
 *   2. `Jobs.getById(jobKey, folderId)` → returns the job with `traceId` + `folderKey`.
 *
 * Step 1 is folder-less, so this works even when the agent has been deployed
 * to a folder different from the agent target's configured `folderId` hint.
 *
 * Returns null when neither hop succeeds (typically: signed-in user lacks
 * read access to the agent's folder).
 *
 * Used lazily by the dispute draft detail view — never on the cards page.
 */
export async function resolveTraceForJob(
  sdk: UiPath,
  jobKey: string,
  folderIdHint: number | null,
): Promise<ResolvedTrace | null> {
  const token = sdk.getToken();
  if (!token) return null;
  const baseUrl = import.meta.env.VITE_UIPATH_BASE_URL;
  const orgName = import.meta.env.VITE_UIPATH_ORG_NAME;
  const tenantName = getActiveTenant();
  const orchBase = `${baseUrl}/${orgName}/${tenantName}/orchestrator_`;

  // Hop 1 — discover folder.
  let folderId: number | null = folderIdHint ?? null;
  try {
    const r = await fetch(
      `${orchBase}/api/Jobs/GetJobInfo?jobKey=${encodeURIComponent(jobKey)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (r.ok) {
      const info = (await r.json()) as { organizationUnitId?: number };
      if (typeof info.organizationUnitId === 'number') {
        folderId = info.organizationUnitId;
      }
    }
  } catch {
    // fall through with the hint
  }
  if (folderId == null) return null;

  // Hop 2 — fetch the full job in its folder context.
  try {
    const jobs = new Jobs(sdk);
    // expand=release attaches a `process` sub-object with the string
    // `processVersion` (e.g. "1.0.2") — the top-level `processVersionId`
    // is numeric and useless for the LLM Ops feedback POST.
    const j = await jobs.getById(jobKey, folderId, { expand: 'release' });
    const traceId = typeof j.traceId === 'string' && j.traceId.length > 0 ? j.traceId : null;
    if (!traceId) return null;
    const pv = j.process?.processVersion;
    return {
      traceId,
      folderKey: typeof j.folderKey === 'string' && j.folderKey.length > 0 ? j.folderKey : null,
      agentVersion: typeof pv === 'string' && pv.length > 0 ? pv : null,
    };
  } catch {
    return null;
  }
}
