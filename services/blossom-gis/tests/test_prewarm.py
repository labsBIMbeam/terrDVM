"""Prewarm must fill exactly the caches the client reads.

The pinned query string below also lives in the napplet's test suite
(roads.test.ts). If either side changes how the Overpass query is built,
both pins fail and the cache-key contract is renegotiated consciously.
"""

from __future__ import annotations

from blossom_gis.geo import BBox
from blossom_gis.prewarm import DEMO_SELECTIONS, dem_tiles, features_query

RING = BBox(west=16.355, south=48.195, east=16.385, north=48.215)

PINNED_RING_QUERY = (
    '[out:json][timeout:25];('
    'way["building"](48.195,16.355,48.215,16.385);'
    'way["highway"](48.195,16.355,48.215,16.385);'
    'way["waterway"](48.195,16.355,48.215,16.385);'
    'way["landuse"](48.195,16.355,48.215,16.385);'
    'way["natural"](48.195,16.355,48.215,16.385);'
    ');out geom 16000;'
)


class TestPrewarm:
    def test_query_matches_the_client_pin(self) -> None:
        assert features_query(RING) == PINNED_RING_QUERY

    def test_number_formatting_is_shortest_roundtrip(self) -> None:
        # JavaScript's String(number); trailing .0 must vanish, precision stay.
        assert features_query(BBox(west=-17.0, south=32.64, east=-16.9, north=32.66)) == (
            '[out:json][timeout:25];('
            'way["building"](32.64,-17,32.66,-16.9);'
            'way["highway"](32.64,-17,32.66,-16.9);'
            'way["waterway"](32.64,-17,32.66,-16.9);'
            'way["landuse"](32.64,-17,32.66,-16.9);'
            'way["natural"](32.64,-17,32.66,-16.9);'
            ');out geom 16000;'
        )

    def test_dem_tiles_cover_the_selection_at_both_zooms(self) -> None:
        tiles = dem_tiles(RING)
        assert all(z in (13, 14) for z, _, _ in tiles)
        assert len(tiles) >= 2
        assert len(set(tiles)) == len(tiles)

    def test_demo_selections_are_inside_their_regions(self) -> None:
        for name, (region, box) in DEMO_SELECTIONS.items():
            assert box.west < box.east and box.south < box.north, name
            assert region in ("madeira", "vienna", "south-tyrol"), name
