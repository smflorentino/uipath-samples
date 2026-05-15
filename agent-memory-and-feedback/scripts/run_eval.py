#!/usr/bin/env python3
"""Run the Resolution Drafter Agent on a Disputes row and (optionally) submit feedback.

For each --eval-name, this script:
  1. Queries the Disputes entity for the row tagged with that evalName.
  2. Inserts a new DisputeResolutionDrafts row pointing at that dispute.
  3. Starts the RPA process wrapping the agent, passing the draft row ID.
  4. Polls until the job completes.
  5. Fetches the trace, locates the agentRun span, and reads the draft's subject/body.
  6. If --feedback is set, posts the analyst feedback (from data/memory-items.json) against the agent's trace span.

Single-item per invocation; pass --all or repeat --eval-name to run multiple items
sequentially or with a small thread pool.

EXAMPLES

  # Single memory pressure-test, with feedback submission.
  python3 run_eval.py \\
    --eval-name M1-item0 \\
    --process-key <UUID> \\
    --folder-key <UUID> \\
    --disputes-entity <UUID> \\
    --drafts-entity <UUID> \\
    --agent-id <UUID> \\
    --feedback \\
    --feedback-from-memory-items ../data/memory-items.json \\
    --negative \\
    --feedback-category Output

  # All ten memory pressure-tests with feedback (sequential is safest while you
  # build up state in the memory space — see INSTALL.md Phase 5).
  python3 run_eval.py --all [...same args]

PREREQS
  - `uip` CLI installed and authenticated against the target tenant.
  - Phases 1–4 of INSTALL.md complete (entities created, data loaded, agent
    published, memory space created and bound to the agent).
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional


def uip(*args: str, check: bool = True) -> dict:
    cmd = ["uip", *args, "--output", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 and check:
        raise RuntimeError(f"uip failed: {' '.join(shlex.quote(a) for a in cmd)}\n{proc.stderr}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"uip returned non-JSON output: {proc.stdout!r}\nstderr: {proc.stderr}") from e


def query_one(entity_id: str, field_name: str, value: str) -> dict:
    body = json.dumps({
        "filterGroup": {
            "logicalOperator": 0,
            "queryFilters": [{"fieldName": field_name, "operator": "=", "value": value}],
        }
    })
    resp = uip("df", "records", "query", entity_id, "--body", body)
    records = resp["Data"]["Records"]
    if not records:
        raise RuntimeError(f"no records in {entity_id} where {field_name}={value!r}")
    return records[0]


def insert_draft(drafts_entity: str, dispute_id: str) -> str:
    body = json.dumps({"disputeId": dispute_id})
    resp = uip("df", "records", "insert", drafts_entity, "--body", body)
    return resp["Data"]["Id"]


def start_job(process_key: str, folder_key: str, draft_id: str) -> str:
    inputs = json.dumps({"draftEntityId": draft_id})
    resp = uip(
        "or", "jobs", "start", process_key,
        "--folder-key", folder_key,
        "--input-arguments", inputs,
    )
    return resp["Data"]["Jobs"][0]["Key"]


def poll_job(job_key: str, interval: int, timeout: int) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = uip("or", "jobs", "get", job_key)
        state = resp["Data"]["State"]
        if state in ("Successful", "Faulted", "Stopped"):
            return state
        time.sleep(interval)
    raise TimeoutError(f"job {job_key} did not finish within {timeout}s")


def get_spans(job_key: str) -> list[dict]:
    resp = uip("traces", "spans", "get", job_key)
    return resp["Data"]


def span16_to_guid(span16: str) -> str:
    """Convert a 16-char hex span id to the GUID form the feedback API expects."""
    s = span16.replace("-", "").lower()
    if len(s) != 16:
        raise ValueError(f"expected 16-char hex span id, got {span16!r}")
    return f"00000000-0000-0000-{s[:4]}-{s[4:]}"


def find_span(spans: list[dict], span_type: str) -> Optional[str]:
    for s in spans:
        if (s.get("SpanType") or "") == span_type:
            return s.get("Id")
    return None


def get_draft(drafts_entity: str, draft_id: str) -> dict:
    resp = uip("df", "records", "get", drafts_entity, draft_id)
    return resp["Data"]


def post_feedback(
    *,
    trace_id: str,
    span_id_guid: Optional[str],
    sentiment: str,
    comment: str,
    categories: list[str],
    folder_key: str,
    agent_id: Optional[str],
) -> str:
    args = [
        "traces", "feedback", "create",
        "--trace-id", trace_id,
        f"--{sentiment}",
        "--comment", comment,
        "--folder-key", folder_key,
    ]
    if span_id_guid:
        args += ["--span-id", span_id_guid]
    for c in categories:
        args += ["--category", c]
    if agent_id:
        args += ["--agent-id", agent_id]
    resp = uip(*args)
    return resp["Data"]["id"]


@dataclass
class Config:
    process_key: str
    folder_key: str
    disputes_entity: str
    drafts_entity: str
    agent_id: Optional[str] = None
    poll_interval: int = 10
    poll_timeout: int = 300
    do_feedback: bool = False
    feedback_text_source: str = "inline"  # inline | file | memory-items
    feedback_inline: Optional[str] = None
    feedback_file: Optional[str] = None
    feedback_memory_items_path: Optional[str] = None
    feedback_sentiment: str = "negative"  # negative | positive
    feedback_categories: list[str] = field(default_factory=lambda: ["Output"])
    feedback_span: str = "agentRun"  # agentRun | agentOutput | root


def resolve_comment(cfg: Config, eval_name: str) -> str:
    if cfg.feedback_text_source == "inline":
        if not cfg.feedback_inline:
            raise ValueError("--feedback-comment is required for inline source")
        return cfg.feedback_inline
    if cfg.feedback_text_source == "file":
        if not cfg.feedback_file:
            raise ValueError("--feedback-comment-file is required for file source")
        if cfg.feedback_file == "-":
            return sys.stdin.read()
        with open(cfg.feedback_file) as f:
            return f.read()
    if cfg.feedback_text_source == "memory-items":
        if not cfg.feedback_memory_items_path:
            raise ValueError("--feedback-from-memory-items required when source is memory-items")
        with open(cfg.feedback_memory_items_path) as f:
            items = json.load(f)
        for item in items:
            if item.get("evalName") == eval_name:
                return item["feedback"]
        raise ValueError(f"no memory item with evalName={eval_name!r} in {cfg.feedback_memory_items_path}")
    raise ValueError(f"unknown feedback source: {cfg.feedback_text_source}")


def run_one(eval_name: str, cfg: Config) -> dict:
    out: dict = {"evalName": eval_name}
    try:
        dispute = query_one(cfg.disputes_entity, "evalName", eval_name)
        out["disputeId"] = dispute["Id"]
        out["draftId"] = insert_draft(cfg.drafts_entity, dispute["Id"])
        out["jobKey"] = start_job(cfg.process_key, cfg.folder_key, out["draftId"])
        out["traceId"] = out["jobKey"]
        state = poll_job(out["jobKey"], cfg.poll_interval, cfg.poll_timeout)
        out["jobState"] = state
        if state != "Successful":
            return out

        spans = get_spans(out["jobKey"])
        agent_run_16 = find_span(spans, "agentRun")
        agent_output_16 = find_span(spans, "agentOutput")
        out["agentRunSpanId"] = span16_to_guid(agent_run_16) if agent_run_16 else None
        out["agentOutputSpanId"] = span16_to_guid(agent_output_16) if agent_output_16 else None

        draft = get_draft(cfg.drafts_entity, out["draftId"])
        out["subject"] = draft.get("subject")
        out["body"] = draft.get("body")

        if cfg.do_feedback:
            span_map = {
                "agentRun": out["agentRunSpanId"],
                "agentOutput": out["agentOutputSpanId"],
                "root": None,
            }
            target_span = span_map[cfg.feedback_span]
            comment = resolve_comment(cfg, eval_name)
            out["feedbackId"] = post_feedback(
                trace_id=out["jobKey"],
                span_id_guid=target_span,
                sentiment=cfg.feedback_sentiment,
                comment=comment,
                categories=cfg.feedback_categories,
                folder_key=cfg.folder_key,
                agent_id=cfg.agent_id,
            )
            out["feedbackSpanScope"] = cfg.feedback_span
    except Exception as e:
        out["error"] = str(e)
    return out


def parse_args() -> tuple[list[str], Config, int]:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)

    sel = p.add_argument_group("selection")
    sel.add_argument("--eval-name", action="append", default=[], help="repeat for multiple")
    sel.add_argument("--all", action="store_true", help="run M1-item0 through M10-item0")
    sel.add_argument("--max-workers", type=int, default=1, help="parallel workers; default 1 (sequential)")

    tenant = p.add_argument_group("tenant config — capture these in INSTALL.md phases 1, 3")
    tenant.add_argument("--process-key", required=True, help="ReleaseKey of the RPA process that wraps the agent")
    tenant.add_argument("--folder-key", required=True, help="GUID of the folder the process is deployed in")
    tenant.add_argument("--disputes-entity", required=True, help="GUID of the Disputes entity")
    tenant.add_argument("--drafts-entity", required=True, help="GUID of the DisputeResolutionDrafts entity")
    tenant.add_argument("--agent-id", help="GUID of the Resolution Drafter agent (optional, attached to feedback)")

    job = p.add_argument_group("job")
    job.add_argument("--poll-interval", type=int, default=10)
    job.add_argument("--poll-timeout", type=int, default=300)

    fb = p.add_argument_group("feedback")
    fb.add_argument("--feedback", action="store_true", help="submit feedback after the run")
    fb_text = fb.add_mutually_exclusive_group()
    fb_text.add_argument("--feedback-comment", help="inline comment text")
    fb_text.add_argument("--feedback-comment-file", help="path or '-' for stdin")
    fb_text.add_argument("--feedback-from-memory-items", metavar="PATH", help="resolve feedback text from memory-items.json by matching evalName (default: ../data/memory-items.json relative to this script)")
    fb_sent = fb.add_mutually_exclusive_group()
    fb_sent.add_argument("--negative", dest="sentiment", action="store_const", const="negative")
    fb_sent.add_argument("--positive", dest="sentiment", action="store_const", const="positive")
    fb.add_argument("--feedback-category", action="append", default=None, help='repeatable; default ["Output"]')
    fb.add_argument("--feedback-span", choices=["agentRun", "agentOutput", "root"], default="agentRun")

    args = p.parse_args()

    eval_names = list(args.eval_name)
    if args.all:
        eval_names = [f"M{n}-item0" for n in range(1, 11)]
    if not eval_names:
        p.error("specify --eval-name (repeatable) or --all")

    if args.feedback_comment:
        source = "inline"
    elif args.feedback_comment_file:
        source = "file"
    elif args.feedback_from_memory_items:
        source = "memory-items"
    elif args.feedback:
        # default: try ../data/memory-items.json relative to this script
        source = "memory-items"
    else:
        source = "inline"

    memory_items_path = args.feedback_from_memory_items
    if source == "memory-items" and not memory_items_path:
        from pathlib import Path
        memory_items_path = str(Path(__file__).resolve().parent.parent / "data" / "memory-items.json")

    cfg = Config(
        process_key=args.process_key,
        folder_key=args.folder_key,
        disputes_entity=args.disputes_entity,
        drafts_entity=args.drafts_entity,
        agent_id=args.agent_id,
        poll_interval=args.poll_interval,
        poll_timeout=args.poll_timeout,
        do_feedback=args.feedback,
        feedback_text_source=source,
        feedback_inline=args.feedback_comment,
        feedback_file=args.feedback_comment_file,
        feedback_memory_items_path=memory_items_path,
        feedback_sentiment=args.sentiment or "negative",
        feedback_categories=args.feedback_category or ["Output"],
        feedback_span=args.feedback_span,
    )
    return eval_names, cfg, args.max_workers


def main() -> int:
    eval_names, cfg, max_workers = parse_args()
    if len(eval_names) == 1 or max_workers <= 1:
        results: list[dict] = []
        for name in eval_names:
            r = run_one(name, cfg)
            print(json.dumps(r, indent=2), flush=True)
            results.append(r)
    else:
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(run_one, name, cfg): name for name in eval_names}
            for f in as_completed(futures):
                r = f.result()
                print(json.dumps(r, indent=2), flush=True)
                results.append(r)

    failures = [r for r in results if "error" in r or r.get("jobState") != "Successful"]
    print(json.dumps({"summary": {"total": len(results), "failures": len(failures)}}, indent=2), flush=True)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
