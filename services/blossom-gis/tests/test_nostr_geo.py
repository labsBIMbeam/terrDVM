from __future__ import annotations

import pytest

from blossom_gis.geo import BBox, geohash_encode
from blossom_gis.nostr_geo import (
    FILE_METADATA_KIND,
    bbox_filter,
    bbox_from_tags,
    build_announcement,
    geo_filter,
)

MADEIRA = BBox(west=-17.05, south=32.70, east=-16.95, north=32.78)


def tag_values(event, name):
    return [t[1] for t in event["tags"] if t[0] == name]


class TestAnnouncement:
    def test_carries_the_blob_identity_and_footprint(self) -> None:
        event = build_announcement(
            sha256="a" * 64,
            url="https://example.test/" + "a" * 64,
            size=1234,
            media_type="image/png",
            bbox=MADEIRA,
            tile=(11, 927, 826),
            created_at=1700000000,
        )
        assert event["kind"] == FILE_METADATA_KIND
        assert tag_values(event, "x") == ["a" * 64]
        assert tag_values(event, "size") == ["1234"]
        assert tag_values(event, "m") == ["image/png"]
        assert tag_values(event, "tile") == ["11/927/826"]

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

    def test_rejects_an_empty_precision_set(self) -> None:
        with pytest.raises(ValueError):
            build_announcement(
                sha256="a" * 64, url="u", size=1, media_type="m",
                bbox=MADEIRA, created_at=1, precisions=(),
            )

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
            bbox=MADEIRA, created_at=1, precisions=(1, 2, 3, 4, 5, 6),
        )
        published = set(tag_values(event, "g"))
        lat, lon = MADEIRA.center
        for precision in (1, 3, 6):
            assert set(geo_filter(lat=lat, lon=lon, precision=precision)["#g"]) <= published

    def test_bbox_filter_covers_corners_and_centre(self) -> None:
        flt = bbox_filter(MADEIRA, precision=5)
        expected = {
            geohash_encode(lat, lon, 5)
            for lat, lon in [
                MADEIRA.center,
                (MADEIRA.north, MADEIRA.west),
                (MADEIRA.north, MADEIRA.east),
                (MADEIRA.south, MADEIRA.west),
                (MADEIRA.south, MADEIRA.east),
            ]
        }
        assert set(flt["#g"]) == expected

    @pytest.mark.parametrize("precision", [0, 13, -1])
    def test_rejects_out_of_range_precision(self, precision: int) -> None:
        with pytest.raises(ValueError):
            geo_filter(lat=0, lon=0, precision=precision)
        with pytest.raises(ValueError):
            bbox_filter(MADEIRA, precision=precision)
