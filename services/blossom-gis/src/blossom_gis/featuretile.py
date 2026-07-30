"""Binary feature-tile codec — Python side.

Byte-for-byte compatible with `apps/napplet/src/features/codec.ts`. The two
implementations are pinned together by a cross-language conformance test: the
TypeScript encoder emits a fixture, this decoder reads it, and re-encoding must
reproduce the same bytes.

That matters because the tile hash is the storage key. If the two sides
disagreed by a single byte, the same tile would occupy two blobs and dedup
would silently stop working.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

TFT_MAGIC = 0x54465432  # 'TFT2' — adds the landuse layer
TILE_EXTENT = 4096

LANDUSE_CLASSES = (
    "forest",
    "farmland",
    "meadow",
    "grass",
    "vineyard",
    "orchard",
    "scrub",
    "heath",
    "wetland",
    "water",
    "residential",
    "industrial",
    "commercial",
    "quarry",
    "bare_rock",
)

ROAD_CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "service",
    "track",
    "path",
)


@dataclass
class Building:
    ring: list[tuple[float, float]]
    height_m: float


@dataclass
class Road:
    line: list[tuple[float, float]]
    road_class: str


@dataclass
class Landuse:
    ring: list[tuple[float, float]]
    landuse_class: str


@dataclass
class FeatureTile:
    z: int
    x: int
    y: int
    buildings: list[Building] = field(default_factory=list)
    roads: list[Road] = field(default_factory=list)
    landuse: list[Landuse] = field(default_factory=list)


class _Writer:
    def __init__(self) -> None:
        self.data = bytearray()

    def byte(self, value: int) -> None:
        self.data.append(value & 0xFF)

    def uint16(self, value: int) -> None:
        self.data += (value & 0xFFFF).to_bytes(2, "little")

    def uint32(self, value: int) -> None:
        self.data += (value & 0xFFFFFFFF).to_bytes(4, "little")

    def varint(self, value: int) -> None:
        remaining = value & 0xFFFFFFFF
        while remaining >= 0x80:
            self.data.append((remaining & 0x7F) | 0x80)
            remaining >>= 7
        self.data.append(remaining)

    def zigzag(self, value: int) -> None:
        # Mirrors the 32-bit JS shift semantics exactly.
        self.varint(((value << 1) ^ (value >> 31)) & 0xFFFFFFFF)


class _Reader:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._offset = 0

    def byte(self) -> int:
        if self._offset >= len(self._data):
            raise ValueError("feature tile truncated")
        value = self._data[self._offset]
        self._offset += 1
        return value

    def uint16(self) -> int:
        return self.byte() | (self.byte() << 8)

    def uint32(self) -> int:
        return (
            self.byte() | (self.byte() << 8) | (self.byte() << 16) | (self.byte() << 24)
        )

    def varint(self) -> int:
        result = 0
        shift = 0
        while True:
            current = self.byte()
            result |= (current & 0x7F) << shift
            if not current & 0x80:
                return result
            shift += 7
            if shift > 35:
                raise ValueError("varint overflow in feature tile")

    def zigzag(self) -> int:
        raw = self.varint()
        return (raw >> 1) ^ -(raw & 1)


def _tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    span = 2**z
    west = x / span * 360.0 - 180.0
    east = (x + 1) / span * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / span))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / span))))
    return west, south, east, north


def _quantise(z: int, x: int, y: int):
    west, south, east, north = _tile_bounds(z, x, y)
    span_lon = east - west
    span_lat = north - south

    def convert(lon: float, lat: float) -> tuple[int, int]:
        qx = max(0, min(TILE_EXTENT, round((lon - west) / span_lon * TILE_EXTENT)))
        qy = max(0, min(TILE_EXTENT, round((north - lat) / span_lat * TILE_EXTENT)))
        return qx, qy

    return convert


def _dequantise(z: int, x: int, y: int):
    west, south, east, north = _tile_bounds(z, x, y)
    span_lon = east - west
    span_lat = north - south

    def convert(qx: int, qy: int) -> tuple[float, float]:
        return west + qx / TILE_EXTENT * span_lon, north - qy / TILE_EXTENT * span_lat

    return convert


def _js_round(value: float) -> int:
    """JavaScript Math.round: halves go towards +Infinity, not to even."""
    return math.floor(value + 0.5)


def encode_feature_tile(tile: FeatureTile) -> bytes:
    writer = _Writer()
    writer.uint32(TFT_MAGIC)
    writer.byte(tile.z)
    writer.uint32(tile.x)
    writer.uint32(tile.y)
    writer.uint16(TILE_EXTENT)

    west, south, east, north = _tile_bounds(tile.z, tile.x, tile.y)
    span_lon = east - west
    span_lat = north - south

    def quantise(lon: float, lat: float) -> tuple[int, int]:
        qx = max(0, min(TILE_EXTENT, _js_round((lon - west) / span_lon * TILE_EXTENT)))
        qy = max(0, min(TILE_EXTENT, _js_round((north - lat) / span_lat * TILE_EXTENT)))
        return qx, qy

    writer.varint(len(tile.buildings))
    for building in tile.buildings:
        writer.varint(len(building.ring))
        previous_x = previous_y = 0
        for lon, lat in building.ring:
            qx, qy = quantise(lon, lat)
            writer.zigzag(qx - previous_x)
            writer.zigzag(qy - previous_y)
            previous_x, previous_y = qx, qy
        writer.varint(max(0, _js_round(building.height_m * 10)))

    writer.varint(len(tile.roads))
    for road in tile.roads:
        writer.varint(len(road.line))
        try:
            index = ROAD_CLASSES.index(road.road_class)
        except ValueError:
            index = ROAD_CLASSES.index("residential")
        writer.byte(index)
        previous_x = previous_y = 0
        for lon, lat in road.line:
            qx, qy = quantise(lon, lat)
            writer.zigzag(qx - previous_x)
            writer.zigzag(qy - previous_y)
            previous_x, previous_y = qx, qy

    writer.varint(len(tile.landuse))
    for area in tile.landuse:
        writer.varint(len(area.ring))
        try:
            index = LANDUSE_CLASSES.index(area.landuse_class)
        except ValueError:
            index = LANDUSE_CLASSES.index("grass")
        writer.byte(index)
        previous_x = previous_y = 0
        for lon, lat in area.ring:
            qx, qy = quantise(lon, lat)
            writer.zigzag(qx - previous_x)
            writer.zigzag(qy - previous_y)
            previous_x, previous_y = qx, qy

    return bytes(writer.data)


def decode_feature_tile(data: bytes) -> FeatureTile:
    reader = _Reader(data)
    if reader.uint32() != TFT_MAGIC:
        raise ValueError("not a terrDVM feature tile")

    z = reader.byte()
    x = reader.uint32()
    y = reader.uint32()
    extent = reader.uint16()
    if extent != TILE_EXTENT:
        raise ValueError(f"unsupported feature-tile extent {extent}")

    dequantise = _dequantise(z, x, y)
    tile = FeatureTile(z=z, x=x, y=y)

    for _ in range(reader.varint()):
        point_count = reader.varint()
        ring: list[tuple[float, float]] = []
        qx = qy = 0
        for _ in range(point_count):
            qx += reader.zigzag()
            qy += reader.zigzag()
            ring.append(dequantise(qx, qy))
        tile.buildings.append(Building(ring=ring, height_m=reader.varint() / 10))

    for _ in range(reader.varint()):
        point_count = reader.varint()
        class_index = reader.byte()
        line: list[tuple[float, float]] = []
        qx = qy = 0
        for _ in range(point_count):
            qx += reader.zigzag()
            qy += reader.zigzag()
            line.append(dequantise(qx, qy))
        road_class = (
            ROAD_CLASSES[class_index]
            if 0 <= class_index < len(ROAD_CLASSES)
            else "residential"
        )
        tile.roads.append(Road(line=line, road_class=road_class))

    for _ in range(reader.varint()):
        point_count = reader.varint()
        class_index = reader.byte()
        ring = []
        qx = qy = 0
        for _ in range(point_count):
            qx += reader.zigzag()
            qy += reader.zigzag()
            ring.append(dequantise(qx, qy))
        landuse_class = (
            LANDUSE_CLASSES[class_index]
            if 0 <= class_index < len(LANDUSE_CLASSES)
            else "grass"
        )
        tile.landuse.append(Landuse(ring=ring, landuse_class=landuse_class))

    return tile
