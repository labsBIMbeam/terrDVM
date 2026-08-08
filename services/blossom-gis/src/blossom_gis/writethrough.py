"""BUD-02 write-through: push a locally stored corpus blob to the byte-owning
blossom-server with a crawler-signed kind-24242 authorization.

Fail closed everywhere: transport errors, non-2xx responses, unparseable
bodies, and descriptors whose sha256 differs from the uploaded bytes all raise
WriteThroughError — the caller must treat the blob as not written through.
"""

from __future__ import annotations

import base64
import hashlib
import json
import urllib.error
import urllib.request
from typing import Any

from .signer import upload_auth


class WriteThroughError(RuntimeError):
    """The blob did not verifiably land on the blossom-server."""


def upload(
    base_url: str,
    payload: bytes,
    media_type: str,
    secret: int,
    *,
    timeout_s: float = 60.0,
    now: int | None = None,
) -> dict[str, Any]:
    """PUT one blob; return the server's descriptor after verifying its hash."""
    sha256 = hashlib.sha256(payload).hexdigest()
    auth = upload_auth(sha256, secret, now=now)
    header = "Nostr " + base64.b64encode(json.dumps(auth, separators=(",", ":")).encode()).decode()

    request = urllib.request.Request(
        base_url.rstrip("/") + "/upload",
        data=payload,
        method="PUT",
        headers={
            "Authorization": header,
            "Content-Type": media_type,
            "User-Agent": "terrCVM-crawler/0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read()[:200]
        raise WriteThroughError(f"upload rejected: HTTP {error.code} {detail!r}") from error
    except OSError as error:
        raise WriteThroughError(f"upload failed: {error}") from error

    try:
        descriptor = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise WriteThroughError("upload response is not JSON") from error
    answered = descriptor.get("sha256") if isinstance(descriptor, dict) else None
    if answered != sha256:
        raise WriteThroughError(
            f"server answered sha {answered!r} for blob {sha256} — refusing to trust the write"
        )
    return descriptor
