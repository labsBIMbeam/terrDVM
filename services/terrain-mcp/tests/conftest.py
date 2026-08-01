"""Test helpers.

Upstreams are injected, never monkeypatched: every fake here is handed to the
`ServiceContext` under test, so a test that forgets one fails with a socket
error rather than silently reaching the internet.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from blossom_gis.crawl import RateLimiter, Tile
from blossom_gis.db import BlobIndex
from blossom_gis.featuretile import Building, FeatureTile
from blossom_gis.geo import BBox
from blossom_gis.store import BlobStore
from blossom_gis.texture import SOURCES, Texture, plan_texture
from PIL import Image

from terrain_mcp.plan import TEXTURE_MAX_TILES
from terrain_mcp.produce import ServiceContext


class CountingLimiter(RateLimiter):
    """A rate limiter that never sleeps but records that it was consulted."""

    def __init__(self) -> None:
        super().__init__(min_interval_s=0.0)
        self.waits = 0

    def wait(self) -> None:
        self.waits += 1
        super().wait()


class FakeUpstream:
    """Counts calls so a test can prove a fetch did — or did not — happen."""

    def __init__(self) -> None:
        self.dem_calls: list[Tile] = []
        self.feature_calls: list[Tile] = []
        self.texture_calls: list[tuple[BBox, str, float]] = []
        self.timeouts: list[float] = []

    def dem(self, tile: Tile, timeout_s: float = 0.0) -> bytes:
        """Distinct bytes per tile, so distinct tiles get distinct hashes."""
        self.dem_calls.append(tile)
        self.timeouts.append(timeout_s)
        return f"terrarium:{tile.z}/{tile.x}/{tile.y}".encode()

    def features(self, tile: Tile, timeout_s: float = 0.0) -> FeatureTile:
        self.feature_calls.append(tile)
        self.timeouts.append(timeout_s)
        west, south, east, north = _bounds(tile)
        ring = [
            (west + (east - west) * 0.4, south + (north - south) * 0.4),
            (west + (east - west) * 0.6, south + (north - south) * 0.4),
            (west + (east - west) * 0.6, south + (north - south) * 0.6),
        ]
        return FeatureTile(
            z=tile.z, x=tile.x, y=tile.y, buildings=[Building(ring=ring, height_m=9.0)]
        )

    def texture(self, bbox: BBox, region: str, target: float, **_: object) -> Texture:
        """A faithful stand-in: it downgrades exactly as the real backend does.

        A fake that echoed `target` back as the delivered resolution would have
        agreed with the bug this suite exists to pin — the whole defect was a
        requested number presented as a delivered one. `plan_texture` is the
        same module's own forecast of its own caps, so the fake coarsens where
        the real bake coarsens.
        """
        self.texture_calls.append((bbox, region, target))
        forecast = plan_texture(bbox, region, target, max_tiles=TEXTURE_MAX_TILES)
        return Texture(
            image=Image.new("RGB", (64, 48), (90, 110, 70)),
            source=SOURCES[forecast["source"]["id"]],
            bbox=bbox,
            metres_per_pixel=forecast["m_per_px"],
            requests=1,
            warnings=["fake upstream"],
        )


def _bounds(tile: Tile) -> tuple[float, float, float, float]:
    from blossom_gis.geo import tile_bbox

    box = tile_bbox(tile.z, tile.x, tile.y)
    return box.west, box.south, box.east, box.north


class FakeClock:
    """A monotonic clock a test drives by hand.

    The budget has to be exhaustible without sleeping: a suite that proved the
    two-hour case by waiting two hours would never be run.
    """

    def __init__(self, start: float = 1_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def exploding(reason: str) -> Callable[..., object]:
    """A fetcher that must never be called."""

    def _fetch(*_args: object, **_kwargs: object) -> object:
        raise AssertionError(f"upstream was contacted but should not have been: {reason}")

    return _fetch


@pytest.fixture
def upstream() -> FakeUpstream:
    return FakeUpstream()


@pytest.fixture
def context(tmp_path: Path, upstream: FakeUpstream) -> ServiceContext:
    """A service wired to a throwaway store, index and fake upstreams."""
    return ServiceContext(
        store=BlobStore(tmp_path / "blobs"),
        index=BlobIndex(tmp_path / "index.sqlite"),
        base_url="https://blobs.example/",
        dem_fetcher=upstream.dem,
        feature_fetcher=upstream.features,
        texture_fetcher=upstream.texture,
        texture_http_fetcher=exploding("texture http"),
        clock=lambda: 1_700_000_000,
        feature_limiter=CountingLimiter(),
        raster_limiter=CountingLimiter(),
    )


@pytest.fixture
def sealed_context(tmp_path: Path) -> ServiceContext:
    """A service whose every upstream fails the test if it is reached."""
    return ServiceContext(
        store=BlobStore(tmp_path / "blobs"),
        index=BlobIndex(tmp_path / "index.sqlite"),
        base_url="https://blobs.example/",
        dem_fetcher=exploding("dem"),
        feature_fetcher=exploding("features"),
        texture_fetcher=exploding("texture"),
        texture_http_fetcher=exploding("texture http"),
        clock=lambda: 1_700_000_000,
        feature_limiter=CountingLimiter(),
        raster_limiter=CountingLimiter(),
    )
