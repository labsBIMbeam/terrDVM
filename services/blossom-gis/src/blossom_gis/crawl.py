"""Resumable, rate-limited tile crawler.

Design constraints, in order of importance:

1. **Never overrun the upstream.** Overpass publishes a slot count; the crawler
   asks before it fetches and waits when there is nothing free. A public
   endpoint that bans us is worse than a slow crawl.
2. **Bounded work per run.** Every invocation processes at most `max_tiles`, so
   a cron tick has a predictable ceiling and cannot hang a scheduler.
3. **Resumable.** Progress lives in SQLite, not in memory. Kill it at any point
   and the next run continues where it stopped.
4. **Idempotent.** A tile's identity is (region, z, x, y); re-crawling replaces
   its row and, because storage is content-addressed, an unchanged tile costs
   no new blob.
"""

from __future__ import annotations

import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .featuretile import Building, FeatureTile, Landuse, Road, encode_feature_tile
from .geo import BBox, tile_bbox, tile_for_point

OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
OVERPASS_STATUS = "https://overpass-api.de/api/status"
USER_AGENT = "terrCVM-crawler/0.1 (+https://github.com/labsBIMbeam/terrCVM)"

#: Terrarium-encoded elevation, AWS Open Data. No key, no published quota.
DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

#: Esri World Imagery. Note the ArcGIS {z}/{y}/{x} axis order.
ORTHO_URL = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
)

#: Politeness floor between upstream requests, seconds.
MIN_REQUEST_INTERVAL_S = 4.0

#: Raster endpoints are CDN-backed and tolerate a much tighter cadence than Overpass.
RASTER_REQUEST_INTERVAL_S = 0.4

#: Give up on a tile after this many failed attempts.
MAX_ATTEMPTS = 4

#: Lower sorts first. Terrain and imagery are the demo-critical layers, so they
#: drain before vector features — and they are also the cheap ones to fetch.
KIND_PRIORITY = {"dem": 0, "ortho": 1, "features": 2}
KINDS = tuple(KIND_PRIORITY)

#: Only Overpass publishes slots and needs the slow lane.
SLOT_LIMITED_KINDS = frozenset({"features"})

MEDIA_TYPES = {
    "dem": "image/png",
    "ortho": "image/jpeg",
    "features": "application/vnd.terrcvm.tft",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS crawl_items (
    region      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    z           INTEGER NOT NULL,
    x           INTEGER NOT NULL,
    y           INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    sha256      TEXT,
    bytes       INTEGER,
    buildings   INTEGER,
    roads       INTEGER,
    landuse     INTEGER,
    updated_at  INTEGER,
    PRIMARY KEY (region, kind, z, x, y)
);
CREATE INDEX IF NOT EXISTS idx_crawl_claim
    ON crawl_items (region, status, attempts, kind);
"""


@dataclass(frozen=True)
class Tile:
    region: str
    z: int
    x: int
    y: int
    kind: str = "features"


class CrawlQueue:
    def __init__(self, path: Path | str) -> None:
        self._connection = sqlite3.connect(str(path))
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.executescript(SCHEMA)
        self._migrate_legacy()
        self._connection.commit()

    def _migrate_legacy(self) -> None:
        """Carry rows over from the pre-kind schema, if one is present.

        The old table had no `kind` column; everything it held was vector
        features, so that is what its rows become.
        """
        legacy = self._connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='crawl_tiles'"
        ).fetchone()
        if not legacy:
            return
        self._connection.execute(
            """
            INSERT OR IGNORE INTO crawl_items
                (region, kind, z, x, y, status, attempts, last_error,
                 sha256, bytes, buildings, roads, landuse, updated_at)
            SELECT region, 'features', z, x, y, status, attempts, last_error,
                   sha256, bytes, buildings, roads, landuse, updated_at
              FROM crawl_tiles
            """
        )
        self._connection.execute("DROP TABLE crawl_tiles")

    def close(self) -> None:
        self._connection.close()

    def seed(
        self,
        region: str,
        bounds: BBox,
        zoom: int,
        kinds: tuple[str, ...] = KINDS,
    ) -> int:
        """Enqueue every (kind, tile) covering `bounds`. Existing rows are left alone."""
        unknown = set(kinds) - set(KINDS)
        if unknown:
            raise ValueError(f"unknown crawl kinds: {sorted(unknown)}")

        min_x, min_y = tile_for_point(bounds.north, bounds.west, zoom)
        max_x, max_y = tile_for_point(bounds.south, bounds.east, zoom)
        rows = [
            (region, kind, zoom, x, y)
            for kind in kinds
            for x in range(min(min_x, max_x), max(min_x, max_x) + 1)
            for y in range(min(min_y, max_y), max(min_y, max_y) + 1)
        ]
        self._connection.executemany(
            "INSERT OR IGNORE INTO crawl_items (region, kind, z, x, y) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
        self._connection.commit()
        return len(rows)

    def claim(self, region: str, limit: int, kind: str | None = None) -> list[Tile]:
        """Next items to process, terrain and imagery first."""
        clause = "AND kind = ?" if kind else ""
        params: list = [region, MAX_ATTEMPTS]
        if kind:
            params.append(kind)
        params.append(limit)
        rows = self._connection.execute(
            f"""
            SELECT region, kind, z, x, y FROM crawl_items
             WHERE region = ? AND status IN ('pending', 'failed') AND attempts < ?
                   {clause}
             ORDER BY CASE kind WHEN 'dem' THEN 0 WHEN 'ortho' THEN 1 ELSE 2 END ASC,
                      attempts ASC, y ASC, x ASC
             LIMIT ?
            """,
            params,
        ).fetchall()
        return [Tile(**dict(row)) for row in rows]

    def mark_done(self, tile: Tile, *, sha256: str, size: int, counts: dict[str, int]) -> None:
        self._connection.execute(
            """
            UPDATE crawl_items
               SET status='done', attempts=attempts+1, last_error=NULL,
                   sha256=?, bytes=?, buildings=?, roads=?, landuse=?, updated_at=?
             WHERE region=? AND kind=? AND z=? AND x=? AND y=?
            """,
            (
                sha256, size, counts.get("buildings", 0), counts.get("roads", 0),
                counts.get("landuse", 0), int(time.time()),
                tile.region, tile.kind, tile.z, tile.x, tile.y,
            ),
        )
        self._connection.commit()

    def mark_failed(self, tile: Tile, error: str) -> None:
        self._connection.execute(
            """
            UPDATE crawl_items
               SET status='failed', attempts=attempts+1, last_error=?, updated_at=?
             WHERE region=? AND kind=? AND z=? AND x=? AND y=?
            """,
            (error[:500], int(time.time()), tile.region, tile.kind, tile.z, tile.x, tile.y),
        )
        self._connection.commit()

    def progress(self, region: str) -> dict[str, int]:
        rows = self._connection.execute(
            "SELECT status, COUNT(*) AS n FROM crawl_items WHERE region=? GROUP BY status",
            (region,),
        ).fetchall()
        summary = {row["status"]: row["n"] for row in rows}
        summary["total"] = sum(summary.values())
        exhausted = self._connection.execute(
            "SELECT COUNT(*) FROM crawl_items WHERE region=? AND attempts>=?",
            (region, MAX_ATTEMPTS),
        ).fetchone()[0]
        summary["exhausted"] = exhausted
        return summary


class RateLimiter:
    """Spacing plus upstream slot awareness."""

    def __init__(self, min_interval_s: float = MIN_REQUEST_INTERVAL_S) -> None:
        self._min_interval = min_interval_s
        self._last_request = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request = time.monotonic()

    @staticmethod
    def available_slots(timeout_s: float = 15) -> int | None:
        """Free Overpass slots, or None when status cannot be read."""
        request = urllib.request.Request(
            OVERPASS_STATUS, headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_s) as response:
                text = response.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError):
            return None
        for line in text.splitlines():
            if "slots available now" in line:
                head = line.strip().split(" ", 1)[0]
                if head.isdigit():
                    return int(head)
        return 0 if "Slot available after" in text else None


def overpass_query(bounds: BBox, limit: int) -> str:
    """Union query for one bbox, capped at `limit` elements.

    Note that `out geom <limit>` is a *silent* hard cap upstream — see
    `fetch_tile`, which is where the cap is checked and refused.
    """
    area = f"{bounds.south},{bounds.west},{bounds.north},{bounds.east}"
    return (
        # 180 s server-side: a dense z14 tile is ~9k ways, which does not
        # complete inside the old 60 s budget.
        "[out:json][timeout:180];("
        f'way["building"]({area});'
        f'way["highway"]({area});'
        f'way["landuse"]({area});'
        f'way["natural"]({area});'
        f");out geom {limit};"
    )


ROAD_ALIASES = {
    "footway": "path", "pedestrian": "path", "steps": "path", "cycleway": "path",
    "unclassified": "residential", "living_street": "residential",
}
ROAD_KNOWN = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "residential", "service", "track", "path",
}
LANDUSE_ALIASES = {
    "forest": "forest", "wood": "forest", "farmland": "farmland",
    "farmyard": "farmland", "orchard": "orchard", "vineyard": "vineyard",
    "meadow": "meadow", "grass": "grass", "grassland": "grass",
    "village_green": "grass", "scrub": "scrub", "heath": "heath",
    "wetland": "wetland", "marsh": "wetland", "water": "water",
    "reservoir": "water", "basin": "water", "residential": "residential",
    "industrial": "industrial", "commercial": "commercial", "retail": "commercial",
    "quarry": "quarry", "bare_rock": "bare_rock", "scree": "bare_rock",
}


def _height_from_tags(tags: dict[str, str]) -> float:
    raw = tags.get("height", "")
    try:
        explicit = float(raw.split()[0]) if raw else 0.0
    except ValueError:
        explicit = 0.0
    if explicit > 0:
        return min(explicit, 400.0)
    try:
        levels = float(tags.get("building:levels", ""))
    except ValueError:
        levels = 0.0
    if levels > 0:
        return min(levels * 3.0, 400.0)
    return 6.0


def parse_overpass(payload: dict, tile: Tile) -> FeatureTile:
    result = FeatureTile(z=tile.z, x=tile.x, y=tile.y)
    for element in payload.get("elements", []):
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        ring = [
            (point["lon"], point["lat"])
            for point in element.get("geometry") or []
            if isinstance(point.get("lon"), (int, float))
            and isinstance(point.get("lat"), (int, float))
        ]

        if tags.get("building"):
            if len(ring) >= 3:
                result.buildings.append(Building(ring=ring, height_m=_height_from_tags(tags)))
            continue

        highway = tags.get("highway")
        if highway:
            base = highway.removesuffix("_link")
            road_class = base if base in ROAD_KNOWN else ROAD_ALIASES.get(base)
            if road_class and len(ring) >= 2:
                result.roads.append(Road(line=ring, road_class=road_class))
            continue

        for key in ("landuse", "natural"):
            value = tags.get(key)
            if value and value in LANDUSE_ALIASES and len(ring) >= 3:
                result.landuse.append(
                    Landuse(ring=ring, landuse_class=LANDUSE_ALIASES[value])
                )
                break
    return result


#: Refuse anything larger than this per raster tile.
MAX_RASTER_BYTES = 4_000_000


def raster_url(tile: Tile) -> str:
    """Upstream URL for a raster tile. ArcGIS uses z/y/x, terrarium uses z/x/y."""
    if tile.kind == "dem":
        return DEM_URL.format(z=tile.z, x=tile.x, y=tile.y)
    if tile.kind == "ortho":
        return ORTHO_URL.format(z=tile.z, y=tile.y, x=tile.x)
    raise ValueError(f"{tile.kind} is not a raster kind")


def fetch_raster(tile: Tile, timeout_s: float = 45) -> bytes:
    """Fetch a raster tile verbatim — the upstream bytes are what we store."""
    request = urllib.request.Request(
        raster_url(tile), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        payload = response.read(MAX_RASTER_BYTES + 1)
    if len(payload) > MAX_RASTER_BYTES:
        raise ValueError("raster tile exceeded the approved size bound")
    if not payload:
        raise ValueError("raster tile was empty")
    return payload


class TileTruncatedError(RuntimeError):
    """The upstream `out <n>` cap was reached, so this answer is incomplete.

    Raised instead of returning, because a partial tile is indistinguishable
    from a complete one once it is encoded: the same z/x/y, a plausible size, a
    valid TFT2 blob. Marked done, it would be served forever as the truth about
    that place.
    """


def fetch_tile(tile: Tile, limit: int = 20000, timeout_s: float = 180) -> FeatureTile:
    """Fetch one tile's OSM ways, or raise if the upstream cap truncated them.

    Overpass's `out <n>` is a **hard cap, not a warning**: it returns exactly
    `n` elements and no `remark`, so truncation is invisible in the payload.
    Measured on 14/7422/6618 (Funchal), the old default of 5000 silently
    discarded 3,830 of 8,830 ways — 43% of the tile — and the crawler then
    marked it done.

    So we fail closed: reaching the cap is a failure, retried and surfaced,
    never a completed tile. `limit` stays as a runaway guard against a query
    that would otherwise return a whole city.
    """
    bounds = tile_bbox(tile.z, tile.x, tile.y)
    body = urllib.parse.urlencode({"data": overpass_query(bounds, limit)}).encode()
    request = urllib.request.Request(
        OVERPASS_ENDPOINT,
        data=body,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        payload = json.loads(response.read().decode("utf-8"))

    elements = payload.get("elements") or []
    if len(elements) >= limit:
        raise TileTruncatedError(
            f"overpass returned {len(elements)} elements at the {limit} cap for "
            f"{tile.z}/{tile.x}/{tile.y} — the tile is incomplete, refusing to store it"
        )
    return parse_overpass(payload, tile)


def run(
    *,
    queue: CrawlQueue,
    store,
    index,
    region: str,
    max_tiles: int,
    limiter: RateLimiter | None = None,
    raster_limiter: RateLimiter | None = None,
    fetcher=fetch_tile,
    raster_fetcher=fetch_raster,
) -> Iterator[dict]:
    """Process up to `max_tiles`. Yields one record per tile for logging."""
    limiter = limiter or RateLimiter()
    raster_limiter = raster_limiter or RateLimiter(RASTER_REQUEST_INTERVAL_S)

    for tile in queue.claim(region, max_tiles):
        # Only the slot-limited upstream needs asking. Raster CDNs publish no
        # slot count, and gating them on Overpass would stall the layers the
        # demo actually needs first.
        if tile.kind in SLOT_LIMITED_KINDS:
            # Through the instance, not the class: the slot policy is part of
            # the injected limiter, so a caller can substitute or stub it.
            if limiter.available_slots() == 0:
                yield {"tile": tile, "skipped": "no upstream slot"}
                return
            limiter.wait()
        else:
            raster_limiter.wait()

        counts: dict[str, int] = {}
        try:
            if tile.kind in ("dem", "ortho"):
                payload = raster_fetcher(tile)
            else:
                feature_tile = fetcher(tile)
                payload = encode_feature_tile(feature_tile)
                counts = {
                    "buildings": len(feature_tile.buildings),
                    "roads": len(feature_tile.roads),
                    "landuse": len(feature_tile.landuse),
                }
        except Exception as error:  # noqa: BLE001 - any upstream failure retries later
            queue.mark_failed(tile, f"{type(error).__name__}: {error}")
            yield {"tile": tile, "error": str(error)}
            continue

        stored = store.put(payload)

        from .db import BlobRecord, geo_fields

        index.upsert(
            BlobRecord(
                sha256=stored.sha256,
                size=stored.size,
                media_type=MEDIA_TYPES[tile.kind],
                uploaded_by=f"crawler:{region}:{tile.kind}",
                uploaded_at=int(time.time()),
                tile_z=tile.z,
                tile_x=tile.x,
                tile_y=tile.y,
                **geo_fields(tile_bbox(tile.z, tile.x, tile.y)),
            )
        )
        queue.mark_done(tile, sha256=stored.sha256, size=stored.size, counts=counts)
        yield {"tile": tile, "sha256": stored.sha256, "bytes": stored.size, **counts}
