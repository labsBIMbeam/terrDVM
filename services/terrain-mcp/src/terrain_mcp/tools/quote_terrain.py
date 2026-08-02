"""`quote_terrain` — what a request would cost, before any of it happens.

CEP-8's transparent flow is plan, quote, `payment_required`, payment, produce.
This tool is the quote: the same arguments `generate_terrain` takes, answered
with the price and the resolved request it was computed from, and not one
upstream byte fetched.

It takes no `ServiceContext` on purpose. A tool that is never handed the store,
the index or a fetcher cannot fetch, cannot store, and cannot look at what is
already cached — which is also why two identical requests quote identically on
a cold store and a warm one. `terrain_mcp.plan` is pure arithmetic, so the whole
answer is computable from the arguments alone.

The price is the delivered one: the resolved plan carries the resolution a bake
can actually achieve, so a quote for an extent the caps will coarsen is lower
than the same request over a smaller extent, and never higher than what arrives.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated

from mcp.server import MCPServer
from mcp.types import ToolAnnotations
from pydantic import Field

from ..manifest import ResolvedRequest, TerrainQuote
from ..plan import DEFAULT_LOD, Lod, parse_bbox, plan_terrain, price_plan

TOOL_DESCRIPTION = (
    "Price a generate_terrain request without producing it. Returns the sats "
    "price, the work units behind it — delivered megapixels, DEM tiles and "
    "feature tiles — and the resolved request the price was computed from, "
    "including the orthophoto resolution that can actually be delivered for "
    "this extent. Nothing is fetched, stored or charged. A request that would "
    "be refused on the area or tile ceilings is refused here too, with the "
    "same error, so a caller learns that before paying rather than after. The "
    "same arguments given to generate_terrain produce exactly this price."
)


def quote_terrain(
    bbox: Sequence[float],
    lod: str = DEFAULT_LOD,
    *,
    texture: bool = True,
    texture_m_per_px: float | None = None,
) -> TerrainQuote:
    """Resolve a request and price it, without producing anything."""
    plan = plan_terrain(
        parse_bbox(bbox),
        lod,
        texture=texture,
        texture_m_per_px=texture_m_per_px,
    )
    return TerrainQuote(request=ResolvedRequest.from_plan(plan), price=price_plan(plan))


def register(server: MCPServer) -> None:
    """Register `quote_terrain` on an MCP server. No context: it has no I/O."""

    @server.tool(
        name="quote_terrain",
        title="Quote a terrain request",
        description=TOOL_DESCRIPTION,
        annotations=ToolAnnotations(
            read_only_hint=True,
            destructive_hint=False,
            idempotent_hint=True,
            # Closed world, and that is the point of the tool: a quote reaches
            # no upstream, so it can be asked freely and cannot be a probe.
            open_world_hint=False,
        ),
    )
    async def _quote_terrain(
        bbox: Annotated[
            list[float],
            Field(
                description=(
                    "Extent as four EPSG:4326 degrees: west, south, east, north. "
                    "Must satisfy west < east and south < north."
                ),
                min_length=4,
                max_length=4,
            ),
        ],
        lod: Annotated[
            Lod,
            Field(
                description=(
                    "Detail tier. overview = DEM z11 / features z12 / 2.0 m/px imagery; "
                    "standard = z12 / z13 / 0.5 m/px; detail = z13 / z14 / 0.25 m/px."
                )
            ),
        ] = DEFAULT_LOD,
        texture: Annotated[
            bool,
            Field(description="Price an orthophoto for the extent as well as the terrain data."),
        ] = True,
        texture_m_per_px: Annotated[
            float | None,
            Field(
                description=(
                    "Target orthophoto resolution in metres per pixel, 0.05 to 10. "
                    "Defaults to the lod's tier value. Ignored when texture is false."
                ),
                gt=0,
            ),
        ] = None,
    ) -> TerrainQuote:
        # Straight on the event loop, unlike `generate_terrain`: this is a few
        # hundred nanoseconds of arithmetic with no blocking call in it.
        return quote_terrain(bbox, lod, texture=texture, texture_m_per_px=texture_m_per_px)
