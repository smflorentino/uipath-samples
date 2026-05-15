# INSTALL — Agent Memory and Feedback

Step-by-step runbook to deploy this sample on a **fresh UiPath organization**. Intended to be executed by a Claude Code session (or a developer reading along) against a live tenant. The end state is: 10 dispute rows loaded, a memory space populated with 10 feedback-promoted memories, the Resolution Drafter Solution deployed, and the `agent-feedback-app` coded app running locally and surfacing the runs.

Total time: ~60 minutes for a careful run.

## Prereqs

- A UiPath organization (cloud) with admin access. Data Fabric, Agents (Builder), and LLM Ops must be enabled on the target tenant.
- [`uip` CLI](https://docs.uipath.com/automation-cloud/automation-cloud/latest/admin-guide/uipath-command-line-interface) installed.
- Python 3.10+ on the executor's machine. The scripts use only the standard library.
- Node 20+ and npm.
- `/usr/bin/curl` on PATH (used by `ingest_memory.py` for the LLM-Ops POST).

## Working notes

Before starting, copy the working-notes template once:

```bash
cp INSTALL_NOTES_TEMPLATE.md INSTALL_NOTES.md
```

[`INSTALL_NOTES.md`](./INSTALL_NOTES.md) is `.gitignore`d (it ends up holding tenant GUIDs, account IDs, and per-run identifiers — none of which belong in source control). The [`INSTALL_NOTES_TEMPLATE.md`](./INSTALL_NOTES_TEMPLATE.md) version is committed and kept clean. Edit only the copy. **Fill it in as you go** — every phase below tells you exactly what to record.

---

## Phase 1 — Verify login and capture session identifiers

The memory-space, folder, and agent endpoints all need session-scoped GUIDs. Capture them up front.

```bash
uip login status --output json
```

If `Status` is not `"Logged in"`, run `uip login` and complete the browser auth flow before continuing.

Then capture session identifiers:

```bash
uip login refresh --output json
```

From the response, record into `INSTALL_NOTES.md`:

| Response field | Working-notes variable |
| :--- | :--- |
| `OrganizationName` | `ORG_NAME` |
| `OrganizationId` | `INTERNAL_ACCOUNT_ID` |
| `TenantName` | `TENANT_NAME` |
| `TenantId` | `INTERNAL_TENANT_ID_GUID` |
| `BaseUrl` | `BASE_URL` (you'll derive the portal host from this) |

> The `OrganizationId` and `TenantId` returned by `login refresh` are the **internal GUIDs** the LLM-Ops API expects in `x-uipath-internal-accountid` and `x-uipath-internal-tenantid` headers. They are not the tenant slug (`DefaultTenant`, `Memory`, etc.).

Also grab the long Orchestrator tenant ID. The CLI exposes only the **GUID**-form tenant ID; the coded app's `agentTargets.ts` (`orchestratorTenantIdLong`) needs the **numeric** form — the `tid=` you see in any Orchestrator portal URL. Get it via one REST call to Orchestrator's `GetCurrentUser` endpoint, reusing the access token `uip login refresh` just minted:

```bash
REFRESH=$(uip login refresh --output json)
ACCESS_TOKEN=$(echo "$REFRESH" | python3 -c 'import sys,json; print(json.load(sys.stdin)["Data"]["AccessToken"])')
BASE_URL=$(echo "$REFRESH"     | python3 -c 'import sys,json; print(json.load(sys.stdin)["Data"]["BaseUrl"])')
ORG_NAME=$(echo "$REFRESH"     | python3 -c 'import sys,json; print(json.load(sys.stdin)["Data"]["OrganizationName"])')
TENANT_NAME=$(echo "$REFRESH"  | python3 -c 'import sys,json; print(json.load(sys.stdin)["Data"]["TenantName"])')

curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/$ORG_NAME/$TENANT_NAME/orchestrator_/odata/Users/UiPath.Server.Configuration.OData.GetCurrentUser" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["TenantId"])'
```

> The runbook deliberately uses `curl` (a documented prereq) rather than Python's `urllib` for the HTTPS call — `python.org` Python on macOS doesn't trust the system keychain, so a stdlib request would fail certificate verification on a fresh machine. `curl` uses the OS trust store via Secure Transport / OpenSSL.

Record the printed integer as `ORCH_TENANT_ID_LONG`.

> This is the **only** raw REST call the runbook makes — every later step goes back through `uip`. If for some reason the call fails, the manual fallback is to open any Orchestrator page in the portal and copy the `tid=` query param from the URL.

---

## Phase 2 — Create the Memory Space and attach it to the agent

The agent's binding at `AgentMemoryAndFeedback.sln/Agent/features/Resolution Draft Memory/feature.json` ships with `referenceKey: TODO_FROM_INSTALL`. The user has to (a) create a memory space in the portal and (b) attach it to the agent in Studio Web Local Workspace — the attach action is what rewrites `feature.json` locally with the real `referenceKey`.

### 2a — Compute the Agents portal URL

The Agents portal lives on the **portal host** (without `.api.`). Derive it from `BASE_URL`:

```bash
PORTAL_BASE=$(echo "$BASE_URL" | sed 's|\.api\.|.|')
echo "$PORTAL_BASE/$ORG_NAME/agents_/memory"
```

### 2b — Create the memory space in the portal (manual)

Open the URL printed above. Click **+ Create memory space** and configure:

- **Name**: `Resolution Draft Memory` (use this exact name — `feature.json` references it by name)
- **Folder**: `Shared` (the memory space is created independently of the agent's solution folder, which doesn't exist yet — picking `Shared` keeps everything under the same parent the Phase 6 solution-folder will land in)
- **Retrieval keys** (three, all equal weight — these must match what `feature.json` declares):
  - `customer_tier`
  - `flags`
  - `root_cause`

Click **Create**. The portal navigates to the memory-space page.

### 2c — Capture and validate the memory-space GUID

The URL of the memory-space page is `…/agents_/memory/<MEMORY_SPACE_ID>`. Paste it into `verify_memory_space.py` to extract the GUID and confirm the URL shape — don't eyeball it:

```bash
python3 scripts/verify_memory_space.py \
  --url 'https://<portal>/<org>/agents_/memory/<GUID>' \
  --skip-feature-json
```

Expected output: `OK — URL parses cleanly; MEMORY_SPACE_ID = <guid>`. Record that GUID as `MEMORY_SPACE_ID` in `INSTALL_NOTES.md`. `MEMORY_FOLDER_KEY` gets captured later — Phase 5f populates `FOLDER_KEY` after the solution deploys, and you can set `MEMORY_FOLDER_KEY` to the same value if your memory space lives under the same parent (`Shared`).

### 2d — Attach the memory space to the agent in Studio Web Local Workspace (manual)

Open `AgentMemoryAndFeedback.sln/` in **Studio Web → Local Workspace**. Inside the solution:

1. Open the `Agent` sub-project.
2. Find the **Memory** section (left panel or agent settings).
3. **Attach existing memory space** → select `Resolution Draft Memory` (the one you just created).
4. Save.

Studio Web rewrites `feature.json` locally with the real `referenceKey`, regenerates the internal feature `id`, and pulls the live `memorySpaceName` from the cloud. The retrieval-key configuration (`customer_tier`, `flags`, `root_cause` at weight 1, hybrid search, top-3) stays as the local declaration already had it.

### 2e — Verify the attach took

Same script as 2c, with the URL passed so the GUID from the portal is cross-checked against the GUID Studio Web wrote into `feature.json`:

```bash
python3 scripts/verify_memory_space.py \
  --url 'https://<portal>/<org>/agents_/memory/<MEMORY_SPACE_ID>'
```

Expected output:

```
OK — URL parses cleanly; MEMORY_SPACE_ID = <guid>
OK — referenceKey:      <same guid>
OK — retrieval keys:    ['customer_tier', 'flags', 'root_cause']
OK — memorySpaceName:   Resolution Draft Memory
OK — URL's GUID matches feature.json's referenceKey
```

If you see `feature.json.referenceKey is still 'TODO_FROM_INSTALL'`, the attach didn't take — re-do step 2d in Studio Web (save explicitly; some SW Local Workspace versions only persist on Save). If you see `MISMATCH`, you attached a different memory space than the one whose URL you pasted — re-attach in Studio Web targeting the right space.

For the strongest check — also hit the API to confirm the memory space actually exists in your active tenant:

```bash
python3 scripts/verify_memory_space.py \
  --url 'https://<portal>/<org>/agents_/memory/<MEMORY_SPACE_ID>' \
  --server-check
```

---

## Phase 3 — Create the two Data Fabric entities

```bash
uip df entities create --file entities/Disputes.entity.json --output json
uip df entities create --file entities/DisputeResolutionDrafts.entity.json --output json
```

Record `Id` from each response as `DISPUTES_ENTITY_ID` and `DRAFTS_ENTITY_ID`.

> **`DisputeResolutionDrafts.disputeId`** is a `STRING` holding a `Disputes.Id`. No server-side relationship enforcement — joins happen in the app and scripts via filter queries. This keeps the sample portable across Data Fabric versions that handle relationship-typed fields differently.

Verify field counts:

```bash
uip df entities get $DISPUTES_ENTITY_ID --output json | python3 -c 'import sys,json; d=json.load(sys.stdin)["Data"]; print(len(d["fields"]), "fields on Disputes")'
uip df entities get $DRAFTS_ENTITY_ID --output json | python3 -c 'import sys,json; d=json.load(sys.stdin)["Data"]; print(len(d["fields"]), "fields on DisputeResolutionDrafts")'
```

Expected: `15 fields on Disputes`, `7 fields on DisputeResolutionDrafts`.

---

## Phase 4 — Load the 10 memory pressure-test inputs into `Disputes`

```bash
uip df records insert $DISPUTES_ENTITY_ID --file data/memory-pressure-test-inputs.json --output json
```

10 rows (`M1-item0`–`M10-item0`) — past disputes whose drafted emails need the matching analyst feedback. These are the only rows that go into Data Fabric: they exist at runtime so the agent (via the RPA wrapper) can produce a real trace to attach feedback to. The 20 design-time evals (`B1`–`B10`, `M1`–`M10`) live in [`AgentMemoryAndFeedback.sln/Agent/evals/eval-sets/`](./AgentMemoryAndFeedback.sln/Agent/evals/eval-sets/) and are run by Agent Builder directly — no Data Fabric round-trip needed.

Verify:

```bash
uip df records query $DISPUTES_ENTITY_ID --body '{"selectedFields":["evalName"]}' --output json \
  | python3 -c 'import sys,json; rs=json.load(sys.stdin)["Data"]["Records"]; print(len(rs), "rows"); print(sorted([r.get("evalName") for r in rs if r.get("evalName")]))'
```

Expected: `10 rows` and the sorted list `["M1-item0", "M10-item0", "M2-item0", …, "M9-item0"]`.

---

## Phase 5 — Open the Solution, add the RPA wrapper, pack/publish/deploy

The agent ships as a **UiPath Solution** in `AgentMemoryAndFeedback.sln/`. A Solution bundles the agent, an RPA wrapper process, and a memory-space resource declaration under one deployable unit (`.uipx`).

The end-state: a `Solution`-typed folder named `PATH Industries Demo` created under `Shared/` by the `deploy run` step, containing the deployed Agent + `ResolutionDrafter.Process`.

### 5a — Open the Solution in Studio Web Local Workspace

Studio Web → Local Workspace → Open Project → select `AgentMemoryAndFeedback.sln/`. The Solution opens with the `Agent` sub-project and the memory-space binding (now pointing at the real GUID from Phase 2d).

### 5b — Add an RPA wrapper process to the Solution

The Agent itself is the LLM call. To drive it from `scripts/run_eval.py` (and the coded app's "re-run draft" action), the Solution needs an **RPA process** that:

1. Accepts one input argument: `draftEntityId` (string).
2. Looks up the `DisputeResolutionDrafts` row by that ID, then its parent `Disputes` row via `disputeId`.
3. Passes the 14 fields of the `Disputes` row through to the agent's `Invoke Agent` activity (entity field names are snake_case to match the agent's input schema 1:1).
4. Writes the agent's `subject` and `body` outputs back to the `DisputeResolutionDrafts` row, along with the current `jobKey`.

In Studio Web, inside the Solution: **Add → Process → name it `ResolutionDrafter.Process`**, build the four steps above, and reference the `Agent` sub-project as a dependency.

> The simplest minimal wrapper is three activities: Data Fabric `Get Record` → `Invoke Agent` → `Update Record`.

### 5c — Pack the Solution

```bash
uip solution pack ./AgentMemoryAndFeedback.sln ./dist --output json
```

Produces `./dist/AgentMemoryAndFeedback.<version>.zip`. The default package version is `1.0.0`; override with `--version` on subsequent rebuilds (the feed rejects duplicate name+version pairs).

### 5d — Publish to the solution feed

```bash
uip solution publish ./dist/AgentMemoryAndFeedback.<version>.zip --output json
```

Successful output includes `PackageName`, `PackageVersion`, and `PackageVersionKey`. Verify the package is in the feed:

```bash
uip solution packages list --output json
```

### 5e — Deploy into `Shared/PATH Industries Demo`

`deploy run` **creates** a new `Solution`-typed folder — `--folder-name` is the name to create, not an existing folder to deploy into. Land it under `Shared/` via `--parent-folder-path`:

```bash
uip solution deploy run \
  --name "PATH Industries Demo" \
  --package-name "AgentMemoryAndFeedback" \
  --package-version "<version-from-5c>" \
  --folder-name "PATH Industries Demo" \
  --parent-folder-path "Shared" \
  --output json
```

> If you prefer to pass the parent by GUID, capture the Shared folder's key once with `uip or folders get "Shared" --output json` (record as `SHARED_FOLDER_KEY`) and use `--parent-folder-key $SHARED_FOLDER_KEY` instead of `--parent-folder-path`. Path-based form works fine — the key is only required if your tenant has multiple folders named `Shared` and you need to disambiguate.

A successful run returns `Status: DeploymentSucceeded` and `ActivationStatus: SuccessfulActivate`. The output also exposes `DeploymentKey`, `PipelineDeploymentId`, `InstanceId`, `FolderName`, and `FolderPath` — but **not** the new folder's GUID, the deployed agent ID, or the process release key. Capture those in 5f.

If the deploy reports an activation failure, fix the config and retry with `uip solution deploy activate "PATH Industries Demo"` — the deployment itself succeeded; only activation didn't.

### 5f — Capture deployed identifiers

```bash
uip or folders get "Shared/PATH Industries Demo" --output json  # → FOLDER_KEY (GUID), FOLDER_ID (numeric), FOLDER_NAME
uip agent list --output json                                     # → AGENT_ID
uip or processes list --folder-key $FOLDER_KEY --output json     # → PROCESS_KEY (the ResolutionDrafter.Process ReleaseKey)
```

Record `FOLDER_KEY`, `FOLDER_ID`, `FOLDER_NAME`, `AGENT_ID`, and `PROCESS_KEY` in `INSTALL_NOTES.md`. If your Phase 2 memory space lives under `Shared` too, set `MEMORY_FOLDER_KEY = FOLDER_KEY`.

---

## Phase 6 — Run the 10 memory pressure-tests and submit feedback

For each `M1-item0` through `M10-item0`, this single invocation runs the agent on the pressure-test input, polls until the job finishes, reads the drafted email back from the `DisputeResolutionDrafts` row, and POSTs the analyst-feedback string (from `data/memory-items.json`) against the agent's trace span.

```bash
python3 scripts/run_eval.py \
  --all \
  --process-key   $PROCESS_KEY \
  --folder-key    $FOLDER_KEY \
  --disputes-entity $DISPUTES_ENTITY_ID \
  --drafts-entity   $DRAFTS_ENTITY_ID \
  --agent-id      $AGENT_ID \
  --feedback \
  --negative \
  --feedback-category Output \
  --max-workers 1
```

`--max-workers 1` runs the 10 items sequentially — recommended on the first pass while you're still verifying the wiring.

Each item emits a JSON object on stdout that looks like:

```json
{
  "evalName": "M1-item0",
  "disputeId": "...",
  "draftId": "...",
  "jobKey": "...",
  "jobState": "Successful",
  "agentRunSpanId": "00000000-0000-0000-XXXX-XXXXXXXXXXXX",
  "subject": "Revised Invoice Issued for INV-2026-02-1144",
  "body": "Dear Madhav,\n\n...",
  "feedbackId": "...",
  "feedbackSpanScope": "agentRun"
}
```

**Append each `feedbackId` to your working notes**, one per line under `FEEDBACK_IDS`. You will need all 10 in Phase 7.

If any run fails, fix the underlying issue before continuing — usually the RPA wrapper not reading `draftEntityId` correctly, a permissions gap (Logs.View / Logs.Create), or a memory-space binding mismatch.

---

## Phase 7 — Promote the 10 feedbacks into the memory space

```bash
python3 scripts/ingest_memory.py \
  --memory-space-id   $MEMORY_SPACE_ID \
  --memory-space-name "Resolution Draft Memory" \
  --folder-key        $MEMORY_FOLDER_KEY \
  --feedback-ids      "$FEEDBACK_IDS" \
  --verbose
```

(`$FEEDBACK_IDS` should be the 10 IDs comma-separated.)

Each item runs `uip traces feedback get` → `uip traces spans get` → POST to `/llmopstenant_/api/Agent/memory/<id>/ingest` with the agentRun span's `Attributes` blob as the payload. A successful response has `httpStatus: 200` and a `responseBody` containing the new `memoryItemId`.

**Smoke-test first** with `--dry-run`:

```bash
python3 scripts/ingest_memory.py [...same args] --dry-run
```

Verify by opening the memory space in the portal: 10 items should be listed, each named after the corresponding agentRun. If only a subset shows, the missing `feedbackId`(s) didn't have an `agentRun` span on their trace — re-run that specific item in Phase 6 and re-ingest.

---

## Phase 8 — Build and run the coded app locally

```bash
cd app
cp .env.example .env
# Edit .env: VITE_UIPATH_CLIENT_ID, VITE_UIPATH_ORG_NAME, VITE_UIPATH_TENANT_NAME
# (BASE_URL stays as https://cloud.uipath.com for the public cloud)

# Edit src/config/agentTargets.ts and replace every TODO_FROM_INSTALL with a
# captured value. Each placeholder has a comment naming the phase it came from.

npm install
npm run build      # tsc -b && vite build — confirms no type regressions
npm test           # vitest run
npm run dev        # serves http://localhost:5173
```

Sign in via PKCE, then navigate to `http://localhost:5173/#/drafts`. The card grid should list the 10 drafts created during Phase 6. Open one to see the dispute inputs alongside the drafted `subject` and `body`, plus a feedback form.

To **deploy as a UiPath Coded Web App**: after `npm run build`, package and publish via the standard UiPath Coded Web Apps flow.

---

## Phase 9 — End-to-end verification (the "memory on" rerun)

The payoff of this sample is the diff between the same agent, on the same input, with and without memory. With memory now populated by Phase 7, re-run one of the memory pressure-tests and compare:

```bash
python3 scripts/run_eval.py \
  --eval-name M1-item0 \
  --process-key   $PROCESS_KEY \
  --folder-key    $FOLDER_KEY \
  --disputes-entity $DISPUTES_ENTITY_ID \
  --drafts-entity   $DRAFTS_ENTITY_ID \
  --agent-id      $AGENT_ID
```

Expected: the **new** draft contains the load-bearing language from M1's feedback that was absent from the original — specifically:

- An explicit instruction to **reverse the IGST input tax credit** previously claimed and **reclaim CGST+SGST** in the next **GSTR-3B** return.
- A citation of **Rule 53 of the CGST Rules**.

Compare against the past output stored in `data/memory-items.json` under `M1-item0.pastOutput.body` — the new draft should include those clauses; the past one does not.

Repeat for `M3-item0` (platinum-tier account-manager mention) or `M5-item0` (steel HSN family ₹/MT citation) for two more clear before/after diffs.

---

## What you have at the end

- **One memory space** in your deployment folder, populated with 10 promoted feedback items.
- **Two Data Fabric entities** (`Disputes`, `DisputeResolutionDrafts`), with the 10 pressure-test rows plus 10 generated draft rows.
- **One Resolution Drafter Solution** deployed: the agent + RPA wrapper, both bound to the memory space.
- **One coded app** running locally (and optionally deployed) that surfaces drafts and lets reviewers submit additional feedback + promote it.

From here, run any of the 20 evals (`B1`–`B10` and `M1`–`M10`) against the agent with memory turned on (from Agent Builder), and the memory-driven evals (`M1`–`M10`) should now pass where they previously failed.
