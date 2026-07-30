from __future__ import annotations

import io

import pytest
from PIL import Image

from blossom_gis.source_check import (
    CANDIDATES,
    MIN_BYTES_PER_MEGAPIXEL,
    MIN_DETAIL_SCORE,
    Candidate,
    detail_score,
    metres_per_pixel_at,
    probe,
)

ESRI = next(c for c in CANDIDATES if c.id == "esri-world-imagery")
IRIG = next(c for c in CANDIDATES if c.id == "irig-south-tyrol")


def encode(image: Image.Image, quality: int = 85) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=quality)
    return buffer.getvalue()


def rich_imagery(size: int = 256) -> bytes:
    return encode(Image.effect_noise((size, size), 55), quality=92)


def placeholder(size: int = 256) -> bytes:
    """A near-uniform tile — what a service returns where it has no coverage."""
    base = Image.new("L", (size, size), 210)
    base.putpixel((0, 0), 190)
    return encode(base, quality=60)


class TestDetailScore:
    def test_separates_real_detail_from_upsampled_mush(self) -> None:
        noise = Image.effect_noise((256, 256), 60).convert("RGB")
        upsampled = noise.resize((32, 32), Image.LANCZOS).resize((256, 256), Image.LANCZOS)

        assert detail_score(noise) > MIN_DETAIL_SCORE
        assert detail_score(upsampled) < MIN_DETAIL_SCORE

    def test_flat_fill_scores_at_unity(self) -> None:
        flat = Image.new("RGB", (256, 256), (128, 128, 128))
        assert detail_score(flat) == pytest.approx(1.0, abs=0.05)

    def test_tiny_images_score_zero_rather_than_dividing_by_nothing(self) -> None:
        assert detail_score(Image.new("RGB", (8, 8))) == 0.0


class TestResolution:
    def test_halves_per_zoom_level(self) -> None:
        assert metres_per_pixel_at(19, 46.6) == pytest.approx(
            metres_per_pixel_at(18, 46.6) / 2
        )


class TestProbe:
    def test_accepts_genuine_imagery(self) -> None:
        result = probe(ESRI, fetcher=lambda url, timeout: rich_imagery())

        assert result.ok
        assert result.usable_for_architecture
        assert result.verdict == "architectural resolution"
        assert result.bytes_per_megapixel > MIN_BYTES_PER_MEGAPIXEL

    def test_rejects_a_no_coverage_placeholder(self) -> None:
        """Regression: Esri's no-coverage tile scored 1.17 on edge energy alone
        and was waved through. Payload density is the second gate."""
        result = probe(ESRI, fetcher=lambda url, timeout: placeholder())

        assert result.ok  # it *is* a valid image
        assert not result.usable_for_architecture
        assert "no coverage" in result.verdict

    def test_density_gate_alone_catches_a_sharp_but_empty_payload(self) -> None:
        # High edge energy, implausibly few bytes: a compressor cannot make
        # detail it was not given.
        result = probe(ESRI, fetcher=lambda url, timeout: encode(
            Image.effect_noise((2048, 2048), 55), quality=1
        ))
        assert result.bytes_per_megapixel < MIN_BYTES_PER_MEGAPIXEL
        assert not result.usable_for_architecture

    def test_reports_an_unreachable_service_without_raising(self) -> None:
        def dead(url: str, timeout: float) -> bytes:
            raise ConnectionError("no route to host")

        result = probe(IRIG, fetcher=dead)
        assert not result.ok
        assert result.verdict == "unreachable"
        assert "ConnectionError" in result.status

    def test_reports_an_xml_service_exception_as_such(self) -> None:
        xml = b'<?xml version="1.0"?><ServiceExceptionReport>bad layer</ServiceExceptionReport>'
        result = probe(IRIG, fetcher=lambda url, timeout: xml)

        assert not result.ok
        assert result.verdict == "service error"
        assert "ServiceException" in result.status

    def test_empty_response_is_not_treated_as_an_image(self) -> None:
        result = probe(IRIG, fetcher=lambda url, timeout: b"")
        assert not result.ok and result.verdict == "no data"


class TestRequestShape:
    def test_wms_probe_uses_lat_lon_axis_order_and_the_declared_layer(self) -> None:
        seen: list[str] = []

        def capture(url: str, timeout: float) -> bytes:
            seen.append(url)
            return rich_imagery(512)

        probe(IRIG, fetcher=capture)
        url = seen[0].replace("%3A", ":").replace("%2C", ",")

        assert "REQUEST=GetMap" in url
        assert "OI.OrthoimageCoverage" in url
        # WMS 1.3.0 + EPSG:4326 is lat,lon; the probe point is ~46.5N, 11.35E,
        # so the first BBOX value must be the latitude.
        bbox = url.split("BBOX=")[1].split("&")[0]
        assert float(bbox.split(",")[0]) == pytest.approx(46.5, abs=0.1)

    def test_xyz_probe_requests_one_tile_at_the_source_ceiling(self) -> None:
        seen: list[str] = []

        def capture(url: str, timeout: float) -> bytes:
            seen.append(url)
            return rich_imagery()

        probe(ESRI, fetcher=capture)
        assert len(seen) == 1
        assert f"/tile/{ESRI.max_zoom}/" in seen[0]


class TestCandidateRegistry:
    def test_every_candidate_declares_a_licence_and_a_probe_point(self) -> None:
        for candidate in CANDIDATES:
            assert candidate.license
            assert -90 <= candidate.test_lat <= 90
            assert -180 <= candidate.test_lon <= 180

    def test_wms_candidates_name_a_layer(self) -> None:
        for candidate in CANDIDATES:
            if candidate.kind == "wms":
                assert candidate.layer, f"{candidate.id} has no layer"

    def test_candidate_ids_are_unique(self) -> None:
        ids = [c.id for c in CANDIDATES]
        assert len(ids) == len(set(ids))

    def test_probe_points_sit_in_the_right_country(self) -> None:
        """A national service probed outside its own country proves nothing."""
        expected = {
            "irig-south-tyrol": (46.2, 47.1, 10.3, 12.5),
            "swisstopo-swissimage": (45.8, 47.9, 5.9, 10.6),
            "nrw-dop": (50.3, 52.6, 5.8, 9.5),
            "pdok-luchtfoto": (50.7, 53.6, 3.3, 7.3),
        }
        by_id = {c.id: c for c in CANDIDATES}
        for source_id, (south, north, west, east) in expected.items():
            candidate: Candidate = by_id[source_id]
            assert south <= candidate.test_lat <= north, source_id
            assert west <= candidate.test_lon <= east, source_id
