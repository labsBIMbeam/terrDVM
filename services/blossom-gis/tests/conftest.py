"""Test helpers.

The production package verifies signatures only and never touches private keys.
Signing lives here, in test scope, so end-to-end tests can mint real kind-24242
authorization events.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

import pytest

from blossom_gis.schnorr import G, N, P, _point_mul, tagged_hash


def _x_only(point: tuple[int, int]) -> bytes:
    return point[0].to_bytes(32, "big")


def public_key_from_secret(secret: int) -> bytes:
    point = _point_mul(G, secret)
    assert point is not None
    return _x_only(point)


def sign(secret: int, message: bytes, aux: bytes = b"\x00" * 32) -> bytes:
    """BIP-340 sign. Test-only."""
    point = _point_mul(G, secret)
    assert point is not None
    d = secret if point[1] % 2 == 0 else N - secret
    px = _x_only(point)

    t = d ^ int.from_bytes(tagged_hash("BIP0340/aux", aux), "big")
    rand = tagged_hash("BIP0340/nonce", t.to_bytes(32, "big") + px + message)
    k0 = int.from_bytes(rand, "big") % N
    assert k0 != 0

    r_point = _point_mul(G, k0)
    assert r_point is not None
    k = k0 if r_point[1] % 2 == 0 else N - k0
    rx = _x_only(r_point)

    e = int.from_bytes(tagged_hash("BIP0340/challenge", rx + px + message), "big") % N
    return rx + ((k + e * d) % N).to_bytes(32, "big")


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
            "content": "terrDVM blossom-gis test",
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


__all__ = ["sign", "public_key_from_secret", "N", "P", "G"]
