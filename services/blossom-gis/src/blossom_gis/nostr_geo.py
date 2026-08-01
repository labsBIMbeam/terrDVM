"""Geo announcements: publishing blob locations to ordinary Nostr relays.

A relay cannot understand geometry — it matches tags exactly. So a blob is
announced once per geohash precision level (`g` tags). A client searching a
coarse area queries the short prefix; a client searching a small area queries a
long one. Both hit the same event without the relay knowing what a bbox is.

**The ladder is not optional here.** Kind 1063 is a *social* kind under
CONTRACT.md section 13, alongside 1, 30315 and 31923, and nostr tag filters are
exact string matches: a client querying a five-character cell can never match a
four-character tag. Collapsing this to a single precision-4 tag — as the
previous round did — silently broke live presence and the geo-note feed, because
a precision-4 cell is 39x19 km and continental Europe needs 43,617 of them.
Sparse global proximity search is exactly what the multi-precision convention
exists for.

The single-tag rule applies to the dataset kinds 30550/30551 in `geo_protocol`
and to nothing else: there a survey-zoom viewport is a handful of cells and one
cell holds about 208 z14 tiles, which is one workable relay page.

That is why this server does not ship its own relay: any NIP-01 relay with
generic tag indexing (strfry, for example) already serves as the geo index.
The exact footprint travels in the event for client-side refinement, and the
authoritative spatial filter stays in `GET /geo` on the blob server.
"""

from __future__ import annotations

from typing import Any

from .geo import BBox, geohash_prefixes
from .geo_protocol import (
    DEFAULT_FILTER_LIMIT,
    MAX_COVER_CELLS,
    canonical_coordinate,
    cover,
)

#: NIP-94 file metadata. Reused so generic Nostr clients can already read these.
FILE_METADATA_KIND = 1063

#: The social ladder: every prefix from continent scale (precision 1) down to
#: ~600 m cells (precision 6). Announcing all twelve levels would spam the relay
#: with twelve tags for one tile; stopping at 6 covers every query a viewport
#: client makes, including presence's precision-5 point query.
DEFAULT_GEOHASH_PRECISIONS = (1, 2, 3, 4, 5, 6)


def build_announcement(
    *,
    sha256: str,
    url: str,
    size: int,
    media_type: str,
    bbox: BBox,
    created_at: int,
    precisions: tuple[int, ...] = DEFAULT_GEOHASH_PRECISIONS,
    summary: str = "",
) -> dict[str, Any]:
    """Build an *unsigned* announcement event.

    Signing deliberately happens elsewhere: this service never holds a private
    key, so the caller signs with their own signer (NIP-07/NIP-46) and publishes.

    There is no `tile` tag: the item `d` in `geo_protocol` subsumes it, and two
    spellings of one fact are two things to keep in step. Coordinates use the
    contract's canonical formatter, because bare `str()` emits exponent notation
    below 1e-4 — `8.6e-05` inside a nostr tag, which no client parses back.
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
        [
            "bbox",
            canonical_coordinate(bbox.west),
            canonical_coordinate(bbox.south),
            canonical_coordinate(bbox.east),
            canonical_coordinate(bbox.north),
        ],
    ]
    tags.extend(["g", all_prefixes[p - 1]] for p in sorted(set(precisions)))

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
    precision: int = 4,
    limit: int = DEFAULT_FILTER_LIMIT,
) -> dict[str, Any]:
    """A NIP-01 filter selecting announcements inside one geohash cell.

    `precision` is a real parameter because the ladder makes it one: a client
    zoomed to a street queries 6, a client zoomed to a country queries 2.
    """
    if not 1 <= precision <= 12:
        raise ValueError("precision must be 1..12")
    if limit < 1:
        raise ValueError("limit must be positive")
    return {
        "kinds": [FILE_METADATA_KIND],
        "#g": [geohash_prefixes(lat, lon, precision)[-1]],
        "limit": limit,
    }


def bbox_filter(
    bbox: BBox,
    *,
    precision: int = 4,
    limit: int = DEFAULT_FILTER_LIMIT,
    max_cells: int = MAX_COVER_CELLS,
) -> dict[str, Any] | None:
    """A filter covering every cell a bounding box touches, at one precision.

    Exact, not sampled. The predecessor sampled the box's corners and centre and
    called the result a superset; it was in fact an undercount, missing every
    interior cell — around 92% of what a multi-degree viewport needs. Returns
    None when the box is too wide to express as one filter, which is the caller's
    signal to fall back to the collection layer instead of sending a filter the
    relay will silently drop.
    """
    if limit < 1:
        raise ValueError("limit must be positive")
    cells = cover((bbox.west, bbox.south, bbox.east, bbox.north), precision)
    if len(cells) > max_cells:
        return None
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
