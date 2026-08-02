"""VS-6: the corpus estimator — projected bytes per candidate crawl plan.

Exists to print one number: the v1 public crawl plan against the 40 GB hosting
gate (VERTICAL-SLICE.md §7). Two byte models bracket the truth and the gate is
judged on the HIGH bound — a plan that fits only under optimistic assumptions
does not justify provisioning:

* low  — the slice doc's area model: land km² × measured intensity. Latitude-
  independent, so it under-counts where high-latitude tiles shrink but their
  PNGs do not.
* high — the tile model: distinct stored tiles × measured bytes per tile. The
  corpus is stored per tile, so this is what the disk actually sees.

Provenance tags as in MESH-CALCULATOR.md: [measured] this project's own
measurement · [computed] derived and checked here · [assumption] invented,
deliberately visible.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .geo import BBox, tile_for_point

#: [measured 2026-08-02] Terrarium z13 tile 13/3711/3309, Madeira massif.
DEM_TILE_BYTES_Z13 = 43_014
#: [measured] anchor tile's mid-latitude, for the area-intensity conversion.
DEM_ANCHOR_LAT = 32.75
#: [measured] one zoom finer over a fixed area: 4x tiles, 3.86x total bytes —
#: under 4x because finer tiles hold less relief and compress better.
ZOOM_TOTAL_SCALE = 3.86

#: [measured 2026-08-02] Funchal z14 features tile, 20k cap, 4,668 buildings +
#: 3,826 roads + 139 landuse = 139,699 B. SUPERSEDES the 51.3 kB constant in
#: VERTICAL-SLICE.md §7, which predates the Overpass truncation fix that was
#: silently discarding 43% of exactly this tile.
FEATURES_DENSE_URBAN_BYTES = 139_699
#: [assumption] the mean land tile carries 2–10% of a dense-urban tile's bytes;
#: most land is rural, forest, or empty.
FEATURES_MEAN_FRACTION = (0.02, 0.10)

#: The hosting gate (VERTICAL-SLICE.md §7): at or under, provision the public
#: VPS; over, stay alflx-only and cut the plan, not the hosting.
GATE_BYTES = 40e9

EARTH_RADIUS_KM = 6371.0088
EARTH_CIRCUMFERENCE_KM = 40_075.017


@dataclass(frozen=True)
class Part:
    """One region of a crawl plan."""

    name: str
    bbox: BBox
    #: Fraction of bbox tiles that become distinct stored blobs — land share
    #: plus content-addressing dedup of identical ocean tiles.
    distinct_fraction: float
    land_km2: float


#: v1 fractions: Madeira measured 168 bbox tiles -> 32 distinct blobs
#: [measured]; South Tyrol is inland, every tile distinct. Europe's land share
#: is 10.5M km² [doc] over the computed bbox area. Land areas per §7.
PLANS: dict[str, tuple[Part, ...]] = {
    "v1": (
        Part("madeira", BBox(west=-17.32, south=32.35, east=-16.24, north=33.15), 32 / 168, 800),
        Part(
            "south-tyrol", BBox(west=10.38, south=46.21, east=12.48, north=47.10), 1.0, 15_800
        ),
    ),
    "austria-bbox": (
        Part("austria", BBox(west=9.53, south=46.37, east=17.16, north=49.02), 1.0, 168_000),
    ),
    "europe": (
        Part("europe", BBox(west=-25.0, south=34.0, east=32.0, north=71.5), -1.0, 10_500_000),
    ),
}


def bbox_area_km2(bbox: BBox) -> float:
    """Exact spherical area of a lon/lat rectangle."""
    dlon = math.radians(bbox.east - bbox.west)
    band = math.sin(math.radians(bbox.north)) - math.sin(math.radians(bbox.south))
    return EARTH_RADIUS_KM**2 * dlon * band


def tile_area_km2(z: int, lat: float) -> float:
    """Approximate ground area of one Web Mercator tile at a latitude."""
    width = EARTH_CIRCUMFERENCE_KM * math.cos(math.radians(lat)) / 2**z
    return width * width


def count_tiles(bbox: BBox, z: int) -> int:
    """Bbox tile count, arithmetically — never materialise continental lists."""
    min_x, min_y = tile_for_point(bbox.north, bbox.west, z)
    max_x, max_y = tile_for_point(bbox.south, bbox.east, z)
    return (abs(max_x - min_x) + 1) * (abs(max_y - min_y) + 1)


def dem_bytes_per_tile(z: int) -> float:
    """[computed] per-tile bytes from the z13 anchor: 4x tiles carry 3.86x bytes."""
    return DEM_TILE_BYTES_Z13 * (ZOOM_TOTAL_SCALE / 4) ** (z - 13)


def dem_intensity_kb_per_km2(z: int) -> float:
    """[computed] the doc's area model, re-anchored on the measured tile."""
    per_km2 = DEM_TILE_BYTES_Z13 / tile_area_km2(13, DEM_ANCHOR_LAT)
    return per_km2 * ZOOM_TOTAL_SCALE ** (z - 13)


@dataclass(frozen=True)
class PlanEstimate:
    plan: str
    zoom: int
    tiles_bbox: int
    tiles_distinct: int
    dem_bytes_low: float
    dem_bytes: float
    features_low: float
    features_high: float
    total_low: float
    total_high: float
    passes_gate: bool


def estimate_plan(plan: str, zoom: int) -> PlanEstimate:
    parts = PLANS[plan]
    tiles_bbox = 0
    tiles_distinct = 0.0
    land_km2 = 0.0
    for part in parts:
        count = count_tiles(part.bbox, zoom)
        fraction = part.distinct_fraction
        if fraction < 0:  # derive from land share when no measured dedup exists
            fraction = min(1.0, part.land_km2 / bbox_area_km2(part.bbox))
        tiles_bbox += count
        tiles_distinct += count * fraction
        land_km2 += part.land_km2

    dem_low = land_km2 * dem_intensity_kb_per_km2(zoom)
    dem_high = tiles_distinct * dem_bytes_per_tile(zoom)
    low_frac, high_frac = FEATURES_MEAN_FRACTION
    features_low = tiles_distinct * FEATURES_DENSE_URBAN_BYTES * low_frac
    features_high = tiles_distinct * FEATURES_DENSE_URBAN_BYTES * high_frac
    total_low = dem_low + features_low
    total_high = dem_high + features_high
    return PlanEstimate(
        plan=plan,
        zoom=zoom,
        tiles_bbox=tiles_bbox,
        tiles_distinct=int(tiles_distinct),
        dem_bytes_low=dem_low,
        dem_bytes=dem_high,
        features_low=features_low,
        features_high=features_high,
        total_low=total_low,
        total_high=total_high,
        passes_gate=total_high <= GATE_BYTES,
    )


def _human(size: float) -> str:
    for unit in ("B", "kB", "MB", "GB", "TB"):
        if size < 1000:
            return f"{size:,.1f} {unit}"
        size /= 1000
    return f"{size:,.1f} PB"


def render_report(zooms: tuple[int, ...] = (12, 13, 14)) -> str:
    lines = [
        "corpus estimator — VS-6 (bytes are low..high across the area and tile models;",
        "the 40 GB gate judges the HIGH bound)",
        "",
        f"anchors: dem z13 tile {DEM_TILE_BYTES_Z13:,} B [measured 2026-08-02], "
        f"zoom scale x{ZOOM_TOTAL_SCALE} [measured],",
        f"         features dense-urban {FEATURES_DENSE_URBAN_BYTES:,} B [measured 2026-08-02, "
        "supersedes 51.3 kB pre-truncation-fix],",
        f"         mean-tile fraction {FEATURES_MEAN_FRACTION[0]:.0%}..{FEATURES_MEAN_FRACTION[1]:.0%} [assumption]",
        "",
        f"{'plan':<14}{'z':>3}{'bbox tiles':>12}{'distinct':>11}{'dem':>22}{'features':>22}{'total':>24}  gate",
    ]
    for plan in PLANS:
        for zoom in zooms:
            e = estimate_plan(plan, zoom)
            lines.append(
                f"{e.plan:<14}{e.zoom:>3}{e.tiles_bbox:>12,}{e.tiles_distinct:>11,}"
                f"{_human(e.dem_bytes_low):>10}..{_human(e.dem_bytes):<10}"
                f"{_human(e.features_low):>10}..{_human(e.features_high):<10}"
                f"{_human(e.total_low):>12}..{_human(e.total_high):<11}"
                f"{'PASS' if e.passes_gate else 'CUT'}"
            )
        lines.append("")

    v1 = estimate_plan("v1", 13)
    europe13 = estimate_plan("europe", 13)
    lines.append(
        f"the number: v1 at z13 is {_human(v1.total_high)} high-bound — "
        f"{'inside' if v1.passes_gate else 'outside'} the 40 GB gate"
    )
    lines.append(
        f"europe at z13 is {_human(europe13.total_low)}..{_human(europe13.total_high)}: "
        + (
            "inside the gate"
            if europe13.passes_gate
            else "the HIGH bound breaks the 40 GB gate — the doc's z13 pass holds only "
            "under the area model; cut the plan or re-measure before provisioning"
        )
    )
    return "\n".join(lines)
