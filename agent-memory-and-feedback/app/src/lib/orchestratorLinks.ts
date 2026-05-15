export interface JobDetailUrlInput {
  baseUrl: string;
  orgName: string;
  tenantName: string;
  tenantIdLong: string;
  folderId: number;
  jobKey: string;
}

/**
 * Builds the Orchestrator side-panel URL for a job's trace view.
 *
 * Example output:
 *   https://cloud.uipath.com/your-org/Memory/orchestrator_/jobs(
 *     sidepanel:sidepanel/jobs/<jobKey>/traces/:id
 *   )?tid=999999&fid=999999
 *
 * `tid` (the long tenant ID) and `fid` (the folder ID) are both required for
 * Orchestrator to route the side-panel into the right tenant + folder context.
 * `index` / `size` / `state` from the in-browser URL are UI filter state that
 * Orchestrator defaults on its own — we don't bother forwarding them.
 *
 * `baseUrl` is the API host (`https://cloud.api.uipath.com`) — the SDK uses
 * it for all calls. The Orchestrator *web app* lives on the sibling host
 * without the `.api.` segment (`https://cloud.uipath.com`), so we strip
 * `.api.` to land users on the UI when they click the link.
 */
export function buildJobDetailUrl(i: JobDetailUrlInput): string {
  const portalBase = i.baseUrl.replace('.api.', '.');
  const path = `${portalBase}/${i.orgName}/${i.tenantName}/orchestrator_/jobs(sidepanel:sidepanel/jobs/${i.jobKey}/traces/:id)`;
  const qs = new URLSearchParams({
    tid: i.tenantIdLong,
    fid: String(i.folderId),
  });
  return `${path}?${qs.toString()}`;
}

export interface MemorySpaceUrlInput {
  baseUrl: string;
  orgName: string;
  memoryId: string;
}

/**
 * Builds the Agents portal URL for browsing a memory space's contents.
 *
 * Example output:
 *   https://cloud.uipath.com/your-org/agents_/memory/<memoryId>
 *
 * The agents portal scopes itself to the user's last-selected tenant via
 * cookie/localStorage — no tenant id required in the path (unlike the
 * Orchestrator job URL). Strips `.api.` from `baseUrl` for the same reason
 * as `buildJobDetailUrl`.
 */
export function buildMemorySpaceUrl(i: MemorySpaceUrlInput): string {
  const portalBase = i.baseUrl.replace('.api.', '.');
  return `${portalBase}/${i.orgName}/agents_/memory/${i.memoryId}`;
}

export interface AgentsImUrlInput {
  baseUrl: string;
  orgName: string;
  folderKey: string;
  /** Release key (the Orchestrator process GUID for this agent's deployment in the folder). */
  processKey: string;
  agentId: string;
  /** Agent version string, e.g. `"1.0.3"`. Sourced at call time from a recent feedback row. */
  version: string;
  /** Optional tab anchor — `?tab=feedback` is the most useful default. */
  tab?: string;
}

/**
 * Builds the Agents Instance Management deep link for a deployed agent.
 *
 * Example output:
 *   https://cloud.uipath.com/your-org/agents_/deployed/<folderKey>/<processKey>/<agentId>/<version>?tab=feedback
 *
 * Same portal-host derivation as `buildMemorySpaceUrl`. Caller is responsible
 * for resolving `version` (it changes per redeploy, so we don't bake it into
 * `agentTargets.ts`).
 */
export function buildAgentsImUrl(i: AgentsImUrlInput): string {
  const portalBase = i.baseUrl.replace('.api.', '.');
  const path = `${portalBase}/${i.orgName}/agents_/deployed/${i.folderKey}/${i.processKey}/${i.agentId}/${i.version}`;
  return i.tab ? `${path}?tab=${encodeURIComponent(i.tab)}` : path;
}
