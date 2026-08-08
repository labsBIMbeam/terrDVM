"""Test helpers.

The server verifies signatures only and never touches private keys. Production
signing exists for the crawler CLI alone (blossom_gis.signer — the stance shift
recorded in VERTICAL-SLICE.md). Tests reuse that signer with a fixed aux
default so fixture events stay reproducible.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

import pytest

from blossom_gis.signer import public_key_from_secret as public_key_from_secret
from blossom_gis.signer import sign as _sign


def sign(secret: int, message: bytes, aux: bytes = b"\x00" * 32) -> bytes:
    """BIP-340 sign with a deterministic default aux, for reproducible fixtures."""
    return _sign(secret, message, aux)


@pytest.fixture
def keypair() -> tuple[int, str]:
    """A deterministic (secret, pubkey_hex) pair.

    NOT A SECRET. This is the key published in the BIP-340 specification's own
    test-vector table, reused here so signatures are reproducible. It controls
    nothing and must never be treated as credential material.
    """
    secret = 0xB7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF
    return secret, public_key_from_secret(secret).hex()


@pytest.fixture
def make_auth_event(keypair):
    """Build a signed kind-24242 Blossom authorization event."""
    secret, pubkey = keypair

    def _build(
        *,
        verb: str = "upload",
        blob_sha256: str | None = None,
        expires_in: int = 300,
        created_at: int | None = None,
        kind: int = 24242,
        extra_tags: list[list[str]] | None = None,
    ) -> dict[str, Any]:
        now = int(time.time())
        tags: list[list[str]] = [
            ["t", verb],
            ["expiration", str(now + expires_in)],
        ]
        if blob_sha256:
            tags.append(["x", blob_sha256])
        if extra_tags:
            tags.extend(extra_tags)

        event: dict[str, Any] = {
            "pubkey": pubkey,
            "created_at": created_at if created_at is not None else now,
            "kind": kind,
            "tags": tags,
            "content": "terrCVM blossom-gis test",
        }
        serialized = json.dumps(
            [
                0,
                event["pubkey"],
                event["created_at"],
                event["kind"],
                event["tags"],
                event["content"],
            ],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        event["id"] = hashlib.sha256(serialized.encode()).hexdigest()
        event["sig"] = sign(secret, bytes.fromhex(event["id"])).hex()
        return event

    return _build


__all__ = ["sign", "public_key_from_secret"]
