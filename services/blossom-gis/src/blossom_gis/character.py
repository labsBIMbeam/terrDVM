"""A deterministic low-poly character, published as a content-addressed blob.

The figure is built from cuboids — legs, torso, arms, head — about 1.7 m
tall, Y-up, facing -Z, in metres: exactly the frame the napplet viewer walks
in. Determinism is the point: identical bytes on every machine mean an
identical SHA-256, so the client can address the character by hash without
any registry.
"""

from __future__ import annotations

import json
import struct

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

#: (min_x, min_y, min_z, max_x, max_y, max_z) per cuboid, metres.
CHARACTER_BOXES: tuple[tuple[float, float, float, float, float, float], ...] = (
    (-0.20, 0.0, -0.11, -0.02, 0.80, 0.11),  # left leg
    (0.02, 0.0, -0.11, 0.20, 0.80, 0.11),  # right leg
    (-0.23, 0.80, -0.14, 0.23, 1.45, 0.14),  # torso
    (-0.35, 0.85, -0.10, -0.23, 1.40, 0.10),  # left arm
    (0.23, 0.85, -0.10, 0.35, 1.40, 0.10),  # right arm
    (-0.12, 1.45, -0.12, 0.12, 1.72, 0.12),  # head
)

_FACES = (
    # (axis, direction): four corners per face, counter-clockwise from outside.
    ((0, 1), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
    ((0, -1), ((0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0))),
    ((1, 1), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0))),
    ((1, -1), ((0, 0, 1), (0, 0, 0), (1, 0, 0), (1, 0, 1))),
    ((2, 1), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),
    ((2, -1), ((1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0))),
)


def _box_geometry(
    box: tuple[float, float, float, float, float, float], base: int
) -> tuple[list[float], list[float], list[int]]:
    minimum = box[:3]
    maximum = box[3:]
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for (axis, direction), corners in _FACES:
        normal = [0.0, 0.0, 0.0]
        normal[axis] = float(direction)
        start = base + len(positions) // 3
        for corner in corners:
            for component in range(3):
                bound = maximum[component] if corner[component] else minimum[component]
                positions.append(bound)
            normals.extend(normal)
        indices.extend([start, start + 1, start + 2, start, start + 2, start + 3])
    return positions, normals, indices


def build_character_glb() -> bytes:
    """Assemble the figure into a byte-stable binary glTF."""
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for box in CHARACTER_BOXES:
        box_positions, box_normals, box_indices = _box_geometry(box, len(positions) // 3)
        positions.extend(box_positions)
        normals.extend(box_normals)
        indices.extend(box_indices)

    position_bytes = struct.pack(f"<{len(positions)}f", *positions)
    normal_bytes = struct.pack(f"<{len(normals)}f", *normals)
    index_bytes = struct.pack(f"<{len(indices)}H", *indices)
    if len(index_bytes) % 4:
        index_bytes += b"\x00\x00"
    binary = position_bytes + normal_bytes + index_bytes

    minimum = [min(positions[i::3]) for i in range(3)]
    maximum = [max(positions[i::3]) for i in range(3)]
    gltf = {
        "asset": {"generator": "terrdvm-character", "version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"NORMAL": 1, "POSITION": 0}, "indices": 2}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteLength": len(position_bytes), "byteOffset": 0},
            {
                "buffer": 0,
                "byteLength": len(normal_bytes),
                "byteOffset": len(position_bytes),
            },
            {
                "buffer": 0,
                "byteLength": len(index_bytes),
                "byteOffset": len(position_bytes) + len(normal_bytes),
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions) // 3,
                "max": maximum,
                "min": minimum,
                "type": "VEC3",
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(normals) // 3,
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
    }
    payload = json.dumps(gltf, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(payload) % 4:
        payload += b" " * (4 - len(payload) % 4)

    total = 12 + 8 + len(payload) + 8 + len(binary)
    return b"".join(
        [
            struct.pack("<III", GLB_MAGIC, 2, total),
            struct.pack("<II", len(payload), CHUNK_JSON),
            payload,
            struct.pack("<II", len(binary), CHUNK_BIN),
            binary,
        ]
    )
