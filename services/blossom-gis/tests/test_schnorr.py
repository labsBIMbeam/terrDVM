"""BIP-340 verification, checked against the specification's own test vectors."""

from __future__ import annotations

import pytest
from conftest import public_key_from_secret, sign

from blossom_gis.schnorr import tagged_hash, verify

# (public_key, message, signature, expected) — from the BIP-340 vector table.
VECTORS = [
    (
        "F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA8215"
        "25F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0",
        True,
    ),
    (
        "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
        "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
        "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE3341"
        "8906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A",
        True,
    ),
    (
        "DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8",
        "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C",
        "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1B"
        "AB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7",
        True,
    ),
    # Public key is not on the curve.
    (
        "EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34",
        "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
        "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769"
        "69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B",
        False,
    ),
    # has_even_y(R) is false.
    (
        "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
        "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
        "FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A1460297556"
        "3CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2",
        False,
    ),
]


@pytest.mark.parametrize(("pubkey", "message", "signature", "expected"), VECTORS)
def test_bip340_vectors(pubkey: str, message: str, signature: str, expected: bool) -> None:
    result = verify(bytes.fromhex(pubkey), bytes.fromhex(message), bytes.fromhex(signature))
    assert result is expected


def test_tagged_hash_is_domain_separated() -> None:
    assert tagged_hash("a", b"x") != tagged_hash("b", b"x")
    assert len(tagged_hash("BIP0340/challenge", b"x")) == 32


def test_sign_verify_round_trip() -> None:
    secret = 0x0000000000000000000000000000000000000000000000000000000000000003
    pubkey = public_key_from_secret(secret)
    message = bytes(range(32))
    assert verify(pubkey, message, sign(secret, message)) is True


def test_rejects_tampered_message() -> None:
    secret = 0x0000000000000000000000000000000000000000000000000000000000000003
    pubkey = public_key_from_secret(secret)
    signature = sign(secret, bytes(range(32)))
    assert verify(pubkey, bytes(range(1, 33)), signature) is False


@pytest.mark.parametrize(
    ("pubkey", "message", "signature"),
    [
        (b"\x01" * 31, b"\x00" * 32, b"\x00" * 64),  # short key
        (b"\x01" * 32, b"\x00" * 31, b"\x00" * 64),  # short message
        (b"\x01" * 32, b"\x00" * 32, b"\x00" * 63),  # short signature
    ],
)
def test_malformed_input_fails_closed(pubkey: bytes, message: bytes, signature: bytes) -> None:
    """Never raise on malformed input — callers must get a plain False."""
    assert verify(pubkey, message, signature) is False
