/**
 * Configuration for the agent target this app surfaces. Every tenant-specific
 * GUID below is a `TODO_FROM_INSTALL` placeholder — fill them in following
 * the runbook in `../../../INSTALL.md`. Each entry's comment names the
 * INSTALL.md phase that captures it.
 *
 * All other constants (field names, labels, paths) are set up for the sample
 * as-shipped — the Resolution Drafter Agent, the Disputes / DisputeResolutionDrafts
 * Data Fabric entities, and the memory space you create in INSTALL.md Phase 4.
 */

import { useSyncExternalStore } from 'react';

export interface AgentTarget {
  /** Stable id, not user-facing. */
  id: string;
  /** Tab label and page heading. */
  tabLabel: string;
  /** Singular noun used in card titles ("Draft", "Letter", etc.). */
  cardLabel: string;
  /** Optional intro sentence shown above the card grid. */
  description?: string;

  /** How to identify runs of this agent in Orchestrator. */
  match: {
    processName: string;
    /** ReleaseKey of the RPA process wrapping the agent — captured in INSTALL.md Phase 3. */
    processKey?: string;
    /** Folder GUID — captured in INSTALL.md Phase 3. */
    folderKey?: string;
    /** Numeric folder id; SDK's `folderId`. Required for Jobs.getById. */
    folderId?: number;
    /** Display-only — surfaced in the header so users know which folder the runs come from. */
    folderName?: string;
    /** Tenant slug the agent is deployed in — surfaced as a hint when the active tenant doesn't match. */
    tenantName?: string;
    /** Numeric "long" Orchestrator tenant ID. Used to build the `tid=` query param in deep links. Captured from any Orchestrator URL. */
    orchestratorTenantIdLong: string;
    /** ReleaseName of the RPA process that re-drafts a single dispute. Optional. */
    rpaProcessName?: string;
  };

  /** Agent ID for the LLM Ops feedback POST body. Discovered from the agentRun span attributes. */
  agentId: string;

  /** Map raw input-argument keys → friendly labels for the detail view. */
  inputLabels: Record<string, string>;

  /** Optional fields to surface on the cards grid. */
  cardFields?: {
    primary?: string;
    badges?: string[];
  };

  /** Optional ordering for input fields. Keys not in the array sort alphabetically afterwards. */
  inputFieldOrder?: string[];

  /** JSON path inside parsed `outputArguments` to the letter body. */
  outputContentPath: string[];

  /** Optional path inside `outputArguments` to a subject line. Set to `null` if no subject. */
  outputSubjectPath?: string[] | null;

  /**
   * Optional Data Fabric backing. When present, the drafts list comes from
   * `draftsEntityId` rows instead of `Jobs.getAll`. Each row links to a
   * `disputesEntityId` row via `disputeIdField` for customer/dispute context.
   * The feedback chain still goes through the job (row.jobKey → traceId).
   */
  dataFabric?: {
    draftsEntityId: string;
    disputesEntityId: string;
    disputeIdField: string;
    jobKeyField: string;
    subjectField: string;
    bodyField: string;
    reviewedField?: string;
    createdAtField?: string;
    disputeLabels: Record<string, string>;
    disputeFieldOrder?: string[];
    cardFields?: {
      primary?: string;
      badges?: string[];
    };
  };

  /**
   * Agent Memory space the Feedback Triage page ingests into. When absent,
   * the Feedback Triage tab/route are hidden. All five fields are required
   * together — they parameterize the LLM Ops `/api/Agent/*` endpoints, which
   * use the internal tenant GUID in the URL path (not the tenant slug).
   *
   * The five values are captured in INSTALL.md Phase 4 by opening the agents
   * portal at `/agents_/memory/<memorySpaceId>` with the browser's network
   * tab open, and reading the request headers + URL of the ingest call.
   */
  memorySpace?: {
    /** GUID of the memory space (the `:memoryId` in the ingest URL). */
    memoryId: string;
    /** Display name (the `memorySpaceName` query param on ingest). */
    memoryName: string;
    /** `X-UiPath-FolderKey` sent on ingest — the folder the memory space lives in. */
    memoryFolderKey: string;
    /** Memory tenant's GUID (NOT the slug). Used in URL path + `X-UiPath-Internal-TenantId`. */
    internalTenantIdGuid: string;
    /** Org-level account GUID. Used in `X-UiPath-Internal-AccountId`. */
    internalAccountId: string;
  };
}

const RESOLUTION_DRAFTER_TARGET: AgentTarget = {
  id: 'resolution-drafter',
  tabLabel: 'Dispute Resolution Drafts',
  cardLabel: 'Draft',
  description:
    "Review the agent's drafted resolution letters and leave feedback. Each card is one customer dispute the agent drafted a reply for.",

  match: {
    // The ReleaseName the RPA wrapper process is published under. INSTALL.md
    // Phase 3 instructs you to name the wrapper `ResolutionDrafter.Process`;
    // adjust here if you used a different name.
    processName: 'ResolutionDrafter.Process',
    // INSTALL.md Phase 3 step 8 — `uip or processes list --folder-key <FOLDER>`
    processKey: 'TODO_FROM_INSTALL',
    // INSTALL.md Phase 3 step 8 — `uip or folders list`
    folderKey: 'TODO_FROM_INSTALL',
    // INSTALL.md Phase 3 step 8 — numeric folder ID from the same `folders list`
    folderId: 0,
    folderName: 'TODO_FROM_INSTALL',
    tenantName: 'TODO_FROM_INSTALL',
    // INSTALL.md Phase 3 step 8 — read from any Orchestrator URL (`tid=` param)
    orchestratorTenantIdLong: 'TODO_FROM_INSTALL',
    rpaProcessName: 'ResolutionDrafter.Process',
  },

  // INSTALL.md Phase 3 step 8 — `uip agent list` after publishing the agent
  agentId: 'TODO_FROM_INSTALL',

  // Maps raw agent input-argument keys → friendly labels. Used only when the
  // app falls back to `Jobs.getAll`-style rendering; the Data Fabric path
  // below uses `dataFabric.disputeLabels` instead.
  inputLabels: {
    customer_name: 'Customer',
    customer_tier: 'Tier',
    flags: 'Account flags',
    invoice_number: 'Invoice number',
    dispute_description: 'Dispute description',
    root_cause: 'Root cause',
    recommended_resolution: 'Recommended resolution',
    line_items_summary: 'Line items',
    adjustment_type: 'Adjustment type',
    adjustment_id: 'Adjustment ID',
    credit_amount: 'Credit amount',
    adjusted_invoice_balance: 'Adjusted invoice balance',
    finance_manager_name: 'Finance manager',
    company_name: 'Company',
  },

  inputFieldOrder: [
    'customer_name',
    'customer_tier',
    'flags',
    'company_name',
    'invoice_number',
    'dispute_description',
    'root_cause',
    'line_items_summary',
    'recommended_resolution',
    'adjustment_type',
    'adjustment_id',
    'credit_amount',
    'adjusted_invoice_balance',
    'finance_manager_name',
  ],

  outputContentPath: ['body'],
  outputSubjectPath: ['subject'],

  cardFields: {
    primary: 'customer_name',
    badges: ['customer_tier', 'flags'],
  },

  // Data Fabric backing — the drafts list pulls from DisputeResolutionDrafts,
  // joined with Disputes for context. Entity IDs are captured in INSTALL.md
  // Phase 1.
  dataFabric: {
    // INSTALL.md Phase 1 — `uip df entities create ... DisputeResolutionDrafts.entity.json`
    draftsEntityId: 'TODO_FROM_INSTALL',
    // INSTALL.md Phase 1 — `uip df entities create ... Disputes.entity.json`
    disputesEntityId: 'TODO_FROM_INSTALL',
    disputeIdField: 'disputeId',
    jobKeyField: 'jobKey',
    subjectField: 'subject',
    bodyField: 'body',
    reviewedField: 'isReviewed',
    createdAtField: 'CreateTime',
    // Same 14 input fields as the agent, snake_case to match the Disputes entity field names.
    disputeLabels: {
      customer_name: 'Customer',
      customer_tier: 'Tier',
      flags: 'Account flags',
      company_name: 'Company',
      invoice_number: 'Invoice number',
      dispute_description: 'Dispute description',
      root_cause: 'Root cause',
      line_items_summary: 'Line items',
      recommended_resolution: 'Recommended resolution',
      adjustment_type: 'Adjustment type',
      adjustment_id: 'Adjustment ID',
      credit_amount: 'Credit amount',
      adjusted_invoice_balance: 'Adjusted invoice balance',
      finance_manager_name: 'Finance manager',
    },
    disputeFieldOrder: [
      'customer_name',
      'customer_tier',
      'flags',
      'company_name',
      'invoice_number',
      'dispute_description',
      'root_cause',
      'line_items_summary',
      'recommended_resolution',
      'adjustment_type',
      'adjustment_id',
      'credit_amount',
      'adjusted_invoice_balance',
      'finance_manager_name',
    ],
    cardFields: {
      primary: 'customer_name',
      badges: ['customer_tier', 'flags'],
    },
  },

  memorySpace: {
    // INSTALL.md Phase 4 — read each value from the network tab when you load
    // `/agents_/memory/<memorySpaceId>` after creating the space.
    memoryId: 'TODO_FROM_INSTALL',
    memoryName: 'PATH Industries — Resolution Draft Memory',
    memoryFolderKey: 'TODO_FROM_INSTALL',
    internalTenantIdGuid: 'TODO_FROM_INSTALL',
    internalAccountId: 'TODO_FROM_INSTALL',
  },
};

/**
 * One target shipped in the sample. Add more entries to surface them in the
 * header dropdown (e.g., a dev/staging environment vs. production).
 */
export const AGENT_TARGETS = {
  default: { label: 'Resolution Drafter', target: RESOLUTION_DRAFTER_TARGET },
} as const;

export type AgentTargetKey = keyof typeof AGENT_TARGETS;

const STORAGE_KEY = 'agent-feedback-app.activeAgentTargetKey';
const DEFAULT_KEY: AgentTargetKey = 'default';

function readStoredKey(): AgentTargetKey {
  if (typeof window === 'undefined') return DEFAULT_KEY;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v && v in AGENT_TARGETS ? (v as AgentTargetKey) : DEFAULT_KEY;
}

let activeKey: AgentTargetKey = readStoredKey();
const subscribers = new Set<() => void>();

export function getActiveAgentTargetKey(): AgentTargetKey {
  return activeKey;
}

export function getActiveAgentTarget(): AgentTarget {
  return AGENT_TARGETS[activeKey].target;
}

export function setActiveAgentTargetKey(key: AgentTargetKey): void {
  if (key === activeKey || !(key in AGENT_TARGETS)) return;
  activeKey = key;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, key);
  }
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * React hook returning the currently-active agent target. Components
 * subscribe via `useSyncExternalStore` so a `setActiveAgentTargetKey()`
 * call from anywhere immediately re-renders every consumer.
 */
export function useActiveAgentTarget(): AgentTarget {
  return useSyncExternalStore(subscribe, getActiveAgentTarget, getActiveAgentTarget);
}

/** Same as `useActiveAgentTarget` but returns the key instead of the target object. */
export function useActiveAgentTargetKey(): AgentTargetKey {
  return useSyncExternalStore(subscribe, getActiveAgentTargetKey, getActiveAgentTargetKey);
}
