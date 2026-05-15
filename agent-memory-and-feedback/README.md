# Agent Memory and Feedback

A runnable sample that demonstrates **episodic memory** and **feedback** for UiPath Agents, using the **Resolution Drafter Agent** at fictional company PATH Industries.

## The concepts
This sample is designed to illustrate how the following concepts work:
- Agent Memory (Episodic) - how it works, and how to set it up.
- Feedback Collection - how (and why) to collect it, and how it gets used in memory.
- Evals (for Memory) -  how to measure improvements.

Critically, Agent Memory helps Agents perform better in two scenarios:

(1) When agents see **similar looking input**. Similar to how human memory works, it's something like "the next time you encounter a scenario {X}, do {Y}". Of course, this is not an exact match - scenarios may not be *exactly* alike. You might have to proces 2 different platinum customers in the similar way, but they are different customers with the same status tier. Or you might need to process two similarly looking emails for a support request - the intent is the same, but the exact wording differs slightly. 

(2) When tribal knowledge / edge case need to be captured. These might not be known at development time, and may only occur when you deploy the agent in front of users. By capturing feedback, and adding it to memory, you can **insert the right knowledge, at the right place, at the right time its needed** - instead of an endlessly long system prompt.

Interested now? Read on.

## The scenario

PATH Industries is a (fictional) mid-cap steel manufacturer processing roughly 30,000 invoices per year. A typical B2B invoice goes to a buyer governed by Indian GST rules, and 2–5% of invoices come back as disputes for a variety of reasons. Each dispute is investigated by an analyst, a financial adjustment (credit memo or revised invoice) is posted in the ERP, and the customer is sent a resolution email.

This sample focuses on the **last step** — writing that email. The **Resolution Drafter Agent** takes the closed dispute and the adjustment that was posted, and produces a `{ subject, body }` JSON object. The email must be specific (no rounding amounts, no paraphrasing IDs), compliance-correct, and tone-matched to the customer tier and account history. Static prompting can get most cases right; the long tail of phrasing rules and edge cases is the gap episodic memory closes.

## Episodic memory and feedback

UiPath Agents distinguish three kinds of memory:

| Kind | What it holds | How UiPath implements it |
| :--- | :--- | :--- |
| Semantic | Facts | Context Grounding Index |
| Procedural | Instructions | System prompt |
| Episodic | Experiences | Memory Space (the focus of this sample) |

The flow of how Agent Memory works is this:

1. The agent runs and emits a trace.
2. A human reviewer looks at the resulting email and submits **feedback** — typically a correction ("for platinum-tier credits ≥ ₹5L, you must mention the account manager").
3. (Optional) An SME (typically a team lead in the business) reviews the feedback, discarding invalid feedback.
3. The feedback is **added** into an agent **memory space**.
4. On future runs, the agent's input is semantically searched against the memory space; matching `<input, output, feedback>` triples are appended to the **end of the system prompt** as few-shot examples.

The agent does not get retrained and does not need re-deployment — the agent learns continuously from feedback over time from the business users.

## The Resolution Drafter Agent

The Resolution Drafter searches memory on three of its fourteen inputs — `root_cause`, `flags`, and `customer_tier` — all at equal weight (see [`AgentMemoryAndFeedback.sln/Agent/features/Resolution Draft Memory/feature.json`](./AgentMemoryAndFeedback.sln/Agent/features/Resolution%20Draft%20Memory/feature.json)). The other inputs (customer name, invoice number, adjustment ID, amounts, finance manager, company name, the free-text dispute description) are not searched on, so memory is keyed to scenario shape (kind of dispute, account flags, tier) rather than partitioned by customer. Memory is scoped to the **entire agent**, not per-customer.

This sample ships **10 memory items** (`M1`–`M10`), each capturing a real category of feedback. Examples:

- **M2** — for duplicate-charge credits, state that the duplicate was caught by internal reconciliation and that other invoices on the account were cross-checked. Without that reassurance, customers spent hours auditing their other invoices on their own and called PATH's finance team to confirm.
- **M3** — for platinum-tier credits ≥ ₹5L, add a line that the account manager has been informed and may follow up. Account managers were getting blindsided when CFO-level customers heard about large credits from finance before the relationship layer did.
- **M6** — for pricing-mismatch credits, commit to fixing the rate card in the billing system so the same error won't recur next month. Roughly a quarter of customers were filing the same dispute the following month because the original email said nothing about an upstream fix.

Run the agent without memory and the emails are competent but generic. Promote the 10 items into memory and re-run, and the emails pick up the institutional knowledge.

## The three assets

### UiPath Solution (`AgentMemoryAndFeedback.sln/`)

A deployable UiPath Solution bundling the Resolution Drafter agent, an RPA wrapper process slot, and the memory-space binding into a single `.uipx` package. Open `AgentMemoryAndFeedback.sln/` in Studio Web's Local Workspace to inspect prompts, schemas, eval sets, and the memory-space configuration. The agent uses Claude Opus 4.6, temperature 0, max tokens 64,000, deterministic, non-conversational. Takes 14 inputs (customer, dispute, adjustment, sign-off) and produces 2 outputs (`subject`, `body`).

### Data Fabric Entities (`entities/`)

Two flat entities back the agent at runtime.

- **`Disputes`** — one row per customer dispute. Mirrors the 14 input fields of the Resolution Drafter, plus an `evalName` tag. Loaded at runtime from `data/memory-pressure-test-inputs.json` (the 10 memory pressure-tests). The 20 design-time evals (`B1`–`B10`, `M1`–`M10`) live in `AgentMemoryAndFeedback.sln/Agent/evals/eval-sets/` and run through Agent Builder directly — they don't go into Data Fabric.
- **`DisputeResolutionDrafts`** — one row per email the agent drafts. Holds the agent's two outputs (`subject`, `body`), a `disputeId` foreign key back to `Disputes`, the OR `jobKey` and `traceId` (for the feedback chain), and an `isReviewed` boolean the coded app flips.

### UiPath Coded App (`app/`)

`agent-feedback-app` — a React + TypeScript + Vite single-page app deployed as a UiPath Coded Web App. Surfaces Resolution Drafter runs as a card grid, opens each into a detail view showing the dispute inputs alongside the drafted email, and lets a reviewer:

1. **Submit LLM-Ops feedback** against the agent's trace span (with the `x-uipath-folderkey` header, agentRun span ID GUID-padded, and the categories array the Instance Management view requires).
2. **Promote that feedback into the memory space** so it becomes a future few-shot example.

The single configuration point is `app/src/config/agentTargets.ts` — every tenant-specific GUID (process key, folder key, agent ID, entity IDs, memory space ID) is set to `TODO_FROM_INSTALL` and populated during setup.

## Getting started

Open [`INSTALL.md`](./INSTALL.md). It is structured as an 8-phase runbook that another Claude Code session can execute against a fresh UiPath organization: create the two Data Fabric entities, load the eval and pressure-test data, build the agent in the portal, create a memory space, run the 10 memory pressure-tests and submit feedback for each, ingest the feedback into the memory space, deploy the coded app, and verify end-to-end by re-running one memory test with memory on.
