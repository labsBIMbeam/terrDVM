from __future__ import annotations

from pathlib import Path

import pytest

from blossom_gis.crawl import (
    KINDS,
    MAX_ATTEMPTS,
    CrawlQueue,
    RateLimiter,
    Tile,
    overpass_query,
    parse_overpass,
    raster_url,
)
from blossom_gis.db import BlobIndex
from blossom_gis.featuretile import decode_feature_tile
from blossom_gis.geo import BBox
from blossom_gis.store import BlobStore

MADEIRA = BBox(west=-17.32, south=32.35, east=-16.24, north=33.15)
TILE = Tile(region="madeira", z=13, x=3855, y=3306)


@pytest.fixture
def queue(tmp_path: Path) -> CrawlQueue:
    q = CrawlQueue(tmp_path / "crawl.sqlite")
    yield q
    q.close()


class TestQueue:
    def test_seeds_a_region_and_is_idempotent(self, queue: CrawlQueue) -> None:
        first = queue.seed("madeira", MADEIRA, 12, ("features",))
        assert first > 0
        assert queue.progress("madeira")["total"] == first

        # Re-seeding must not duplicate rows or reset progress.
        queue.seed("madeira", MADEIRA, 12, ("features",))
        assert queue.progress("madeira")["total"] == first

    def test_claims_bounded_work(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 11, ("features",))
        assert len(queue.claim("madeira", 3)) == 3
        assert len(queue.claim("madeira", 1000)) <= queue.progress("madeira")["total"]

    def test_done_tiles_are_not_reclaimed(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 11, ("features",))
        tile = queue.claim("madeira", 1)[0]
        queue.mark_done(tile, sha256="a" * 64, size=10, counts={"buildings": 1})

        remaining = queue.claim("madeira", 1000)
        assert tile not in remaining
        assert queue.progress("madeira")["done"] == 1

    def test_failures_retry_until_exhausted(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 11, ("features",))
        tile = queue.claim("madeira", 1)[0]

        for _ in range(MAX_ATTEMPTS):
            assert tile in queue.claim("madeira", 1000)
            queue.mark_failed(tile, "upstream 429")

        # Past the attempt ceiling the tile stops being handed out, so one bad
        # tile can never block the queue forever.
        assert tile not in queue.claim("madeira", 1000)
        assert queue.progress("madeira")["exhausted"] == 1

    def test_regions_are_isolated(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 10, ("features",))
        queue.seed(
            "south-tyrol", BBox(west=10.38, south=46.21, east=12.48, north=47.10), 10, ("features",)
        )
        assert queue.claim("madeira", 100)[0].region == "madeira"
        assert queue.progress("south-tyrol")["total"] > 0


class TestOverpassParsing:
    def test_query_covers_all_four_layers(self) -> None:
        query = overpass_query(MADEIRA, 500)
        for tag in ('way["building"]', 'way["highway"]', 'way["landuse"]', 'way["natural"]'):
            assert tag in query
        assert "out geom 500;" in query

    def test_splits_elements_into_layers(self) -> None:
        tile = parse_overpass(
            {
                "elements": [
                    {
                        "type": "way",
                        "tags": {"building": "yes", "building:levels": "5"},
                        "geometry": [
                            {"lat": 32.65, "lon": -16.92},
                            {"lat": 32.65, "lon": -16.919},
                            {"lat": 32.651, "lon": -16.919},
                        ],
                    },
                    {
                        "type": "way",
                        "tags": {"highway": "secondary_link"},
                        "geometry": [
                            {"lat": 32.65, "lon": -16.92},
                            {"lat": 32.66, "lon": -16.91},
                        ],
                    },
                    {
                        "type": "way",
                        "tags": {"natural": "wood"},
                        "geometry": [
                            {"lat": 32.65, "lon": -16.92},
                            {"lat": 32.66, "lon": -16.91},
                            {"lat": 32.67, "lon": -16.93},
                        ],
                    },
                    {"type": "node", "tags": {"building": "yes"}},
                ]
            },
            TILE,
        )
        assert len(tile.buildings) == 1
        assert tile.buildings[0].height_m == 15.0
        assert len(tile.roads) == 1
        assert tile.roads[0].road_class == "secondary"
        assert len(tile.landuse) == 1
        assert tile.landuse[0].landuse_class == "forest"

    def test_ignores_unusable_geometry(self) -> None:
        tile = parse_overpass(
            {
                "elements": [
                    {
                        "type": "way",
                        "tags": {"building": "yes"},
                        "geometry": [{"lat": 1, "lon": 1}],
                    },
                    {"type": "way", "tags": {"highway": "bus_stop"}, "geometry": []},
                    {"type": "way", "tags": {}, "geometry": []},
                ]
            },
            TILE,
        )
        assert tile.buildings == [] and tile.roads == [] and tile.landuse == []

    def test_handles_an_empty_response(self) -> None:
        tile = parse_overpass({"elements": []}, TILE)
        assert (tile.z, tile.x, tile.y) == (TILE.z, TILE.x, TILE.y)


class TestRun:
    def test_stores_encoded_tiles_and_records_progress(
        self, queue: CrawlQueue, tmp_path: Path
    ) -> None:
        from blossom_gis.crawl import run

        queue.seed("madeira", MADEIRA, 11, ("features",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")

        def fake_fetch(tile: Tile):
            return parse_overpass(
                {
                    "elements": [
                        {
                            "type": "way",
                            "tags": {"building": "yes"},
                            "geometry": [
                                {"lat": 32.70, "lon": -17.00},
                                {"lat": 32.70, "lon": -16.99},
                                {"lat": 32.71, "lon": -16.99},
                            ],
                        }
                    ]
                },
                tile,
            )

        class NoWait(RateLimiter):
            def wait(self) -> None:
                return None

            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 2

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=2, limiter=NoWait(), raster_limiter=NoWait(),
                fetcher=fake_fetch, raster_fetcher=lambda tile: b"PNG",
            )
        )

        assert len(records) == 2
        for record in records:
            assert record["buildings"] == 1
            # The stored bytes must decode back through the shared codec.
            decoded = decode_feature_tile(store.read(record["sha256"]))
            assert len(decoded.buildings) == 1

        assert queue.progress("madeira")["done"] == 2
        index.close()

    def test_a_failing_fetch_does_not_stop_the_run(
        self, queue: CrawlQueue, tmp_path: Path
    ) -> None:
        from blossom_gis.crawl import run

        queue.seed("madeira", MADEIRA, 11, ("features",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")
        calls = {"n": 0}

        def flaky(tile: Tile):
            calls["n"] += 1
            if calls["n"] == 1:
                raise TimeoutError("upstream timed out")
            return parse_overpass({"elements": []}, tile)

        class NoWait(RateLimiter):
            def wait(self) -> None:
                return None

            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 2

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=3, limiter=NoWait(), raster_limiter=NoWait(),
                fetcher=flaky, raster_fetcher=lambda tile: b"PNG",
            )
        )

        assert "error" in records[0]
        assert queue.progress("madeira")["failed"] == 1
        assert queue.progress("madeira")["done"] == 2
        index.close()

    def test_stops_when_upstream_has_no_free_slot(self, queue: CrawlQueue, tmp_path: Path) -> None:
        from blossom_gis.crawl import run

        queue.seed("madeira", MADEIRA, 11, ("features",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")

        class Exhausted(RateLimiter):
            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 0

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=5, limiter=Exhausted(), raster_limiter=Exhausted(),
                fetcher=lambda tile: pytest.fail("must not fetch without a slot"),
                raster_fetcher=lambda tile: pytest.fail("no raster expected here"),
            )
        )

        assert len(records) == 1 and "skipped" in records[0]
        assert queue.progress("madeira").get("done", 0) == 0
        index.close()


class TestRateLimiter:
    def test_spaces_requests(self) -> None:
        import time

        limiter = RateLimiter(min_interval_s=0.05)
        limiter.wait()
        start = time.monotonic()
        limiter.wait()
        assert time.monotonic() - start >= 0.04


class TestRasterLayers:
    def test_seeding_all_kinds_multiplies_the_queue(self, queue: CrawlQueue) -> None:
        features_only = queue.seed("madeira", MADEIRA, 11, ("features",))
        queue.seed("madeira", MADEIRA, 11, KINDS)
        assert queue.progress("madeira")["total"] == features_only * len(KINDS)

    def test_terrain_and_imagery_are_claimed_before_features(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 11, KINDS)
        claimed = queue.claim("madeira", 1000)
        kinds_in_order = [item.kind for item in claimed]

        # Every dem precedes every ortho, and every ortho precedes every feature.
        assert kinds_in_order == sorted(
            kinds_in_order, key=lambda k: {"dem": 0, "ortho": 1, "features": 2}[k]
        )
        assert kinds_in_order[0] == "dem"

    def test_claim_can_be_narrowed_to_one_kind(self, queue: CrawlQueue) -> None:
        queue.seed("madeira", MADEIRA, 11, KINDS)
        assert {item.kind for item in queue.claim("madeira", 50, kind="ortho")} == {"ortho"}

    def test_rejects_an_unknown_kind_at_seed_time(self, queue: CrawlQueue) -> None:
        with pytest.raises(ValueError, match="unknown crawl kinds"):
            queue.seed("madeira", MADEIRA, 11, ("lidar",))

    def test_raster_urls_use_each_provider_axis_order(self) -> None:
        """Terrarium is z/x/y; ArcGIS is z/y/x. Swapping them silently returns
        the wrong place on Earth, so pin both."""
        dem = raster_url(Tile(region="madeira", z=12, x=1851, y=1650, kind="dem"))
        assert dem.endswith("/terrarium/12/1851/1650.png")

        ortho = raster_url(Tile(region="madeira", z=12, x=1851, y=1650, kind="ortho"))
        assert ortho.endswith("/MapServer/tile/12/1650/1851")

    def test_raster_url_refuses_a_vector_kind(self) -> None:
        with pytest.raises(ValueError, match="not a raster kind"):
            raster_url(Tile(region="madeira", z=12, x=1, y=1, kind="features"))

    def test_raster_bytes_are_stored_verbatim(self, queue: CrawlQueue, tmp_path: Path) -> None:
        from blossom_gis.crawl import run

        queue.seed("madeira", MADEIRA, 11, ("dem",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")
        payload = b"\x89PNG\r\n\x1a\n fake elevation raster"

        class NoWait(RateLimiter):
            def wait(self) -> None:
                return None

            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 2

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=2, limiter=NoWait(), raster_limiter=NoWait(),
                fetcher=lambda tile: pytest.fail("no vector fetch expected"),
                raster_fetcher=lambda tile: payload,
            )
        )

        assert len(records) == 2
        for record in records:
            # Untouched: a raster tile is stored exactly as the upstream sent it.
            assert store.read(record["sha256"]) == payload
            assert "buildings" not in record

        stored = index.get(records[0]["sha256"])
        assert stored is not None and stored.media_type == "image/png"
        assert stored.uploaded_by == "crawler:madeira:dem"
        index.close()

    def test_rasters_do_not_wait_on_the_overpass_slot(
        self, queue: CrawlQueue, tmp_path: Path
    ) -> None:
        """Gating imagery on a vector-API quota would stall the priority layers."""
        from blossom_gis.crawl import run

        queue.seed("madeira", MADEIRA, 11, ("dem",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")

        class NoSlots(RateLimiter):
            def wait(self) -> None:
                return None

            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 0

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=3, limiter=NoSlots(), raster_limiter=NoSlots(),
                fetcher=lambda tile: pytest.fail("no vector fetch expected"),
                raster_fetcher=lambda tile: b"PNG",
            )
        )

        assert len(records) == 3
        assert all("sha256" in record for record in records)
        index.close()


class TestTruncationIsFailure:
    """Overpass `out <n>` is a hard cap that returns no `remark`.

    A truncated tile is indistinguishable from a complete one downstream — same
    z/x/y, plausible size, valid TFT2 — so if it were marked done it would be
    served forever as the truth about that place. Measured on 14/7422/6618
    (Funchal): the old default cap of 5000 discarded 3,830 of 8,830 ways, 43%
    of the tile, silently.
    """

    def _fake_upstream(self, element_count: int, monkeypatch) -> None:
        """Stand in for urlopen with a response holding exactly N ways."""
        import json as json_module
        from contextlib import contextmanager

        from blossom_gis import crawl as crawl_module

        ring = [
            {"lat": 32.65, "lon": -16.92},
            {"lat": 32.65, "lon": -16.919},
            {"lat": 32.651, "lon": -16.919},
        ]
        payload = json_module.dumps(
            {
                "elements": [
                    {"type": "way", "tags": {"building": "yes"}, "geometry": ring}
                    for _ in range(element_count)
                ]
            }
        ).encode()

        class _Response:
            def read(self) -> bytes:
                return payload

        @contextmanager
        def fake_urlopen(request, timeout=None):
            yield _Response()

        monkeypatch.setattr(crawl_module.urllib.request, "urlopen", fake_urlopen)

    def test_hitting_the_cap_raises_instead_of_returning_a_partial_tile(
        self, monkeypatch
    ) -> None:
        from blossom_gis.crawl import TileTruncatedError, fetch_tile

        self._fake_upstream(50, monkeypatch)
        with pytest.raises(TileTruncatedError) as excinfo:
            fetch_tile(TILE, limit=50)
        assert "50" in str(excinfo.value)

    def test_one_element_under_the_cap_is_a_complete_tile(self, monkeypatch) -> None:
        from blossom_gis.crawl import fetch_tile

        self._fake_upstream(49, monkeypatch)
        tile = fetch_tile(TILE, limit=50)
        assert len(tile.buildings) == 49

    def test_a_truncated_tile_is_never_marked_done(
        self, queue: CrawlQueue, tmp_path: Path, monkeypatch
    ) -> None:
        """The whole point: fail closed, so the crawl reports the gap."""
        from blossom_gis.crawl import fetch_tile, run

        self._fake_upstream(50, monkeypatch)
        queue.seed("madeira", MADEIRA, 11, ("features",))
        store = BlobStore(tmp_path / "blobs")
        index = BlobIndex(tmp_path / "index.sqlite")

        class NoWait(RateLimiter):
            def wait(self) -> None:
                return None

            @staticmethod
            def available_slots(timeout_s: float = 15) -> int | None:
                return 2

        records = list(
            run(
                queue=queue, store=store, index=index, region="madeira",
                max_tiles=2, limiter=NoWait(), raster_limiter=NoWait(),
                fetcher=lambda tile: fetch_tile(tile, limit=50),
                raster_fetcher=lambda tile: pytest.fail("no raster expected here"),
            )
        )

        assert len(records) == 2
        assert all("error" in record and "sha256" not in record for record in records)
        progress = queue.progress("madeira")
        assert progress.get("done", 0) == 0
        assert progress["failed"] == 2
        # Nothing reached the corpus either — a partial tile must not be stored.
        assert not any((tmp_path / "blobs").rglob("*")) or store.read("0" * 64) is None
        index.close()

    def test_the_default_cap_is_above_a_dense_city_tile(self) -> None:
        """14/7422/6618 holds 8,830 ways. A default below that truncates Funchal."""
        import inspect

        from blossom_gis.crawl import fetch_tile

        default = inspect.signature(fetch_tile).parameters["limit"].default
        assert default > 8830
