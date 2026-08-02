"""Crawler-side BIP-340 signing, checked against the specification's own
signing vectors, and the event/authorization builders checked against this
service's own fail-closed verifiers acting as the oracle."""

from __future__ import annotations

import pytest

from blossom_gis.nostr import authorize, event_id, verify_event
from blossom_gis.schnorr import verify
from blossom_gis.signer import (
    load_secret,
    public_key_from_secret,
    sign,
    sign_event,
    upload_auth,
)

# (secret, aux, message, expected_signature) — the BIP-340 vector table's signing
# rows. Their pubkey/message/signature triples are the same ones test_schnorr.py
# already verifies, so the two suites pin the same ground truth from both sides.
SIGNING_VECTORS = [
    (
        "0000000000000000000000000000000000000000000000000000000000000003",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA8215"
        "25F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0",
    ),
    (
        "B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF",
        "0000000000000000000000000000000000000000000000000000000000000001",
        "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
        "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE3341"
        "8906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A",
    ),
    (
        "C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9",
        "C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906",
        "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C",
        "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1B"
        "AB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7",
    ),
]


@pytest.mark.parametrize(("secret", "aux", "message", "expected"), SIGNING_VECTORS)
def test_bip340_signing_vectors(secret: str, aux: str, message: str, expected: str) -> None:
    signature = sign(int(secret, 16), bytes.fromhex(message), bytes.fromhex(aux))
    assert signature.hex().upper() == expected


def test_random_aux_round_trips_through_the_verifier() -> None:
    secret = 0xB7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF
    message = b"\x42" * 32
    signature = sign(secret, message)
    assert verify(public_key_from_secret(secret), message, signature)


def test_secret_outside_the_group_order_is_rejected() -> None:
    with pytest.raises(ValueError):
        sign(0, b"\x00" * 32)
    with pytest.raises(ValueError):
        public_key_from_secret(0)


def test_sign_event_produces_a_verifiable_nostr_event() -> None:
    secret = 3
    event = sign_event(
        {
            "created_at": 1754130000,
            "kind": 30551,
            "tags": [["d", "dem:13/3711/3309"]],
            "content": "",
        },
        secret,
    )
    assert event["pubkey"] == public_key_from_secret(secret).hex()
    assert event["id"] == event_id(event)
    assert verify_event(event)


def test_sign_event_does_not_mutate_its_input() -> None:
    template = {"created_at": 1, "kind": 1, "tags": [], "content": "x"}
    sign_event(template, 3)
    assert "sig" not in template and "id" not in template and "pubkey" not in template


def test_upload_auth_satisfies_this_services_own_authorizer() -> None:
    sha = "ab" * 32
    now = 1754130000
    event = upload_auth(sha, 3, now=now)
    result = authorize(event, verb="upload", now=now, blob_sha256=sha)
    assert result.ok, result.reason
    assert result.pubkey == public_key_from_secret(3).hex()


def test_upload_auth_is_bound_to_the_blob_hash() -> None:
    now = 1754130000
    event = upload_auth("ab" * 32, 3, now=now)
    assert not authorize(event, verb="upload", now=now, blob_sha256="cd" * 32).ok
    assert not authorize(event, verb="delete", now=now, blob_sha256="ab" * 32).ok


def test_upload_auth_expires_in_the_future_only(tmp_path) -> None:
    now = 1754130000
    event = upload_auth("ab" * 32, 3, now=now, expires_in=60)
    assert not authorize(event, verb="upload", now=now + 61, blob_sha256="ab" * 32).ok


def test_load_secret_reads_hex_and_rejects_junk(tmp_path) -> None:
    good = tmp_path / "key"
    good.write_text("  B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF\n")
    assert load_secret(good) == 0xB7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF

    for bad in ("", "zz" * 32, "ab" * 31, "00" * 32):
        path = tmp_path / "bad"
        path.write_text(bad)
        with pytest.raises(ValueError):
            load_secret(path)
