"""Turn a bounded plan into stored blobs.

Every upstream is an injected callable, so the whole module runs in tests
without a socket. The fetchers themselves are blossom-gis's — this service adds
storage, indexing and a manifest, not a second copy of anyone's tile logic.
"""

from __future__ import annotations

import io
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from blossom_gis import texture as texture_module
from blossom_gis.crawl import (
    MEDIA_TYPES,
    RASTER_REQUEST_INTERVAL_S,
    RateLimiter,
    Tile,
    fetch_raster,
    fetch_tile,
)
from blossom_gis.db import BlobIndex, BlobRecord, geo_fields
from blossom_gis.featuretile import FeatureTile, encode_feature_tile
from blossom_gis.geo import tile_bbox
from blossom_gis.store import BlobStore

from .budget import DEFAULT_BUDGET_S, Budget, TerrainBudgetError
from .manifest import (
    ROLE_DEM,
    ROLE_FEATURES,
    ROLE_ORTHO,
    BlobDescriptor,
    ResolvedRequest,
    TerrainManifest,
    total_bytes,
)
from .plan import TEXTURE_MAX_TILES, TerrainPlan, price_plan, resolutions_match

logger = logging.getLogger(__name__)

#: `(done, total, message)`. Stage-level, so a caller can render a bar without
#: this module knowing anything about MCP.
ProgressReporter = Callable[[float, float, str], None]

#: Provenance written into the index's `uploaded_by` column. The crawler already
#: uses that column for a non-pubkey origin string (`crawler:<region>:<kind>`);
#: this service is keyless and follows the same convention.
PROVENANCE = "terrain-mcp"

#: Fixed upstreams, so their attribution is fixed too. Copied verbatim from
#: `packages/terrain-engine/src/terrain/dem.ts` and the ODbL requirement the
#: napplet already carries.
DEM_ATTRIBUTION = "Elevation: Mapzen Terrain Tiles via AWS Open Data (SRTM, GMTED2010, NED)"
FEATURE_ATTRIBUTION = "Features: © OpenStreetMap contributors (ODbL)"

#: Per-call ceilings, each additionally clipped to whatever the request budget
#: has left. blossom-gis's own defaults (45 s per raster tile, 180 s per Overpass
#: tile) outlive the whole budget on their own, so they are narrowed here rather
#: than inherited.
DEM_TILE_TIMEOUT_S = 30.0
FEATURE_TILE_TIMEOUT_S = 60.0


class TerrainUpstreamError(RuntimeError):
    """An upstream failed. Raised rather than dropping the tile from the manifest.

    A manifest missing one DEM tile is a hole in the terrain that looks exactly
    like a complete answer. The crawler already learnt this the expensive way
    with silently truncated Overpass tiles; the same rule applies here.
    """


class TextureResolutionMismatchError(RuntimeError):
    """The bake came back at a resolution the plan did not promise.

    Fail closed. The alternative — publish the delivered number and carry on —
    is what turned a 0.1 m/px request into a 2.0 m/px blob described as 0.1, and
    the CEP-8 price is computed from exactly this field. A mismatch also means
    the forecast in `plan` and the bake in `blossom_gis.texture` have drifted
    apart, which is a defect to surface, not to absorb.
    """


def _now() -> int:
    return int(time.time())


def _raster_limiter() -> RateLimiter:
    return RateLimiter(RASTER_REQUEST_INTERVAL_S)


def _fetch_dem(tile: Tile, timeout_s: float) -> bytes:
    """blossom-gis's Terrarium fetcher, under this service's timeout."""
    return fetch_raster(tile, timeout_s=timeout_s)


def _fetch_features(tile: Tile, timeout_s: float) -> FeatureTile:
    """blossom-gis's Overpass fetcher, under this service's timeout."""
    return fetch_tile(tile, timeout_s=timeout_s)


def _no_progress(done: float, total: float, message: str) -> None:
    """Default reporter — a call with no progress token still has to run."""


@dataclass(frozen=True)
class ServiceContext:
    """Everything the tool needs from the outside world.

    Constructed once at startup from the environment, or by hand in a test with
    a tmp_path store and fake fetchers.

    The two limiters are the crawler's two lanes, and they are per-context rather
    than per-request on purpose: a server that answers ten calls in a minute must
    still respect one politeness floor, not ten. Overpass is the slow lane; the
    raster CDNs tolerate a much tighter cadence. The crawler's slot check is
    deliberately not applied — that guards bulk runs, and this tool is capped at
    sixteen feature tiles.
    """

    store: BlobStore
    index: BlobIndex
    base_url: str
    dem_fetcher: Callable[[Tile, float], bytes] = _fetch_dem
    feature_fetcher: Callable[[Tile, float], FeatureTile] = _fetch_features
    texture_fetcher: Callable[..., texture_module.Texture] = texture_module.fetch_texture
    #: The per-URL fetcher handed *into* the texture backend, so every tile of a
    #: mosaic passes this service's budget on its way out.
    #:
    #: PRIVATE IMPORT, pending an export: `blossom_gis.texture._fetch` is the
    #: only way to reach the module's own urllib call (correct User-Agent,
    #: correct error surface) without writing a second HTTP client here. An
    #: export request is on record; swap the name when it lands.
    texture_http_fetcher: Callable[[str, float], bytes] = texture_module._fetch
    clock: Callable[[], int] = _now
    #: Monotonic source for the request budget, injected so a test can exhaust it
    #: without sleeping.
    monotonic: Callable[[], float] = time.monotonic
    budget_s: float = DEFAULT_BUDGET_S
    feature_limiter: RateLimiter = field(default_factory=RateLimiter)
    raster_limiter: RateLimiter = field(default_factory=_raster_limiter)


def _cached_tile(
    context: ServiceContext, z: int, x: int, y: int, media_type: str
) -> BlobRecord | None:
    """An already-stored blob for this tile and layer, or None.

    Hits the crawler's blobs too: a tile the crawler fetched last week is the
    same tile, so a warm region costs nothing upstream.
    """
    for record in context.index.query_tile(z, x, y):
        if record.media_type == media_type and context.store.exists(record.sha256):
            return record
    return None


def _store_tile(
    context: ServiceContext, tile: Tile, payload: bytes, media_type: str
) -> BlobRecord:
    """Store a tile's bytes content-addressed and index its footprint."""
    stored = context.store.put(payload)
    record = BlobRecord(
        sha256=stored.sha256,
        size=stored.size,
        media_type=media_type,
        uploaded_by=f"{PROVENANCE}:{tile.kind}",
        uploaded_at=context.clock(),
        tile_z=tile.z,
        tile_x=tile.x,
        tile_y=tile.y,
        **geo_fields(tile_bbox(tile.z, tile.x, tile.y)),
    )
    context.index.upsert(record)
    return record


@dataclass
class _Run:
    """Per-request state threaded through the stages: budget, progress, notes."""

    budget: Budget
    report: ProgressReporter
    total_units: float
    done_units: float = 0.0
    warnings: list[str] = field(default_factory=list)
    attribution: list[str] = field(default_factory=list)

    def advance(self, message: str, units: float = 1.0) -> None:
        """Book a completed unit of work and tell the client about it."""
        self.done_units += units
        self.report(self.done_units, self.total_units, message)

    def at(self, fraction: float, message: str) -> None:
        """Report partway through the current unit, without booking it."""
        self.report(self.done_units + min(fraction, 0.99), self.total_units, message)


class _BudgetedFetch:
    """The per-URL fetcher handed to the texture backend.

    Two jobs the backend cannot do for itself. It caps every call at whatever the
    request has left, so no single tile outlives the budget. And once the budget
    is gone it refuses instantly instead of connecting — which matters because
    `fetch_xyz_texture` swallows per-tile failures to keep the mosaic going, so a
    raise here does not stop the loop, it only makes the rest of it free. The
    refusal count is what turns that truncated mosaic into a failed request.
    """

    def __init__(self, budget: Budget, inner: Callable[[str, float], bytes], run: _Run) -> None:
        self.budget = budget
        self.inner = inner
        self.run = run
        self.tiles = 0
        self.refusals = 0

    def __call__(self, url: str, timeout_s: float) -> bytes:
        remaining = self.budget.remaining_s()
        if remaining <= 0:
            self.refusals += 1
            raise TerrainBudgetError("request budget exhausted before this texture tile")
        self.tiles += 1
        self.run.at(self.tiles / TEXTURE_MAX_TILES, f"orthophoto tile {self.tiles}")
        return self.inner(url, min(timeout_s, remaining))


def _budget_exhausted(run: _Run, fetch: _BudgetedFetch) -> TerrainBudgetError:
    """The named failure for a mosaic left incomplete by the clock."""
    return TerrainBudgetError(
        f"the {run.budget.total_s:.0f}s budget for this request ran out during the texture "
        f"stage after {run.budget.elapsed_s():.1f}s, leaving {fetch.refusals} of the mosaic's "
        "tiles unfetched — request a smaller bbox, a coarser lod, or texture=false"
    )


def _produce_dem(context: ServiceContext, plan: TerrainPlan, run: _Run) -> list[BlobDescriptor]:
    """Terrarium elevation tiles covering the extent."""
    media_type = MEDIA_TYPES["dem"]
    descriptors: list[BlobDescriptor] = []
    for x, y in plan.dem_tiles:
        record = _cached_tile(context, plan.dem_zoom, x, y, media_type)
        if record is None:
            tile = Tile(region=PROVENANCE, z=plan.dem_zoom, x=x, y=y, kind="dem")
            context.raster_limiter.wait()
            timeout_s = run.budget.slice_s(DEM_TILE_TIMEOUT_S, "the DEM stage")
            try:
                payload = context.dem_fetcher(tile, timeout_s)
            except Exception as error:
                raise TerrainUpstreamError(
                    f"DEM tile {tile.z}/{tile.x}/{tile.y} failed: {type(error).__name__}: {error}"
                ) from error
            record = _store_tile(context, tile, payload, media_type)
            logger.info("stored dem %s/%s/%s as %s", tile.z, tile.x, tile.y, record.sha256)
        descriptors.append(BlobDescriptor.from_record(record, context.base_url, ROLE_DEM))
        run.advance(f"DEM tile {plan.dem_zoom}/{x}/{y}")
    return descriptors


def _produce_features(
    context: ServiceContext, plan: TerrainPlan, run: _Run
) -> list[BlobDescriptor]:
    """TFT2 feature tiles covering the extent, encoded by the pinned codec."""
    media_type = MEDIA_TYPES["features"]
    descriptors: list[BlobDescriptor] = []
    for x, y in plan.feature_tiles:
        record = _cached_tile(context, plan.feature_zoom, x, y, media_type)
        if record is None:
            tile = Tile(region=PROVENANCE, z=plan.feature_zoom, x=x, y=y, kind="features")
            context.feature_limiter.wait()
            timeout_s = run.budget.slice_s(FEATURE_TILE_TIMEOUT_S, "the feature stage")
            try:
                payload = encode_feature_tile(context.feature_fetcher(tile, timeout_s))
            except Exception as error:
                raise TerrainUpstreamError(
                    f"feature tile {tile.z}/{tile.x}/{tile.y} failed: "
                    f"{type(error).__name__}: {error}"
                ) from error
            record = _store_tile(context, tile, payload, media_type)
            logger.info("stored features %s/%s/%s as %s", tile.z, tile.x, tile.y, record.sha256)
        descriptors.append(BlobDescriptor.from_record(record, context.base_url, ROLE_FEATURES))
        run.advance(f"feature tile {plan.feature_zoom}/{x}/{y}")
    return descriptors


def _produce_texture(
    context: ServiceContext, plan: TerrainPlan, run: _Run
) -> list[BlobDescriptor]:
    """One orthophoto baked to the exact extent — not a tile pyramid.

    Deliberately not cached by extent: the source chain falls back per region and
    per request, so the only way to report which survey actually answered is to
    have just asked it. The bytes still dedupe in the content-addressed store.

    The backend is asked for the *requested* resolution, not the planned one, on
    purpose: it then applies its own caps and the answer is a live cross-check of
    the forecast `plan` made. Equal means the two agree; unequal is a drift that
    fails the request rather than reaching a manifest.
    """
    forecast = plan.texture_forecast
    if not plan.texture or plan.texture_region is None or forecast is None:
        return []

    run.budget.check("the texture stage")
    run.at(0.0, f"baking {forecast.m_per_px:.2f} m/px orthophoto from {forecast.source_id}")
    fetch = _BudgetedFetch(run.budget, context.texture_http_fetcher, run)
    try:
        baked = context.texture_fetcher(
            plan.bbox,
            plan.texture_region,
            forecast.requested_m_per_px,
            max_tiles=TEXTURE_MAX_TILES,
            fetcher=fetch,
        )
    except Exception as error:
        # `fetch_texture` catches everything per source, so a budget refusal
        # arrives here disguised as "no texture source succeeded".
        if fetch.refusals:
            raise _budget_exhausted(run, fetch) from error
        raise TerrainUpstreamError(
            f"texture bake failed for region {plan.texture_region}: "
            f"{type(error).__name__}: {error}"
        ) from error

    # A mosaic that skipped tiles because the clock ran out is incomplete, and
    # `fetch_xyz_texture` returns it anyway rather than raising.
    if fetch.refusals:
        raise _budget_exhausted(run, fetch)

    if not resolutions_match(baked.metres_per_pixel, forecast.m_per_px):
        # Two causes, one response. Either the source chain fell back past the
        # survey the plan priced, or the forecast and the bake have drifted.
        # Both leave the caller with an image other than the one quoted.
        cause = (
            f"{forecast.source_id} was unavailable and {baked.source.id} answered instead"
            if baked.source.id != forecast.source_id
            else f"{baked.source.id} did not honour its own plan"
        )
        raise TextureResolutionMismatchError(
            f"planned {forecast.m_per_px:.3f} m/px for region {plan.texture_region} but "
            f"got {baked.metres_per_pixel:.3f} m/px — {cause}; refusing to describe the "
            "blob at a resolution it does not have"
        )

    buffer = io.BytesIO()
    baked.image.save(buffer, "JPEG", quality=90)
    stored = context.store.put(buffer.getvalue())
    record = BlobRecord(
        sha256=stored.sha256,
        size=stored.size,
        media_type=MEDIA_TYPES["ortho"],
        uploaded_by=f"{PROVENANCE}:ortho",
        uploaded_at=context.clock(),
        **geo_fields(plan.bbox),
    )
    context.index.upsert(record)

    run.warnings.extend(baked.warnings)
    run.warnings.extend(forecast.notes)
    if forecast.downgraded:
        run.warnings.append(
            f"requested {forecast.requested_m_per_px:.2f} m/px; this extent can only be "
            f"delivered at {forecast.m_per_px:.2f} m/px — request a smaller bbox for more detail"
        )
    run.attribution.append(f"Imagery: {baked.source.attribution} ({baked.source.license})")
    logger.info(
        "baked ortho %s at %.3f m/px as %s",
        plan.texture_region,
        baked.metres_per_pixel,
        record.sha256,
    )
    run.advance(f"orthophoto at {baked.metres_per_pixel:.2f} m/px")
    return [
        BlobDescriptor.from_record(
            record, context.base_url, ROLE_ORTHO, m_per_px=baked.metres_per_pixel
        )
    ]


def produce_terrain(
    plan: TerrainPlan,
    context: ServiceContext,
    progress: ProgressReporter | None = None,
) -> TerrainManifest:
    """Ensure every planned source tile exists as a blob, and describe them all.

    Bounded by one wall-clock budget shared across all three stages, and
    reporting a unit of progress per tile. Both exist for the same reason: the
    texture stage fetches a mosaic sequentially, and without them a black-holing
    upstream turns a single call into hours of silence that only the client's
    read timeout ends.
    """
    run = _Run(
        budget=Budget(total_s=context.budget_s, clock=context.monotonic),
        report=progress or _no_progress,
        total_units=float(len(plan.dem_tiles) + len(plan.feature_tiles) + int(plan.texture)),
        attribution=[DEM_ATTRIBUTION, FEATURE_ATTRIBUTION],
    )
    run.at(0.0, f"planning {plan.lod} terrain for {run.total_units:.0f} sources")

    blobs = _produce_dem(context, plan, run)
    blobs += _produce_features(context, plan, run)
    blobs += _produce_texture(context, plan, run)

    return TerrainManifest(
        request=ResolvedRequest.from_plan(plan),
        blobs=blobs,
        total_bytes=total_bytes(blobs),
        # Priced from the plan, not from what this run happened to fetch: the
        # tiles already in the store cost nothing to serve, and discounting them
        # would make the price a readout of the corpus. Same plan, same price.
        price=price_plan(plan),
        attribution=run.attribution,
        warnings=run.warnings,
    )
