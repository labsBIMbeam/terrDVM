"""The CEP-8 price: the number, the range, and the two things it must not be.

It must not be computed from a value that was requested but will not be
delivered, and it must not vary with what is already in the store.
"""

from __future__ import annotations

import asyncio
import inspect
import socket
from pathlib import Path
from typing import Any

import pytest
from conftest import FakeUpstream
from mcp.server import MCPServer

from terrain_mcp.plan import (
    FEATURE_TILE_WEIGHT,
    LIGHTNING_DUST_LIMIT_SATS,
    MAX_AREA_KM2,
    MAX_DEM_TILES,
    MAX_FEATURE_TILES,
    MIN_PRICE_SATS,
    PRICED_TOOL,
    SATS_PER_WORK_UNIT,
    AreaCeilingError,
    BoundingBoxError,
    TileCeilingError,
    advertised_price_range,
    ceiling_price,
    cep8_cap_tag,
    parse_bbox,
    plan_terrain,
    price_for_work_units,
    price_plan,
    texture_megapixels,
    work_units,
)
from terrain_mcp.produce import ServiceContext
from terrain_mcp.tools import register
from terrain_mcp.tools.generate_terrain import generate_terrain
from terrain_mcp.tools.quote_terrain import quote_terrain
from terrain_mcp.tools.quote_terrain import register as register_quote

FUNCHAL = [-16.9200, 32.6450, -16.9080, 32.6530]
EUROPE = [-25.0, 34.0, 32.0, 71.5]
EIGHT_KM_SQUARE = [11.3000, 46.4600, 11.4044, 46.5323]

#: 4.8 x 4.4 km near Casablanca: a 0.1 m/px request the mosaic tile budget can
#: only answer at 2.0 m/px — the measured 20x case, and the price's worst
#: temptation.
TWENTY_X = [-7.6000, 33.1249, -7.5520, 33.1649]


def priced(bbox: list[float], lod: str = "standard", **kwargs: Any) -> Any:
    """The price of a request, planned exactly as the tool plans it."""
    return price_plan(plan_terrain(parse_bbox(bbox), lod, **kwargs))


class TestTheTable:
    """The five rows the owner decided.

        work_units = megapixels + 8 * dem_tiles + 40 * feature_tiles
        price_sats = max(1_000, 21 * work_units)

    All arithmetic, so each row is pinned exactly rather than approximately.
    """

    @pytest.mark.parametrize(
        (
            "label",
            "area_km2",
            "m_per_px",
            "dem_tiles",
            "feature_tiles",
            "megapixels",
            "units",
            "sats",
        ),
        [
            # 1 km², one DEM tile, one feature tile, at each tier's own default.
            ("1 km2 overview", 1.0, 2.0, 1, 1, 0.25, 48.25, 1_013),
            ("1 km2 standard", 1.0, 0.5, 1, 1, 4.0, 52.0, 1_092),
            ("1 km2 detail", 1.0, 0.25, 1, 1, 16.0, 64.0, 1_344),
            # 25 km² at detail: a z13 DEM tile covers ~11 km² and a z14 feature
            # tile ~2.8 km², so the extent lands near three and eight.
            ("25 km2 detail", 25.0, 0.25, 3, 8, 400.0, 744.0, 15_624),
            # Every ceiling at once — the dearest request the service accepts.
            (
                "120 km2 ceiling",
                MAX_AREA_KM2,
                0.25,
                MAX_DEM_TILES,
                MAX_FEATURE_TILES,
                1_920.0,
                3_072.0,
                64_512,
            ),
        ],
    )
    def test_each_row_prices_exactly(
        self,
        label: str,
        area_km2: float,
        m_per_px: float,
        dem_tiles: int,
        feature_tiles: int,
        megapixels: float,
        units: float,
        sats: int,
    ) -> None:
        assert texture_megapixels(area_km2, m_per_px) == pytest.approx(megapixels), label
        assert work_units(megapixels, dem_tiles, feature_tiles) == pytest.approx(units), label
        assert price_for_work_units(units) == sats, label

    def test_the_weights_are_the_ones_the_table_was_built_from(self) -> None:
        # Feature tiles dominate because Overpass does: rate-limited upstream, a
        # 4 s politeness floor per tile, and no cache gives that time back.
        assert (SATS_PER_WORK_UNIT, FEATURE_TILE_WEIGHT) == (21, 40.0)
        assert work_units(1.0, 0, 0) == 1.0
        assert work_units(0.0, 1, 0) == 8.0
        assert work_units(0.0, 0, 1) == 40.0

    def test_a_real_square_kilometre_at_overview_lands_on_the_first_row(self) -> None:
        # The table is arithmetic, but its first row is also a real extent: ~1 km²
        # over Funchal at overview resolves to one DEM tile and one feature tile.
        price = priced(FUNCHAL, "overview")
        assert (price.dem_tiles, price.feature_tiles) == (1, 1)
        assert price.price_sats == 1_013


class TestTheFloorAndTheDustLimit:
    def test_the_floor_binds_below_itself(self) -> None:
        assert price_for_work_units(0.0) == MIN_PRICE_SATS
        assert price_for_work_units(MIN_PRICE_SATS / SATS_PER_WORK_UNIT - 1) == MIN_PRICE_SATS

    def test_the_floor_stops_binding_where_the_arithmetic_passes_it(self) -> None:
        assert price_for_work_units(MIN_PRICE_SATS / SATS_PER_WORK_UNIT + 1) > MIN_PRICE_SATS

    def test_the_floor_clears_lightning_s_dust_limit(self) -> None:
        # Below the dust limit an HTLC is trimmed: no on-chain output, so it is
        # unenforceable on a force-close, at 2-14% routing fees. A single work
        # unit at 21 sats is far under it, which is why the floor exists.
        assert SATS_PER_WORK_UNIT < LIGHTNING_DUST_LIMIT_SATS < MIN_PRICE_SATS

    @pytest.mark.parametrize("lod", ["overview", "standard", "detail"])
    @pytest.mark.parametrize("texture", [True, False])
    def test_no_plannable_request_prices_into_dust(self, lod: str, texture: bool) -> None:
        for bbox in (FUNCHAL, TWENTY_X):
            price = priced(bbox, lod, texture=texture)
            assert price.price_sats >= MIN_PRICE_SATS > LIGHTNING_DUST_LIMIT_SATS

    def test_a_price_is_a_whole_number_of_sats(self) -> None:
        assert isinstance(priced(FUNCHAL, "detail").price_sats, int)


class TestPricedOnWhatIsDelivered:
    """The achieved resolution, never the requested one."""

    def test_the_twenty_fold_request_is_priced_at_two_metres_not_ten_centimetres(self) -> None:
        plan = plan_terrain(parse_bbox(TWENTY_X), "standard", texture_m_per_px=0.1)
        price = price_plan(plan)
        assert plan.texture_m_per_px_requested == 0.1
        assert plan.texture_m_per_px == 2.0
        # Priced on the 2.0 m/px mosaic that will actually be baked.
        assert price.megapixels == pytest.approx(texture_megapixels(plan.area_km2, 2.0))
        # Pricing the requested number would have been 400x the pixels.
        assert price.megapixels < texture_megapixels(plan.area_km2, 0.1) / 100

    def test_a_capped_request_costs_no_more_than_the_resolution_it_gets(self) -> None:
        # Same extent, same tiles: asking for 0.1 m/px on an extent the tile
        # budget answers at 2.0 must cost exactly what asking for 2.0 costs.
        assert (
            priced(TWENTY_X, "standard", texture_m_per_px=0.1).price_sats
            == priced(TWENTY_X, "standard", texture_m_per_px=2.0).price_sats
        )

    def test_finer_delivered_pixels_cost_more(self) -> None:
        assert (
            priced(FUNCHAL, "standard", texture_m_per_px=0.5).price_sats
            > priced(FUNCHAL, "standard", texture_m_per_px=2.0).price_sats
        )

    def test_no_texture_costs_no_pixels(self) -> None:
        price = priced(FUNCHAL, "standard", texture=False)
        assert price.megapixels == 0.0
        assert price.work_units == work_units(0.0, price.dem_tiles, price.feature_tiles)
        assert price.price_sats < priced(FUNCHAL, "standard").price_sats

    def test_the_price_counts_the_tiles_the_plan_will_fetch(self) -> None:
        plan = plan_terrain(parse_bbox(EIGHT_KM_SQUARE), "standard")
        price = price_plan(plan)
        assert (price.dem_tiles, price.feature_tiles) == (
            len(plan.dem_tiles),
            len(plan.feature_tiles),
        )


class TestThePriceIsNotAnOracleForTheStore:
    """Two identical requests quote identically, warm store or cold.

    A cached tile is free to serve. Discounting it would turn the price into a
    readout of the corpus — quote an extent, watch the number, learn what has
    already been produced. That privacy property is worth more than the discount.
    """

    def test_a_repeat_delivery_costs_the_same_as_the_first(
        self, context: ServiceContext, upstream: FakeUpstream
    ) -> None:
        first = generate_terrain(context, FUNCHAL, "standard", texture=False)
        fetched = (len(upstream.dem_calls), len(upstream.feature_calls))
        second = generate_terrain(context, FUNCHAL, "standard", texture=False)
        # Nothing was fetched the second time — and the price did not move.
        assert (len(upstream.dem_calls), len(upstream.feature_calls)) == fetched
        assert second.price == first.price

    def test_the_quote_matches_the_manifest_of_the_work_it_paid_for(
        self, context: ServiceContext
    ) -> None:
        quoted = quote_terrain(FUNCHAL, "standard")
        delivered = generate_terrain(context, FUNCHAL, "standard")
        assert delivered.price == quoted.price
        assert delivered.request == quoted.request

    def test_a_quote_after_the_work_is_the_quote_from_before_it(
        self, context: ServiceContext
    ) -> None:
        before = quote_terrain(FUNCHAL, "standard")
        generate_terrain(context, FUNCHAL, "standard")
        assert quote_terrain(FUNCHAL, "standard") == before


class TestAQuoteCostsNothing:
    def test_it_reaches_no_upstream_with_every_fetcher_armed(
        self, sealed_context: ServiceContext, tmp_path: Path
    ) -> None:
        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, sealed_context)
        result = asyncio.run(server.call_tool("quote_terrain", {"bbox": FUNCHAL}))
        assert result.is_error is False
        assert result.structured_content["price"]["price_sats"] > 0
        # Every fetcher on that context raises if reached; nothing was stored.
        assert list((tmp_path / "blobs").rglob("*")) == []

    def test_it_opens_no_socket(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Not a fetcher count — the absence of any call into the network stack."""

        def forbidden(*_args: object, **_kwargs: object) -> object:
            raise AssertionError("a quote opened a socket")

        monkeypatch.setattr(socket, "socket", forbidden)
        monkeypatch.setattr(socket, "create_connection", forbidden)
        assert quote_terrain(TWENTY_X, "detail", texture_m_per_px=0.1).price.price_sats > 0

    def test_the_quote_tool_is_never_handed_a_store_or_an_index(self) -> None:
        # Structural, not behavioural: with no ServiceContext there is nothing
        # for a quote to read the corpus from, whatever anyone adds later.
        assert list(inspect.signature(register_quote).parameters) == ["server"]

    @pytest.mark.parametrize(
        ("bbox", "lod", "error"),
        [
            (EUROPE, "overview", AreaCeilingError),
            (EIGHT_KM_SQUARE, "detail", TileCeilingError),
            ([1.0, 2.0], "standard", BoundingBoxError),
        ],
    )
    def test_a_request_that_would_be_refused_is_refused_at_quote_time(
        self, bbox: list[float], lod: str, error: type[Exception]
    ) -> None:
        # Discovering that an extent is impossible after paying for it is the
        # same failure as being charged for data that never arrives.
        with pytest.raises(error):
            quote_terrain(bbox, lod)


class TestAdvertisedRange:
    def test_the_cap_tag_has_the_documented_shape(self) -> None:
        assert cep8_cap_tag() == ["cap", "tool:generate_terrain", "1000-64512", "sats"]

    def test_the_range_runs_from_the_floor_to_the_ceiling_request(self) -> None:
        assert advertised_price_range() == (MIN_PRICE_SATS, ceiling_price().price_sats)
        assert ceiling_price().price_sats == 64_512
        assert ceiling_price().work_units == 3_072.0

    def test_the_maximum_is_derived_from_the_ceilings_rather_than_written_down(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Move a ceiling and the advertised maximum must move with it, or the
        # announcement quietly desyncs from what the service accepts.
        monkeypatch.setattr("terrain_mcp.plan.MAX_AREA_KM2", MAX_AREA_KM2 / 2)
        assert advertised_price_range()[1] < 64_512
        monkeypatch.setattr("terrain_mcp.plan.MAX_FEATURE_TILES", MAX_FEATURE_TILES * 2)
        assert cep8_cap_tag()[2] != "1000-64512"

    def test_the_advertised_maximum_bounds_real_requests(self) -> None:
        # The ceiling row is an upper bound, not a reachable quote: the mosaic
        # tile budget and the 4096 px clamp coarsen a large extent long before
        # it could deliver 1,920 megapixels.
        low, high = advertised_price_range()
        for bbox in (FUNCHAL, TWENTY_X, EIGHT_KM_SQUARE):
            for lod in ("overview", "standard"):
                assert low <= priced(bbox, lod).price_sats <= high

    def test_the_advertised_tool_is_one_this_server_exposes(
        self, context: ServiceContext
    ) -> None:
        # A cap tag naming a tool that does not exist advertises nothing. This
        # is the only cross-check that catches a rename.
        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, context)
        assert PRICED_TOOL in [tool.name for tool in asyncio.run(server.list_tools())]
        assert cep8_cap_tag()[1] == f"tool:{PRICED_TOOL}"


class TestQuoteToolShape:
    def tool(self, context: ServiceContext) -> Any:
        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, context)
        return next(
            tool for tool in asyncio.run(server.list_tools()) if tool.name == "quote_terrain"
        )

    def test_it_takes_the_same_arguments_as_the_tool_it_prices(
        self, context: ServiceContext
    ) -> None:
        schema = self.tool(context).input_schema
        assert schema["required"] == ["bbox"]
        assert sorted(schema["properties"]) == ["bbox", "lod", "texture", "texture_m_per_px"]

    def test_it_answers_with_the_price_and_the_request_it_priced(
        self, context: ServiceContext
    ) -> None:
        assert sorted(self.tool(context).output_schema["properties"]) == ["price", "request"]

    def test_it_is_announced_as_read_only_and_closed_world(
        self, context: ServiceContext
    ) -> None:
        annotations = self.tool(context).annotations
        assert annotations is not None
        assert annotations.read_only_hint is True
        assert annotations.open_world_hint is False

    def test_a_call_shows_the_work_units_behind_the_number(
        self, sealed_context: ServiceContext
    ) -> None:
        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, sealed_context)
        result = asyncio.run(
            server.call_tool("quote_terrain", {"bbox": FUNCHAL, "lod": "detail"})
        )
        price = result.structured_content["price"]
        assert price["unit"] == "sats"
        assert price["work_units"] == pytest.approx(
            work_units(price["megapixels"], price["dem_tiles"], price["feature_tiles"])
        )
        assert price["price_sats"] == price_for_work_units(price["work_units"])
        # The resolution the price was built on is the deliverable one, and it
        # is on the answer next to the number.
        assert result.structured_content["request"]["texture_m_per_px"] == 0.275

    def test_a_refused_request_surfaces_as_a_tool_error(
        self, sealed_context: ServiceContext
    ) -> None:
        from mcp.server.mcpserver.exceptions import ToolError

        server = MCPServer(name="terrain-mcp-test", version="0.0.0")
        register(server, sealed_context)
        with pytest.raises(ToolError, match="km2 ceiling"):
            asyncio.run(server.call_tool("quote_terrain", {"bbox": EUROPE}))


class TestThePriceTravelsWithTheDelivery:
    def test_the_manifest_states_what_it_cost(self, context: ServiceContext) -> None:
        manifest = generate_terrain(context, FUNCHAL, "standard")
        assert manifest.price == priced(FUNCHAL, "standard")
        assert manifest.price.price_sats >= MIN_PRICE_SATS

    def test_the_price_is_not_derived_from_the_bytes_that_happened_to_arrive(
        self, context: ServiceContext
    ) -> None:
        # Blob sizes depend on the upstream's mood; the price depends on the
        # plan. A fake upstream returning tiny payloads must not make it cheap.
        manifest = generate_terrain(context, FUNCHAL, "standard")
        assert manifest.total_bytes < 100_000
        assert manifest.price.price_sats > MIN_PRICE_SATS
