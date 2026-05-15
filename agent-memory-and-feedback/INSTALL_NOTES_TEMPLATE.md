# Working notes — fill in as you go

> **Don't edit this file directly.** Copy it to `INSTALL_NOTES.md` first (INSTALL.md Phase 0 tells you how). The copy is `.gitignore`d so your tenant GUIDs and account IDs never end up in git.

Capture each GUID / identifier as INSTALL.md tells you to. The names match the placeholders the scripts and `app/src/config/agentTargets.ts` expect.

```
# Phase 1 — Session identifiers (from `uip login refresh`)
ORG_NAME=
INTERNAL_ACCOUNT_ID=
TENANT_NAME=
INTERNAL_TENANT_ID_GUID=
BASE_URL=
ORCH_TENANT_ID_LONG=

# Phase 2 — Memory space (pasted URL → extracted GUID)
MEMORY_SPACE_ID=
MEMORY_FOLDER_KEY=        # usually = FOLDER_KEY (set after Phase 5f)

# Phase 3 — Data Fabric entities
DISPUTES_ENTITY_ID=
DRAFTS_ENTITY_ID=

# Phase 5 — Deployed solution folder, agent + RPA wrapper process
FOLDER_KEY=
FOLDER_ID=
FOLDER_NAME=
AGENT_ID=
PROCESS_KEY=

# Phase 6 — Feedback IDs returned by run_eval.py (one per memory pressure-test)
FEEDBACK_IDS=
# M1-item0  ->
# M2-item0  ->
# M3-item0  ->
# M4-item0  ->
# M5-item0  ->
# M6-item0  ->
# M7-item0  ->
# M8-item0  ->
# M9-item0  ->
# M10-item0 ->
```

Once Phase 9 is reached, the captured values get pasted into:

- `app/.env` — for `VITE_UIPATH_ORG_NAME`, `VITE_UIPATH_TENANT_NAME`, etc.
- `app/src/config/agentTargets.ts` — every `TODO_FROM_INSTALL` placeholder maps to one of the variables above; the comments next to each placeholder name the phase that captures it.
