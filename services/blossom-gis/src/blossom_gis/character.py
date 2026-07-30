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


def _node_world_matrices(gltf: dict) -> dict[int, list[list[float]]]:
    """World matrix per node index (column vectors), TRS or matrix form."""

    def local(node: dict) -> list[list[float]]:
        if "matrix" in node:
            m = node["matrix"]
            return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
        tx, ty, tz = node.get("translation", [0, 0, 0])
        qx, qy, qz, qw = node.get("rotation", [0, 0, 0, 1])
        sx, sy, sz = node.get("scale", [1, 1, 1])
        xx, yy, zz = qx * qx, qy * qy, qz * qz
        xy, xz, yz = qx * qy, qx * qz, qy * qz
        wx, wy, wz = qw * qx, qw * qy, qw * qz
        return [
            [(1 - 2 * (yy + zz)) * sx, 2 * (xy - wz) * sy, 2 * (xz + wy) * sz, tx],
            [2 * (xy + wz) * sx, (1 - 2 * (xx + zz)) * sy, 2 * (yz - wx) * sz, ty],
            [2 * (xz - wy) * sx, 2 * (yz + wx) * sy, (1 - 2 * (xx + yy)) * sz, tz],
            [0, 0, 0, 1],
        ]

    def multiply(a, b):
        return [
            [sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)
        ]

    world: dict[int, list[list[float]]] = {}

    def visit(index: int, parent):
        node = gltf["nodes"][index]
        matrix = multiply(parent, local(node))
        world[index] = matrix
        for child in node.get("children", []):
            visit(child, matrix)

    identity = [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]
    for root in gltf.get("scenes", [{}])[gltf.get("scene", 0)].get("nodes", []):
        visit(root, identity)
    return world


def _basecolor_image(gltf: dict, binary: bytes) -> tuple[bytes, str] | None:
    """Follow material → texture → image to the embedded baseColor bytes."""
    materials = gltf.get("materials", [])
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            material_index = primitive.get("material")
            if material_index is None or material_index >= len(materials):
                continue
            pbr = materials[material_index].get("pbrMetallicRoughness", {})
            texture_index = pbr.get("baseColorTexture", {}).get("index")
            if texture_index is None:
                continue
            source = gltf.get("textures", [{}])[texture_index].get("source")
            if source is None:
                continue
            image = gltf.get("images", [])[source]
            view_index = image.get("bufferView")
            mime = image.get("mimeType")
            if view_index is None or not mime:
                continue
            view = gltf["bufferViews"][view_index]
            start = view.get("byteOffset", 0)
            return binary[start : start + view["byteLength"]], mime
    return None


def decode_draco_geometry(
    payload: bytes,
) -> tuple[list[float], list[float], list[float] | None, list[int], tuple[bytes, str] | None]:
    """Decode a Draco GLB into flat arrays: positions, normals, uvs, indices, skin."""
    import DracoPy

    magic, version, _total = struct.unpack_from("<III", payload, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError("not a glTF 2.0 binary container")
    json_length, json_type = struct.unpack_from("<II", payload, 12)
    if json_type != CHUNK_JSON:
        raise ValueError("first chunk is not JSON")
    gltf = json.loads(payload[20 : 20 + json_length])
    bin_start = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", payload, bin_start)
    if bin_type != CHUNK_BIN:
        raise ValueError("second chunk is not BIN")
    binary = payload[bin_start + 8 : bin_start + 8 + bin_length]

    world = _node_world_matrices(gltf)
    positions: list[float] = []
    normals: list[float] = []
    uvs: list[float] = []
    indices: list[int] = []
    has_all_uvs = True

    for node_index, matrix in world.items():
        mesh_index = gltf["nodes"][node_index].get("mesh")
        if mesh_index is None:
            continue
        for primitive in gltf["meshes"][mesh_index].get("primitives", []):
            draco = primitive.get("extensions", {}).get("KHR_draco_mesh_compression")
            if not draco:
                continue
            view = gltf["bufferViews"][draco["bufferView"]]
            start = view.get("byteOffset", 0)
            decoded = DracoPy.decode(binary[start : start + view["byteLength"]])
            base = len(positions) // 3
            has_normals = decoded.normals is not None and len(decoded.normals) > 0
            tex_coord = getattr(decoded, "tex_coord", None)
            has_uvs = tex_coord is not None and len(tex_coord) > 0
            if not has_uvs:
                has_all_uvs = False
            for i, point in enumerate(decoded.points):
                x, y, z = float(point[0]), float(point[1]), float(point[2])
                positions.extend(
                    [
                        matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
                        matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
                        matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3],
                    ]
                )
                if has_normals:
                    nx, ny, nz = (float(v) for v in decoded.normals[i])
                    tx = matrix[0][0] * nx + matrix[0][1] * ny + matrix[0][2] * nz
                    ty = matrix[1][0] * nx + matrix[1][1] * ny + matrix[1][2] * nz
                    tz = matrix[2][0] * nx + matrix[2][1] * ny + matrix[2][2] * nz
                    length = (tx * tx + ty * ty + tz * tz) ** 0.5 or 1.0
                    normals.extend([tx / length, ty / length, tz / length])
                else:
                    normals.extend([0.0, 1.0, 0.0])
                if has_uvs:
                    uvs.extend([float(tex_coord[i][0]), float(tex_coord[i][1])])
                else:
                    uvs.extend([0.0, 0.0])
            for face in decoded.faces:
                indices.extend([base + int(face[0]), base + int(face[1]), base + int(face[2])])

    if not positions:
        raise ValueError("no draco geometry found")
    texture = _basecolor_image(gltf, binary)
    return (
        positions,
        normals,
        uvs if has_all_uvs and uvs else None,
        indices,
        texture,
    )


def transcode_draco_glb(payload: bytes) -> bytes:
    """Decode a Draco-compressed GLB into a plain-geometry GLB.

    Geometry, TEXCOORD_0 and the embedded baseColor image survive the trip;
    skins and animations do not. Node transforms are applied so the merged
    mesh stands the way its author posed it.
    """
    positions, normals, uvs, indices, texture = decode_draco_geometry(payload)
    return _pack_glb(positions, normals, indices, uvs=uvs, texture=texture)


def _pack_glb(
    positions: list[float],
    normals: list[float],
    indices: list[int],
    uvs: list[float] | None = None,
    texture: tuple[bytes, str] | None = None,
) -> bytes:
    """Assemble plain geometry — plus an optional painted skin — into a
    byte-stable binary glTF."""
    position_bytes = struct.pack(f"<{len(positions)}f", *positions)
    normal_bytes = struct.pack(f"<{len(normals)}f", *normals)
    index_bytes = struct.pack(f"<{len(indices)}I", *indices)

    chunks = [position_bytes, normal_bytes, index_bytes]
    buffer_views: list[dict] = []
    offset = 0
    for chunk in chunks:
        buffer_views.append({"buffer": 0, "byteLength": len(chunk), "byteOffset": offset})
        offset += len(chunk)

    accessors: list[dict] = [
        {
            "bufferView": 0,
            "componentType": 5126,
            "count": len(positions) // 3,
            "max": [max(positions[i::3]) for i in range(3)],
            "min": [min(positions[i::3]) for i in range(3)],
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
            "componentType": 5125,
            "count": len(indices),
            "type": "SCALAR",
        },
    ]
    attributes = {"NORMAL": 1, "POSITION": 0}
    primitive: dict = {"attributes": attributes, "indices": 2}

    if uvs:
        uv_bytes = struct.pack(f"<{len(uvs)}f", *uvs)
        chunks.append(uv_bytes)
        buffer_views.append({"buffer": 0, "byteLength": len(uv_bytes), "byteOffset": offset})
        offset += len(uv_bytes)
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(uvs) // 2,
                "type": "VEC2",
            }
        )
        attributes["TEXCOORD_0"] = len(accessors) - 1

    gltf = {
        "asset": {"generator": "terrdvm-transcode", "version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [primitive]}],
    }

    if texture and uvs:
        image_bytes, mime = texture
        if offset % 4:
            padding = b"\x00" * (4 - offset % 4)
            chunks.append(padding)
            offset += len(padding)
        chunks.append(image_bytes)
        buffer_views.append(
            {"buffer": 0, "byteLength": len(image_bytes), "byteOffset": offset}
        )
        offset += len(image_bytes)
        gltf["images"] = [{"bufferView": len(buffer_views) - 1, "mimeType": mime}]
        gltf["samplers"] = [
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
        ]
        gltf["textures"] = [{"sampler": 0, "source": 0}]
        gltf["materials"] = [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}
        ]
        primitive["material"] = 0

    binary = b"".join(chunks)
    # GLB chunks must be 4-byte aligned; a JPEG tail rarely is.
    if len(binary) % 4:
        binary += b"\x00" * (4 - len(binary) % 4)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    gltf["bufferViews"] = buffer_views
    gltf["accessors"] = accessors

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
