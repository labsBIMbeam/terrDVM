from __future__ import annotations

import hashlib
import time
from pathlib import Path

import pytest

from blossom_gis.nostr import authorize, event_id, parse_auth_header, verify_event
from blossom_gis.store import BlobStore, is_valid_sha256


class TestBlobStore:
    def test_put_is_content_addressed_and_idempotent(self, tmp_path: Path) -> None:
        store = BlobStore(tmp_path)
        payload = b"terrain tile bytes"
        expected = hashlib.sha256(payload).hexdigest()

        first = store.put(payload)
        second = store.put(payload)

        assert first.sha256 == expected
        assert first.created is True
        assert second.created is False
        assert store.read(expected) == payload

    def test_shards_by_hash_prefix(self, tmp_path: Path) -> None:
        store = BlobStore(tmp_path)
        stored = store.put(b"x")
        assert stored.path.parent.name == stored.sha256[2:4]
        assert stored.path.parent.parent.name == stored.sha256[:2]

    def test_leaves_no_partial_file_behind(self, tmp_path: Path) -> None:
        store = BlobStore(tmp_path)
        store.put(b"payload")
        assert list(tmp_path.rglob("*.part")) == []

    @pytest.mark.parametrize(
        "candidate",
        [
            "../../etc/passwd",
            "a" * 63,
            "A" * 64,  # uppercase is not the canonical form
            "g" * 64,  # not hex
            "",
            "../" + "a" * 61,
        ],
    )
    def test_rejects_anything_that_is_not_a_canonical_hash(
        self, tmp_path: Path, candidate: str
    ) -> None:
        store = BlobStore(tmp_path)
        assert is_valid_sha256(candidate) is False
        assert store.exists(candidate) is False
        assert store.read(candidate) is None
        assert store.delete(candidate) is False
        with pytest.raises(ValueError):
            store.path_for(candidate)

    def test_delete_removes_only_the_named_blob(self, tmp_path: Path) -> None:
        store = BlobStore(tmp_path)
        keep = store.put(b"keep")
        drop = store.put(b"drop")
        assert store.delete(drop.sha256) is True
        assert store.read(drop.sha256) is None
        assert store.read(keep.sha256) == b"keep"


class TestNostrAuthorization:
    def test_accepts_a_well_formed_upload_grant(self, make_auth_event, keypair) -> None:
        _, pubkey = keypair
        digest = hashlib.sha256(b"payload").hexdigest()
        event = make_auth_event(verb="upload", blob_sha256=digest)

        result = authorize(event, verb="upload", now=int(time.time()), blob_sha256=digest)

        assert result.ok is True
        assert result.pubkey == pubkey

    def test_event_id_is_the_canonical_digest(self, make_auth_event) -> None:
        event = make_auth_event()
        assert event_id(event) == event["id"]
        assert verify_event(event) is True

    def test_rejects_a_tampered_event(self, make_auth_event) -> None:
        event = make_auth_event()
        event["content"] = "tampered"
        assert verify_event(event) is False
        assert authorize(event, verb="upload", now=int(time.time())).ok is False

    def test_rejects_expired_grant(self, make_auth_event) -> None:
        event = make_auth_event(expires_in=10)
        result = authorize(event, verb="upload", now=int(time.time()) + 60)
        assert result.ok is False
        assert "expired" in (result.reason or "")

    def test_rejects_wrong_verb(self, make_auth_event) -> None:
        event = make_auth_event(verb="list")
        result = authorize(event, verb="upload", now=int(time.time()))
        assert result.ok is False
        assert "upload" in (result.reason or "")

    def test_rejects_grant_for_a_different_blob(self, make_auth_event) -> None:
        event = make_auth_event(verb="upload", blob_sha256="a" * 64)
        result = authorize(event, verb="upload", now=int(time.time()), blob_sha256="b" * 64)
        assert result.ok is False
        assert "blob hash" in (result.reason or "")

    def test_rejects_wrong_kind(self, make_auth_event) -> None:
        event = make_auth_event(kind=1)
        assert authorize(event, verb="upload", now=int(time.time())).ok is False

    def test_rejects_event_from_the_future(self, make_auth_event) -> None:
        now = int(time.time())
        event = make_auth_event(created_at=now + 3600)
        assert authorize(event, verb="upload", now=now).ok is False

    def test_requires_exactly_one_expiration_tag(self, make_auth_event) -> None:
        now = int(time.time())
        event = make_auth_event(extra_tags=[["expiration", str(now + 9999)]])
        result = authorize(event, verb="upload", now=now)
        assert result.ok is False
        assert "expiration" in (result.reason or "")

    @pytest.mark.parametrize(
        "header",
        [None, "", "Bearer abc", "Nostr !!!not-base64!!!", "Nostr " + "eyJhIjoxfQ==", "Nostr"],
    )
    def test_malformed_authorization_headers_fail_closed(self, header: str | None) -> None:
        event = parse_auth_header(header)
        assert authorize(event, verb="upload", now=int(time.time())).ok is False

    def test_unsupported_verb_is_refused(self, make_auth_event) -> None:
        event = make_auth_event()
        assert authorize(event, verb="sudo", now=int(time.time())).ok is False
