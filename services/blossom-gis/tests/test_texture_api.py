"""The /texture endpoint: extent in, cached orthophoto out.

The corpus is tile-shaped; a texture is a per-delivery bake over the exact
requested borders. These tests stub the upstream fetch — network behaviour of
the backends is covered in test_texture.py.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from blossom_gis import app as app_module
from blossom_gis.geo import BBox
from blossom_gis.texture import DROTE_MADEIRA, Texture

FUNCHAL = "-16.92,32.64,-16.90,32.66"


def _stub_texture(box: BBox) -> Texture:
    return Texture(
        image=Image.new("RGB", (64, 64), (120, 100, 80)),
        source=DROTE_MADEIRA,
        bbox=box,
        metres_per_pixel=0.25,
        requests=1,
        warnings=[],
    )


@pytest.fixture
def texture_client(tmp_path: Path) -> Iterator[tuple[TestClient, list]]:
    calls: list = []

    def fake_fetch(box, region, target, **_kwargs):
        calls.append((region, target))
        return _stub_texture(box)

    app_module.app.dependency_overrides[app_module.texture_dir] = lambda: tmp_path
    app_module.app.dependency_overrides[app_module.texture_fetch] = lambda: fake_fetch
    with TestClient(app_module.app) as client:
        yield client, calls
    app_module.app.dependency_overrides.clear()


class TestTextureEndpoint:
    def test_returns_jpeg_with_provenance_headers(self, texture_client) -> None:
        client, _ = texture_client
        response = client.get("/texture", params={"region": "madeira", "bbox": FUNCHAL})
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["x-texture-source"] == "drote-madeira-ortho"
        assert response.content[:2] == b"\xff\xd8"  # JPEG SOI marker

    def test_meta_carries_source_licence_and_attribution(self, texture_client) -> None:
        client, _ = texture_client
        meta = client.get(
            "/texture/meta", params={"region": "madeira", "bbox": FUNCHAL}
        ).json()
        assert meta["source"]["id"] == "drote-madeira-ortho"
        assert meta["source"]["license"]
        assert meta["source"]["attribution"]
        assert meta["m_per_px"] == 0.25

    def test_second_request_is_served_from_disk(self, texture_client) -> None:
        client, calls = texture_client
        params = {"region": "madeira", "bbox": FUNCHAL}
        first = client.get("/texture", params=params)
        second = client.get("/texture", params=params)
        assert first.content == second.content
        assert len(calls) == 1

    def test_sidecar_records_provenance_on_disk(
        self, texture_client, tmp_path: Path
    ) -> None:
        client, _ = texture_client
        client.get("/texture", params={"region": "madeira", "bbox": FUNCHAL})
        sidecars = list(tmp_path.glob("*.txt"))
        assert len(sidecars) == 1
        assert "drote-madeira-ortho" in sidecars[0].read_text(encoding="utf-8")

    def test_unknown_region_is_404(self, texture_client) -> None:
        client, _ = texture_client
        response = client.get("/texture", params={"region": "atlantis", "bbox": FUNCHAL})
        assert response.status_code == 404

    def test_malformed_bbox_is_400(self, texture_client) -> None:
        client, _ = texture_client
        response = client.get("/texture", params={"region": "madeira", "bbox": "1,2,3"})
        assert response.status_code == 400

    def test_oversized_bbox_is_413(self, texture_client) -> None:
        client, _ = texture_client
        response = client.get(
            "/texture", params={"region": "madeira", "bbox": "-17.3,32.3,-16.2,33.1"}
        )
        assert response.status_code == 413

    def test_upstream_failure_is_a_named_502(self, tmp_path: Path) -> None:
        def failing_fetch(box, region, target, **_kwargs):
            raise RuntimeError("no texture source succeeded")

        app_module.app.dependency_overrides[app_module.texture_dir] = lambda: tmp_path
        app_module.app.dependency_overrides[app_module.texture_fetch] = (
            lambda: failing_fetch
        )
        try:
            with TestClient(app_module.app) as client:
                response = client.get(
                    "/texture", params={"region": "madeira", "bbox": FUNCHAL}
                )
            assert response.status_code == 502
            assert "no texture source succeeded" in response.json()["detail"]
        finally:
            app_module.app.dependency_overrides.clear()
