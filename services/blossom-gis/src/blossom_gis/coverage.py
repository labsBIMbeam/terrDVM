"""Map where architectural-resolution imagery actually exists.

Coverage is not a property of a service, it is a property of a *place*. Esri
answers everywhere, but over Porto Santo it hands back the same placeholder it
serves for the whole world. A source list alone therefore tells a user nothing
about whether their site is usable.

This module samples a region on a tile grid, qualifies each cell with a single
probe, and emits GeoJSON the map can draw. The grid is an approximation:
imagery footprints follow flight lines and satellite passes, not slippy tiles,
so a cell is "covered" if its centre is — boundaries are accurate to one cell.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator
from dataclasses import dataclass, replace

from .geo import BBox, tile_bbox, tile_for_point
from .source_check import Candidate, CheckResult, probe

#: Elevation at or below this counts as sea, in metres.
SEA_LEVEL_M = 0.5


def _sample_elevation(lat: float, lon: float, zoom: int = 11, *, fetcher=None) -> float | None:
    """Centre-pixel elevation from a terrarium DEM tile, or None if unavailable.

    Used only to tell water from land. Open ocean and a town with no imagery
    both return the same "no coverage" placeholder, but only one of them is a
    gap worth showing a user.
    """
    import io as _io
    import urllib.request as _request

    from PIL import Image as _Image

    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png"

    try:
        if fetcher is not None:
            payload = fetcher(url, 30)
        else:
            request = _request.Request(url, headers={"User-Agent": "terrCVM-coverage/0.1"})
            with _request.urlopen(request, timeout=30) as response:
                payload = response.read()
        image = _Image.open(_io.BytesIO(payload)).convert("RGB")
    except Exception:  # noqa: BLE001 — unknown elevation is a valid answer
        return None

    width, height = image.size
    red, green, blue = image.getpixel((width // 2, height // 2))
    return red * 256 + green + blue / 256 - 32768


@dataclass(frozen=True)
class CoverageCell:
    z: int
    x: int
    y: int
    bounds: BBox
    covered: bool
    source_id: str
    metres_per_pixel: float | None
    detail_score: float | None
    bytes_per_megapixel: float | None
    verdict: str
    #: "covered" | "gap" | "sea" | "unknown"
    status: str = "unknown"

    def to_feature(self) -> dict:
        b = self.bounds
        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [b.west, b.south], [b.east, b.south],
                    [b.east, b.north], [b.west, b.north], [b.west, b.south],
                ]],
            },
            "properties": {
                "tile": f"{self.z}/{self.x}/{self.y}",
                "covered": self.covered,
                "status": self.status,
                "source": self.source_id,
                "m_per_px": round(self.metres_per_pixel, 3) if self.metres_per_pixel else None,
                "detail": round(self.detail_score, 2) if self.detail_score else None,
                "kb_per_mp": (
                    round(self.bytes_per_megapixel / 1000) if self.bytes_per_megapixel else None
                ),
                "verdict": self.verdict,
            },
        }


def grid_tiles(bounds: BBox, zoom: int) -> list[tuple[int, int]]:
    min_x, min_y = tile_for_point(bounds.north, bounds.west, zoom)
    max_x, max_y = tile_for_point(bounds.south, bounds.east, zoom)
    return [
        (x, y)
        for x in range(min(min_x, max_x), max(min_x, max_x) + 1)
        for y in range(min(min_y, max_y), max(min_y, max_y) + 1)
    ]


def survey(
    bounds: BBox,
    candidates: list[Candidate],
    zoom: int = 11,
    *,
    on_cell=None,
    dem_fetcher=None,
    **probe_kwargs,
) -> Iterator[CoverageCell]:
    """Probe each grid cell, taking the first candidate that qualifies.

    Candidates are tried in order, so a regional survey wins over the global
    fallback wherever it reaches.
    """
    if not candidates:
        raise ValueError("coverage survey needs at least one candidate source")

    for x, y in grid_tiles(bounds, zoom):
        cell_bounds = tile_bbox(zoom, x, y)
        centre_lat, centre_lon = cell_bounds.center

        best: CheckResult | None = None
        for candidate in candidates:
            result = probe(
                replace(candidate, test_lat=centre_lat, test_lon=centre_lon), **probe_kwargs
            )
            if best is None or result.usable_for_architecture and not best.usable_for_architecture:
                best = result
            if result.usable_for_architecture:
                break

        assert best is not None
        covered = best.usable_for_architecture
        if covered:
            status = "covered"
        else:
            elevation = _sample_elevation(centre_lat, centre_lon, fetcher=dem_fetcher)
            if elevation is None:
                status = "unknown"
            elif elevation <= SEA_LEVEL_M:
                status = "sea"
            else:
                status = "gap"

        cell = CoverageCell(
            z=zoom, x=x, y=y, bounds=cell_bounds,
            covered=covered,
            status=status,
            source_id=best.candidate.id,
            metres_per_pixel=best.metres_per_pixel,
            detail_score=best.detail_score,
            bytes_per_megapixel=best.bytes_per_megapixel,
            verdict=best.verdict,
        )
        if on_cell is not None:
            on_cell(cell)
        yield cell


def to_geojson(cells: list[CoverageCell], region: str, zoom: int) -> dict:
    covered = sum(1 for cell in cells if cell.covered)
    return {
        "type": "FeatureCollection",
        "properties": {
            "region": region,
            "zoom": zoom,
            "cells": len(cells),
            "covered": covered,
            "uncovered": len(cells) - covered,
            "gaps": sum(1 for c in cells if c.status == "gap"),
            "sea": sum(1 for c in cells if c.status == "sea"),
            "note": (
                "Cell resolution is the survey grid, not the imagery footprint. "
                "A cell is covered if its centre probe qualified."
            ),
        },
        "features": [cell.to_feature() for cell in cells],
    }


def write_geojson(cells: list[CoverageCell], region: str, zoom: int, path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(to_geojson(cells, region, zoom), separators=(",", ":")), encoding="utf-8"
    )


def summarise(cells: list[CoverageCell]) -> dict[str, object]:
    covered = [c for c in cells if c.covered]
    by_source: dict[str, int] = {}
    for cell in covered:
        by_source[cell.source_id] = by_source.get(cell.source_id, 0) + 1

    total_km2 = 0.0
    covered_km2 = 0.0
    for cell in cells:
        b = cell.bounds
        mid = math.radians((b.south + b.north) / 2)
        area = (b.east - b.west) * 111.32 * math.cos(mid) * (b.north - b.south) * 110.57
        total_km2 += area
        if cell.covered:
            covered_km2 += area

    states: dict[str, int] = {}
    for cell in cells:
        states[cell.status] = states.get(cell.status, 0) + 1

    land = [c for c in cells if c.status in ("covered", "gap")]
    return {
        "cells": len(cells),
        "covered": len(covered),
        "states": states,
        "land_cells": len(land),
        "land_percent": round(100 * len(covered) / len(land), 1) if land else 0.0,
        "percent": round(100 * len(covered) / len(cells), 1) if cells else 0.0,
        "covered_km2": round(covered_km2),
        "total_km2": round(total_km2),
        "by_source": by_source,
    }
