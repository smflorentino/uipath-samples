import { Entities } from '@uipath/uipath-typescript/entities';
import { Processes, type ProcessStartResponse } from '@uipath/uipath-typescript/processes';
import type { UiPath } from '@uipath/uipath-typescript/core';

export interface RerunInput {
  sdk: UiPath;
  processName: string;
  folderId: number;
  disputeId: string;
  /** DRD entity id where we insert the new (initially empty) draft row. */
  draftsEntityId: string;
  /** Field name on the DRD row that holds the disputeId — usually `'disputeId'`. */
  disputeIdField: string;
}

export interface RerunResult {
  jobKey: string;
  draftRecordId: string;
}

/**
 * Pre-creates the DRD row and starts the resolution-drafter RPA against it.
 *
 * The RPA contract takes a `draftEntityId` input — the GUID of an existing
 * `DisputeResolutionDrafts` row that already has `disputeId` populated. The
 * RPA then writes `jobKey` (and eventually `subject`/`body`) back onto that
 * same row as it runs. So this helper does two SDK calls in order:
 *
 *   1. `Entities.insertRecordById(draftsEntityId, { [disputeIdField]: disputeId })`
 *      → returns the new row's `Id` (which becomes `draftEntityId`).
 *   2. `Processes.start({ processName, inputArguments: JSON.stringify({ draftEntityId }) })`.
 *
 * `inputArguments` is sent to Orchestrator as a JSON string, not an object —
 * the SDK passes it through verbatim.
 *
 * If step 2 throws after step 1 succeeds, the empty row stays in the entity
 * as an orphan. Manual cleanup (`uip df records delete …`) is fine; we don't
 * compensate because the demo cadence makes orphans cheap.
 */
export async function rerunDrafter(i: RerunInput): Promise<RerunResult> {
  const entities = new Entities(i.sdk);
  const inserted = await entities.insertRecordById(i.draftsEntityId, {
    [i.disputeIdField]: i.disputeId,
  });
  const draftRecordId = (inserted as { Id?: string }).Id ?? '';
  if (!draftRecordId) throw new Error('Draft row insert succeeded but returned no Id');

  const processes = new Processes(i.sdk);
  const out: ProcessStartResponse[] = await processes.start(
    {
      processName: i.processName,
      inputArguments: JSON.stringify({ draftEntityId: draftRecordId }),
    },
    i.folderId,
  );
  const job = out[0];
  if (!job?.key) {
    throw new Error('Orchestrator accepted the request but returned no job key');
  }

  return { jobKey: job.key, draftRecordId };
}
