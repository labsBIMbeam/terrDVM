from __future__ import annotations

import asyncio
from pathlib import Path

from terrain_mcp import __version__
from terrain_mcp.produce import ServiceContext
from terrain_mcp.server import build_server, context_from_env


class TestServerAssembly:
    def test_the_server_names_itself_and_its_version(self, context: ServiceContext) -> None:
        server = build_server(context)
        assert server.name == "terrain-mcp"
        assert server.version == __version__

    def test_the_server_carries_instructions_that_say_what_it_returns(
        self, context: ServiceContext
    ) -> None:
        server = build_server(context)
        assert "never returns a mesh" in (server.instructions or "")

    def test_the_assembled_server_exposes_the_tool_and_its_quote(
        self, context: ServiceContext
    ) -> None:
        tools = asyncio.run(build_server(context).list_tools())
        assert sorted(tool.name for tool in tools) == ["generate_terrain", "quote_terrain"]


class TestEnvironmentWiring:
    def test_it_writes_into_the_store_the_blob_server_reads(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        # Both services honour the same two variables so a manifest's URLs
        # resolve against a blossom-gis instance without extra configuration.
        monkeypatch.setenv("BLOSSOM_GIS_DATA", str(tmp_path / "data"))
        monkeypatch.setenv("BLOSSOM_GIS_BASE_URL", "https://blobs.example")
        context = context_from_env()
        assert context.store.root == tmp_path / "data" / "blobs"
        assert context.base_url == "https://blobs.example"
        assert (tmp_path / "data" / "index.sqlite").exists()
