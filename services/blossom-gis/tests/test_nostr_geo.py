"""Geo announcements, and the line between the ladder and the single tag.

Kind 1063 is a *social* kind (CONTRACT.md section 13) and carries a `g` tag per
precision level. The dataset kinds 30550/30551 carry exactly one. The tests here
pin both halves of that split, because it has already flipped once: collapsing
1063/30315/31923 to a single precision-4 tag silently broke live presence and the
geo-note feed, and nothing failed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from blossom_gis.geo import BBox, geohash_encode
from blossom_gis.geo_protocol import (
    KIND_GEO_COLLECTION,
    KIND_GEO_ITEM,
    build_item,
)
from blossom_gis.nostr_geo import (
    DEFAULT_GEOHASH_PRECISIONS,
    FILE_METADATA_KIND,
    bbox_filter,
    bbox_from_tags,
    build_announcement,
    geo_filter,
)

MADEIRA = BBox(west=-17.05, south=32.70, east=-16.95, north=32.78)


def tag_values(event, name):
    return [t[1] for t in event["tags"] if t[0] == name]


def social_vector() -> dict:
    """The contract's own ladder vector, so this file cannot drift from it."""
    for candidate in Path(__file__).resolve().parents:
        path = candidate / "packages/geo-protocol/tests/fixtures/geo-vectors.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))["socialGeohashLadder"]
    raise AssertionError(
        "packages/geo-protocol/tests/fixtures/geo-vectors.json is missing; it is the "
        "normative source for which kinds carry the geohash ladder. Failing rather "
        "than skipping."
    )


class TestAnnouncement:
    def test_carries_the_blob_identity_and_footprint(self) -> None:
        event = build_announcement(
            sha256="a" * 64,
            url="https://example.test/" + "a" * 64,
            size=1234,
            media_type="image/png",
            bbox=MADEIRA,
            created_at=1700000000,
        )
        assert event["kind"] == FILE_METADATA_KIND
        assert tag_values(event, "x") == ["a" * 64]
        assert tag_values(event, "size") == ["1234"]
        assert tag_values(event, "m") == ["image/png"]

    def test_carries_no_tile_tag(self) -> None:
        """The item `d` in geo_protocol subsumes it; two spellings of one fact drift."""
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        assert tag_values(event, "tile") == []

    def test_is_unsigned_so_the_service_never_holds_a_key(self) -> None:
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        assert "sig" not in event
        assert "pubkey" not in event

    def test_indexes_one_nested_geohash_tag_per_precision(self) -> None:
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1, precisions=(1, 3, 6),
        )
        cells = tag_values(event, "g")
        assert [len(c) for c in cells] == [1, 3, 6]
        for shorter, longer in zip(cells, cells[1:], strict=False):
            assert longer.startswith(shorter)

        lat, lon = MADEIRA.center
        assert cells[-1] == geohash_encode(lat, lon, 6)

    def test_the_default_ladder_is_precisions_one_to_six(self) -> None:
        """A five-character query can never match a four-character tag."""
        assert DEFAULT_GEOHASH_PRECISIONS == (1, 2, 3, 4, 5, 6)
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        assert [len(c) for c in tag_values(event, "g")] == [1, 2, 3, 4, 5, 6]

    def test_the_ladder_matches_the_contract_vector(self) -> None:
        vector = social_vector()
        assert tuple(vector["precisions"]) == DEFAULT_GEOHASH_PRECISIONS
        point = vector["example"]
        box = BBox(
            west=point["lon"], south=point["lat"],
            east=point["lon"] + 1e-9, north=point["lat"] + 1e-9,
        )
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m", bbox=box, created_at=1,
        )
        ladder = [t for t in event["tags"] if t[0] == "g"]
        assert ladder == [list(t) for t in vector["example"]["expectedTags"]]

    def test_rejects_an_empty_precision_set(self) -> None:
        with pytest.raises(ValueError):
            build_announcement(
                sha256="a" * 64, url="u", size=1, media_type="m",
                bbox=MADEIRA, created_at=1, precisions=(),
            )

    def test_the_bbox_tag_never_uses_exponent_notation(self) -> None:
        """Bare str() emits `8.6e-05` inside a tag, which no client parses back."""
        tiny = BBox(west=0.0, south=0.0, east=8.58306884765625e-05, north=8.583e-05)
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m", bbox=tiny, created_at=1,
        )
        bbox_tag = next(t for t in event["tags"] if t[0] == "bbox")
        assert bbox_tag == ["bbox", "0", "0", "0.000086", "0.000086"]
        assert not any("e" in v for v in bbox_tag[1:])

    def test_footprint_round_trips_through_the_tags(self) -> None:
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        recovered = bbox_from_tags(event["tags"])
        assert recovered == MADEIRA

    def test_missing_or_malformed_bbox_tag_yields_none(self) -> None:
        assert bbox_from_tags([["x", "abc"]]) is None
        assert bbox_from_tags([["bbox", "a", "b", "c", "d"]]) is None


class TestWhichKindsCarryTheLadder:
    """The split is normative. It has flipped once already, silently."""

    def test_the_social_kinds_are_exactly_the_ones_the_contract_names(self) -> None:
        assert set(social_vector()["kinds"]) == {1, 1063, 30315, 31923}
        assert FILE_METADATA_KIND in social_vector()["kinds"]

    def test_the_dataset_kinds_are_not_social_kinds(self) -> None:
        ladder_kinds = set(social_vector()["kinds"])
        assert KIND_GEO_COLLECTION not in ladder_kinds
        assert KIND_GEO_ITEM not in ladder_kinds

    def test_a_1063_announcement_carries_six_g_tags(self) -> None:
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        assert len(tag_values(event, "g")) == 6

    def test_a_30551_item_carries_exactly_one_g_tag_at_precision_4(self) -> None:
        item = build_item(
            dataset="terrain",
            pubkey="0123456789abcdef" * 4,
            z=14,
            x=8593,
            y=5677,
            sha256="fedcba9876543210" * 4,
            url="https://blossom.example/x.tft2",
            mime_type="application/vnd.terrcvm.tft2",
            size=65536,
            datetime="2026-01-01T00:00:00Z",
            created_at=1767225600,
        )
        cells = tag_values(item, "g")
        assert cells == ["u0w6"]
        assert len(cells[0]) == 4


class TestFilters:
    def test_point_filter_targets_one_cell(self) -> None:
        lat, lon = MADEIRA.center
        flt = geo_filter(lat=lat, lon=lon, precision=5)
        assert flt["kinds"] == [FILE_METADATA_KIND]
        assert flt["#g"] == [geohash_encode(lat, lon, 5)]

    def test_a_published_blob_matches_a_query_for_its_own_cell(self) -> None:
        """The announcement and the filter must agree, or nothing is findable."""
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=MADEIRA, created_at=1,
        )
        published = set(tag_values(event, "g"))
        lat, lon = MADEIRA.center
        for precision in DEFAULT_GEOHASH_PRECISIONS:
            assert set(geo_filter(lat=lat, lon=lon, precision=precision)["#g"]) <= published

    def test_bbox_filter_covers_the_interior_not_just_the_corners(self) -> None:
        """A wide box has interior cells no corner sample would ever reach."""
        wide = BBox(west=-2.0, south=46.0, east=1.0, north=47.0)
        flt = bbox_filter(wide)
        assert flt is not None
        cells = set(flt["#g"])
        # 9 columns x 7 rows of precision-4 cells, all of them.
        assert len(flt["#g"]) == 63
        corners = {
            geohash_encode(lat, lon, 4)
            for lat, lon in [(46.0, -2.0), (46.0, 1.0), (47.0, -2.0), (47.0, 1.0)]
        }
        assert corners < cells
        # An interior point that corner sampling would miss entirely.
        assert geohash_encode(46.5, -0.5, 4) in cells

    def test_bbox_filter_matches_its_own_announcement_at_the_same_precision(self) -> None:
        """The ladder is what makes this hold at every zoom, not just at 4.

        One blob, one street-sized viewport, six query precisions: with a single
        precision-4 tag five of the six would return nothing at all.
        """
        street = BBox(west=-16.9251, south=32.6501, east=-16.9249, north=32.6503)
        event = build_announcement(
            sha256="a" * 64, url="u", size=1, media_type="m",
            bbox=street, created_at=1,
        )
        published = set(tag_values(event, "g"))
        for precision in DEFAULT_GEOHASH_PRECISIONS:
            flt = bbox_filter(street, precision=precision)
            assert flt is not None, precision
            assert published & set(flt["#g"]), precision

    def test_a_continental_box_is_refused_rather_than_silently_dropped(self) -> None:
        europe = BBox(west=-25.0, south=34.0, east=45.0, north=72.0)
        assert bbox_filter(europe) is None

    @pytest.mark.parametrize("limit", [0, -1])
    def test_rejects_a_non_positive_limit(self, limit: int) -> None:
        with pytest.raises(ValueError):
            geo_filter(lat=0, lon=0, limit=limit)
        with pytest.raises(ValueError):
            bbox_filter(MADEIRA, limit=limit)

    @pytest.mark.parametrize("precision", [0, 13, -1])
    def test_rejects_out_of_range_precision(self, precision: int) -> None:
        with pytest.raises(ValueError):
            geo_filter(lat=0, lon=0, precision=precision)
        with pytest.raises(ValueError):
            bbox_filter(MADEIRA, precision=precision)
