"""Warm every cache a demo selection touches, through the real HTTP paths.

The point is byte-identical cache keys: the Overpass query built here must
match the client's `featuresQuery` character for character, or the warm-up
fills a cache nobody reads. A cross-language pin test holds both sides to
the same string.
"""

from __future__ import annotations

import math
import urllib.parse
import urllib.request

from .geo import BBox


def _js_number(value: float) -> str:
    """Shortest round-trip formatting, matching JavaScript's String(number)."""
    text = repr(value)
    return text[:-2] if text.endswith(".0") else text


def features_query(box: BBox, limit: int = 16000) -> str:
    """Mirror of the client's featuresQuery — pinned by a conformance test."""
    area = (
        f"{_js_number(box.south)},{_js_number(box.west)},"
        f"{_js_number(box.north)},{_js_number(box.east)}"
    )
    return (
        "[out:json][timeout:25];("
        f'way["building"]({area});'
        f'way["highway"]({area});'
        f'way["waterway"]({area});'
        f'way["landuse"]({area});'
        f'way["natural"]({area});'
        f");out geom {limit};"
    )


def _tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def dem_tiles(box: BBox, zooms: tuple[int, ...] = (13, 14)) -> list[tuple[int, int, int]]:
    """Every DEM tile a selection of this extent can ask for."""
    tiles: list[tuple[int, int, int]] = []
    for zoom in zooms:
        min_x, min_y = _tile(box.north, box.west, zoom)
        max_x, max_y = _tile(box.south, box.east, zoom)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                tiles.append((zoom, x, y))
    return tiles


def prewarm_selection(
    base_url: str,
    region: str,
    box: BBox,
    *,
    fetch=None,
    log=print,
) -> dict[str, str]:
    """Hit every endpoint the client will, so demo runs come from disk."""

    def default_fetch(url: str, timeout_s: float) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": "terrDVM-prewarm/0.1"})
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return response.read()

    fetch = fetch or default_fetch
    results: dict[str, str] = {}

    tiles = dem_tiles(box)
    failed = 0
    for zoom, x, y in tiles:
        try:
            fetch(f"{base_url}/dem/{zoom}/{x}/{y}.png", 60)
        except Exception:  # noqa: BLE001 — count, keep warming
            failed += 1
    results["dem"] = f"{len(tiles) - failed}/{len(tiles)} tiles"
    log(f"  dem      {results['dem']}")

    query = urllib.parse.urlencode({"data": features_query(box)})
    try:
        payload = fetch(f"{base_url}/osm?{query}", 120)
        results["osm"] = f"{len(payload):,} bytes"
    except Exception as error:  # noqa: BLE001 — a warm-up failure is a report, not a crash
        results["osm"] = f"FAILED: {error}"
    log(f"  osm      {results['osm']}")

    bbox_param = f"{box.west},{box.south},{box.east},{box.north}"
    texture_query = urllib.parse.urlencode(
        {"region": region, "bbox": bbox_param, "target": "0.25"}
    )
    try:
        payload = fetch(f"{base_url}/texture?{texture_query}", 420)
        results["texture"] = f"{len(payload):,} bytes"
    except Exception as error:  # noqa: BLE001
        results["texture"] = f"FAILED: {error}"
    log(f"  texture  {results['texture']}")

    if region == "vienna":
        wfs_query = urllib.parse.urlencode({"src": "vienna-bkm", "bbox": bbox_param})
        try:
            payload = fetch(f"{base_url}/wfs?{wfs_query}", 180)
            results["wfs"] = f"{len(payload):,} bytes"
        except Exception as error:  # noqa: BLE001
            results["wfs"] = f"FAILED: {error}"
        log(f"  wfs      {results['wfs']}")

    return results


#: The named selections tomorrow's demo walks through.
DEMO_SELECTIONS: dict[str, tuple[str, BBox]] = {
    "funchal": ("madeira", BBox(west=-16.92, south=32.64, east=-16.9, north=32.66)),
    "schoenbrunn": ("vienna", BBox(west=16.3, south=48.178, east=16.32, north=48.19)),
    "ring": ("vienna", BBox(west=16.355, south=48.195, east=16.385, north=48.215)),
    "bruneck": ("south-tyrol", BBox(west=11.925, south=46.788, east=11.955, north=46.805)),
    # The Dolomites showcase from the demo-2 plan: Innichen / San Candido.
    "innichen": ("south-tyrol", BBox(west=12.265, south=46.725, east=12.295, north=46.745)),
}
