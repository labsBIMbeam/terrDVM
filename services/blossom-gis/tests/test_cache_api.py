"""The upstream request cache: fetch once, serve from disk afterwards.

Overpass throttles repeated identical queries — observed live as buildings
silently vanishing from demo reruns — so the cache is correctness for the
demo, not just speed.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import public_key_from_secret, sign
from fastapi.testclient import TestClient

from blossom_gis import app as app_module
from blossom_gis.geo import geohash_encode

QUERY = '[out:json][timeout:25];way["building"](32.64,-16.92,32.66,-16.90);out geom 10;'

#: A second BIP-340 test-vector key, so a test can act as a *different*
#: publisher than the shared `keypair` fixture. NOT A SECRET — it is the second
#: entry in the BIP-340 specification's own test-vector table and controls
#: nothing.
OTHER_SECRET = 0xC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9
OTHER_PUBKEY = public_key_from_secret(OTHER_SECRET).hex()


def auth_header(event: dict[str, Any]) -> dict[str, str]:
    encoded = base64.b64encode(json.dumps(event).encode()).decode()
    return {"Authorization": f"Nostr {encoded}"}


def other_auth_event(
    *, verb: str = "upload", blob_sha256: str | None = None, expires_in: int = 300
) -> dict[str, Any]:
    """A signed kind-24242 event from OTHER_SECRET, not the `keypair` fixture."""
    now = int(time.time())
    tags: list[list[str]] = [["t", verb], ["expiration", str(now + expires_in)]]
    if blob_sha256:
        tags.append(["x", blob_sha256])
    event: dict[str, Any] = {
        "pubkey": OTHER_PUBKEY,
        "created_at": now,
        "kind": 24242,
        "tags": tags,
        "content": "terrCVM blossom-gis second publisher",
    }
    serialized = json.dumps(
        [0, event["pubkey"], event["created_at"], event["kind"], event["tags"], event["content"]],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    event["id"] = hashlib.sha256(serialized.encode()).hexdigest()
    event["sig"] = sign(OTHER_SECRET, bytes.fromhex(event["id"])).hex()
    return event


@pytest.fixture
def cache_client(tmp_path: Path) -> Iterator[tuple[TestClient, list[str]]]:
    calls: list[str] = []

    def fake_fetch(url: str, timeout_s: float) -> bytes:
        calls.append(url)
        if "overpass" in url:
            return b'{"elements": []}'
        return b"\x89PNG\r\n\x1a\nfake-dem-tile"

    app_module.app.dependency_overrides[app_module.cache_dir] = lambda: tmp_path
    app_module.app.dependency_overrides[app_module.upstream_fetch] = lambda: fake_fetch
    with TestClient(app_module.app) as client:
        yield client, calls
    app_module.app.dependency_overrides.clear()


class TestOsmCache:
    def test_proxies_the_query_verbatim_to_overpass(self, cache_client) -> None:
        client, calls = cache_client
        response = client.get("/osm", params={"data": QUERY})
        assert response.status_code == 200
        assert response.json() == {"elements": []}
        assert len(calls) == 1
        assert calls[0].startswith(app_module.OVERPASS_UPSTREAM)

    def test_second_request_is_served_from_disk(self, cache_client) -> None:
        client, calls = cache_client
        first = client.get("/osm", params={"data": QUERY})
        second = client.get("/osm", params={"data": QUERY})
        assert first.content == second.content
        assert len(calls) == 1

    def test_distinct_queries_get_distinct_entries(self, cache_client) -> None:
        client, calls = cache_client
        client.get("/osm", params={"data": QUERY})
        client.get("/osm", params={"data": QUERY.replace("10", "20")})
        assert len(calls) == 2

    def test_empty_or_oversized_query_is_400(self, cache_client) -> None:
        client, _ = cache_client
        assert client.get("/osm", params={"data": "  "}).status_code == 400
        assert client.get("/osm", params={"data": "x" * 8_001}).status_code == 400

    def test_upstream_failure_is_a_named_502(self, tmp_path: Path) -> None:
        def failing(url: str, timeout_s: float) -> bytes:
            raise RuntimeError("overpass says no")

        app_module.app.dependency_overrides[app_module.cache_dir] = lambda: tmp_path
        app_module.app.dependency_overrides[app_module.upstream_fetch] = lambda: failing
        try:
            with TestClient(app_module.app) as client:
                response = client.get("/osm", params={"data": QUERY})
            assert response.status_code == 502
            assert "overpass says no" in response.json()["detail"]
        finally:
            app_module.app.dependency_overrides.clear()


class TestDemCache:
    def test_serves_png_and_caches(self, cache_client) -> None:
        client, calls = cache_client
        first = client.get("/dem/11/927/826.png")
        second = client.get("/dem/11/927/826.png")
        assert first.status_code == 200
        assert first.headers["content-type"] == "image/png"
        assert first.content == second.content
        assert len(calls) == 1
        assert "elevation-tiles-prod" in calls[0]

    def test_invalid_tile_is_400(self, cache_client) -> None:
        client, _ = cache_client
        assert client.get("/dem/11/999999/826.png").status_code == 400


class TestDashboard:
    def test_serves_sources_licences_and_holdings(self, cache_client) -> None:
        client, _ = cache_client
        response = client.get("/dashboard")
        assert response.status_code == 200
        page = response.text
        assert "basemap.at Orthofoto" in page
        assert "DROTe" in page
        assert "CC-BY-4.0" in page
        assert "ODbL" in page
        assert "vienna" in page
        # The full qualified pool with operator classification.
        assert "swisstopo SWISSIMAGE" in page
        assert "qualified — not wired yet" in page
        assert "state — IGN France" in page
        assert "commercial — Esri Inc." in page
        assert "Europe coverage" in page


class TestCharacterManifest:
    def test_serves_named_avatars_from_the_manifest(self, tmp_path: Path) -> None:
        manifest = tmp_path / "characters.json"
        manifest.write_text(
            '{"flx600": {"sha256": "'
            + "a" * 64
            + '", "size": 11636080}, "junk": {"sha256": "not-a-hash"}}',
            encoding="utf-8",
        )
        app_module.app.dependency_overrides[app_module.characters_manifest_path] = (
            lambda: manifest
        )
        try:
            with TestClient(app_module.app) as client:
                entries = client.get("/characters").json()
            assert entries == [{"name": "flx600", "sha256": "a" * 64, "size": 11636080}]
        finally:
            app_module.app.dependency_overrides.clear()

    def test_missing_manifest_is_an_empty_list(self, tmp_path: Path) -> None:
        app_module.app.dependency_overrides[app_module.characters_manifest_path] = (
            lambda: tmp_path / "absent.json"
        )
        try:
            with TestClient(app_module.app) as client:
                assert client.get("/characters").json() == []
        finally:
            app_module.app.dependency_overrides.clear()


class TestWfsProxy:
    def test_fetches_registered_source_and_caches(self, cache_client) -> None:
        client, calls = cache_client

        def wfs_fetch(url: str, timeout_s: float) -> bytes:
            calls.append(url)
            return b'{"type":"FeatureCollection","features":[]}'

        app_module.app.dependency_overrides[app_module.upstream_fetch] = lambda: wfs_fetch
        params = {"src": "vienna-bkm", "bbox": "16.355,48.195,16.385,48.215"}
        first = client.get("/wfs", params=params)
        second = client.get("/wfs", params=params)
        assert first.status_code == 200
        assert first.headers["x-wfs-attribution"].startswith("Datenquelle: Stadt Wien")
        assert first.content == second.content
        assert len(calls) == 1
        assert "FMZKBKMOGD" in calls[0]
        assert "data.wien.gv.at" in calls[0]

    def test_unknown_source_is_404_not_an_open_proxy(self, cache_client) -> None:
        client, _ = cache_client
        response = client.get(
            "/wfs", params={"src": "evil", "bbox": "16.35,48.19,16.38,48.21"}
        )
        assert response.status_code == 404


class TestPlacements:
    def test_filters_by_bbox_and_drops_junk(self, tmp_path: Path) -> None:
        placements = tmp_path / "placements.json"
        placements.write_text(
            '[{"name":"flx600","sha256":"'
            + "a" * 64
            + '","lon":16.37,"lat":48.21,"heading":200},'
            '{"name":"far","sha256":"' + "b" * 64 + '","lon":0,"lat":0,"heading":0}]',
            encoding="utf-8",
        )
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                inside = client.get(
                    "/placements", params={"bbox": "16.35,48.19,16.39,48.22"}
                ).json()
                everything = client.get("/placements").json()
            assert [p["name"] for p in inside] == ["flx600"]
            assert len(everything) == 2
        finally:
            app_module.app.dependency_overrides.clear()

    def test_missing_file_is_an_empty_list(self, tmp_path: Path) -> None:
        app_module.app.dependency_overrides[app_module.placements_path] = (
            lambda: tmp_path / "absent.json"
        )
        try:
            with TestClient(app_module.app) as client:
                assert client.get("/placements").json() == []
        finally:
            app_module.app.dependency_overrides.clear()


class TestPlacementEvent:
    def test_builds_unsigned_nip94_announcement(self, tmp_path: Path, monkeypatch) -> None:
        manifest = tmp_path / "characters.json"
        manifest.write_text(
            '{"flx600": {"sha256": "' + "a" * 64 + '", "size": 11636080}}',
            encoding="utf-8",
        )
        monkeypatch.setattr(app_module, "DATA_DIR", tmp_path)
        with TestClient(app_module.app) as client:
            event = client.get(
                "/placements/event",
                params={"character": "flx600", "at": "16.3725,48.2085", "heading": 200},
            ).json()
        assert event["kind"] == 1063
        tags = {t[0]: t[1] for t in event["tags"] if t[0] != "g"}
        assert tags["x"] == "a" * 64
        assert tags["x"] in tags["url"]
        assert tags["m"] == "model/gltf-binary"
        assert tags["name"] == "flx600"
        # 1063 is a social kind: the full ladder, not one precision-4 cell.
        geohashes = [t[1] for t in event["tags"] if t[0] == "g"]
        assert geohashes == [geohash_encode(48.2085, 16.3725, p) for p in range(1, 7)]
        # Unsigned on purpose: the server never holds a key.
        assert "sig" not in event and "pubkey" not in event

    def test_calendar_event_is_an_unsigned_nip52_meetup(self) -> None:
        with TestClient(app_module.app) as client:
            event = client.get(
                "/calendar/event",
                params={
                    "title": "SEC demo night",
                    "at": "16.372500,48.208500",
                    "starts": 1785500000,
                    "description": "terrain CVM live",
                },
            ).json()
        assert event["kind"] == 31923
        tags = {t[0]: t[1] for t in event["tags"] if t[0] != "g"}
        assert tags["title"] == "SEC demo night"
        assert tags["start"] == "1785500000"
        # Location falls back to the title when the caller sends none.
        assert tags["location"] == "SEC demo night"
        assert tags["d"].startswith("terrcvm-1785500000-")
        assert event["content"] == "terrain CVM live"
        geohashes = [t[1] for t in event["tags"] if t[0] == "g"]
        assert geohashes == [geohash_encode(48.2085, 16.3725, p) for p in range(1, 7)]
        assert "sig" not in event and "pubkey" not in event

    def test_builds_an_unsigned_nip38_presence_status(self, tmp_path: Path, monkeypatch) -> None:
        """30315 had no test at all, which is how the ladder went missing unnoticed."""
        manifest = tmp_path / "characters.json"
        manifest.write_text(
            '{"flx600": {"sha256": "' + "a" * 64 + '", "size": 11636080}}',
            encoding="utf-8",
        )
        monkeypatch.setattr(app_module, "DATA_DIR", tmp_path)
        with TestClient(app_module.app) as client:
            event = client.get(
                "/presence/event",
                params={"character": "flx600", "at": "16.3725,48.2085"},
            ).json()
        assert event["kind"] == 30315
        tags = {t[0]: t[1] for t in event["tags"] if t[0] != "g"}
        assert tags["d"] == "terrcvm"
        assert tags["name"] == "flx600"
        geohashes = [t[1] for t in event["tags"] if t[0] == "g"]
        assert geohashes == [geohash_encode(48.2085, 16.3725, p) for p in range(1, 7)]
        assert "sig" not in event and "pubkey" not in event


    def test_calendar_event_rejects_blank_title_and_bad_time(self) -> None:
        with TestClient(app_module.app) as client:
            blank = client.get(
                "/calendar/event",
                params={"title": "  ", "at": "16.37,48.2", "starts": 1785500000},
            )
            bad_time = client.get(
                "/calendar/event",
                params={"title": "x", "at": "16.37,48.2", "starts": 0},
            )
        assert blank.status_code == 400
        assert bad_time.status_code == 400

    def test_post_records_a_local_placement(self, tmp_path: Path, make_auth_event) -> None:
        placements = tmp_path / "placements.json"
        sha = "b" * 64
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                ok = client.post(
                    "/placements",
                    json={"name": "gigi", "sha256": sha, "lon": 16.31, "lat": 48.18},
                    headers=auth_header(make_auth_event(verb="upload", blob_sha256=sha)),
                )
                bad = client.post(
                    "/placements",
                    json={"name": "x", "sha256": "junk"},
                    headers=auth_header(make_auth_event(verb="upload", blob_sha256=sha)),
                )
            assert ok.status_code == 200
            assert bad.status_code == 400
            assert "gigi" in placements.read_text(encoding="utf-8")
        finally:
            app_module.app.dependency_overrides.clear()


class TestPlacementAuthorization:
    """POST /placements was unauthenticated. Three attacks rode on that.

    Each test below is one of them, written to fail against the old handler:
    it took the owner pubkey from the request body, deduplicated on `name`
    alone, and never read an Authorization header at all.
    """

    def _post(self, client, body, event=None):
        headers = auth_header(event) if event else {}
        return client.post("/placements", json=body, headers=headers)

    def test_an_unsigned_post_is_rejected(self, tmp_path: Path) -> None:
        placements = tmp_path / "placements.json"
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                response = self._post(
                    client,
                    {"name": "gigi", "sha256": "b" * 64, "lon": 16.31, "lat": 48.18},
                )
            assert response.status_code == 401
            assert not placements.exists()
        finally:
            app_module.app.dependency_overrides.clear()

    def test_the_body_cannot_claim_another_pubkey(
        self, tmp_path: Path, make_auth_event, keypair
    ) -> None:
        """Attack 1 — impersonation.

        The body carries the operator's stage npub; the signature does not. The
        stored owner must be the signer, not the claim.
        """
        _, signer = keypair
        placements = tmp_path / "placements.json"
        sha = "c" * 64
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                response = self._post(
                    client,
                    {
                        "name": "gigi",
                        "sha256": sha,
                        "lon": 16.31,
                        "lat": 48.18,
                        "pubkey": app_module.DEMO_OWNER_PUBKEY,
                    },
                    make_auth_event(verb="upload", blob_sha256=sha),
                )
            assert response.status_code == 200
            stored = json.loads(placements.read_text(encoding="utf-8"))
            assert [entry["pubkey"] for entry in stored] == [signer]
            assert app_module.DEMO_OWNER_PUBKEY not in placements.read_text(encoding="utf-8")
        finally:
            app_module.app.dependency_overrides.clear()

    def test_one_publisher_cannot_evict_anothers_placement(
        self, tmp_path: Path, make_auth_event, keypair
    ) -> None:
        """Attack 2 — eviction.

        Dedup used to filter on the attacker-controlled `name`, so re-posting
        someone else's character name deleted their entry. The key is
        (pubkey, name): both placements must survive.
        """
        _, victim = keypair
        placements = tmp_path / "placements.json"
        sha = "d" * 64
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                first = self._post(
                    client,
                    {"name": "gigi", "sha256": sha, "lon": 16.31, "lat": 48.18},
                    make_auth_event(verb="upload", blob_sha256=sha),
                )
                # A different keypair, same character name.
                second = self._post(
                    client,
                    {"name": "gigi", "sha256": sha, "lon": -3.7, "lat": 40.4},
                    other_auth_event(verb="upload", blob_sha256=sha),
                )
            assert (first.status_code, second.status_code) == (200, 200)
            stored = json.loads(placements.read_text(encoding="utf-8"))
            assert len(stored) == 2
            assert {entry["pubkey"] for entry in stored} == {victim, OTHER_PUBKEY}
            # And re-posting under the same key still replaces, not duplicates.
            with TestClient(app_module.app) as client:
                self._post(
                    client,
                    {"name": "gigi", "sha256": sha, "lon": 16.4, "lat": 48.2},
                    make_auth_event(verb="upload", blob_sha256=sha),
                )
            stored = json.loads(placements.read_text(encoding="utf-8"))
            assert len(stored) == 2
            mine = [e for e in stored if e["pubkey"] == victim]
            assert len(mine) == 1 and mine[0]["lon"] == 16.4
        finally:
            app_module.app.dependency_overrides.clear()

    def test_an_arbitrary_sha256_cannot_be_smuggled_in(
        self, tmp_path: Path, make_auth_event
    ) -> None:
        """Attack 3 — content injection.

        The napplet fetches and decodes whatever hash this file names. The
        authorization event's `x` tag must cover the exact blob being placed,
        so a signature minted for one hash cannot carry another.
        """
        placements = tmp_path / "placements.json"
        app_module.app.dependency_overrides[app_module.placements_path] = lambda: placements
        try:
            with TestClient(app_module.app) as client:
                mismatched = self._post(
                    client,
                    {"name": "gigi", "sha256": "e" * 64, "lon": 16.31, "lat": 48.18},
                    make_auth_event(verb="upload", blob_sha256="f" * 64),
                )
                wrong_verb = self._post(
                    client,
                    {"name": "gigi", "sha256": "e" * 64, "lon": 16.31, "lat": 48.18},
                    make_auth_event(verb="get", blob_sha256="e" * 64),
                )
                expired = self._post(
                    client,
                    {"name": "gigi", "sha256": "e" * 64, "lon": 16.31, "lat": 48.18},
                    make_auth_event(verb="upload", blob_sha256="e" * 64, expires_in=-60),
                )
            assert mismatched.status_code == 401
            assert wrong_verb.status_code == 401
            assert expired.status_code == 401
            assert not placements.exists()
        finally:
            app_module.app.dependency_overrides.clear()


class TestSocialGeohashLadder:
    """Which kinds get a ladder and which get one tag. This has flipped once already.

    A precision-4 tag is 39x19 km. `apps/napplet/src/nostr/presence.ts` queries
    precision 5 for a point and 2/3/4 by viewport span, and relay tag filters are
    exact string matches — so a lone precision-4 tag answers none of those three.
    """

    LADDER_ENDPOINTS = [
        ("/placements/event", 1063, {"character": "flx600", "at": "16.3725,48.2085"}),
        ("/presence/event", 30315, {"character": "flx600", "at": "16.3725,48.2085"}),
        (
            "/calendar/event",
            31923,
            {"title": "SEC demo night", "at": "16.3725,48.2085", "starts": 1785500000},
        ),
    ]

    @pytest.mark.parametrize(("path", "kind", "params"), LADDER_ENDPOINTS)
    def test_every_social_endpoint_publishes_precisions_one_to_six(
        self, path: str, kind: int, params: dict, tmp_path: Path, monkeypatch
    ) -> None:
        manifest = tmp_path / "characters.json"
        manifest.write_text(
            '{"flx600": {"sha256": "' + "a" * 64 + '", "size": 1}}', encoding="utf-8"
        )
        monkeypatch.setattr(app_module, "DATA_DIR", tmp_path)
        with TestClient(app_module.app) as client:
            event = client.get(path, params=params).json()
        assert event["kind"] == kind
        cells = [t[1] for t in event["tags"] if t[0] == "g"]
        assert [len(c) for c in cells] == [1, 2, 3, 4, 5, 6]
        for shorter, longer in zip(cells, cells[1:], strict=False):
            assert longer.startswith(shorter)

    def test_the_dataset_item_still_carries_exactly_one_tag(self) -> None:
        """The single-precision rule belongs to 30550/30551 and to nothing else."""
        from blossom_gis.geo_protocol import build_item

        item = build_item(
            dataset="terrain",
            pubkey="0123456789abcdef" * 4,
            z=14,
            x=8593,
            y=5677,
            sha256="fedcba9876543210" * 4,
            url="https://blossom.example/x.tft2",
            mime_type="application/vnd.terrcvm.tft2",
            size=65536,
            datetime="2026-01-01T00:00:00Z",
            created_at=1767225600,
        )
        assert [t for t in item["tags"] if t[0] == "g"] == [["g", "u0w6"]]
