"""`generate_terrain` — the one tool this service exposes.

It answers with a **manifest of Blossom descriptors**, never a baked GLB.

Why
---
The mesher is TypeScript (`packages/terrain-engine/src/terrain/{mesh,heightfield,
dem}.ts`). A Python port would be a third implementation of one algorithm and
would need its own cross-language conformance suite — this repo has been bitten
by exactly that twice already, once by a one-directional TFT2 codec pin and once
by two geo-protocol implementations that took three adversarial rounds to agree.
`docs/ARCHITECTURE.md` rules on the artifact directly: GLB is a *baked* delivery
with a fixed LOD, materials and origin, and two GLBs do not compose into a larger
scene, so the corpus is source tiles and the bake happens per delivery.

What this service sells is what a sandboxed browser cannot do for itself:
orthophoto at a resolution and an extent that a single-file bundle and a 512 KB
quota cannot reach, and DEM at zooms the client will not fetch on its own. All of
that is source-tile production, which Python already does here.

LOD mapping
-----------
`lod` is a named tier, not a raw zoom, so a caller never has to guess a slippy
number. Each tier resolves to one DEM zoom, one feature-tile zoom and a default
orthophoto target (pinned in `tests/test_plan.py`):

===========  ==========  ==============  ====================
lod          DEM zoom    feature zoom    default texture
===========  ==========  ==============  ====================
overview     z11         z12             2.0 m/px
standard     z12         z13             0.5 m/px
detail       z13         z14             0.25 m/px
===========  ==========  ==============  ====================

DEM stops at z13 because Terrarium carries no new elevation above it; feature
tiles sit one zoom deeper because a smaller vector tile is what keeps an Overpass
answer inside the upstream's element cap. Both derivations live in
`terrain_mcp.plan`.

Ceilings
--------
Refused before any fetching, with a named error: 120 km² of ground, 64 DEM tiles,
16 feature tiles. Fail closed — there is no payment gate in front of this yet,
and a silently coarsened answer looks exactly like an honoured one.

Resolution
----------
`texture_m_per_px` in the answer is what was *delivered*, not what was asked for.
The mosaic tile budget, the source's max zoom and the WMS side clamp each cap the
achievable resolution, and the cap is resolved during planning, so a caller sees
`texture_m_per_px_requested`, `texture_m_per_px` and `texture_downgraded` before
paying rather than after. A bake that comes back at any other resolution fails
the request.

Price
-----
Every manifest carries the CEP-8 price of the delivery, in sats, computed from
the resolved plan — achieved resolution, actual tile counts — by
`terrain_mcp.plan.price_plan`. `quote_terrain` returns the same number for the
same arguments without fetching anything, which is the seam the gateway's
`payment_required` needs. Nothing here settles a payment.

Time
----
One wall-clock budget covers all three stages together, checked between tiles.
`notifications/progress` carries one unit per source tile, so a long call is
visibly alive; exhausting the budget is a named error, never a short manifest.
"""

from __future__ import annotations

import functools
import logging
from collections.abc import Sequence
from typing import Annotated

import anyio
import anyio.from_thread
import anyio.to_thread
from mcp.server import MCPServer
from mcp.server.mcpserver import Context
from mcp.types import ToolAnnotations
from pydantic import Field

from ..manifest import TerrainManifest
from ..plan import DEFAULT_LOD, Lod, parse_bbox, plan_terrain
from ..produce import ProgressReporter, ServiceContext, produce_terrain

logger = logging.getLogger(__name__)

TOOL_DESCRIPTION = (
    "Produce the terrain source tiles for a bounding box and return them as a "
    "manifest of content-addressed Blossom descriptors: Terrarium DEM tiles, "
    "TFT2 vector feature tiles and, optionally, one orthophoto baked to the "
    "exact extent. This does NOT return a mesh or a GLB — the client assembles "
    "the terrain from these source tiles with @terrcvm/terrain-engine, which is "
    "what lets one corpus serve every level of detail. Requests larger than "
    "120 km2, 64 DEM tiles or 16 feature tiles are refused before anything is "
    "fetched. The manifest reports the orthophoto resolution actually delivered "
    "alongside the one requested: a large extent is capped by the mosaic tile "
    "budget, and the downgrade is stated rather than hidden. Every call runs "
    "under one wall-clock budget and reports progress per source tile. The "
    "answer carries the price of the delivery in sats; call quote_terrain "
    "first for the same number without producing anything."
)


def generate_terrain(
    context: ServiceContext,
    bbox: Sequence[float],
    lod: str = DEFAULT_LOD,
    *,
    texture: bool = True,
    texture_m_per_px: float | None = None,
    progress: ProgressReporter | None = None,
) -> TerrainManifest:
    """Plan a request, refuse it if oversized, then produce and describe its tiles."""
    plan = plan_terrain(
        parse_bbox(bbox),
        lod,
        texture=texture,
        texture_m_per_px=texture_m_per_px,
    )
    return produce_terrain(plan, context, progress)


def _progress_bridge(ctx: Context) -> ProgressReporter:
    """Turn `produce`'s synchronous reporter into `notifications/progress`.

    `Context.report_progress` is a coroutine and the production code is a worker
    thread, so the call is marshalled back onto the event loop. It is a no-op
    when the caller sent no progress token, and it must never be able to fail a
    request that is otherwise succeeding — telemetry is not the deliverable.
    """

    async def send(done: float, total: float, message: str) -> None:
        try:
            await ctx.report_progress(done, total, message)
        except Exception:
            logger.debug("progress notification dropped", exc_info=True)

    def report(done: float, total: float, message: str) -> None:
        try:
            anyio.from_thread.run(send, done, total, message)
        except Exception:
            logger.debug("progress notification dropped", exc_info=True)

    return report


def register(server: MCPServer, context: ServiceContext) -> None:
    """Register `generate_terrain` on an MCP server, bound to one service context."""

    @server.tool(
        name="generate_terrain",
        title="Generate terrain source tiles",
        description=TOOL_DESCRIPTION,
        annotations=ToolAnnotations(
            read_only_hint=False,
            # Blobs are content-addressed and indexed by tile: producing the same
            # extent twice replaces nothing and destroys nothing.
            destructive_hint=False,
            idempotent_hint=True,
            open_world_hint=True,
        ),
    )
    async def _generate_terrain(
        ctx: Context,
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
            Field(description="Bake an orthophoto for the extent as well as the terrain data."),
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
    ) -> TerrainManifest:
        # The production path is blocking I/O end to end (urllib, PIL, SQLite),
        # so it runs on a worker thread. That is also what makes progress
        # visible: on the event loop the notifications could not be flushed
        # until the whole bake had finished, which is precisely when they stop
        # being useful.
        return await anyio.to_thread.run_sync(
            functools.partial(
                generate_terrain,
                context,
                bbox,
                lod,
                texture=texture,
                texture_m_per_px=texture_m_per_px,
                progress=_progress_bridge(ctx),
            )
        )
