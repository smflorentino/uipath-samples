# data/

Runtime data for the memory-feedback loop. The 20 design-time evals (`B1`–`B10` baseline, `M1`–`M10` memory-driven) are **not** here — they live as proper UiPath evaluation sets in [`../AgentMemoryAndFeedback.sln/Agent/evals/eval-sets/`](../AgentMemoryAndFeedback.sln/Agent/evals/eval-sets/) and are run by Agent Builder directly. Nothing in this folder is loaded for design-time eval runs.

## Files

| File | Purpose |
| :--- | :--- |
| `memory-pressure-test-inputs.json` | 10 rows (`M1-item0`–`M10-item0`) loaded into the `Disputes` Data Fabric entity in [INSTALL.md Phase 2](../INSTALL.md). Each row is a 14-field agent input representing a *past* dispute whose drafted email needs the institutional feedback baked in. |
| `memory-items.json` | 10 triples — one per pressure-test input — carrying the past output the agent originally produced, the expected output after feedback is applied, and the analyst feedback prose itself. `scripts/run_eval.py` reads this file at runtime to attach the right feedback string to each agent run's trace. |
| `build_data.py` | Source of truth. Regenerates both JSON files from inline Python dicts. Run `python3 build_data.py` after editing. |

## How they're used

1. **INSTALL.md Phase 2** — `uip df records insert <Disputes-entity> --file data/memory-pressure-test-inputs.json` loads the 10 pressure-test rows.
2. **INSTALL.md Phase 5** — `scripts/run_eval.py --all` reads `data/memory-items.json` to pair each agent run with its analyst feedback, then POSTs the feedback against the resulting trace span.
3. **INSTALL.md Phase 6** — `scripts/ingest_memory.py` promotes each feedback-tagged trace into the memory space.

The pressure-test rows and the `pastInput` blocks inside `memory-items.json` are the same 14 input fields, denormalized because the consumers (Data Fabric bulk insert vs. per-eval Python lookup) want them in different shapes.
