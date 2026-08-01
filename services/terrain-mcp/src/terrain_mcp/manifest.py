"""The typed result of `generate_terrain`: Blossom descriptors, never a mesh.

Kept free of MCP and of every network call so the shape can be tested on its
own. The descriptor fields are derived from `blossom_gis.db.BlobRecord`, so a
blob produced here describes itself exactly the way the blossom-gis server
describes the same blob over HTTP.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from blossom_gis.db import BlobRecord

from .plan import TerrainPlan, TerrainPrice

#: Layer names, identical to `blossom_gis.crawl.KINDS`. A blob produced here and
#: a blob produced by the crawler are then indistinguishable downstream — same
#: media type, same index columns, same descriptor.
ROLE_DEM = "dem"
ROLE_ORTHO = "ortho"
ROLE_FEATURES = "features"


@dataclass(frozen=True)
class TileRef:
    """The slippy-map tile (XYZ scheme) a blob is bound to."""

    z: int
    x: int
    y: int


@dataclass(frozen=True)
class BlobDescriptor:
    """One stored blob: BUD-01 fields plus this project's geo footprint.

    `media_type` is BUD-01's `type`, renamed only to avoid shadowing the
    builtin in a dataclass field.
    """

    role: str
    sha256: str
    size: int
    media_type: str
    url: str
    bbox: list[float]
    geohash: str
    tile: TileRef | None = None
    #: Ground sample distance of *these bytes*, metres per pixel. Set on the
    #: baked orthophoto, where it is the blob's defining property and the number
    #: a price is computed from; `None` on tile blobs, whose resolution is fully
    #: determined by their zoom. It records what was delivered, not what was
    #: asked for — a descriptor that carries the request instead of the result
    #: is how a 0.1 m/px claim came to be attached to a 2.0 m/px image.
    m_per_px: float | None = None

    @classmethod
    def from_record(
        cls,
        record: BlobRecord,
        base_url: str,
        role: str,
        *,
        m_per_px: float | None = None,
    ) -> BlobDescriptor:
        """Render an indexed blob as a descriptor, reusing blossom-gis's shape."""
        descriptor: dict[str, Any] = record.to_descriptor(base_url)
        if "bbox" not in descriptor:
            raise ValueError(f"blob {record.sha256} has no footprint and cannot be described")
        tile = descriptor.get("tile")
        return cls(
            role=role,
            sha256=descriptor["sha256"],
            size=descriptor["size"],
            media_type=descriptor["type"],
            url=descriptor["url"],
            bbox=[float(value) for value in descriptor["bbox"]],
            geohash=descriptor["geohash"],
            tile=TileRef(z=tile["z"], x=tile["x"], y=tile["y"]) if tile else None,
            m_per_px=m_per_px,
        )


@dataclass(frozen=True)
class ResolvedRequest:
    """What the service actually decided to do, once defaults were applied.

    Returned verbatim to the caller: a request that was silently coarsened is
    indistinguishable from one that was honoured unless the resolution is
    stated.
    """

    bbox: list[float]
    lod: str
    dem_zoom: int
    feature_zoom: int
    dem_tile_count: int
    feature_tile_count: int
    texture: bool
    #: Delivered orthophoto resolution, metres per pixel — the number a client
    #: may quote and a price may be computed from.
    texture_m_per_px: float | None
    texture_region: str | None
    area_km2: float
    #: What the caller asked for. Equal to `texture_m_per_px` unless the source's
    #: max zoom, the mosaic tile budget or the WMS side clamp coarsened the bake;
    #: both are stated so the downgrade is visible before payment, not after.
    texture_m_per_px_requested: float | None = None
    #: True when the two above differ — the one field a caller has to read.
    texture_downgraded: bool = False

    @classmethod
    def from_plan(cls, plan: TerrainPlan) -> ResolvedRequest:
        """Render a resolved plan as the request description a caller gets back.

        One rendering for both paths: a quote and the manifest of the work it
        paid for describe the same job with the same code, so the two can never
        disagree about what was ordered.
        """
        forecast = plan.texture_forecast
        return cls(
            bbox=[plan.bbox.west, plan.bbox.south, plan.bbox.east, plan.bbox.north],
            lod=plan.lod,
            dem_zoom=plan.dem_zoom,
            feature_zoom=plan.feature_zoom,
            dem_tile_count=len(plan.dem_tiles),
            feature_tile_count=len(plan.feature_tiles),
            texture=plan.texture,
            texture_m_per_px=plan.texture_m_per_px,
            texture_region=plan.texture_region,
            area_km2=round(plan.area_km2, 3),
            texture_m_per_px_requested=None if forecast is None else forecast.requested_m_per_px,
            texture_downgraded=bool(forecast is not None and forecast.downgraded),
        )


@dataclass(frozen=True)
class TerrainQuote:
    """A price for a request that has not been produced — and need not be.

    The whole document is computed from the plan, so obtaining one costs no
    upstream request. It is what a caller reads before paying, and what the
    gateway turns into a CEP-8 `payment_required`.
    """

    request: ResolvedRequest
    price: TerrainPrice


@dataclass(frozen=True)
class TerrainManifest:
    """Everything a client needs to bake the mesh with the engine it already has.

    There is no GLB here on purpose. `docs/ARCHITECTURE.md`: GLB is a baked
    artifact with a fixed LOD, materials and origin, and two GLBs do not compose
    into a larger scene — so the corpus is source tiles and the bake happens per
    delivery, in `@terrcvm/terrain-engine`.
    """

    request: ResolvedRequest
    blobs: list[BlobDescriptor]
    total_bytes: int
    #: The CEP-8 price of this delivery, identical to the one `quote_terrain`
    #: gives for the same arguments: a caller pays what it was quoted, and can
    #: see so on the answer.
    price: TerrainPrice
    attribution: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def total_bytes(blobs: list[BlobDescriptor]) -> int:
    """Sum of the described blob sizes."""
    return sum(blob.size for blob in blobs)
