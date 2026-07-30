"""Nostr event validation and Blossom authorization (kind 24242).

Every check fails closed: malformed input, a bad signature, a wrong verb, a
missing or expired `expiration` tag, or a blob-hash mismatch all yield a
rejection rather than an exception.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from typing import Any

from .schnorr import verify

BLOSSOM_AUTH_KIND = 24242
VALID_VERBS = frozenset({"get", "upload", "list", "delete"})

#: Tolerance for clock skew on `created_at`, in seconds.
CREATED_AT_SKEW_S = 300


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    pubkey: str | None = None
    reason: str | None = None

    @staticmethod
    def deny(reason: str) -> AuthResult:
        return AuthResult(ok=False, reason=reason)


def event_id(event: dict[str, Any]) -> str:
    """Compute the NIP-01 event id: sha256 over the canonical serialization."""
    serialized = json.dumps(
        [
            0,
            event.get("pubkey", ""),
            event.get("created_at", 0),
            event.get("kind", 0),
            event.get("tags", []),
            event.get("content", ""),
        ],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _hex_bytes(value: Any, length: int) -> bytes | None:
    if not isinstance(value, str) or len(value) != length * 2:
        return None
    try:
        return bytes.fromhex(value)
    except ValueError:
        return None


def verify_event(event: Any) -> bool:
    """Verify a Nostr event's id and signature."""
    if not isinstance(event, dict):
        return False

    pubkey = _hex_bytes(event.get("pubkey"), 32)
    signature = _hex_bytes(event.get("sig"), 64)
    if pubkey is None or signature is None:
        return False
    if not isinstance(event.get("created_at"), int) or not isinstance(event.get("kind"), int):
        return False
    if not isinstance(event.get("tags"), list) or not isinstance(event.get("content"), str):
        return False

    computed = event_id(event)
    if computed != event.get("id"):
        return False

    return verify(pubkey, bytes.fromhex(computed), signature)


def tag_values(event: dict[str, Any], name: str) -> list[str]:
    """All values for a tag name, skipping malformed tag entries."""
    values: list[str] = []
    for tag in event.get("tags", []):
        if (
            isinstance(tag, list)
            and len(tag) >= 2
            and tag[0] == name
            and isinstance(tag[1], str)
        ):
            values.append(tag[1])
    return values


def parse_auth_header(header: str | None) -> dict[str, Any] | None:
    """Decode an `Authorization: Nostr <base64 event>` header."""
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "nostr":
        return None
    try:
        decoded = base64.b64decode(parts[1], validate=True)
    except (binascii.Error, ValueError):
        return None
    try:
        event = json.loads(decoded)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return event if isinstance(event, dict) else None


def authorize(
    event: Any,
    *,
    verb: str,
    now: int,
    blob_sha256: str | None = None,
) -> AuthResult:
    """Authorize a Blossom request from a kind-24242 event.

    Args:
        event: The decoded authorization event.
        verb: Required `t` tag value, e.g. "upload".
        now: Current unix time, injected so the check is deterministic in tests.
        blob_sha256: When given, the event must carry a matching `x` tag.
    """
    if verb not in VALID_VERBS:
        return AuthResult.deny("unsupported verb")
    if not isinstance(event, dict):
        return AuthResult.deny("malformed authorization event")
    if event.get("kind") != BLOSSOM_AUTH_KIND:
        return AuthResult.deny(f"authorization event must be kind {BLOSSOM_AUTH_KIND}")

    created_at = event.get("created_at")
    if not isinstance(created_at, int) or created_at > now + CREATED_AT_SKEW_S:
        return AuthResult.deny("authorization event is not yet valid")

    expirations = tag_values(event, "expiration")
    if len(expirations) != 1:
        return AuthResult.deny("authorization event needs exactly one expiration tag")
    try:
        expires_at = int(expirations[0])
    except ValueError:
        return AuthResult.deny("expiration tag is not an integer")
    if expires_at <= now:
        return AuthResult.deny("authorization event has expired")

    if verb not in tag_values(event, "t"):
        return AuthResult.deny(f"authorization event does not grant '{verb}'")

    if blob_sha256 is not None and blob_sha256 not in tag_values(event, "x"):
        return AuthResult.deny("authorization event does not cover this blob hash")

    if not verify_event(event):
        return AuthResult.deny("invalid event id or signature")

    return AuthResult(ok=True, pubkey=event["pubkey"])
