from __future__ import annotations

import pytest

from blossom_gis.geo import (
    BBox,
    geohash_encode,
    geohash_prefixes,
    tile_bbox,
    tile_for_point,
    tiles_for_bbox,
)

MADEIRA = BBox(west=-17.05, south=32.70, east=-16.95, north=32.78)


class TestGeohash:
    def test_matches_the_canonical_reference_value(self) -> None:
        assert geohash_encode(57.64911, 10.40744, 11) == "u4pruydqqvj"

    def test_precision_controls_length(self) -> None:
        for precision in (1, 5, 12):
            assert len(geohash_encode(32.75, -16.9, precision)) == precision

    def test_prefixes_are_nested_shortest_first(self) -> None:
        prefixes = geohash_prefixes(32.75, -16.9, 8)
        assert len(prefixes) == 8
        assert prefixes[0] == geohash_encode(32.75, -16.9, 1)
        for shorter, longer in zip(prefixes, prefixes[1:], strict=False):
            assert longer.startswith(shorter)

    def test_nearby_points_share_a_prefix(self) -> None:
        a = geohash_encode(32.7500, -16.9000, 6)
        b = geohash_encode(32.7501, -16.9001, 6)
        assert a[:4] == b[:4]

    @pytest.mark.parametrize(
        ("lat", "lon", "precision"),
        [(91, 0, 6), (0, 181, 6), (0, 0, 0), (0, 0, 13)],
    )
    def test_rejects_out_of_range_input(self, lat: float, lon: float, precision: int) -> None:
        with pytest.raises(ValueError):
            geohash_encode(lat, lon, precision)


class TestTiles:
    def test_zoom_zero_covers_the_world(self) -> None:
        box = tile_bbox(0, 0, 0)
        assert box.west == pytest.approx(-180)
        assert box.east == pytest.approx(180)
        assert box.north == pytest.approx(85.0511, abs=1e-3)
        assert box.south == pytest.approx(-85.0511, abs=1e-3)

    def test_madeira_lands_in_the_expected_z11_tile(self) -> None:
        assert tile_for_point(32.75, -16.9, 11) == (927, 826)

    def test_tile_bbox_contains_its_own_centre(self) -> None:
        box = tile_bbox(11, 927, 826)
        lat, lon = box.center
        assert tile_for_point(lat, lon, 11) == (927, 826)

    def test_tiles_for_bbox_cover_every_corner(self) -> None:
        zoom = 12
        covering = set(tiles_for_bbox(MADEIRA, zoom))
        corners = [
            (MADEIRA.north, MADEIRA.west),
            (MADEIRA.north, MADEIRA.east),
            (MADEIRA.south, MADEIRA.west),
            (MADEIRA.south, MADEIRA.east),
        ]
        for lat, lon in corners:
            assert tile_for_point(lat, lon, zoom) in covering

    @pytest.mark.parametrize(("z", "x", "y"), [(-1, 0, 0), (1, 2, 0), (1, 0, 2)])
    def test_rejects_out_of_range_tiles(self, z: int, x: int, y: int) -> None:
        with pytest.raises(ValueError):
            tile_bbox(z, x, y)


class TestBBox:
    def test_rejects_degenerate_and_inverted_boxes(self) -> None:
        with pytest.raises(ValueError):
            BBox(west=1, south=0, east=1, north=1)  # zero width
        with pytest.raises(ValueError):
            BBox(west=2, south=0, east=1, north=1)  # inverted
        with pytest.raises(ValueError):
            BBox(west=float("nan"), south=0, east=1, north=1)
        with pytest.raises(ValueError):
            BBox(west=-181, south=0, east=1, north=1)

    def test_overlap_is_symmetric_and_excludes_touching_edges(self) -> None:
        a = BBox(west=0, south=0, east=2, north=2)
        overlapping = BBox(west=1, south=1, east=3, north=3)
        touching = BBox(west=2, south=0, east=4, north=2)
        assert a.overlaps(overlapping) and overlapping.overlaps(a)
        assert not a.overlaps(touching)

    def test_centre_is_the_midpoint(self) -> None:
        lat, lon = BBox(west=-2, south=-4, east=2, north=4).center
        assert (lat, lon) == (0, 0)
