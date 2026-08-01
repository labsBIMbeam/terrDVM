from __future__ import annotations

import pytest
from blossom_gis.db import BlobRecord, geo_fields
from blossom_gis.geo import BBox, tile_bbox

from terrain_mcp.manifest import (
    ROLE_DEM,
    ROLE_ORTHO,
    BlobDescriptor,
    ResolvedRequest,
    TerrainManifest,
    TileRef,
    total_bytes,
)
from terrain_mcp.plan import plan_terrain, price_plan

FUNCHAL = BBox(west=-16.9200, south=32.6450, east=-16.9080, north=32.6530)
DIGEST = "ab" * 32

#: A real resolved plan, so the manifest is exercised against the same object
#: the production path hands it rather than a hand-built stand-in.
PLAN = plan_terrain(FUNCHAL, "standard")


def tile_record(z: int = 13, x: int = 3711, y: int = 3309) -> BlobRecord:
    return BlobRecord(
        sha256=DIGEST,
        size=4096,
        media_type="image/png",
        uploaded_by="terrain-mcp:dem",
        uploaded_at=1_700_000_000,
        tile_z=z,
        tile_x=x,
        tile_y=y,
        **geo_fields(tile_bbox(z, x, y)),
    )


class TestBlobDescriptor:
    def test_carries_the_blossom_descriptor_fields(self) -> None:
        descriptor = BlobDescriptor.from_record(tile_record(), "https://blobs.example", ROLE_DEM)
        assert descriptor.sha256 == DIGEST
        assert descriptor.size == 4096
        assert descriptor.media_type == "image/png"
        assert descriptor.url == f"https://blobs.example/{DIGEST}"
        assert descriptor.role == ROLE_DEM

    def test_a_trailing_slash_on_the_base_url_does_not_double(self) -> None:
        descriptor = BlobDescriptor.from_record(tile_record(), "https://blobs.example/", ROLE_DEM)
        assert descriptor.url == f"https://blobs.example/{DIGEST}"

    def test_carries_the_footprint_the_index_holds(self) -> None:
        record = tile_record()
        descriptor = BlobDescriptor.from_record(record, "https://blobs.example", ROLE_DEM)
        assert descriptor.bbox == [record.west, record.south, record.east, record.north]
        assert descriptor.geohash == record.geohash

    def test_a_tile_bound_blob_names_its_tile(self) -> None:
        descriptor = BlobDescriptor.from_record(
            tile_record(13, 3711, 3309), "https://blobs.example", ROLE_DEM
        )
        assert descriptor.tile == TileRef(z=13, x=3711, y=3309)

    def test_a_baked_orthophoto_has_a_footprint_but_no_tile(self) -> None:
        record = BlobRecord(
            sha256=DIGEST,
            size=9000,
            media_type="image/jpeg",
            uploaded_by="terrain-mcp:ortho",
            uploaded_at=1_700_000_000,
            **geo_fields(FUNCHAL),
        )
        descriptor = BlobDescriptor.from_record(
            record, "https://blobs.example", ROLE_ORTHO, m_per_px=2.0
        )
        assert descriptor.tile is None
        assert descriptor.bbox == [FUNCHAL.west, FUNCHAL.south, FUNCHAL.east, FUNCHAL.north]
        assert descriptor.m_per_px == 2.0

    def test_a_tile_blob_states_no_resolution_because_its_zoom_decides_it(self) -> None:
        descriptor = BlobDescriptor.from_record(tile_record(), "https://blobs.example", ROLE_DEM)
        assert descriptor.m_per_px is None

    def test_a_blob_without_a_footprint_cannot_be_described(self) -> None:
        record = BlobRecord(
            sha256=DIGEST,
            size=1,
            media_type="image/png",
            uploaded_by="terrain-mcp:dem",
            uploaded_at=1_700_000_000,
        )
        with pytest.raises(ValueError, match="no footprint"):
            BlobDescriptor.from_record(record, "https://blobs.example", ROLE_DEM)


class TestManifestShape:
    def test_totals_the_described_bytes(self) -> None:
        blobs = [
            BlobDescriptor.from_record(tile_record(13, 3711, 3309), "https://b", ROLE_DEM),
            BlobDescriptor.from_record(tile_record(13, 3712, 3309), "https://b", ROLE_DEM),
        ]
        assert total_bytes(blobs) == 8192

    def test_a_manifest_restates_the_resolved_request(self) -> None:
        resolved = ResolvedRequest(
            bbox=[FUNCHAL.west, FUNCHAL.south, FUNCHAL.east, FUNCHAL.north],
            lod="standard",
            dem_zoom=12,
            feature_zoom=13,
            dem_tile_count=1,
            feature_tile_count=1,
            texture=True,
            texture_m_per_px=0.5,
            texture_region="madeira",
            area_km2=0.9,
        )
        manifest = TerrainManifest(
            request=resolved, blobs=[], total_bytes=0, price=price_plan(PLAN)
        )
        assert manifest.request.lod == "standard"
        assert manifest.attribution == []
        assert manifest.warnings == []

    def test_a_manifest_states_the_price_of_the_delivery(self) -> None:
        # A caller pays before the work; the answer restates what it paid, in
        # the same shape `quote_terrain` gave it.
        manifest = TerrainManifest(
            request=ResolvedRequest.from_plan(PLAN),
            blobs=[],
            total_bytes=0,
            price=price_plan(PLAN),
        )
        assert manifest.price.unit == "sats"
        assert manifest.price.price_sats == price_plan(PLAN).price_sats

    def test_the_resolved_request_is_rendered_from_the_plan_for_both_paths(self) -> None:
        # One rendering, so a quote and the manifest of the work it bought can
        # never disagree about what was ordered.
        request = ResolvedRequest.from_plan(PLAN)
        assert request.dem_tile_count == len(PLAN.dem_tiles)
        assert request.feature_tile_count == len(PLAN.feature_tiles)
        assert request.texture_m_per_px == PLAN.texture_m_per_px
        assert request.texture_m_per_px_requested == PLAN.texture_m_per_px_requested

    def test_the_resolved_request_states_requested_and_delivered_resolution(self) -> None:
        # Two fields, not one: a caller has to be able to see the downgrade
        # before paying for a resolution that was never produced.
        fields = ResolvedRequest.__dataclass_fields__
        assert "texture_m_per_px" in fields
        assert "texture_m_per_px_requested" in fields
        assert "texture_downgraded" in fields

    def test_the_manifest_never_offers_a_mesh(self) -> None:
        # The corpus is source tiles; GLB is baked per delivery by the client.
        fields = TerrainManifest.__dataclass_fields__
        assert "glb" not in fields and "mesh" not in fields
