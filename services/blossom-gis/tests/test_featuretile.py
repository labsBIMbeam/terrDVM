"""Feature-tile codec, including cross-language conformance.

The golden bytes below were emitted by the TypeScript reference implementation
in `apps/napplet/src/features/codec.ts`. If either side drifts, this test fails
— which is the point: the tile hash is the storage key, so a one-byte
disagreement would silently split one logical tile into two blobs and stop
deduplication working.
"""

from __future__ import annotations

import pytest

from blossom_gis.featuretile import (
    LANDUSE_CLASSES,
    ROAD_CLASSES,
    TILE_EXTENT,
    Building,
    FeatureTile,
    Landuse,
    Road,
    decode_feature_tile,
    encode_feature_tile,
)

# Emitted by the TypeScript encoder for the tile constructed in `reference_tile`.
GOLDEN_HEX = (
    "325446540efa2100001b17000000100204b406b406c60200009803c502007f03b426d827ea03"
    "50f501be043202030300b41680205280208e050207801000a4018040020400e62cb4068010a4"
    "01f501f411e50ca30103049a03e62c9a13a4019903dc0e"
)

Z, X, Y = 14, 8698, 5915


def _tile_bounds():
    from blossom_gis.featuretile import _tile_bounds

    return _tile_bounds(Z, X, Y)


def point(fx: float, fy: float) -> tuple[float, float]:
    west, south, east, north = _tile_bounds()
    return (west + (east - west) * fx, north - (north - south) * fy)


def reference_tile() -> FeatureTile:
    return FeatureTile(
        z=Z,
        x=X,
        y=Y,
        buildings=[
            Building(
                ring=[point(0.10, 0.10), point(0.14, 0.10), point(0.14, 0.15), point(0.10, 0.15)],
                height_m=12.7,
            ),
            Building(
                ring=[point(0.60, 0.62), point(0.66, 0.63), point(0.63, 0.70)],
                height_m=5,
            ),
        ],
        roads=[
            Road(
                line=[point(0.0, 0.35), point(0.5, 0.36), point(1.0, 0.44)],
                road_class="secondary",
            ),
            Road(line=[point(0.25, 0.0), point(0.27, 1.0)], road_class="track"),
        ],
        landuse=[
            Landuse(
                ring=[point(0.70, 0.10), point(0.95, 0.12), point(0.92, 0.40), point(0.72, 0.38)],
                landuse_class="forest",
            ),
            Landuse(
                ring=[point(0.05, 0.70), point(0.35, 0.72), point(0.30, 0.95)],
                landuse_class="vineyard",
            ),
        ],
    )


class TestCrossLanguageConformance:
    def test_python_encodes_byte_for_byte_like_typescript(self) -> None:
        assert encode_feature_tile(reference_tile()).hex() == GOLDEN_HEX

    def test_python_decodes_the_typescript_output(self) -> None:
        tile = decode_feature_tile(bytes.fromhex(GOLDEN_HEX))

        assert (tile.z, tile.x, tile.y) == (Z, X, Y)
        assert [b.height_m for b in tile.buildings] == [12.7, 5.0]
        assert [r.road_class for r in tile.roads] == ["secondary", "track"]
        assert [land.landuse_class for land in tile.landuse] == ["forest", "vineyard"]

    def test_matches_the_typescript_decoded_coordinate(self) -> None:
        tile = decode_feature_tile(bytes.fromhex(GOLDEN_HEX))
        lon, lat = tile.buildings[0].ring[0]
        # Values reported by the TypeScript decoder for the same bytes.
        assert lon == pytest.approx(11.120363473892212, abs=1e-9)
        assert lat == pytest.approx(44.66708847478562, abs=1e-9)

    def test_re_encoding_a_decoded_tile_is_stable(self) -> None:
        """Decode → encode must be a fixed point, or hashes would churn."""
        once = bytes.fromhex(GOLDEN_HEX)
        assert encode_feature_tile(decode_feature_tile(once)) == once


class TestRoundTrip:
    def test_empty_tile(self) -> None:
        tile = decode_feature_tile(encode_feature_tile(FeatureTile(z=Z, x=X, y=Y)))
        assert tile.buildings == [] and tile.roads == [] and tile.landuse == []

    def test_every_road_class_survives(self) -> None:
        tile = FeatureTile(
            z=Z, x=X, y=Y,
            roads=[
                Road(line=[point(0.1, i / 20), point(0.9, i / 20)], road_class=name)
                for i, name in enumerate(ROAD_CLASSES)
            ],
        )
        decoded = decode_feature_tile(encode_feature_tile(tile))
        assert [r.road_class for r in decoded.roads] == list(ROAD_CLASSES)

    def test_every_landuse_class_survives(self) -> None:
        tile = FeatureTile(
            z=Z, x=X, y=Y,
            landuse=[
                Landuse(
                    ring=[point(0.1, i / 30), point(0.5, i / 30), point(0.5, i / 30 + 0.02)],
                    landuse_class=name,
                )
                for i, name in enumerate(LANDUSE_CLASSES)
            ],
        )
        decoded = decode_feature_tile(encode_feature_tile(tile))
        assert [land.landuse_class for land in decoded.landuse] == list(LANDUSE_CLASSES)

    def test_unknown_classes_fall_back_instead_of_raising(self) -> None:
        tile = FeatureTile(
            z=Z, x=X, y=Y,
            roads=[Road(line=[point(0.1, 0.1), point(0.2, 0.2)], road_class="hyperloop")],
            landuse=[
                Landuse(
                    ring=[point(0.1, 0.1), point(0.2, 0.2), point(0.3, 0.1)],
                    landuse_class="unobtainium_mine",
                )
            ],
        )
        decoded = decode_feature_tile(encode_feature_tile(tile))
        assert decoded.roads[0].road_class == "residential"
        assert decoded.landuse[0].landuse_class == "grass"

    def test_geometry_stays_within_one_quantisation_step(self) -> None:
        west, south, east, north = _tile_bounds()
        lon_step = (east - west) / TILE_EXTENT
        lat_step = (north - south) / TILE_EXTENT

        original = reference_tile()
        decoded = decode_feature_tile(encode_feature_tile(original))
        for source, result in zip(original.buildings, decoded.buildings, strict=True):
            for (lon, lat), (rlon, rlat) in zip(source.ring, result.ring, strict=True):
                assert abs(rlon - lon) < lon_step
                assert abs(rlat - lat) < lat_step


class TestFailureModes:
    def test_rejects_a_foreign_magic(self) -> None:
        with pytest.raises(ValueError, match="not a terrDVM feature tile"):
            decode_feature_tile(b"\x00\x01\x02\x03and then some")

    def test_rejects_truncated_input(self) -> None:
        valid = bytes.fromhex(GOLDEN_HEX)
        with pytest.raises(ValueError):
            decode_feature_tile(valid[:-6])

    def test_rejects_an_unsupported_extent(self) -> None:
        valid = bytearray(bytes.fromhex(GOLDEN_HEX))
        valid[13:15] = (2048).to_bytes(2, "little")
        with pytest.raises(ValueError, match="extent"):
            decode_feature_tile(bytes(valid))
