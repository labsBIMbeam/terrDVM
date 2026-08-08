#!/usr/bin/env python3
"""strfry write policy: the corpus relay accepts events from the crawler key alone.

Protocol (strfry docs/plugins.md): strfry writes one JSON object per line to stdin;
for each, the plugin must answer one line on stdout carrying the event id, an action
of accept | reject | shadowReject, and an optional client-facing msg on reject.

Fail closed: with CRAWLER_PUBKEY unset or empty, nothing is accepted.
"""

import json
import os
import sys

ALLOWED_PUBKEY = os.environ.get("CRAWLER_PUBKEY", "").strip().lower()


def decide(request: dict) -> dict:
    """Return the response object for one policy request."""
    event = request.get("event") or {}
    pubkey = str(event.get("pubkey", "")).lower()
    response = {"id": event.get("id", "")}
    if ALLOWED_PUBKEY and pubkey == ALLOWED_PUBKEY:
        response["action"] = "accept"
    else:
        response["action"] = "reject"
        response["msg"] = "blocked: this relay accepts the corpus crawler key only"
    return response


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            # Unparseable input carries no event id to answer with; strfry's
            # writePolicy timeout treats the silence as a rejection.
            continue
        sys.stdout.write(json.dumps(decide(request)) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
