#!/usr/bin/env python3
"""Verify the memory-space side of the install. Three layers, run any subset:

1. `--url <URL>` — **pre-attach** URL check. Validates that the URL the user
                   pasted from the Agents portal has the right shape and
                   extracts the `MEMORY_SPACE_ID` GUID. Use in INSTALL.md
                   Phase 3c, before the user clicks Attach in Studio Web.

2. (default) `feature.json` check — **post-attach**. Confirms Studio Web
                   Local Workspace rewrote
                   `AgentMemoryAndFeedback.sln/Agent/features/Resolution Draft Memory/feature.json`
                   with a real GUID `referenceKey` (not the placeholder),
                   `dynamicFewShotSettings.isEnabled = true`, and the three
                   retrieval keys `customer_tier`, `flags`, `root_cause`.
                   Use in INSTALL.md Phase 3e, after Attach.

3. `--server-check` — **API confirmation** that the memory space actually
                   exists in the currently-active `uip` tenant. Hits the
                   read-only ECS endpoint `/ecs_/v2/episodicmemories`. Use
                   when you want strong proof the attach hit the right space,
                   not just that the file shape is correct.

When both `--url` and the feature.json check run, the GUIDs must match.

EXAMPLES

  # Pre-attach: just validate the pasted URL (Phase 3c).
  python3 scripts/verify_memory_space.py \\
    --url 'https://cloud.uipath.com/myorg/agents_/memory/5fc69d30-99b8-4180-0974-08deb116dc33' \\
    --skip-feature-json

  # Post-attach: feature.json shape only (Phase 3e).
  python3 scripts/verify_memory_space.py

  # Strongest check: URL + feature.json + API confirm.
  python3 scripts/verify_memory_space.py --url <URL> --server-check

Exit codes:
  0  all selected checks passed
  1  any check failed (message on stderr)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

GUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_FEATURE_JSON = REPO_ROOT / "AgentMemoryAndFeedback.sln" / "Agent" / "features" / "Resolution Draft Memory" / "feature.json"

EXPECTED_RETRIEVAL_KEYS = ["customer_tier", "flags", "root_cause"]


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# --------------------------------------------------------------------- URL

def extract_memory_space_id(url: str) -> str:
    """Pull the GUID out of a portal URL like
    https://<host>/<org>/agents_/memory/<GUID>[?...][#...]
    """
    parsed = urllib.parse.urlparse(url.strip())
    parts = [p for p in parsed.path.split("/") if p]
    try:
        i = parts.index("memory")
    except ValueError:
        die(f"URL does not contain '/agents_/memory/<guid>': {url!r}")
    if i + 1 >= len(parts):
        die(f"URL has '/memory/' but no GUID after it: {url!r}")
    candidate = parts[i + 1]
    if not GUID_RE.match(candidate):
        die(f"path segment after '/memory/' is not a GUID: {candidate!r}")
    return candidate.lower()


# --------------------------------------------------------------- feature.json

def check_feature_json(path: Path) -> dict:
    if not path.exists():
        die(f"feature.json not found at {path}")
    d = json.loads(path.read_text())

    ref = d.get("referenceKey")
    if ref == "TODO_FROM_INSTALL":
        die(
            "feature.json.referenceKey is still 'TODO_FROM_INSTALL' — the memory "
            "space was NOT attached. Open the solution in Studio Web Local Workspace, "
            "attach the memory space to the Agent, and Save."
        )
    if not isinstance(ref, str) or not GUID_RE.match(ref):
        die(f"feature.json.referenceKey is not a GUID: {ref!r}")

    fs = d.get("dynamicFewShotSettings") or {}
    if not fs.get("isEnabled"):
        die("feature.json.dynamicFewShotSettings.isEnabled is false — memory retrieval is disabled.")

    keys = sorted(f.get("name", "") for f in (fs.get("fieldSettings") or []))
    if keys != EXPECTED_RETRIEVAL_KEYS:
        die(f"feature.json retrieval keys wrong: got {keys}, expected {EXPECTED_RETRIEVAL_KEYS}")

    print(f"OK — referenceKey:      {ref}")
    print(f"OK — retrieval keys:    {keys}")
    print(f"OK — memorySpaceName:   {d.get('memorySpaceName')}")
    return d


# --------------------------------------------------------------- server check

def uip_refresh() -> dict:
    proc = subprocess.run(
        ["uip", "login", "refresh", "--output", "json"],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        die(f"uip login refresh failed:\n{proc.stderr or proc.stdout}")
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        die(f"uip login refresh returned non-JSON: {e}")
    data = payload.get("Data") or {}
    for key in ("AccessToken", "BaseUrl", "OrganizationName",
                "OrganizationId", "TenantName", "TenantId"):
        if not data.get(key):
            die(f"uip login refresh response missing `{key}`")
    return data


def curl_get(url: str, headers: dict[str, str]) -> tuple[int, str]:
    cmd = ["/usr/bin/curl", "--silent", "--show-error", "--max-time", "60",
           "--compressed",
           "-w", "\n__HTTP_STATUS__%{http_code}",
           "-X", "GET", url]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    out = proc.stdout
    marker = "\n__HTTP_STATUS__"
    if marker in out:
        body, status_str = out.rsplit(marker, 1)
        try:
            status = int(status_str.strip())
        except ValueError:
            die(f"curl returned non-integer status `{status_str!r}`")
        return status, body
    die(f"curl produced no status marker — stderr: {proc.stderr!r}")
    raise AssertionError


def list_episodic_memories(session: dict) -> list[dict]:
    url = (
        f"{session['BaseUrl']}/{session['OrganizationName']}/"
        f"{session['TenantId']}/ecs_/v2/episodicmemories"
    )
    headers = {
        "Authorization": f"Bearer {session['AccessToken']}",
        "Accept": "*/*",
        "Content-Type": "application/json",
        "X-UiPath-Internal-AccountId": session["OrganizationId"],
        "X-UiPath-Internal-TenantId": session["TenantId"],
        "X-UiPath-Internal-TenantName": session["TenantName"],
    }
    status, body = curl_get(url, headers)
    if status != 200:
        die(f"GET episodicmemories returned HTTP {status}:\n{body[:500]}")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        die(f"episodicmemories returned non-JSON: {e}\n{body[:500]}")
    if isinstance(payload, list):
        return payload
    for k in ("value", "items", "Data", "data", "results"):
        if isinstance(payload.get(k), list):
            return payload[k]
    die(f"episodicmemories: unrecognized response shape — top-level keys: {list(payload.keys())}")
    raise AssertionError


def check_server(target_id: str) -> None:
    session = uip_refresh()
    memories = list_episodic_memories(session)

    def find_id(rec: dict) -> str | None:
        for k in ("id", "Id", "memorySpaceId", "MemorySpaceId"):
            v = rec.get(k)
            if isinstance(v, str):
                return v
        return None

    match = next((rec for rec in memories if (find_id(rec) or "").lower() == target_id.lower()), None)
    if match is None:
        ids = sorted({find_id(r) or "?" for r in memories})
        msg = (
            f"memory space `{target_id}` not found in tenant "
            f"`{session['TenantName']}` ({session['TenantId']}). "
            f"{len(memories)} space(s) visible: {ids[:5]}{'…' if len(ids) > 5 else ''}"
        )
        die(msg)

    name = match.get("name") or match.get("Name") or match.get("memorySpaceName")
    print(f"OK — server confirms space exists in tenant `{session['TenantName']}`")
    if name:
        print(f"     name on server:   {name}")


# --------------------------------------------------------------------- main

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", help="Memory-space portal URL to validate (Phase 3c).")
    p.add_argument(
        "--feature-json",
        default=str(DEFAULT_FEATURE_JSON),
        help=f"Path to feature.json (default: {DEFAULT_FEATURE_JSON.name} under AgentMemoryAndFeedback.sln/Agent/features/).",
    )
    p.add_argument(
        "--skip-feature-json", action="store_true",
        help="Skip the feature.json check (use in Phase 3c before the attach exists).",
    )
    p.add_argument(
        "--server-check", action="store_true",
        help="Also hit the ECS API to confirm the memory space exists in the active tenant.",
    )
    args = p.parse_args()

    if not args.url and args.skip_feature_json and not args.server_check:
        p.error("nothing to do — provide --url, or drop --skip-feature-json, or pass --server-check.")

    url_guid: str | None = None
    if args.url:
        url_guid = extract_memory_space_id(args.url)
        print(f"OK — URL parses cleanly; MEMORY_SPACE_ID = {url_guid}")

    feature_guid: str | None = None
    if not args.skip_feature_json:
        d = check_feature_json(Path(args.feature_json))
        feature_guid = d["referenceKey"].lower()
        if url_guid and feature_guid != url_guid:
            die(
                f"MISMATCH — URL points at {url_guid} but feature.json was "
                f"attached to {feature_guid}. Did you attach a different memory "
                f"space than the one whose URL you pasted?"
            )
        if url_guid:
            print("OK — URL's GUID matches feature.json's referenceKey")

    if args.server_check:
        target = url_guid or feature_guid
        if not target:
            die("--server-check requires a GUID — provide --url, or run with feature.json available.")
        check_server(target)

    return 0


if __name__ == "__main__":
    sys.exit(main())
