"""The upstream request cache: fetch once, serve from disk afterwards.

Overpass throttles repeated identical queries — observed live as buildings
silently vanishing from demo reruns — so the cache is correctness for the
demo, not just speed.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from blossom_gis import app as app_module

QUERY = '[out:json][timeout:25];way["building"](32.64,-16.92,32.66,-16.90);out geom 10;'


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
