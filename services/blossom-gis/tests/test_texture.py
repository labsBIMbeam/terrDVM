from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from blossom_gis.geo import BBox
from blossom_gis.texture import (
    ESRI_MAX_ZOOM,
    ESRI_WORLD_IMAGERY,
    IRIG_SOUTH_TYROL,
    REGION_SOURCES,
    SOURCES,
    fetch_texture,
    fetch_wms_texture,
    fetch_xyz_texture,
    metres_per_pixel,
    write_texture,
    zoom_for_resolution,
)

FUNCHAL = BBox(west=-16.9200, south=32.6450, east=-16.9080, north=32.6530)
BOLZANO = BBox(west=11.3480, south=46.4940, east=11.3620, north=46.5030)


def jpeg_bytes(size: tuple[int, int] = (256, 256), colour=(120, 90, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "JPEG")
    return buffer.getvalue()


class TestResolutionMath:
    def test_resolution_halves_with_each_zoom_level(self) -> None:
        assert metres_per_pixel(13, 46.6) == pytest.approx(metres_per_pixel(12, 46.6) / 2)

    def test_resolution_tightens_towards_the_poles(self) -> None:
        assert metres_per_pixel(12, 60.0) < metres_per_pixel(12, 0.0)

    def test_picks_the_shallowest_zoom_that_meets_the_target(self) -> None:
        zoom = zoom_for_resolution(BOLZANO, 0.25)
        latitude, _ = BOLZANO.center
        assert metres_per_pixel(zoom, latitude) <= 0.25
        assert metres_per_pixel(zoom - 1, latitude) > 0.25

    def test_rejects_a_non_positive_target(self) -> None:
        with pytest.raises(ValueError):
            zoom_for_resolution(BOLZANO, 0)


class TestSourceRegistry:
    def test_every_source_declares_a_licence_and_attribution(self) -> None:
        for source in SOURCES.values():
            assert source.license and source.attribution

    def test_south_tyrol_prefers_its_own_survey_over_the_global_fallback(self) -> None:
        order = REGION_SOURCES["south-tyrol"]
        assert order[0] == IRIG_SOUTH_TYROL.id
        assert order[-1] == ESRI_WORLD_IMAGERY.id

    def test_esri_zoom_ceiling_is_pinned(self) -> None:
        # z20 was shown to return one identical placeholder worldwide.
        assert ESRI_WORLD_IMAGERY.max_zoom == ESRI_MAX_ZOOM == 19


class TestXyzMosaic:
    def test_stitches_and_crops_to_the_requested_extent(self) -> None:
        calls: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            calls.append(url)
            return jpeg_bytes()

        texture = fetch_xyz_texture(FUNCHAL, ESRI_WORLD_IMAGERY, 0.25, fetcher=fake)

        assert texture.requests == len(calls)
        assert texture.image.size[0] > 0 and texture.image.size[1] > 0
        # Cropped to the extent, so never larger than the assembled mosaic.
        assert texture.image.size[0] <= 256 * 40

    def test_clamps_to_the_source_zoom_ceiling_and_says_so(self) -> None:
        texture = fetch_xyz_texture(
            FUNCHAL, ESRI_WORLD_IMAGERY, 0.02, max_tiles=4000,
            fetcher=lambda url, timeout: jpeg_bytes(),
        )
        assert any("stops at z19" in w for w in texture.warnings)

    def test_respects_the_tile_budget(self) -> None:
        calls: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            calls.append(url)
            return jpeg_bytes()

        fetch_xyz_texture(FUNCHAL, ESRI_WORLD_IMAGERY, 0.05, max_tiles=16, fetcher=fake)
        assert len(calls) <= 16

    def test_one_failing_tile_does_not_lose_the_mosaic(self) -> None:
        state = {"n": 0}

        def flaky(url: str, timeout: float) -> bytes:
            state["n"] += 1
            if state["n"] == 2:
                raise TimeoutError("upstream stalled")
            return jpeg_bytes()

        texture = fetch_xyz_texture(
            FUNCHAL, ESRI_WORLD_IMAGERY, 1.0, max_tiles=64, fetcher=flaky
        )
        assert texture.image.size[0] > 0
        assert any("TimeoutError" in w for w in texture.warnings)


class TestWmsTexture:
    def test_requests_the_extent_in_one_call_with_lat_lon_axis_order(self) -> None:
        seen: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            seen.append(url)
            return jpeg_bytes((800, 600))

        texture = fetch_wms_texture(BOLZANO, IRIG_SOUTH_TYROL, 0.25, fetcher=fake)

        assert texture.requests == 1
        url = seen[0]
        assert "REQUEST=GetMap" in url
        # WMS 1.3.0 + EPSG:4326 is lat,lon — swapping it silently returns
        # a different place on Earth.
        assert f"BBOX={BOLZANO.south}" in url.replace("%2C", ",").replace("+", "")
        assert "OI.OrthoimageCoverage" in url.replace("%3A", ":")

    def test_clamps_oversized_requests(self) -> None:
        texture = fetch_wms_texture(
            BOLZANO, IRIG_SOUTH_TYROL, 0.01, max_side_px=512,
            fetcher=lambda url, timeout: jpeg_bytes((512, 400)),
        )
        assert any("clamped" in w for w in texture.warnings)

    def test_refuses_a_source_without_a_layer(self) -> None:
        with pytest.raises(ValueError, match="no WMS layer"):
            fetch_wms_texture(BOLZANO, ESRI_WORLD_IMAGERY, 0.25, fetcher=lambda u, t: b"")


class TestRegionSelection:
    def test_south_tyrol_falls_back_to_esri_when_its_survey_fails(self) -> None:
        used: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            if "civis.bz.it" in url:
                used.append("irig")
                raise ConnectionError("regional service down")
            used.append("esri")
            return jpeg_bytes()

        texture = fetch_texture(BOLZANO, "south-tyrol", 1.0, fetcher=fake)
        assert texture.source.id == ESRI_WORLD_IMAGERY.id
        assert used[0] == "irig"

    def test_raises_when_every_source_fails(self) -> None:
        def dead(url: str, timeout: float) -> bytes:
            raise ConnectionError("no route")

        with pytest.raises(RuntimeError, match="no texture source succeeded"):
            fetch_texture(BOLZANO, "south-tyrol", 1.0, fetcher=dead)


class TestProvenance:
    def test_writes_the_image_and_a_provenance_sidecar(self, tmp_path: Path) -> None:
        texture = fetch_wms_texture(
            BOLZANO, IRIG_SOUTH_TYROL, 1.0,
            fetcher=lambda url, timeout: jpeg_bytes((400, 300)),
        )
        image_path, sidecar = write_texture(texture, tmp_path, "bolzano")

        assert image_path.exists() and Image.open(image_path).size == (400, 300)
        text = sidecar.read_text(encoding="utf-8")
        # A texture whose licence is unknown is a liability.
        assert "CC0-1.0" in text
        assert "Autonome Provinz Bozen" in text
        assert "OI.OrthoimageCoverage" in text


class TestBackendOptionRouting:
    """A tile-only option must not silently demote a WMS-backed region."""

    def test_max_tiles_does_not_knock_south_tyrol_off_its_own_survey(self) -> None:
        used: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            used.append("irig" if "civis.bz.it" in url else "esri")
            return jpeg_bytes((600, 400))

        texture = fetch_texture(
            BOLZANO, "south-tyrol", 0.25, max_tiles=400, fetcher=fake
        )

        assert texture.source.id == IRIG_SOUTH_TYROL.id
        assert used == ["irig"]

    def test_wms_only_option_does_not_break_a_tile_backed_region(self) -> None:
        # Europe is the one region left without a regional WMS: its only
        # texture source is the Esri tile fallback.
        texture = fetch_texture(
            FUNCHAL, "europe", 1.0, max_side_px=1024,
            fetcher=lambda url, timeout: jpeg_bytes(),
        )
        assert texture.source.id == ESRI_WORLD_IMAGERY.id

    def test_madeira_prefers_drote_over_the_global_fallback(self) -> None:
        used: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            used.append("drote" if "madeira.gov.pt" in url else "esri")
            return jpeg_bytes((600, 400))

        texture = fetch_texture(FUNCHAL, "madeira", 0.25, fetcher=fake)

        assert texture.source.id == "drote-madeira-ortho"
        assert used == ["drote"]
