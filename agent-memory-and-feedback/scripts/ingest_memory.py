#!/usr/bin/env python3
"""
Ingest feedback-tagged agent traces into a UiPath Agent memory space.

For each feedbackId you provide, the script promotes the feedback's underlying
agent run into the agent's episodic-memory space, so future agent invocations
can retrieve it as a few-shot example.

Per item, the script:
  1. Resolves the feedback's traceId via
       `uip traces feedback get <feedbackId> --folder-key <folder>`
  2. Fetches the trace's spans via
       `uip traces spans get <traceId>`.
  3. Finds the `agentRun` span and takes its Attributes JSON string verbatim
     (already contains systemPrompt, userPrompt, input, output, schemas).
  4. POSTs to
       {base}/{org}/{tenantId}/llmopstenant_/api/Agent/memory/{memorySpaceId}/ingest
       ?memorySpaceName={urlencoded name}
     with body `{"feedbackId":"<id>","attributes":"<attrs string>"}` and the
     standard x-uipath-* headers.

Each item runs in a thread pool (--max-workers, default 5). Each emits a JSON
status object on stdout; a session summary is printed to stderr.

PREREQUISITES
  - `uip` CLI installed and authenticated to the target tenant
    (`uip login status` should show "Logged in").
  - The user account running `uip` must have:
      • Logs.View on --folder-key (for traces feedback get / spans get)
      • Automation Developer (or equivalent) on the agent folder so the
        bearer that `uip login refresh` returns can POST to the LLMOps
        memory ingest endpoint.
  - `/usr/bin/curl` available (POST routes through curl to use the system
    trust store).

WHERE TO GET THE IDS — see INSTALL.md Phase 4 for how to capture each value.

  --memory-space-id      Path-tail of the memory-space URL in the agents portal:
                           https://.../<org>/agents_/memory/<memorySpaceId>
                         Same value the browser sends as the path segment to
                         /api/Agent/memory/<this>/ingest.

  --memory-space-name    The human display name of the same space. Both are
                         required (path param + query param).

  --folder-key           Folder the memory space lives in (sent as
                         `x-uipath-folderkey`). In the simple case this is the
                         same folder as the agent.

  --feedback-ids         Comma-separated feedback UUIDs to promote. Get these
                         from the per-eval output of run_eval.py (the
                         `feedbackId` field on each result) — collected during
                         INSTALL.md Phase 5.

EXAMPLES

  # Dry-run (resolves trace + attrs but skips the POST). Use this first.
  python3 ingest_memory.py \\
    --memory-space-id <MEMORY_SPACE_ID> \\
    --memory-space-name "PATH Industries — Resolution Draft Memory" \\
    --folder-key <FOLDER_KEY> \\
    --feedback-ids <FB_1>,<FB_2>,...,<FB_10> \\
    --verbose --dry-run

  # Real ingest for all 10 memory pressure-test feedbacks.
  python3 ingest_memory.py \\
    --memory-space-id <MEMORY_SPACE_ID> \\
    --memory-space-name "PATH Industries — Resolution Draft Memory" \\
    --folder-key <FOLDER_KEY> \\
    --feedback-ids <FB_1>,<FB_2>,...,<FB_10>

OUTPUT
  Each item prints a JSON object to stdout. Successful items include
  `httpStatus: 200` and `responseBody` with the new `memoryItemId`.
  A summary line ("Summary: N OK, M dry-run, K failed") is printed to stderr.
  Exit code 0 if all items succeeded, 1 otherwise.

TROUBLESHOOTING
  "Insufficient permissions. Ensure you have Logs.View / Logs.Create / Logs.Delete"
      → The user account running `uip` lacks Logs.View on --folder-key. Grant
        Logs.View on the agent's folder via Orchestrator → Folders → Manage
        Access.

  SSL certificate verify failed
      → The script POSTs via /usr/bin/curl to avoid this. Confirm /usr/bin/curl
        exists and isn't shadowed by a stub on PATH.

  HTTP 401 from the ingest POST
      → Re-run; the script auto-refreshes the access token via
        `uip login refresh`. If still 401, your user account lacks the LLMOps
        ingest scope — verify Automation Developer (or equivalent) on the
        agent folder.

  HTTP 400 "memorySpaceName missing" / similar
      → Both --memory-space-id AND --memory-space-name are required.

  "no agentRun span found"
      → The traceId fetched from the feedback doesn't have an agentRun span,
        which means the feedback wasn't attached to an agent run. Verify with
        `uip traces spans get <traceId>` directly.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass


def run_uip(*args: str) -> dict:
    """Invoke `uip` with --output json and return the parsed Data."""
    proc = subprocess.run(
        ["uip", *args, "--output", "json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(f"uip {' '.join(args)} failed:\nstdout={proc.stdout!r}\nstderr={proc.stderr!r}")
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"uip {' '.join(args)} returned non-JSON: {proc.stdout[:300]!r}") from e
    if payload.get("Result") != "Success":
        raise RuntimeError(f"uip {' '.join(args)} → {payload.get('Result')}: {payload.get('Message','')} / {payload.get('Instructions','')}")
    return payload.get("Data") or {}


@dataclass(frozen=True)
class Session:
    access_token: str
    base_url: str
    org_name: str
    org_id: str
    tenant_id: str
    tenant_name: str


def refresh_session() -> Session:
    data = run_uip("login", "refresh")
    if data.get("Status") != "Logged in":
        raise RuntimeError(f"Not logged in (Status={data.get('Status')!r}); run `uip login` first")
    return Session(
        access_token=data["AccessToken"],
        base_url=data["BaseUrl"].rstrip("/"),
        org_name=data["OrganizationName"],
        org_id=data["OrganizationId"],
        tenant_id=data["TenantId"],
        tenant_name=data["TenantName"],
    )


def fetch_trace_id(feedback_id: str, folder_key: str) -> str:
    data = run_uip("traces", "feedback", "get", feedback_id, "--folder-key", folder_key)
    trace_id = data.get("traceId") or data.get("TraceId")
    if not trace_id and isinstance(data.get("Records"), list) and data["Records"]:
        trace_id = data["Records"][0].get("traceId") or data["Records"][0].get("TraceId")
    if not trace_id:
        raise RuntimeError(f"feedback {feedback_id}: no traceId in response keys {list(data)[:20]}")
    return trace_id


def fetch_agent_run_attributes(trace_id: str) -> str:
    data = run_uip("traces", "spans", "get", trace_id)
    spans = data if isinstance(data, list) else (data.get("Spans") or [])
    for span in spans:
        if (span.get("SpanType") or "").lower() == "agentrun":
            attrs = span.get("Attributes")
            if not isinstance(attrs, str):
                raise RuntimeError(f"trace {trace_id}: agentRun span Attributes not a string (type={type(attrs).__name__})")
            return attrs
    raise RuntimeError(f"trace {trace_id}: no agentRun span found among {len(spans)} spans")


def ingest_endpoint(session: Session, memory_space_id: str, memory_space_name: str) -> str:
    query = urllib.parse.urlencode({"memorySpaceName": memory_space_name})
    return (
        f"{session.base_url}/{session.org_name}/{session.tenant_id}"
        f"/llmopstenant_/api/Agent/memory/{memory_space_id}/ingest?{query}"
    )


def post_ingest(
    session: Session,
    *,
    url: str,
    folder_key: str,
    feedback_id: str,
    attributes: str,
) -> tuple[int, str]:
    """POST via /usr/bin/curl — uses the system trust store, avoiding the
    Python stdlib CA-bundle mismatch on macOS."""
    body = json.dumps({"feedbackId": feedback_id, "attributes": attributes})
    headers = {
        "Authorization": f"Bearer {session.access_token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
        "x-uipath-folderkey": folder_key,
        "x-uipath-internal-accountid": session.org_id,
        "x-uipath-internal-tenantid": session.tenant_id,
        "x-uipath-internal-tenantname": session.tenant_name,
    }
    cmd = ["curl", "--silent", "--show-error", "--max-time", "60",
           "-X", "POST", url,
           "-w", "\n__HTTP_STATUS__%{http_code}",
           "--data-binary", "@-"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    proc = subprocess.run(cmd, input=body, capture_output=True, text=True, check=False)
    out = proc.stdout
    marker = "\n__HTTP_STATUS__"
    if marker in out:
        body_text, status_str = out.rsplit(marker, 1)
        try:
            status = int(status_str.strip())
        except ValueError:
            status = -1
    else:
        body_text, status = out, -1
    if proc.returncode != 0 and status == -1:
        return -1, f"curl failed (exit {proc.returncode}): {proc.stderr.strip()[:300]}"
    return status, body_text


def ingest_one(session: Session, args, feedback_id: str) -> dict:
    out: dict = {"feedbackId": feedback_id}
    try:
        out["traceId"] = fetch_trace_id(feedback_id, args.folder_key)
        attrs = fetch_agent_run_attributes(out["traceId"])
        out["attributesLength"] = len(attrs)
        url = ingest_endpoint(session, args.memory_space_id, args.memory_space_name)
        out["url"] = url
        if args.verbose:
            parsed = json.loads(attrs)
            out["attributesPreview"] = {
                "agentId": parsed.get("agentId"),
                "type": parsed.get("type"),
                "inputKeys": list((parsed.get("input") or {}).keys())[:10],
                "outputKeys": list((parsed.get("output") or {}).keys())[:10],
            }
        if args.dry_run:
            out["status"] = "DRY_RUN"
            return out
        status, body = post_ingest(
            session,
            url=url,
            folder_key=args.folder_key,
            feedback_id=feedback_id,
            attributes=attrs,
        )
        out["httpStatus"] = status
        out["responseBody"] = body[:400]
        out["status"] = "OK" if 200 <= status < 300 else "HTTP_ERROR"
    except Exception as e:
        out["status"] = "ERROR"
        out["error"] = str(e)
    return out


def parse_feedback_ids(args) -> list[str]:
    ids: list[str] = []
    if args.feedback_ids:
        ids.extend(x.strip() for x in args.feedback_ids.split(",") if x.strip())
    if args.feedback_file:
        with open(args.feedback_file) as f:
            ids.extend(line.strip() for line in f if line.strip() and not line.strip().startswith("#"))
    seen, deduped = set(), []
    for x in ids:
        if x not in seen:
            seen.add(x)
            deduped.append(x)
    return deduped


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--memory-space-id", required=True, help="GUID of the target memory space (path param)")
    p.add_argument("--memory-space-name", required=True, help="Human display name of the memory space (query param)")
    p.add_argument("--folder-key", required=True, help="x-uipath-folderkey header value (agent / memory folder)")
    p.add_argument("--feedback-ids", help="Comma-separated feedback UUIDs (from run_eval.py output)")
    p.add_argument("--feedback-file", help="Path to newline-delimited feedback UUIDs ('#' comments allowed)")
    p.add_argument("--max-workers", type=int, default=5)
    p.add_argument("--dry-run", action="store_true", help="Resolve traces + attrs but don't POST")
    p.add_argument("--verbose", action="store_true", help="Log span sanity-checks per item")
    args = p.parse_args()

    feedback_ids = parse_feedback_ids(args)
    if not feedback_ids:
        p.error("Provide --feedback-ids or --feedback-file")

    print(f"Refreshing access token via `uip login refresh`...", file=sys.stderr)
    session = refresh_session()
    print(f"Session: org={session.org_name} tenant={session.tenant_name} ({session.tenant_id})", file=sys.stderr)
    print(f"Target:  memorySpaceId={args.memory_space_id} memorySpaceName={args.memory_space_name!r}", file=sys.stderr)
    print(f"Folder:  {args.folder_key}", file=sys.stderr)
    print(f"Items:   {len(feedback_ids)} feedback id(s){' (DRY RUN)' if args.dry_run else ''}", file=sys.stderr)

    results: list[dict] = []
    with cf.ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as ex:
        futures = {ex.submit(ingest_one, session, args, fid): fid for fid in feedback_ids}
        for fut in cf.as_completed(futures):
            res = fut.result()
            results.append(res)
            print(json.dumps(res, indent=2), flush=True)

    ok = sum(1 for r in results if r.get("status") == "OK")
    dry = sum(1 for r in results if r.get("status") == "DRY_RUN")
    bad = len(results) - ok - dry
    print(f"\nSummary: {ok} OK, {dry} dry-run, {bad} failed (out of {len(results)})", file=sys.stderr)
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
