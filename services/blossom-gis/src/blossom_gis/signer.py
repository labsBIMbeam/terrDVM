"""BIP-340 signing for the crawler CLI.

The server side of this package verifies and never holds a key — that stance
lives in schnorr.py and is unchanged. Signing exists for the crawler alone:
kind-24242 upload authorizations toward the byte-owning blossom-server and the
kind-3055x corpus announcements (VERTICAL-SLICE.md, "Deviations, stated
plainly"). The secret is read from an operator-local file and never from the
repository.

Validated against the BIP-340 specification's own signing vectors in
tests/test_signer.py — the same pubkey/message/signature triples the verify
suite pins, approached from the signing side.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .nostr import event_id
from .schnorr import G, N, _point_mul, tagged_hash

BLOSSOM_AUTH_KIND = 24242


def _checked_point(secret: int) -> tuple[int, int]:
    if not 1 <= secret < N:
        raise ValueError("secret key is outside the group order")
    point = _point_mul(G, secret)
    if point is None:
        raise ValueError("secret key produced the point at infinity")
    return point


def public_key_from_secret(secret: int) -> bytes:
    """The 32-byte x-only public key for a secret scalar."""
    return _checked_point(secret)[0].to_bytes(32, "big")


def sign(secret: int, message: bytes, aux: bytes | None = None) -> bytes:
    """BIP-340 sign a 32-byte message.

    `aux` is the auxiliary randomness; omitted, fresh randomness is drawn.
    Passing 32 fixed bytes makes the signature deterministic (test vectors).
    """
    if aux is None:
        aux = os.urandom(32)
    point = _checked_point(secret)
    d = secret if point[1] % 2 == 0 else N - secret
    px = point[0].to_bytes(32, "big")

    t = d ^ int.from_bytes(tagged_hash("BIP0340/aux", aux), "big")
    rand = tagged_hash("BIP0340/nonce", t.to_bytes(32, "big") + px + message)
    k0 = int.from_bytes(rand, "big") % N
    if k0 == 0:
        raise ValueError("derived nonce is zero")

    r_point = _point_mul(G, k0)
    assert r_point is not None
    k = k0 if r_point[1] % 2 == 0 else N - k0
    rx = r_point[0].to_bytes(32, "big")

    e = int.from_bytes(tagged_hash("BIP0340/challenge", rx + px + message), "big") % N
    return rx + ((k + e * d) % N).to_bytes(32, "big")


def sign_event(event: dict[str, Any], secret: int) -> dict[str, Any]:
    """Return a signed copy of a nostr event template.

    Fills `pubkey`, `id` (via the same serialisation the verifier uses) and
    `sig`. The input is not mutated.
    """
    signed = dict(event)
    signed["pubkey"] = public_key_from_secret(secret).hex()
    signed["id"] = event_id(signed)
    signed["sig"] = sign(secret, bytes.fromhex(signed["id"])).hex()
    return signed


def upload_auth(
    blob_sha256: str,
    secret: int,
    *,
    expires_in: int = 600,
    now: int | None = None,
) -> dict[str, Any]:
    """A signed kind-24242 Blossom upload authorization bound to one blob hash."""
    import time

    created_at = int(time.time()) if now is None else now
    return sign_event(
        {
            "created_at": created_at,
            "kind": BLOSSOM_AUTH_KIND,
            "tags": [
                ["t", "upload"],
                ["x", blob_sha256],
                ["expiration", str(created_at + expires_in)],
            ],
            "content": "terrCVM corpus write-through",
        },
        secret,
    )


def load_secret(path: Path | str) -> int:
    """Read a 64-hex secret key from an operator-local file.

    Raises ValueError on anything that is not a valid in-range key, so a
    misconfigured deployment fails before it signs.
    """
    text = Path(path).read_text(encoding="utf-8").strip().lower()
    if len(text) != 64 or any(c not in "0123456789abcdef" for c in text):
        raise ValueError(f"{path} does not contain a 64-hex secret key")
    secret = int(text, 16)
    if not 1 <= secret < N:
        raise ValueError(f"{path} contains a key outside the group order")
    return secret
