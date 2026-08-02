from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from blossom_gis.crawl import MEDIA_TYPES
from blossom_gis.featuretile import decode_feature_tile
from blossom_gis.geo import BBox
from blossom_gis.store import is_valid_sha256
from blossom_gis.texture import ESRI_WORLD_IMAGERY, Texture
from conftest import FakeClock, FakeUpstream
from mcp.server import MCPServer
from PIL import Image

from terrain_mcp.budget import TerrainBudgetError
from terrain_mcp.manifest import ROLE_DEM, ROLE_FEATURES, ROLE_ORTHO
from terrain_mcp.plan import AreaCeilingError, BoundingBoxError, TileCeilingError, plan_terrain
from terrain_mcp.produce import (
    ServiceContext,
    TerrainUpstreamError,
    TextureResolutionMismatchError,
    produce_terrain,
)
from terrain_mcp.tools.generate_terrain import generate_terrain, register

FUNCHAL = [-16.9200, 32.6450, -16.9080, 32.6530]
EUROPE = [-25.0, 34.0, 32.0, 71.5]
EIGHT_KM_SQUARE = [11.3000, 46.4600, 11.4044, 46.5323]

#: 4.8 x 4.4 km near Casablanca — the extent that reproduces the measured defect
#: exactly: a 0.1 m/px request the mosaic tile budget can only answer at
#: 2.0 m/px, the 20x overstatement observed over real stdio.
TWENTY_X = [-7.6000, 33.1249, -7.5520, 33.1649]


def roles(manifest: Any) -> list[str]:
    return [blob.role for blob in manifest.blobs]


class TestSmallRealExtent:
    def test_produces_dem_features_and_one_orthophoto(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        assert roles(manifest).count(ROLE_ORTHO) == 1
        assert roles(manifest).count(ROLE_DEM) == manifest.request.dem_tile_count
        assert roles(manifest).count(ROLE_FEATURES) == manifest.request.feature_tile_count

    def test_every_described_blob_is_actually_stored(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        for blob in manifest.blobs:
            assert is_valid_sha256(blob.sha256)
            assert context.store.exists(blob.sha256)
            assert blob.size == context.store.size_of(blob.sha256)

    def test_every_descriptor_resolves_against_the_blob_server(
        self, context: ServiceContext
    ) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        for blob in manifest.blobs:
            assert blob.url == f"https://blobs.example/{blob.sha256}"
            # The blossom-gis blob endpoint refuses a hash with no index row.
            assert context.index.get(blob.sha256) is not None

    def test_media_types_match_the_crawler_s_vocabulary(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        by_role = {blob.role: blob.media_type for blob in manifest.blobs}
        assert by_role[ROLE_DEM] == MEDIA_TYPES["dem"]
        assert by_role[ROLE_FEATURES] == MEDIA_TYPES["features"]
        assert by_role[ROLE_ORTHO] == MEDIA_TYPES["ortho"]

    def test_feature_blobs_are_readable_tft2(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        blob = next(b for b in manifest.blobs if b.role == ROLE_FEATURES)
        tile = decode_feature_tile(context.store.read(blob.sha256))
        assert tile.z == manifest.request.feature_zoom
        assert len(tile.buildings) == 1

    def test_the_resolved_request_is_reported_back(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "detail")
        assert manifest.request.lod == "detail"
        assert (manifest.request.dem_zoom, manifest.request.feature_zoom) == (13, 14)
        assert manifest.request.texture_region == "madeira"
        # 0.25 m/px is the `detail` tier default, but this extent is 1124 m wide
        # and the WMS side clamp stops at 4096 px — so 0.275 is what is on offer,
        # and both numbers are stated.
        assert manifest.request.texture_m_per_px_requested == 0.25
        assert manifest.request.texture_m_per_px == 0.275
        assert manifest.request.texture_downgraded is True
        assert manifest.request.bbox == FUNCHAL

    def test_totals_and_attribution_are_carried(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        assert manifest.total_bytes == sum(blob.size for blob in manifest.blobs)
        assert any("OpenStreetMap" in line for line in manifest.attribution)
        assert any("Mapzen" in line for line in manifest.attribution)
        # Funchal reaches DROTe's own survey, not the global Esri fallback.
        assert any("DROTe" in line for line in manifest.attribution)

    def test_upstream_warnings_reach_the_caller(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        assert "fake upstream" in manifest.warnings


class TestTextureIsOptional:
    def test_no_texture_means_no_orthophoto_and_no_imagery_request(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard", texture=False)
        assert ROLE_ORTHO not in roles(manifest)
        assert upstream.texture_calls == []
        assert manifest.request.texture_region is None


class TestCaching:
    def test_a_repeat_request_refetches_no_tile(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        generate_terrain(context, FUNCHAL, "standard", texture=False)
        first = (len(upstream.dem_calls), len(upstream.feature_calls))
        generate_terrain(context, FUNCHAL, "standard", texture=False)
        assert (len(upstream.dem_calls), len(upstream.feature_calls)) == first

    def test_a_repeat_request_describes_the_same_blobs(self, context: ServiceContext) -> None:
        first = generate_terrain(context, FUNCHAL, "standard", texture=False)
        second = generate_terrain(context, FUNCHAL, "standard", texture=False)
        assert [b.sha256 for b in first.blobs] == [b.sha256 for b in second.blobs]


class TestUpstreamCourtesy:
    def test_every_fetched_tile_passes_its_lane_s_rate_limiter(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        generate_terrain(context, FUNCHAL, "standard", texture=False)
        assert context.raster_limiter.waits == len(upstream.dem_calls)
        assert context.feature_limiter.waits == len(upstream.feature_calls)

    def test_a_cached_tile_costs_the_upstream_nothing(self, context: ServiceContext) -> None:
        generate_terrain(context, FUNCHAL, "standard", texture=False)
        before = (context.raster_limiter.waits, context.feature_limiter.waits)
        generate_terrain(context, FUNCHAL, "standard", texture=False)
        assert (context.raster_limiter.waits, context.feature_limiter.waits) == before

    def test_the_two_lanes_are_separate_limiters(self, context: ServiceContext) -> None:
        # Overpass is slot-limited and needs the slow lane; raster CDNs do not.
        assert context.raster_limiter is not context.feature_limiter


class TestCeilingsRefuseBeforeFetching:
    def test_a_continent_is_refused_without_contacting_anything(
        self, sealed_context: ServiceContext
    ) -> None:
        with pytest.raises(AreaCeilingError):
            generate_terrain(sealed_context, EUROPE, "overview")

    def test_a_tile_ceiling_breach_is_refused_without_contacting_anything(
        self, sealed_context: ServiceContext
    ) -> None:
        with pytest.raises(TileCeilingError):
            generate_terrain(sealed_context, EIGHT_KM_SQUARE, "detail")

    def test_an_invalid_bbox_is_refused_without_contacting_anything(
        self, sealed_context: ServiceContext
    ) -> None:
        with pytest.raises(BoundingBoxError):
            generate_terrain(sealed_context, [1.0, 2.0], "standard")

    def test_nothing_is_stored_when_a_request_is_refused(
        self, sealed_context: ServiceContext, tmp_path: Path
    ) -> None:
        with pytest.raises(AreaCeilingError):
            generate_terrain(sealed_context, EUROPE, "overview")
        assert list((tmp_path / "blobs").rglob("*")) == []


class TestUpstreamFailure:
    def test_a_failing_dem_tile_fails_the_request_rather_than_the_manifest(
        self, context: ServiceContext
    ) -> None:
        def broken(_tile: object, _timeout_s: float) -> bytes:
            raise TimeoutError("upstream went away")

        broken_context = replace(context, dem_fetcher=broken)
        with pytest.raises(TerrainUpstreamError, match="DEM tile"):
            generate_terrain(broken_context, FUNCHAL, "standard")


class TestDeliveredResolutionIsTheReportedOne:
    """The manifest may only claim a resolution the bake actually produced.

    Measured over real stdio before this was fixed: a request for 0.1 m/px came
    back as `texture_m_per_px: 0.1` while the stored blob was a 2.0 m/px mosaic.
    The CEP-8 price is computed from this field, so an overstatement is billing
    for data that was not supplied.
    """

    def test_the_twenty_fold_overstatement_is_gone(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, TWENTY_X, "standard", texture_m_per_px=0.1)
        assert manifest.request.texture_m_per_px_requested == 0.1
        assert manifest.request.texture_m_per_px == 2.0
        assert manifest.request.texture_m_per_px == pytest.approx(
            20 * manifest.request.texture_m_per_px_requested
        )
        assert manifest.request.texture_downgraded is True

    def test_the_ortho_blob_carries_the_resolution_of_its_own_bytes(
        self, context: ServiceContext
    ) -> None:
        manifest = generate_terrain(context, TWENTY_X, "standard", texture_m_per_px=0.1)
        ortho = next(blob for blob in manifest.blobs if blob.role == ROLE_ORTHO)
        assert ortho.m_per_px == 2.0
        assert ortho.m_per_px == manifest.request.texture_m_per_px

    def test_tile_blobs_carry_no_resolution_because_their_zoom_decides_it(
        self, context: ServiceContext
    ) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        for blob in manifest.blobs:
            if blob.role != ROLE_ORTHO:
                assert blob.m_per_px is None

    def test_the_downgrade_is_stated_in_the_warnings(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, TWENTY_X, "standard", texture_m_per_px=0.1)
        assert any("0.10 m/px" in line and "2.00 m/px" in line for line in manifest.warnings)
        assert any("tile budget" in line for line in manifest.warnings)

    def test_a_request_the_caps_can_honour_is_not_marked_as_downgraded(
        self, context: ServiceContext
    ) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard", texture_m_per_px=0.5)
        assert manifest.request.texture_m_per_px == 0.5
        assert manifest.request.texture_m_per_px_requested == 0.5
        assert manifest.request.texture_downgraded is False

    def test_a_bake_coarser_than_planned_fails_the_request(
        self, context: ServiceContext
    ) -> None:
        """The fail-closed rule, and the tripwire for a drifted fallback rule.

        Mutating the rule inside `blossom_gis.texture` moves the bake away from
        the forecast; this is what that mutation looks like from here.
        """

        def coarser(bbox: BBox, _region: str, target: float, **_: object) -> Texture:
            return Texture(
                image=Image.new("RGB", (8, 8)),
                source=ESRI_WORLD_IMAGERY,
                bbox=bbox,
                metres_per_pixel=target * 20,
                requests=1,
            )

        with pytest.raises(TextureResolutionMismatchError, match="refusing to describe"):
            generate_terrain(replace(context, texture_fetcher=coarser), FUNCHAL, "standard")

    def test_nothing_is_stored_for_a_bake_that_missed_its_resolution(
        self, context: ServiceContext, tmp_path: Path
    ) -> None:
        def coarser(bbox: BBox, _region: str, target: float, **_: object) -> Texture:
            return Texture(
                image=Image.new("RGB", (8, 8)),
                source=ESRI_WORLD_IMAGERY,
                bbox=bbox,
                metres_per_pixel=target * 20,
                requests=1,
            )

        broken = replace(context, texture_fetcher=coarser)
        with pytest.raises(TextureResolutionMismatchError):
            generate_terrain(broken, FUNCHAL, "standard", texture=True)
        footprint = BBox(west=-17.0, south=32.6, east=-16.9, north=32.7)
        assert all(
            record.media_type != MEDIA_TYPES["ortho"]
            for record in context.index.query_bbox(footprint)
        )


class TestWallClockBudget:
    """One budget for the whole call, checked between tiles.

    `fetch_xyz_texture` fetches sequentially, swallows per-tile failures and
    defaults to 30 s a tile; with the 256-tile budget one call on a black-holing
    upstream ran ~2 hours and made 321 outbound connect attempts. A per-tile
    timeout cannot bound that.
    """

    def slow_dem(
        self, context: ServiceContext, upstream: FakeUpstream, seconds: float, budget_s: float
    ) -> tuple[ServiceContext, FakeClock]:
        """A context whose DEM fetcher burns `seconds` of a hand-driven clock."""
        clock = FakeClock()

        def fetch(tile: Any, timeout_s: float) -> bytes:
            clock.advance(seconds)
            return upstream.dem(tile, timeout_s)

        return replace(context, dem_fetcher=fetch, monotonic=clock, budget_s=budget_s), clock

    def test_a_slow_dem_stage_exhausts_the_budget_and_fails_closed(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        # Four z12 DEM tiles at 4 s each against a 10 s budget: the fourth is
        # refused rather than fetched.
        slow, _ = self.slow_dem(context, upstream, seconds=4.0, budget_s=10.0)
        with pytest.raises(TerrainBudgetError, match="ran out during the DEM stage"):
            generate_terrain(slow, EIGHT_KM_SQUARE, "standard")
        assert len(upstream.dem_calls) == 3

    def test_the_budget_spans_stages_rather_than_restarting_at_each_one(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        # One DEM tile consumes the whole allowance; the feature stage must
        # inherit the overdraft, not a fresh allowance of its own.
        slow, _ = self.slow_dem(context, upstream, seconds=11.0, budget_s=10.0)
        with pytest.raises(TerrainBudgetError, match="ran out during the feature stage"):
            generate_terrain(slow, FUNCHAL, "standard")
        assert upstream.feature_calls == []

    def test_each_call_is_capped_by_what_is_left_not_by_its_own_timeout(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        slow, _ = self.slow_dem(context, upstream, seconds=1.0, budget_s=5.0)
        generate_terrain(slow, EIGHT_KM_SQUARE, "standard", texture=False)
        # 5 s left, then 4, then 3, then 2 — never the 30 s per-tile ceiling.
        assert upstream.timeouts[:4] == [5.0, 4.0, 3.0, 2.0]

    def test_a_black_holing_texture_mosaic_is_bounded_and_named(
        self, context: ServiceContext
    ) -> None:
        """The measured case: a real mosaic loop, a fake slow upstream, no socket."""
        import blossom_gis.texture as texture_module

        clock = FakeClock()
        attempts: list[str] = []

        def black_hole(url: str, timeout_s: float) -> bytes:
            attempts.append(url)
            clock.advance(timeout_s)
            raise TimeoutError("upstream never answered")

        bounded = replace(
            context,
            # The real mosaic loop, so the swallowing behaviour under test is
            # blossom-gis's own rather than a fake's impression of it.
            texture_fetcher=texture_module.fetch_texture,
            texture_http_fetcher=black_hole,
            monotonic=clock,
            budget_s=60.0,
        )
        with pytest.raises(TerrainBudgetError, match="texture stage"):
            generate_terrain(bounded, TWENTY_X, "standard", texture_m_per_px=0.1)
        # 60 s of budget at 30 s a tile: two connects, not 256.
        assert len(attempts) == 2

    def test_the_budget_is_refused_rather_than_disabled(self, context: ServiceContext) -> None:
        with pytest.raises(ValueError, match="positive"):
            generate_terrain(replace(context, budget_s=0.0), FUNCHAL, "standard")


class TestProgressReporting:
    def test_every_source_tile_books_a_unit_of_progress(
        self, context: ServiceContext
    ) -> None:
        seen: list[tuple[float, float, str]] = []
        plan = plan_terrain(BBox(west=-16.92, south=32.645, east=-16.908, north=32.653))
        produce_terrain(plan, context, lambda done, total, message: seen.append(
            (done, total, message)
        ))
        expected = len(plan.dem_tiles) + len(plan.feature_tiles) + 1
        assert seen[0][0] == 0.0
        assert seen[-1] == (float(expected), float(expected), seen[-1][2])
        assert all(total == float(expected) for _, total, _ in seen)

    def test_progress_never_moves_backwards(self, context: ServiceContext) -> None:
        seen: list[float] = []
        plan = plan_terrain(BBox(west=-16.92, south=32.645, east=-16.908, north=32.653))
        produce_terrain(plan, context, lambda done, _total, _message: seen.append(done))
        assert seen == sorted(seen)

    def test_the_orthophoto_reports_the_resolution_it_delivered(
        self, context: ServiceContext
    ) -> None:
        messages: list[str] = []
        plan = plan_terrain(
            BBox(west=-7.6000, south=33.1249, east=-7.5520, north=33.1649),
            texture_m_per_px=0.1,
        )
        produce_terrain(plan, context, lambda _d, _t, message: messages.append(message))
        assert any("orthophoto at 2.00 m/px" in message for message in messages)


class TestMcpRegistration:
    def build(self, context: ServiceContext) -> MCPServer:
        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, context)
        return server

    def test_exposes_exactly_one_tool(self, context: ServiceContext) -> None:
        tools = asyncio.run(self.build(context).list_tools())
        assert [tool.name for tool in tools] == ["generate_terrain"]

    def test_the_input_schema_is_derived_from_the_typed_parameters(
        self, context: ServiceContext
    ) -> None:
        schema = asyncio.run(self.build(context).list_tools())[0].input_schema
        assert schema["required"] == ["bbox"]
        assert sorted(schema["properties"]) == ["bbox", "lod", "texture", "texture_m_per_px"]
        assert schema["properties"]["bbox"]["minItems"] == 4
        assert schema["properties"]["lod"]["enum"] == ["overview", "standard", "detail"]

    def test_the_output_schema_describes_the_manifest(self, context: ServiceContext) -> None:
        schema = asyncio.run(self.build(context).list_tools())[0].output_schema
        assert sorted(schema["properties"]) == [
            "attribution",
            "blobs",
            "price",
            "request",
            "total_bytes",
            "warnings",
        ]

    def test_a_call_returns_structured_content(self, context: ServiceContext) -> None:
        server = self.build(context)
        result = asyncio.run(server.call_tool("generate_terrain", {"bbox": FUNCHAL}))
        assert result.is_error is False
        structured = result.structured_content
        assert structured["request"]["dem_zoom"] == 12
        assert structured["blobs"]
        assert all(is_valid_sha256(blob["sha256"]) for blob in structured["blobs"])

    def test_a_call_emits_progress_on_the_context_it_was_handed(
        self, context: ServiceContext
    ) -> None:
        """The tool takes an MCP Context and actually reports through it.

        Without this the client's read timeout is the only sign a long call is
        still alive — which is how a two-hour texture stage went unnoticed.
        """
        from mcp.server.mcpserver import Context

        reports: list[tuple[float, float | None, str | None]] = []

        class RecordingContext(Context):
            async def report_progress(
                self, progress: float, total: float | None = None, message: str | None = None
            ) -> None:
                reports.append((progress, total, message))

        server = self.build(context)
        ctx = RecordingContext(mcp_server=server)
        asyncio.run(server.call_tool("generate_terrain", {"bbox": FUNCHAL}, context=ctx))
        assert reports
        assert [report[0] for report in reports] == sorted(report[0] for report in reports)
        assert reports[-1][0] == reports[-1][1]

    def test_a_refused_request_surfaces_as_a_tool_error(self, context: ServiceContext) -> None:
        from mcp.server.mcpserver.exceptions import ToolError

        server = self.build(context)
        with pytest.raises(ToolError, match="km2 ceiling"):
            asyncio.run(server.call_tool("generate_terrain", {"bbox": EUROPE}))


class TestKeylessByDesign:
    def test_the_package_never_reaches_for_signing_or_key_material(self) -> None:
        # blossom-gis is keyless and this service keeps that property: signing
        # belongs to the future gateway, not to tile production.
        forbidden = ("schnorr", "nostr", "nsec", "private_key", "secret_key", "sign(")
        source_root = Path(__file__).resolve().parents[1] / "src" / "terrain_mcp"
        for path in source_root.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            for needle in forbidden:
                assert needle not in text, f"{path.name} mentions {needle!r}"
