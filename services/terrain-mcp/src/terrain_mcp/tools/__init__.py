"""Tools exposed over MCP: one that produces terrain, one that prices it."""

from __future__ import annotations

from mcp.server import MCPServer

from ..produce import ServiceContext
from .generate_terrain import generate_terrain
from .generate_terrain import register as register_generate_terrain
from .quote_terrain import quote_terrain
from .quote_terrain import register as register_quote_terrain

__all__ = ["generate_terrain", "quote_terrain", "register"]


def register(server: MCPServer, context: ServiceContext) -> None:
    """Register every tool this service exposes, bound to one service context."""
    register_generate_terrain(server, context)
    # Deliberately not handed the context. The quote is arithmetic over a plan,
    # and a tool with no store, no index and no fetcher cannot fetch, cannot
    # store, and cannot price differently depending on what is already cached.
    register_quote_terrain(server)
