# agent-feedback-app

UiPath Coded Web App that surfaces Resolution Drafter Agent runs as cards, lets a reviewer open each drafted email, submit LLM-Ops feedback against the agent's trace, and promote that feedback into the agent's memory space.

For end-to-end setup against a fresh UiPath organization (Data Fabric entities, agent, memory space, this app), follow the runbook in [`../INSTALL.md`](../INSTALL.md).

## Configure

Every tenant-specific GUID lives in [`src/config/agentTargets.ts`](./src/config/agentTargets.ts). Each is set to the literal string `'TODO_FROM_INSTALL'`; replace them with the values captured in INSTALL.md phases 1, 3, and 4 (commented inline).

Environment variables go in `.env` (copy `.env.example`):

```
VITE_UIPATH_CLIENT_ID=<your PKCE client id>
VITE_UIPATH_SCOPE=<your scopes>
VITE_UIPATH_ORG_NAME=<your org slug>
VITE_UIPATH_TENANT_NAME=<your tenant slug>
VITE_UIPATH_BASE_URL=https://cloud.uipath.com
```

## Run

```bash
npm install
npm run dev       # local dev server on http://localhost:5173
npm run build     # tsc -b && vite build
npm test          # vitest run
```

Sign in via PKCE, then open `#/drafts` — you should see one card per `DisputeResolutionDrafts` row created during INSTALL.md Phase 5.

## Architecture

- **Auth**: PKCE OAuth against the UiPath cloud tenant (`src/hooks/useAuth.tsx`).
- **Data**: The `@uipath/uipath-typescript` SDK for Folders, Jobs, Processes, Data Fabric (`Disputes`, `DisputeResolutionDrafts`). Raw `fetch` for LLM-Ops endpoints (Feedback API, Trace spans API) that have no SDK coverage yet.
- **Feedback**: `src/lib/feedback.ts` POSTs to `/llmopstenant_/api/Feedback`. The `x-uipath-folderkey` header is required; the `spanId` is the agentRun span GUID-padded; the `categories` array must be non-empty (the IM per-trace feedback view filters out entries with empty categories).
- **Memory promotion**: `src/lib/memoryFeedback.ts` POSTs to `/llmopstenant_/api/Agent/memory/<id>/ingest` with the trace's agentRun-span attributes blob.
- **Routing**: `react-router-dom` `HashRouter`. `#/drafts` lists; `#/drafts/<jobKey>` opens detail.

## Deploy as a UiPath Coded Web App

After `npm run build`, package and publish via the standard UiPath Coded Web Apps flow. See the UiPath docs for the current upload + publish process.
