"""Geospatial primitives: slippy tiles, geohash, bounding boxes.

Two indexing strategies coexist on purpose:

* **Bounding box columns** drive this server's own spatial queries. They give an
  exact overlap test, which geohash prefixes alone cannot.
* **Geohash prefixes** exist for Nostr. Relays only match tags exactly, so a
  blob is announced with one `g` tag per precision level, letting a client
  query a coarse or fine cell without the relay understanding geometry.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"

#: Web Mercator latitude clamp.
MAX_LATITUDE = 85.05112878

#: Deepest geohash precision indexed. 12 chars ≈ 3.7 cm.
MAX_GEOHASH_PRECISION = 12


@dataclass(frozen=True)
class BBox:
    """A WGS84 bounding box in EPSG:4326, degrees."""

    west: float
    south: float
    east: float
    north: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(v) for v in (self.west, self.south, self.east, self.north)):
            raise ValueError("bounding box coordinates must be finite")
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("bounding box must have west < east and south < north")
        if not (self.west >= -180 and self.east <= 180):
            raise ValueError("longitude out of range")
        if not (self.south >= -90 and self.north <= 90):
            raise ValueError("latitude out of range")

    @property
    def center(self) -> tuple[float, float]:
        """(lat, lon) of the box centre."""
        return ((self.south + self.north) / 2, (self.west + self.east) / 2)

    def overlaps(self, other: BBox) -> bool:
        return not (
            self.east <= other.west
            or self.west >= other.east
            or self.north <= other.south
            or self.south >= other.north
        )


def geohash_encode(lat: float, lon: float, precision: int = MAX_GEOHASH_PRECISION) -> str:
    """Encode a point as a geohash string."""
    if not 1 <= precision <= MAX_GEOHASH_PRECISION:
        raise ValueError(f"precision must be 1..{MAX_GEOHASH_PRECISION}")
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise ValueError("latitude/longitude out of range")

    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]
    result: list[str] = []
    bits = 0
    bit_count = 0
    even = True

    while len(result) < precision:
        if even:
            mid = (lon_range[0] + lon_range[1]) / 2
            if lon > mid:
                bits = (bits << 1) | 1
                lon_range[0] = mid
            else:
                bits <<= 1
                lon_range[1] = mid
        else:
            mid = (lat_range[0] + lat_range[1]) / 2
            if lat > mid:
                bits = (bits << 1) | 1
                lat_range[0] = mid
            else:
                bits <<= 1
                lat_range[1] = mid
        even = not even
        bit_count += 1
        if bit_count == 5:
            result.append(GEOHASH_ALPHABET[bits])
            bits = 0
            bit_count = 0

    return "".join(result)


def geohash_prefixes(
    lat: float, lon: float, max_precision: int = MAX_GEOHASH_PRECISION
) -> list[str]:
    """Every prefix of a point's geohash, shortest first.

    These become the `g` tags on the announcement event, so a relay query for a
    coarse cell still matches blobs indexed at full precision.
    """
    full = geohash_encode(lat, lon, max_precision)
    return [full[: i + 1] for i in range(len(full))]


def tile_bbox(z: int, x: int, y: int) -> BBox:
    """Bounding box of a slippy-map tile (XYZ scheme)."""
    if z < 0 or z > 30:
        raise ValueError("zoom out of range")
    span = 2**z
    if not (0 <= x < span and 0 <= y < span):
        raise ValueError("tile coordinates out of range for this zoom")

    west = x / span * 360.0 - 180.0
    east = (x + 1) / span * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / span))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / span))))
    return BBox(west=west, south=south, east=east, north=north)


def tile_for_point(lat: float, lon: float, z: int) -> tuple[int, int]:
    """Slippy tile (x, y) containing a point."""
    if z < 0 or z > 30:
        raise ValueError("zoom out of range")
    lat = max(-MAX_LATITUDE, min(MAX_LATITUDE, lat))
    span = 2**z
    x = int((lon + 180.0) / 360.0 * span)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * span)
    return (min(x, span - 1), min(y, span - 1))


def tiles_for_bbox(bbox: BBox, z: int) -> list[tuple[int, int]]:
    """Every tile at zoom `z` that overlaps the bounding box."""
    min_x, min_y = tile_for_point(bbox.north, bbox.west, z)
    max_x, max_y = tile_for_point(bbox.south, bbox.east, z)
    return [
        (x, y)
        for x in range(min(min_x, max_x), max(min_x, max_x) + 1)
        for y in range(min(min_y, max_y), max(min_y, max_y) + 1)
    ]
