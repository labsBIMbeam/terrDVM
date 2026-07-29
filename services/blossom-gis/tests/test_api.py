from __future__ import annotations

import base64
import hashlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from blossom_gis import app as app_module
from blossom_gis.db import BlobIndex
from blossom_gis.geo import BBox, geohash_encode
from blossom_gis.store import BlobStore

MADEIRA_BBOX = "-17.05,32.70,-16.95,32.78"


def auth_header(event: dict[str, Any]) -> dict[str, str]:
    encoded = base64.b64encode(json.dumps(event).encode()).decode()
    return {"Authorization": f"Nostr {encoded}"}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    store = BlobStore(tmp_path / "blobs")
    index = BlobIndex(tmp_path / "index.sqlite")
    app_module.app.dependency_overrides[app_module.store] = lambda: store
    app_module.app.dependency_overrides[app_module.index] = lambda: index
    with TestClient(app_module.app) as test_client:
        yield test_client
    app_module.app.dependency_overrides.clear()
    index.close()


def upload(client: TestClient, make_auth_event, payload: bytes, **headers: str):
    digest = hashlib.sha256(payload).hexdigest()
    event = make_auth_event(verb="upload", blob_sha256=digest)
    return client.put(
        "/upload",
        content=payload,
        headers={**auth_header(event), "Content-Type": "image/png", **headers},
    )


class TestServerInfo:
    def test_advertises_supported_buds_and_extensions(self, client: TestClient) -> None:
        body = client.get("/").json()
        assert "BUD-01" in body["buds"]
        assert "geo-bbox" in body["extensions"]


class TestUploadAndRetrieve:
    def test_round_trips_a_blob(self, client: TestClient, make_auth_event) -> None:
        payload = b"\x89PNG fake terrain tile"
        response = upload(client, make_auth_event, payload)
        assert response.status_code == 201

        descriptor = response.json()
        digest = hashlib.sha256(payload).hexdigest()
        assert descriptor["sha256"] == digest
        assert descriptor["size"] == len(payload)

        fetched = client.get(f"/{digest}")
        assert fetched.status_code == 200
        assert fetched.content == payload
        assert fetched.headers["etag"] == f'"{digest}"'

    def test_serves_a_hash_with_an_extension(self, client: TestClient, make_auth_event) -> None:
        payload = b"tile"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)
        assert client.get(f"/{digest}.png").content == payload

    def test_head_returns_metadata_without_a_body(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = b"tile bytes"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)

        response = client.head(f"/{digest}")
        assert response.status_code == 200
        assert response.content == b""
        assert response.headers["content-length"] == str(len(payload))

    def test_unknown_blob_is_404_and_bad_hash_is_400(self, client: TestClient) -> None:
        assert client.get(f"/{'a' * 64}").status_code == 404
        assert client.get("/not-a-hash").status_code == 400


class TestAuthorization:
    def test_upload_without_authorization_is_rejected(self, client: TestClient) -> None:
        assert client.put("/upload", content=b"x").status_code == 401

    def test_upload_authorized_for_another_blob_is_rejected(
        self, client: TestClient, make_auth_event
    ) -> None:
        event = make_auth_event(verb="upload", blob_sha256="a" * 64)
        response = client.put("/upload", content=b"different", headers=auth_header(event))
        assert response.status_code == 401

    def test_delete_requires_the_original_uploader(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = b"deletable"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)

        event = make_auth_event(verb="delete", blob_sha256=digest)
        assert client.request("DELETE", f"/{digest}", headers=auth_header(event)).status_code == 204
        assert client.get(f"/{digest}").status_code == 404

    def test_delete_without_a_delete_grant_is_rejected(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = b"protected"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)

        upload_grant = make_auth_event(verb="upload", blob_sha256=digest)
        response = client.request("DELETE", f"/{digest}", headers=auth_header(upload_grant))
        assert response.status_code == 401
        assert client.get(f"/{digest}").status_code == 200


class TestGeoIndexing:
    def test_indexes_and_finds_a_blob_by_bounding_box(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = b"madeira dem tile"
        digest = hashlib.sha256(payload).hexdigest()
        response = upload(client, make_auth_event, payload, **{"X-Geo-BBox": MADEIRA_BBOX})
        assert response.status_code == 201
        assert response.json()["bbox"] == [-17.05, 32.70, -16.95, 32.78]
        # Derived from the footprint centre rather than hard-coded, so the
        # assertion tracks the indexing rule instead of a magic string.
        centre = BBox(west=-17.05, south=32.70, east=-16.95, north=32.78).center
        assert response.json()["geohash"] == geohash_encode(*centre)

        hits = client.get("/geo", params={"bbox": "-17.1,32.6,-16.9,32.8"}).json()
        assert [h["sha256"] for h in hits] == [digest]

    def test_excludes_a_blob_outside_the_query_box(
        self, client: TestClient, make_auth_event
    ) -> None:
        upload(client, make_auth_event, b"madeira", **{"X-Geo-BBox": MADEIRA_BBOX})
        # Vienna — far from the archipelago.
        assert client.get("/geo", params={"bbox": "16.2,48.1,16.5,48.3"}).json() == []

    def test_binds_a_tile_and_finds_it_again(self, client: TestClient, make_auth_event) -> None:
        payload = b"z11 tile"
        digest = hashlib.sha256(payload).hexdigest()
        response = upload(client, make_auth_event, payload, **{"X-Geo-Tile": "11/927/826"})
        assert response.status_code == 201
        assert response.json()["tile"] == {"z": 11, "x": 927, "y": 826}

        hits = client.get("/tile/11/927/826").json()
        assert [h["sha256"] for h in hits] == [digest]
        assert client.get("/tile/11/0/0").json() == []

    def test_geo_headers_are_returned_on_retrieval(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = b"tile with footprint"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload, **{"X-Geo-BBox": MADEIRA_BBOX})
        headers = client.get(f"/{digest}").headers
        assert headers["x-geo-bbox"] == "-17.05,32.7,-16.95,32.78"
        assert headers["x-geo-geohash"]

    @pytest.mark.parametrize(
        "bad",
        ["1,2,3", "a,b,c,d", "10,10,0,20"],  # too few / non-numeric / inverted
    )
    def test_malformed_geo_metadata_is_rejected(
        self, client: TestClient, make_auth_event, bad: str
    ) -> None:
        response = upload(client, make_auth_event, b"payload", **{"X-Geo-BBox": bad})
        assert response.status_code == 400

    def test_malformed_geo_query_is_rejected(self, client: TestClient) -> None:
        assert client.get("/geo", params={"bbox": "1,2,3"}).status_code == 400
        assert client.get("/tile/11/99999/1").status_code == 400


class TestListing:
    def test_lists_only_the_requested_pubkey(
        self, client: TestClient, make_auth_event, keypair
    ) -> None:
        _, pubkey = keypair
        upload(client, make_auth_event, b"one")
        upload(client, make_auth_event, b"two")

        listed = client.get(f"/list/{pubkey}").json()
        assert len(listed) == 2
        assert client.get(f"/list/{'0' * 64}").json() == []

    def test_rejects_a_malformed_pubkey(self, client: TestClient) -> None:
        assert client.get("/list/nope").status_code == 400


class TestRangeRequests:
    """Partial reads matter for cloud-optimised rasters."""

    def test_serves_a_byte_range(self, client: TestClient, make_auth_event) -> None:
        payload = bytes(range(256))
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)

        response = client.get(f"/{digest}", headers={"Range": "bytes=10-19"})
        assert response.status_code == 206
        assert response.content == payload[10:20]
        assert response.headers["content-range"] == "bytes 10-19/256"

    def test_serves_an_open_ended_and_suffix_range(
        self, client: TestClient, make_auth_event
    ) -> None:
        payload = bytes(range(256))
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)

        assert client.get(f"/{digest}", headers={"Range": "bytes=250-"}).content == payload[250:]
        assert client.get(f"/{digest}", headers={"Range": "bytes=-6"}).content == payload[-6:]

    def test_unsatisfiable_range_is_416(self, client: TestClient, make_auth_event) -> None:
        payload = b"short"
        digest = hashlib.sha256(payload).hexdigest()
        upload(client, make_auth_event, payload)
        assert client.get(f"/{digest}", headers={"Range": "bytes=999-"}).status_code == 416
