"""Bounding the work — everything here happens before a single byte is fetched.

A caller can ask for a continent. There is no payment gate in front of this
service yet, so an oversized request is refused rather than trimmed: a request
that is silently coarsened returns a manifest that looks correct and is not.

The CEP-8 price lives here for the same reason. This module is pure and I/O
free, so a caller can be quoted a number without a single upstream request —
which is exactly the seam the transparent payment flow needs (plan, quote,
payment_required, payment, produce). It is also the only place that knows the
*resolved* job: the resolution a bake will actually deliver and the tiles that
will actually be fetched. Pricing anywhere else would risk billing for a
requested value that was never delivered, which is the defect the resolution
forecast was added to kill.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from blossom_gis.cli import REGIONS as SURVEY_REGIONS
from blossom_gis.geo import BBox, tiles_for_bbox
from blossom_gis.texture import REGION_SOURCES
from blossom_gis.texture import plan_texture as forecast_texture

Lod = Literal["overview", "standard", "detail"]


class TerrainRequestError(ValueError):
    """A request this service refuses to plan. Never raised after fetching starts."""


class BoundingBoxError(TerrainRequestError):
    """The bbox is not four finite, ordered, in-range EPSG:4326 degrees."""


class AreaCeilingError(TerrainRequestError):
    """The extent covers more ground than one request is allowed to produce."""


class TileCeilingError(TerrainRequestError):
    """The extent needs more source tiles than one request is allowed to fetch."""


class TextureResolutionError(TerrainRequestError):
    """No usable orthophoto resolution could be resolved for the extent."""


@dataclass(frozen=True)
class LodTier:
    """One detail level: the zooms it resolves to and its default texture target."""

    name: str
    dem_zoom: int
    feature_zoom: int
    texture_m_per_px: float


#: The LOD mapping, pinned by `tests/test_plan.py`.
#:
#: DEM tops out at z13 because Terrarium carries no elevation information above
#: it: a Web Mercator pixel equals the 1-arcsec source grid at z≈12.3, so z14
#: oversamples 3-5x per axis for 16x the bytes. That derivation and the z13 cap
#: are the terrain engine's (`packages/terrain-engine/src/terrain/dem.ts`), and
#: this service must not hand a client tiles it would refuse to load.
#:
#: Feature tiles sit one zoom *deeper* than the DEM: they are vector, and a
#: smaller tile is what keeps a single Overpass answer inside the upstream's
#: element cap. z14 is the crawler's proven unit — its truncation evidence is
#: recorded on 14/7422/6618 over Funchal.
LOD_TIERS: dict[str, LodTier] = {
    "overview": LodTier("overview", dem_zoom=11, feature_zoom=12, texture_m_per_px=2.0),
    "standard": LodTier("standard", dem_zoom=12, feature_zoom=13, texture_m_per_px=0.5),
    "detail": LodTier("detail", dem_zoom=13, feature_zoom=14, texture_m_per_px=0.25),
}

DEFAULT_LOD = "standard"

#: Ground-area ceiling, square kilometres. Matches `TEXTURE_MAX_AREA_KM2` in the
#: blossom-gis app so a request that passes here cannot be refused later by the
#: texture stage for a reason the caller was never told about.
MAX_AREA_KM2 = 120.0

#: Raster-tile ceiling. The area ceiling binds first at mid latitudes; this one
#: binds near the poles, where a Mercator tile covers far less ground (a 120 km²
#: extent at 70°N needs ~49 z13 tiles against ~16 at 47°N).
MAX_DEM_TILES = 64

#: Vector-tile ceiling. Overpass is slot-limited and the crawler's politeness
#: floor is one request every 4 s, so 16 tiles is roughly a minute of upstream
#: time — the point past which a tool call stops being interactive.
MAX_FEATURE_TILES = 16

#: Texture resolution bounds, m/px. Same window the blossom-gis texture endpoint
#: accepts.
MIN_TEXTURE_M_PER_PX = 0.05
MAX_TEXTURE_M_PER_PX = 10.0

#: Mosaic tile budget handed to the texture backend. It lives here rather than in
#: `produce` because the *plan* has to know it: `fetch_xyz_texture` drops a zoom
#: for every doubling that would breach this number, so the budget is one of the
#: three inputs that decide the resolution a bake can actually deliver (the other
#: two being the source's max zoom and, for WMS, the 4096 px side clamp).
#: Same value the blossom-gis texture endpoint passes to `plan_texture`.
TEXTURE_MAX_TILES = 256

#: Relative slack when comparing two resolutions. `plan_texture` rounds its
#: answer to three decimals, so an exact float comparison against an unrounded
#: delivered value would fail on rounding alone.
RESOLUTION_TOLERANCE = 1e-3


def resolutions_match(delivered_m_per_px: float, planned_m_per_px: float) -> bool:
    """Whether a delivered resolution is the planned one, within rounding slack."""
    return math.isclose(delivered_m_per_px, planned_m_per_px, rel_tol=RESOLUTION_TOLERANCE)


@dataclass(frozen=True)
class TextureForecast:
    """The resolution a bake will *deliver*, decided before anything is fetched.

    `requested_m_per_px` is what the caller asked for; `m_per_px` is what the
    backend's own caps leave. They differ whenever the extent is too large for
    the tile budget — verified live at 20x, a 0.1 m/px request answered by a
    2.0 m/px mosaic — and the difference is a price input, so both are carried.
    """

    requested_m_per_px: float
    m_per_px: float
    source_id: str
    kind: str
    notes: tuple[str, ...]

    @property
    def downgraded(self) -> bool:
        """True when the caps cost the caller resolution."""
        return not resolutions_match(self.m_per_px, self.requested_m_per_px)


@dataclass(frozen=True)
class TerrainPlan:
    """A validated, bounded description of the work — no fetching implied."""

    bbox: BBox
    lod: str
    dem_zoom: int
    feature_zoom: int
    dem_tiles: tuple[tuple[int, int], ...]
    feature_tiles: tuple[tuple[int, int], ...]
    texture: bool
    texture_m_per_px: float | None
    texture_region: str | None
    area_km2: float
    texture_forecast: TextureForecast | None = None

    @property
    def texture_m_per_px_requested(self) -> float | None:
        """What the caller asked for, which `texture_m_per_px` may be coarser than."""
        return None if self.texture_forecast is None else self.texture_forecast.requested_m_per_px


def parse_bbox(values: Sequence[float]) -> BBox:
    """Four floats west,south,east,north in EPSG:4326, validated by `geo.BBox`.

    Validation is delegated so the rules are the ones the rest of the project
    already enforces — finite, west < east, south < north, degrees in range.
    """
    try:
        west, south, east, north = (float(value) for value in values)
    except (TypeError, ValueError) as error:
        raise BoundingBoxError(
            f"bbox must be four numbers — west, south, east, north ({error})"
        ) from error
    try:
        return BBox(west=west, south=south, east=east, north=north)
    except ValueError as error:
        raise BoundingBoxError(f"invalid bbox: {error}") from error


def area_km2(bbox: BBox) -> float:
    """Approximate ground area of a small extent, in square kilometres.

    Mirrors the blossom-gis texture endpoint's area estimate so both services
    refuse the same extents.

    DUPLICATE, pending an export: this is `blossom_gis.app._texture_area_km2`
    character for character. It is copied only because the original is private
    and lives in the FastAPI module, which this keyless service must not import.
    Delete this body the moment blossom-gis publishes the formula (proposed home:
    `blossom_gis.geo.area_km2`).
    """
    mid = math.radians((bbox.south + bbox.north) / 2)
    return (
        (bbox.east - bbox.west) * 111.32 * math.cos(mid) * (bbox.north - bbox.south) * 110.57
    )


def resolve_texture_region(bbox: BBox) -> str:
    """The best qualified imagery region for a *place*, not for a parameter.

    A Funchal selection must reach DROTe's 10 cm survey rather than the global
    fallback, so the smallest survey region that fully contains the extent wins.

    DUPLICATE, pending an export: this is the `region == "europe"` branch of
    `blossom_gis.app._resolve_texture_region`, private and behind FastAPI.
    Delete this body once blossom-gis publishes it (proposed home:
    `blossom_gis.texture.resolve_region`).
    """
    for name, bounds in SURVEY_REGIONS.items():
        if name == "europe" or name not in REGION_SOURCES:
            continue
        if (
            bounds.west <= bbox.west
            and bbox.east <= bounds.east
            and bounds.south <= bbox.south
            and bbox.north <= bounds.north
        ):
            return name
    return "europe"


def resolve_texture_resolution(
    bbox: BBox, region: str, requested_m_per_px: float
) -> TextureForecast:
    """The resolution a bake will deliver — computed, never fetched.

    Delegated to `blossom_gis.texture.plan_texture`, which is the *same* module
    that performs the bake and already mirrors its three caps (source max zoom,
    tile budget, WMS side clamp) line for line against `fetch_xyz_texture` and
    `fetch_wms_texture`. Re-deriving the fallback rule here would be a second
    copy of it, and the two copies would drift — this repo has paid that bill
    twice already. `produce` cross-checks the forecast against what the bake
    actually returns, so a drift inside blossom-gis surfaces as a failed
    request rather than an overstated manifest.
    """
    forecast = forecast_texture(
        bbox, region, requested_m_per_px, max_tiles=TEXTURE_MAX_TILES
    )
    delivered = float(forecast["m_per_px"])
    if not math.isfinite(delivered) or delivered <= 0:
        raise TextureResolutionError(
            f"no orthophoto resolution could be resolved for region {region!r} — "
            "request a smaller bbox"
        )
    return TextureForecast(
        requested_m_per_px=requested_m_per_px,
        m_per_px=delivered,
        source_id=str(forecast["source"]["id"]),
        kind=str(forecast["kind"]),
        notes=tuple(forecast["notes"]),
    )


def plan_terrain(
    bbox: BBox,
    lod: str = DEFAULT_LOD,
    *,
    texture: bool = True,
    texture_m_per_px: float | None = None,
) -> TerrainPlan:
    """Resolve a request into a bounded plan, or refuse it with a named error."""
    tier = LOD_TIERS.get(lod)
    if tier is None:
        raise TerrainRequestError(
            f"unknown lod {lod!r}; choose one of {', '.join(sorted(LOD_TIERS))}"
        )

    area = area_km2(bbox)
    if area > MAX_AREA_KM2:
        raise AreaCeilingError(
            f"extent covers {area:.1f} km2, above the {MAX_AREA_KM2:.0f} km2 ceiling — "
            "request a smaller bbox"
        )

    dem_tiles = tuple(tiles_for_bbox(bbox, tier.dem_zoom))
    if len(dem_tiles) > MAX_DEM_TILES:
        raise TileCeilingError(
            f"lod {lod!r} needs {len(dem_tiles)} DEM tiles at z{tier.dem_zoom}, above the "
            f"{MAX_DEM_TILES} tile ceiling — request a smaller bbox or a coarser lod"
        )

    feature_tiles = tuple(tiles_for_bbox(bbox, tier.feature_zoom))
    if len(feature_tiles) > MAX_FEATURE_TILES:
        raise TileCeilingError(
            f"lod {lod!r} needs {len(feature_tiles)} feature tiles at z{tier.feature_zoom}, "
            f"above the {MAX_FEATURE_TILES} tile ceiling — request a smaller bbox or a "
            "coarser lod"
        )

    forecast: TextureForecast | None = None
    region: str | None = None
    if texture:
        target = tier.texture_m_per_px if texture_m_per_px is None else float(texture_m_per_px)
        if not MIN_TEXTURE_M_PER_PX <= target <= MAX_TEXTURE_M_PER_PX:
            raise TerrainRequestError(
                f"texture_m_per_px must be between {MIN_TEXTURE_M_PER_PX} and "
                f"{MAX_TEXTURE_M_PER_PX}"
            )
        region = resolve_texture_region(bbox)
        forecast = resolve_texture_resolution(bbox, region, target)

    return TerrainPlan(
        bbox=bbox,
        lod=lod,
        dem_zoom=tier.dem_zoom,
        feature_zoom=tier.feature_zoom,
        dem_tiles=dem_tiles,
        feature_tiles=feature_tiles,
        texture=texture,
        # The achievable resolution, never the requested one: this value is the
        # manifest's claim and the CEP-8 price input, and charging for a
        # resolution the server knows it will not deliver is billing for data
        # not supplied. The requested value stays reachable on the forecast.
        texture_m_per_px=None if forecast is None else forecast.m_per_px,
        texture_region=region,
        area_km2=area,
        texture_forecast=forecast,
    )


# --------------------------------------------------------------------------
# CEP-8 pricing
#
# Everything below is arithmetic over a resolved `TerrainPlan`. No payment, no
# invoice, no Lightning: this produces a NUMBER and the advertised range, and
# the gateway does the rest.
# --------------------------------------------------------------------------

#: The tool a price is quoted for — the subject of the CEP-8 `cap` tag. Pinned
#: against the registered tool name by the tests, so an advertised capability
#: cannot name a tool this server does not expose.
PRICED_TOOL = "generate_terrain"

#: Denomination of every number here.
PRICE_UNIT = "sats"

#: Sats per unit of work, this project's unit of account.
SATS_PER_WORK_UNIT = 21

#: Price floor, sats. Not decoration: Lightning's dust limit is ~354-546 sats
#: depending on the output type, and a single work unit at 21 sats sits well
#: below it. Such an HTLC is *trimmed* — it gets no on-chain output, so it is
#: unenforceable on a force-close — and routing fees on it run 2-14%. Every
#: price this module produces must clear the dust limit to be a payment at all.
MIN_PRICE_SATS = 1_000

#: The dust limit the floor clears, sats. Kept as a constant so the invariant
#: `MIN_PRICE_SATS > LIGHTNING_DUST_LIMIT_SATS` is testable rather than folklore.
LIGHTNING_DUST_LIMIT_SATS = 546

#: One megapixel of baked orthophoto. Bake CPU and delivered bytes — real, and
#: cheap next to the two upstreams below.
MEGAPIXEL_WEIGHT = 1.0

#: One DEM tile. Terrarium is CDN-cached and heavily deduplicated by content
#: address: a Madeira crawl of 168 tiles collapsed to 32 unique blobs because
#: ocean tiles are byte-identical. Costly enough to charge for, cheap to serve.
DEM_TILE_WEIGHT = 8.0

#: One feature tile, and the reason this weight dwarfs the others: Overpass is
#: the bottleneck. It is rate-limited upstream and held to the crawler's 4 s
#: politeness floor per tile, so the 16-tile ceiling is roughly a minute of
#: upstream time that no cache can give back. Pixels are bytes; these are
#: someone else's scarce query slots.
FEATURE_TILE_WEIGHT = 40.0

#: Unit bookkeeping, spelled out so the megapixel derivation stays auditable.
SQUARE_METRES_PER_SQUARE_KM = 1e6
PIXELS_PER_MEGAPIXEL = 1e6


@dataclass(frozen=True)
class TerrainPrice:
    """What a plan costs, alongside the three quantities that decided it.

    The inputs travel with the number on purpose: a caller asked to pay before
    the work happens can check the arithmetic against the resolved request it
    was quoted with.
    """

    megapixels: float
    dem_tiles: int
    feature_tiles: int
    work_units: float
    price_sats: int
    unit: str = PRICE_UNIT

    @classmethod
    def for_job(cls, megapixels: float, dem_tiles: int, feature_tiles: int) -> TerrainPrice:
        """Price one job's three quantities — the only place a price is assembled.

        A real plan and the hypothetical ceiling request go through here alike,
        so the advertised maximum can never be computed by a second formula.
        """
        units = work_units(megapixels, dem_tiles, feature_tiles)
        return cls(
            megapixels=megapixels,
            dem_tiles=dem_tiles,
            feature_tiles=feature_tiles,
            work_units=units,
            price_sats=price_for_work_units(units),
        )


def texture_megapixels(area_km2: float, m_per_px: float | None) -> float:
    """Megapixels a bake will deliver over an extent at a given ground sample.

    `m_per_px` must be the *achieved* resolution. `None` means no orthophoto was
    ordered, which costs no pixels.
    """
    if m_per_px is None or not m_per_px > 0:
        return 0.0
    pixels = area_km2 * SQUARE_METRES_PER_SQUARE_KM / (m_per_px * m_per_px)
    return pixels / PIXELS_PER_MEGAPIXEL


def work_units(megapixels: float, dem_tiles: int, feature_tiles: int) -> float:
    """The cost-shaped size of a job: pixels, DEM tiles, feature tiles."""
    return (
        MEGAPIXEL_WEIGHT * megapixels
        + DEM_TILE_WEIGHT * dem_tiles
        + FEATURE_TILE_WEIGHT * feature_tiles
    )


def price_for_work_units(units: float) -> int:
    """Sats for a quantity of work, never below the floor.

    Truncated rather than rounded up, so a fractional megapixel never becomes a
    sat the caller did not receive.
    """
    return max(MIN_PRICE_SATS, int(SATS_PER_WORK_UNIT * units))


def price_plan(plan: TerrainPlan) -> TerrainPrice:
    """Price a resolved plan: what will be delivered, never what was asked for.

    Two rules hold this function down.

    The resolution is `plan.texture_m_per_px`, the value the texture forecast
    says the bake can achieve — never `texture_m_per_px_requested`. A 0.1 m/px
    request the tile budget can only answer at 2.0 m/px is 400x fewer pixels,
    and charging the requested number would bill for data that was never
    supplied. That defect was measured once already; pricing must not
    reintroduce it. If the plan says the texture will be coarsened, the price
    falls with it.

    The tile counts are the plan's full tile lists, cached or not. A cached tile
    is free to serve, and pricing it lower would turn the price into an oracle
    for the store's contents: quote an extent, watch the number, learn what has
    already been produced and by whom. Two identical requests quote identically
    whether the store is warm or cold, so the price leaks nothing. Anyone
    tempted to "optimise" this into marginal-cost pricing is removing a privacy
    property, not adding an efficiency.
    """
    return TerrainPrice.for_job(
        megapixels=texture_megapixels(plan.area_km2, plan.texture_m_per_px),
        dem_tiles=len(plan.dem_tiles),
        feature_tiles=len(plan.feature_tiles),
    )


def ceiling_price() -> TerrainPrice:
    """The dearest request this service accepts: every ceiling at once.

    Derived from the ceilings rather than written down, so raising one of them
    cannot silently leave the advertised range behind.

    The finest resolution any tier asks for is the sharpest a price can be built
    on. A caller may name a finer `texture_m_per_px`, but at anything near the
    area ceiling the mosaic tile budget and the WMS side clamp coarsen it long
    before delivery — an 11 km extent clamps to 4096 px, roughly 2.7 m/px — so
    this stays an upper bound rather than a number a real request can pass.
    """
    finest_m_per_px = min(tier.texture_m_per_px for tier in LOD_TIERS.values())
    return TerrainPrice.for_job(
        megapixels=texture_megapixels(MAX_AREA_KM2, finest_m_per_px),
        dem_tiles=MAX_DEM_TILES,
        feature_tiles=MAX_FEATURE_TILES,
    )


def advertised_price_range() -> tuple[int, int]:
    """The range this service advertises: the floor and the ceiling request."""
    return MIN_PRICE_SATS, ceiling_price().price_sats


def cep8_cap_tag(tool: str = PRICED_TOOL) -> list[str]:
    """The `cap` tag for the gateway's kind 11317 tools-list event.

    Documented shape: `["cap", "tool:<name>", "<min>-<max>", "sats"]`. A range,
    because the price is per request and quoted per request — `quote_terrain`
    is what turns the range into a number.
    """
    low, high = advertised_price_range()
    return ["cap", f"tool:{tool}", f"{low}-{high}", PRICE_UNIT]
