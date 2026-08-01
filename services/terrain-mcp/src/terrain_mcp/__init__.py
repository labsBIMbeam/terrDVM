"""terrain-mcp — an MCP server that produces terrain *source tiles*, not meshes.

Keyless by design: nothing here holds or uses a private key. Signing and
announcing belong to the future gateway; this service only writes
content-addressed blobs and describes them.
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
