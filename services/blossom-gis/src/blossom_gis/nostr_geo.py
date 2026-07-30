"""Geo announcements: publishing blob locations to ordinary Nostr relays.

A relay cannot understand geometry — it matches tags exactly. So a blob is
announced once per geohash precision level (`g` tags). A client searching a
coarse area queries the short prefix; a client searching a small area queries a
long one. Both hit the same event without the relay knowing what a bbox is.

That is why this server does not ship its own relay: any NIP-01 relay with
generic tag indexing (strfry, for example) already serves as the geo index.
The exact footprint travels in the event for client-side refinement, and the
authoritative spatial filter stays in `GET /geo` on the blob server.
"""

from __future__ import annotations

from typing import Any

from .geo import BBox, geohash_prefixes

#: NIP-94 file metadata. Reused so generic Nostr clients can already read these.
FILE_METADATA_KIND = 1063

#: Announcing every level from 12 down would spam the relay with 12 tags for a
#: single tile; these cover continent-scale down to ~600 m cells.
DEFAULT_GEOHASH_PRECISIONS = (1, 2, 3, 4, 5, 6)


def build_announcement(
    *,
    sha256: str,
    url: str,
    size: int,
    media_type: str,
    bbox: BBox,
    tile: tuple[int, int, int] | None = None,
    created_at: int,
    precisions: tuple[int, ...] = DEFAULT_GEOHASH_PRECISIONS,
    summary: str = "",
) -> dict[str, Any]:
    """Build an *unsigned* announcement event.

    Signing deliberately happens elsewhere: this service never holds a private
    key, so the caller signs with their own signer (NIP-07/NIP-46) and publishes.
    """
    if not precisions:
        raise ValueError("at least one geohash precision is required")

    lat, lon = bbox.center
    all_prefixes = geohash_prefixes(lat, lon, max(precisions))
    tags: list[list[str]] = [
        ["x", sha256],
        ["url", url],
        ["m", media_type],
        ["size", str(size)],
        ["bbox", str(bbox.west), str(bbox.south), str(bbox.east), str(bbox.north)],
    ]
    tags.extend(["g", all_prefixes[p - 1]] for p in sorted(set(precisions)))
    if tile is not None:
        tags.append(["tile", f"{tile[0]}/{tile[1]}/{tile[2]}"])

    return {
        "kind": FILE_METADATA_KIND,
        "created_at": created_at,
        "tags": tags,
        "content": summary,
    }


def geo_filter(
    *,
    lat: float,
    lon: float,
    precision: int,
    limit: int = 500,
) -> dict[str, Any]:
    """A NIP-01 filter selecting announcements inside one geohash cell."""
    if not 1 <= precision <= 12:
        raise ValueError("precision must be 1..12")
    return {
        "kinds": [FILE_METADATA_KIND],
        "#g": [geohash_prefixes(lat, lon, precision)[-1]],
        "limit": limit,
    }


def bbox_filter(bbox: BBox, *, precision: int = 4, limit: int = 500) -> dict[str, Any]:
    """A filter covering a bounding box at a given precision.

    Relays match tags exactly, so this returns the cells touched by the box's
    corners and centre. It is intentionally a superset: callers must still
    filter precisely against the `bbox` tag on each returned event.
    """
    if not 1 <= precision <= 12:
        raise ValueError("precision must be 1..12")

    points = [
        bbox.center,
        (bbox.north, bbox.west),
        (bbox.north, bbox.east),
        (bbox.south, bbox.west),
        (bbox.south, bbox.east),
    ]
    cells = sorted({geohash_prefixes(lat, lon, precision)[-1] for lat, lon in points})
    return {"kinds": [FILE_METADATA_KIND], "#g": cells, "limit": limit}


def bbox_from_tags(tags: list[list[str]]) -> BBox | None:
    """Recover the exact footprint from an announcement, for client-side filtering."""
    for tag in tags:
        if len(tag) == 5 and tag[0] == "bbox":
            try:
                west, south, east, north = (float(v) for v in tag[1:])
                return BBox(west=west, south=south, east=east, north=north)
            except ValueError:
                return None
    return None
