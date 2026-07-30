from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from PIL import Image

from blossom_gis.coverage import (
    grid_tiles,
    summarise,
    survey,
    to_geojson,
    write_geojson,
)
from blossom_gis.geo import BBox
from blossom_gis.source_check import CANDIDATES

MADEIRA = BBox(west=-17.32, south=32.35, east=-16.24, north=33.15)
ESRI = next(c for c in CANDIDATES if c.id == "esri-world-imagery")
IRIG = next(c for c in CANDIDATES if c.id == "irig-south-tyrol")


def encode(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "JPEG", quality=quality)
    return buffer.getvalue()


def real_imagery() -> bytes:
    return encode(Image.effect_noise((256, 256), 55), 92)


def placeholder() -> bytes:
    base = Image.new("L", (256, 256), 210)
    base.putpixel((0, 0), 190)
    return encode(base, 60)


class TestGrid:
    def test_covers_the_region_corners(self) -> None:
        tiles = grid_tiles(MADEIRA, 10)
        assert len(tiles) > 0
        xs = [x for x, _ in tiles]
        ys = [y for _, y in tiles]
        # A contiguous rectangle, no holes.
        assert len(tiles) == (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)

    def test_finer_zoom_yields_more_cells(self) -> None:
        assert len(grid_tiles(MADEIRA, 10)) < len(grid_tiles(MADEIRA, 11))


class TestSurvey:
    def test_marks_cells_covered_when_imagery_is_real(self) -> None:
        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=lambda u, t: real_imagery()))
        assert cells and all(cell.covered for cell in cells)
        assert all(cell.source_id == ESRI.id for cell in cells)

    def test_marks_cells_uncovered_when_the_service_returns_a_placeholder(self) -> None:
        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=lambda u, t: placeholder()))
        assert cells and not any(cell.covered for cell in cells)
        assert all("no coverage" in cell.verdict for cell in cells)

    def test_prefers_the_regional_source_and_stops_probing_once_it_qualifies(self) -> None:
        seen: list[str] = []

        def fake(url: str, timeout: float) -> bytes:
            seen.append("irig" if "civis.bz.it" in url else "esri")
            return real_imagery()

        cells = list(survey(MADEIRA, [IRIG, ESRI], zoom=9, fetcher=fake))
        assert all(cell.source_id == IRIG.id for cell in cells)
        # Esri is never asked where the regional survey already answered.
        assert "esri" not in seen

    def test_falls_through_to_the_next_source_where_the_first_has_no_coverage(self) -> None:
        def fake(url: str, timeout: float) -> bytes:
            return placeholder() if "civis.bz.it" in url else real_imagery()

        cells = list(survey(MADEIRA, [IRIG, ESRI], zoom=9, fetcher=fake))
        assert all(cell.covered for cell in cells)
        assert all(cell.source_id == ESRI.id for cell in cells)

    def test_records_the_failed_probe_when_no_source_qualifies(self) -> None:
        """A cell nobody covers must still appear, so the map can show the gap."""
        cells = list(
            survey(MADEIRA, [IRIG, ESRI], zoom=9, fetcher=lambda u, t: placeholder())
        )
        assert cells
        for cell in cells:
            assert not cell.covered
            assert cell.source_id in {IRIG.id, ESRI.id}

    def test_refuses_an_empty_candidate_list(self) -> None:
        with pytest.raises(ValueError, match="at least one candidate"):
            list(survey(MADEIRA, [], zoom=9))

    def test_reports_each_cell_through_the_callback(self) -> None:
        seen = []
        cells = list(
            survey(MADEIRA, [ESRI], zoom=9, on_cell=seen.append,
                   fetcher=lambda u, t: real_imagery())
        )
        assert len(seen) == len(cells)


class TestGeoJson:
    def test_emits_one_closed_polygon_per_cell(self) -> None:
        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=lambda u, t: real_imagery()))
        document = to_geojson(cells, "madeira", 9)

        assert document["type"] == "FeatureCollection"
        assert len(document["features"]) == len(cells)
        for feature in document["features"]:
            ring = feature["geometry"]["coordinates"][0]
            assert ring[0] == ring[-1], "polygon ring must close"
            assert "covered" in feature["properties"]

    def test_carries_the_approximation_caveat(self) -> None:
        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=lambda u, t: real_imagery()))
        note = to_geojson(cells, "madeira", 9)["properties"]["note"]
        # The grid is not the imagery footprint; saying so in the data matters.
        assert "footprint" in note

    def test_round_trips_through_a_file(self, tmp_path: Path) -> None:
        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=lambda u, t: real_imagery()))
        out = tmp_path / "nested" / "madeira.geojson"
        write_geojson(cells, "madeira", 9, out)

        document = json.loads(out.read_text(encoding="utf-8"))
        assert document["properties"]["covered"] == len(cells)


class TestSummary:
    def test_counts_cells_area_and_sources(self) -> None:
        def fake(url: str, timeout: float) -> bytes:
            return real_imagery()

        cells = list(survey(MADEIRA, [ESRI], zoom=9, fetcher=fake))
        stats = summarise(cells)

        assert stats["cells"] == len(cells)
        assert stats["covered"] == len(cells)
        assert stats["percent"] == 100.0
        assert stats["covered_km2"] > 0
        assert stats["by_source"] == {ESRI.id: len(cells)}

    def test_empty_survey_does_not_divide_by_zero(self) -> None:
        assert summarise([])["percent"] == 0.0
