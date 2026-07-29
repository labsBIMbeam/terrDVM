"""BIP-340 Schnorr verification over secp256k1.

Implemented in pure Python on purpose: the only operation this server needs is
*verification* of Nostr authorization events, and a pure implementation keeps
the service free of native build dependencies. It is validated against the
official BIP-340 test vectors in tests/test_schnorr.py.

This module verifies only. It never signs and never handles private keys.
"""

from __future__ import annotations

import hashlib

# secp256k1 domain parameters.
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)

Point = tuple[int, int] | None


def tagged_hash(tag: str, msg: bytes) -> bytes:
    """BIP-340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg)."""
    tag_hash = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(tag_hash + tag_hash + msg).digest()


def _point_add(p1: Point, p2: Point) -> Point:
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    if p1[0] == p2[0] and p1[1] != p2[1]:
        return None
    if p1 == p2:
        lam = (3 * p1[0] * p1[0] * pow(2 * p1[1], P - 2, P)) % P
    else:
        lam = ((p2[1] - p1[1]) * pow(p2[0] - p1[0], P - 2, P)) % P
    x3 = (lam * lam - p1[0] - p2[0]) % P
    return (x3, (lam * (p1[0] - x3) - p1[1]) % P)


def _point_mul(point: Point, scalar: int) -> Point:
    result: Point = None
    addend = point
    while scalar:
        if scalar & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        scalar >>= 1
    return result


def _lift_x(x: int) -> Point:
    """Recover the even-Y point for an x-only public key, or None if invalid."""
    if x >= P:
        return None
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if pow(y, 2, P) != y_sq:
        return None
    return (x, y if y % 2 == 0 else P - y)


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Verify a BIP-340 signature.

    Args:
        public_key: 32-byte x-only public key.
        message: 32-byte message hash.
        signature: 64-byte signature.

    Returns:
        True only for a well-formed, valid signature. Never raises on malformed
        input — callers get a plain False so authorization fails closed.
    """
    if len(public_key) != 32 or len(signature) != 64 or len(message) != 32:
        return False

    point = _lift_x(int.from_bytes(public_key, "big"))
    if point is None:
        return False

    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    if r >= P or s >= N:
        return False

    e = int.from_bytes(
        tagged_hash("BIP0340/challenge", signature[:32] + public_key + message), "big"
    ) % N

    # R = s*G - e*P
    negated = _point_mul(point, N - e)
    computed = _point_add(_point_mul(G, s), negated)
    return computed is not None and computed[1] % 2 == 0 and computed[0] == r
