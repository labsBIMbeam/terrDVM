"""SQLite index over stored blobs, with an exact spatial filter.

Bounding-box columns are indexed so `GET /geo` is a real overlap query rather
than a geohash-prefix approximation. The geohash column exists so the same rows
can be announced to Nostr with tags a relay can match.
"""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .geo import BBox, geohash_encode

SCHEMA = """
CREATE TABLE IF NOT EXISTS blobs (
    sha256      TEXT PRIMARY KEY,
    size        INTEGER NOT NULL,
    media_type  TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL,
    west        REAL,
    south       REAL,
    east        REAL,
    north       REAL,
    geohash     TEXT,
    tile_z      INTEGER,
    tile_x      INTEGER,
    tile_y      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_blobs_pubkey ON blobs (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_blobs_bbox   ON blobs (west, east, south, north);
CREATE INDEX IF NOT EXISTS idx_blobs_geohash ON blobs (geohash);
CREATE INDEX IF NOT EXISTS idx_blobs_tile   ON blobs (tile_z, tile_x, tile_y);
"""


@dataclass(frozen=True)
class BlobRecord:
    sha256: str
    size: int
    media_type: str
    uploaded_by: str
    uploaded_at: int
    west: float | None = None
    south: float | None = None
    east: float | None = None
    north: float | None = None
    geohash: str | None = None
    tile_z: int | None = None
    tile_x: int | None = None
    tile_y: int | None = None

    def to_descriptor(self, base_url: str) -> dict[str, Any]:
        """BUD-01 style blob descriptor, plus this server's geo fields."""
        descriptor: dict[str, Any] = {
            "sha256": self.sha256,
            "size": self.size,
            "type": self.media_type,
            "uploaded": self.uploaded_at,
            "url": f"{base_url.rstrip('/')}/{self.sha256}",
        }
        if self.west is not None:
            descriptor["bbox"] = [self.west, self.south, self.east, self.north]
            descriptor["geohash"] = self.geohash
        if self.tile_z is not None:
            descriptor["tile"] = {"z": self.tile_z, "x": self.tile_x, "y": self.tile_y}
        return descriptor


class BlobIndex:
    def __init__(self, path: Path | str) -> None:
        self._path = str(path)
        self._connection = sqlite3.connect(self._path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.executescript(SCHEMA)
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()

    def upsert(self, record: BlobRecord) -> None:
        fields = asdict(record)
        columns = ", ".join(fields)
        placeholders = ", ".join(f":{name}" for name in fields)
        updates = ", ".join(f"{name}=excluded.{name}" for name in fields if name != "sha256")
        self._connection.execute(
            f"INSERT INTO blobs ({columns}) VALUES ({placeholders}) "
            f"ON CONFLICT(sha256) DO UPDATE SET {updates}",
            fields,
        )
        self._connection.commit()

    def get(self, sha256: str) -> BlobRecord | None:
        row = self._connection.execute(
            "SELECT * FROM blobs WHERE sha256 = ?", (sha256,)
        ).fetchone()
        return BlobRecord(**dict(row)) if row else None

    def delete(self, sha256: str) -> None:
        self._connection.execute("DELETE FROM blobs WHERE sha256 = ?", (sha256,))
        self._connection.commit()

    def list_by_pubkey(self, pubkey: str, limit: int = 500) -> list[BlobRecord]:
        rows = self._connection.execute(
            "SELECT * FROM blobs WHERE uploaded_by = ? ORDER BY uploaded_at DESC LIMIT ?",
            (pubkey, limit),
        ).fetchall()
        return [BlobRecord(**dict(row)) for row in rows]

    def query_bbox(self, bbox: BBox, limit: int = 500) -> list[BlobRecord]:
        """Blobs whose footprint overlaps `bbox`. Exact, not prefix-approximate."""
        rows = self._connection.execute(
            """
            SELECT * FROM blobs
             WHERE west IS NOT NULL
               AND west  < :east
               AND east  > :west
               AND south < :north
               AND north > :south
             ORDER BY uploaded_at DESC
             LIMIT :limit
            """,
            {
                "west": bbox.west,
                "south": bbox.south,
                "east": bbox.east,
                "north": bbox.north,
                "limit": limit,
            },
        ).fetchall()
        return [BlobRecord(**dict(row)) for row in rows]

    def query_tile(self, z: int, x: int, y: int) -> list[BlobRecord]:
        rows = self._connection.execute(
            "SELECT * FROM blobs WHERE tile_z = ? AND tile_x = ? AND tile_y = ?",
            (z, x, y),
        ).fetchall()
        return [BlobRecord(**dict(row)) for row in rows]


def geo_fields(bbox: BBox | None) -> dict[str, Any]:
    """Derive the stored geo columns from a footprint."""
    if bbox is None:
        return {"west": None, "south": None, "east": None, "north": None, "geohash": None}
    lat, lon = bbox.center
    return {
        "west": bbox.west,
        "south": bbox.south,
        "east": bbox.east,
        "north": bbox.north,
        "geohash": geohash_encode(lat, lon),
    }
