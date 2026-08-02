"""The stdio MCP server.

Keyless by design. This service signs nothing and never loads a private key:
blossom-gis is keyless too and that property is worth keeping, so announcing and
signing stay in the future gateway.

Blobs are written into the same store the blossom-gis server reads, so the URLs
in a manifest resolve immediately. Both services therefore honour the same two
environment variables:

    BLOSSOM_GIS_DATA        blob root and index (default ./.local/blossom-gis)
    BLOSSOM_GIS_BASE_URL    URL prefix in descriptors (default http://127.0.0.1:8787)

One further variable is this service's own:

    TERRAIN_MCP_BUDGET_S    wall-clock seconds one call may spend upstream
                            (default 120), shared across DEM, features and
                            texture rather than applied per tile
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from blossom_gis.db import BlobIndex
from blossom_gis.store import BlobStore
from mcp.server import MCPServer

from . import __version__
from .budget import DEFAULT_BUDGET_S
from .produce import ServiceContext
from .tools import register

DEFAULT_DATA_DIR = "./.local/blossom-gis"
DEFAULT_BASE_URL = "http://127.0.0.1:8787"

INSTRUCTIONS = (
    "Terrain source-tile production for terrCVM. `generate_terrain` returns a "
    "manifest of content-addressed Blossom blobs — DEM tiles, TFT2 feature tiles "
    "and an optional orthophoto — for a bounding box. It never returns a mesh: "
    "the client bakes one from these tiles with @terrcvm/terrain-engine. Ask for "
    "the smallest extent that answers the question; oversized requests are "
    "refused rather than quietly coarsened. `quote_terrain` prices the same "
    "arguments without producing anything, so a caller can see the cost — and "
    "the resolution actually on offer — before committing."
)


def context_from_env() -> ServiceContext:
    """Build the service context from the environment blossom-gis already uses."""
    data_dir = Path(os.environ.get("BLOSSOM_GIS_DATA", DEFAULT_DATA_DIR))
    base_url = os.environ.get("BLOSSOM_GIS_BASE_URL", DEFAULT_BASE_URL)
    return ServiceContext(
        store=BlobStore(data_dir / "blobs"),
        index=BlobIndex(data_dir / "index.sqlite"),
        base_url=base_url,
        budget_s=_budget_from_env(),
    )


def _budget_from_env() -> float:
    """The per-request wall-clock budget, refusing a value that would disable it."""
    raw = os.environ.get("TERRAIN_MCP_BUDGET_S")
    if raw is None:
        return DEFAULT_BUDGET_S
    try:
        seconds = float(raw)
    except ValueError as error:
        raise ValueError(
            f"TERRAIN_MCP_BUDGET_S must be a number of seconds, got {raw!r}"
        ) from error
    if not seconds > 0:
        raise ValueError("TERRAIN_MCP_BUDGET_S must be positive — an unbounded call is the bug")
    return seconds


def build_server(context: ServiceContext | None = None) -> MCPServer:
    """Assemble the MCP server and its single tool."""
    server = MCPServer(
        name="terrain-mcp",
        title="terrCVM terrain source tiles",
        version=__version__,
        instructions=INSTRUCTIONS,
    )
    register(server, context or context_from_env())
    return server


def main() -> None:
    """Console-script entry point: serve MCP over stdio.

    Logging goes to stderr on purpose — stdout is the protocol channel, and a
    stray line there corrupts the session.
    """
    logging.basicConfig(
        level=os.environ.get("TERRAIN_MCP_LOG_LEVEL", "INFO"),
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_server().run("stdio")


if __name__ == "__main__":
    main()
