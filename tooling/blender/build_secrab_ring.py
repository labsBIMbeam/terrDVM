"""Build the demo intro v2: the roster, the crab, the fall of Vienna — and a goose.

A 21-second (504 frames @ 24 fps) film assembled deterministically from
cached DVM artifacts and last week's 600BillionCWO bundle:

* terrain      — cached Mapzen terrarium tiles (z14) for the Ring selection
* orthophoto   — the basemap.at bake the collection server produced
* buildings    — Vienna Baukoerpermodell WFS pull (measured part heights)
* secrab       — blossom-transcoded rest pose + gait-frame blobs (shape keys)
* roster       — every lore character from the blossom store, 10 m tall,
                 lined up close so the whole cast reads in one pass
* balloons     — MESHNET_BALLOONS_ASSET appended from last week's
                 SECrab_Morph_Assets.blend (orange, as the finale demands)
* goose        — a deterministic toy goose built from primitives; the beaten
                 crab's spirit rises under orange balloons
* end card     — SEC brandmark from art/brand/

Storyboard: dolly along the assembled roster (0-4.5 s) -> secrab enters and
slowly wrecks the Ring (6-18 s, 236 corridor parts topple) -> the giants
close in and put the crab on its back (16.5-19 s) -> a goose rises from the
fallen crab under orange balloons, SEC end card (18.5-21 s).

Run inside Blender:
    exec(compile(open(PATH, encoding="utf-8").read(), PATH, "exec"))

QA stills render immediately; the full sequence renders afterwards with
`blender -b art/blender/secrab_ring.blend -a` and is encoded with ffmpeg.
"""

from __future__ import annotations

import json
import math
import shutil
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector

DATA = Path(r"G:\Github\.local\blossom-gis")
ROOT = Path(r"G:\Github\terrDVM")
BUNDLE = Path(
    r"G:\workspace\20_PROJECTS\600BillionCWO\exports"
    r"\SECrab_Animation_Windows_Fable_Bundle\SECrab_Animation_Windows_Fable_Bundle"
)
BLEND_OUT = ROOT / "art" / "blender" / "secrab_ring.blend"
PREVIEW_DIR = ROOT / "docs" / "demo" / "secrab-ring"
BRANDMARK = ROOT / "art" / "brand" / "sec-05-brandmark-white-on-black-1080x1920.png"

#: The Ring selection exactly as generated in the napplet (prewarm "ring").
BBOX = (16.355, 48.195, 16.385, 48.215)
DEM_ZOOM = 14
WFS_JSON = DATA / "cache" / "wfs" / "11f9b5180e268ba2.json"
ORTHO_JPG = DATA / "textures" / "vienna-00a68583fd27bb39.jpg"

CRAB_HEIGHT_M = 42.0
AVATAR_HEIGHT_M = 10.0
FPS = 24
END_FRAME = 504  # 21 seconds, and not one frame more
CORRIDOR_M = 55.0

#: secrab's shortened, slower walk: Oper -> Burgring -> Parlament.
WAYPOINTS_LONLAT = (
    (16.3690, 48.2022),
    (16.3617, 48.2038),
    (16.3597, 48.2078),
)
WALK_START_F = 150
WALK_END_F = 368
GAIT_CYCLE_S = 2.2

#: The roster assembles on the Heldenplatz, shoulder to shoulder.
ROSTER_CENTER = (16.3640, 48.2062)
ROSTER_SPACING = 16.0

#: The finale breathes: takedown, then almost five seconds for the goose.
ATTACK_START_F = 340
TOPPLE_F = 376
TOPPLE_END_F = 400
GOOSE_RISE_START_F = 388

#: The twin museums on the Maria-Theresien-Platz go down as the crab passes:
#: (lon, lat, radius m) demolition zones beyond the walking corridor.
LANDMARK_DEMOLITIONS = (
    (16.3616, 48.2036, 95.0),  # Kunsthistorisches Museum
    (16.3596, 48.2050, 95.0),  # Naturhistorisches Museum
)

GRID_N = 200

# --- Geography -----------------------------------------------------------------

MID_LAT = math.radians((BBOX[1] + BBOX[3]) / 2)
WIDTH_M = (BBOX[2] - BBOX[0]) * 111_320 * math.cos(MID_LAT)
DEPTH_M = (BBOX[3] - BBOX[1]) * 110_540


def local_xy(lon: float, lat: float) -> tuple[float, float]:
    """Metres east/north of the selection centre (Blender X east, Y north)."""
    x = ((lon - BBOX[0]) / (BBOX[2] - BBOX[0]) - 0.5) * WIDTH_M
    y = ((lat - BBOX[1]) / (BBOX[3] - BBOX[1]) - 0.5) * DEPTH_M
    return x, y


def _mercator_px(lon: float, lat: float) -> tuple[float, float]:
    n = (2**DEM_ZOOM) * 256
    px = (lon + 180.0) / 360.0 * n
    rad = math.radians(lat)
    py = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * n
    return px, py


def load_dem_grid() -> list[list[float]]:
    """Sample the cached terrarium tiles into a GRID_N x GRID_N elevation grid."""
    tiles: dict[tuple[int, int], list[float]] = {}

    def tile_pixels(tx: int, ty: int) -> list[float]:
        key = (tx, ty)
        if key not in tiles:
            path = DATA / "cache" / "dem" / str(DEM_ZOOM) / str(tx) / f"{ty}.png"
            image = bpy.data.images.load(str(path))
            tiles[key] = list(image.pixels)
            bpy.data.images.remove(image)
        return tiles[key]

    grid: list[list[float]] = []
    for row in range(GRID_N):
        lat = BBOX[3] - (row / (GRID_N - 1)) * (BBOX[3] - BBOX[1])
        line: list[float] = []
        for col in range(GRID_N):
            lon = BBOX[0] + (col / (GRID_N - 1)) * (BBOX[2] - BBOX[0])
            px, py = _mercator_px(lon, lat)
            tx, ty = int(px // 256), int(py // 256)
            ix, iy = int(px % 256), int(py % 256)
            pixels = tile_pixels(tx, ty)
            # Blender image rows start at the BOTTOM of the picture.
            offset = ((255 - iy) * 256 + ix) * 4
            r = pixels[offset] * 255.0
            g = pixels[offset + 1] * 255.0
            b = pixels[offset + 2] * 255.0
            line.append((r * 256.0 + g + b / 256.0) - 32768.0)
        grid.append(line)
    return grid


def make_ground_sampler(grid: list[list[float]], base: float):
    """Bilinear elevation above scene zero at local metres (x east, y north)."""

    def ground_at(x: float, y: float) -> float:
        u = min(1.0, max(0.0, x / WIDTH_M + 0.5)) * (GRID_N - 1)
        v = min(1.0, max(0.0, 0.5 - y / DEPTH_M)) * (GRID_N - 1)
        c0, r0 = int(u), int(v)
        c1, r1 = min(GRID_N - 1, c0 + 1), min(GRID_N - 1, r0 + 1)
        fu, fv = u - c0, v - r0
        return (
            grid[r0][c0] * (1 - fu) * (1 - fv)
            + grid[r0][c1] * fu * (1 - fv)
            + grid[r1][c0] * (1 - fu) * fv
            + grid[r1][c1] * fu * fv
        ) - base

    return ground_at


# --- Scene pieces ---------------------------------------------------------------


def build_terrain(grid: list[list[float]], base: float) -> bpy.types.Object:
    verts: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    for row in range(GRID_N):
        y = (0.5 - row / (GRID_N - 1)) * DEPTH_M
        for col in range(GRID_N):
            x = (col / (GRID_N - 1) - 0.5) * WIDTH_M
            verts.append((x, y, grid[row][col] - base))
            uvs.append((col / (GRID_N - 1), 1.0 - row / (GRID_N - 1)))
    faces = []
    for row in range(GRID_N - 1):
        for col in range(GRID_N - 1):
            a = row * GRID_N + col
            faces.append((a, a + 1, a + GRID_N + 1, a + GRID_N))

    mesh = bpy.data.meshes.new("Ring Terrain")
    mesh.from_pydata(verts, [], faces)
    uv_layer = mesh.uv_layers.new(name="Ortho")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    mesh.update()

    material = bpy.data.materials.new("Ring Ortho")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(ORTHO_JPG))
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])

    obj = bpy.data.objects.new("Ring Terrain", mesh)
    obj.data.materials.append(material)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _path_points() -> list[Vector]:
    return [Vector((*local_xy(lon, lat), 0.0)) for lon, lat in WAYPOINTS_LONLAT]


def _distance_to_path(point: Vector, path: list[Vector]) -> tuple[float, float]:
    """(distance, 0..1 parameter along the whole path) for the closest point."""
    total = sum((path[i + 1] - path[i]).length for i in range(len(path) - 1))
    best = (1e9, 0.0)
    walked = 0.0
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        ab = b - a
        seg = ab.length
        t = max(0.0, min(1.0, (point - a).dot(ab) / (seg * seg)))
        d = (point - (a + ab * t)).length
        if d < best[0]:
            best = (d, (walked + t * seg) / total)
        walked += seg
    return best


def build_buildings(ground_at) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    """Static mass of the city plus separate destructibles along the path."""
    with open(WFS_JSON, encoding="utf-8") as f:
        collection = json.load(f)

    path = _path_points()
    static_verts: list[tuple[float, float, float]] = []
    static_faces: list[tuple[int, ...]] = []
    destructibles: list[bpy.types.Object] = []

    # Facades: a window grid carved into the plaster — Vienna's walls read
    # as buildings, not as extruded blocks. Cells ride on a dedicated UV
    # layer scaled to ~3 m window columns and ~4.5 m storeys.
    material = bpy.data.materials.new("Ring Facade")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.74, 0.7, 0.62, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    uv_node = material.node_tree.nodes.new("ShaderNodeUVMap")
    uv_node.uv_map = "Facade"
    windows = material.node_tree.nodes.new("ShaderNodeTexBrick")
    windows.offset = 0.0
    windows.inputs["Scale"].default_value = 1.0
    # One brick per UV cell: a 3 m window bay per storey, glass ~70 % of it.
    windows.inputs["Brick Width"].default_value = 1.0
    windows.inputs["Row Height"].default_value = 1.0
    windows.inputs["Mortar Size"].default_value = 0.15
    windows.inputs["Color1"].default_value = (0.14, 0.18, 0.24, 1.0)
    windows.inputs["Color2"].default_value = (0.2, 0.2, 0.17, 1.0)
    windows.inputs["Mortar"].default_value = (0.74, 0.7, 0.62, 1.0)
    material.node_tree.links.new(uv_node.outputs["UV"], windows.inputs["Vector"])
    material.node_tree.links.new(windows.outputs["Color"], bsdf.inputs["Base Color"])

    # Roofs wear the orthophoto: the aerial image IS the roofscape, exactly
    # as the napplet viewer drapes it.
    roof = bpy.data.materials.new("Ring Roof Ortho")
    roof.use_nodes = True
    roof_bsdf = roof.node_tree.nodes["Principled BSDF"]
    roof_bsdf.inputs["Roughness"].default_value = 0.95
    roof_texture = roof.node_tree.nodes.new("ShaderNodeTexImage")
    ortho_image = bpy.data.images.get("vienna-00a68583fd27bb39.jpg")
    roof_texture.image = ortho_image or bpy.data.images.load(str(ORTHO_JPG))
    roof_uv = roof.node_tree.nodes.new("ShaderNodeUVMap")
    roof_uv.uv_map = "Ortho"
    roof.node_tree.links.new(roof_uv.outputs["UV"], roof_texture.inputs["Vector"])
    roof.node_tree.links.new(
        roof_texture.outputs["Color"], roof_bsdf.inputs["Base Color"])

    def apply_surface(mesh: bpy.types.Mesh, offset_x: float, offset_y: float) -> None:
        """Ortho UVs on roofs, window-grid UVs on walls, materials to match."""
        ortho_uv = mesh.uv_layers.new(name="Ortho")
        facade_uv = mesh.uv_layers.new(name="Facade")
        for poly in mesh.polygons:
            if abs(poly.normal.z) > 0.7:
                poly.material_index = 1
            first = mesh.vertices[mesh.loops[poly.loop_indices[0]].vertex_index].co
            for loop_index in poly.loop_indices:
                co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                ortho_uv.data[loop_index].uv = (
                    (co.x + offset_x) / WIDTH_M + 0.5,
                    (co.y + offset_y) / DEPTH_M + 0.5,
                )
                # Walls: u walks along the wall in 3 m windows, v climbs in
                # 4.5 m storeys.
                along = math.hypot(co.x - first.x, co.y - first.y)
                facade_uv.data[loop_index].uv = (along / 3.0, co.z / 4.5)

    def add_prism(ring: list[tuple[float, float]], z0: float, height: float,
                  verts: list, faces: list) -> None:
        base = len(verts)
        count = len(ring)
        for x, y in ring:
            verts.append((x, y, z0))
        for x, y in ring:
            verts.append((x, y, z0 + height))
        for i in range(count):
            j = (i + 1) % count
            faces.append((base + i, base + j, base + count + j, base + count + i))
        faces.append(tuple(base + count + i for i in range(count)))

    kept = 0
    for feature in collection.get("features", []):
        props = feature.get("properties", {})
        o_kote, t_kote = props.get("O_KOTE"), props.get("T_KOTE")
        if o_kote is None or t_kote is None:
            continue
        height = o_kote - t_kote
        if not (1.5 <= height <= 220.0):
            continue
        geometry = feature.get("geometry") or {}
        polygons = (
            geometry.get("coordinates", [])
            if geometry.get("type") == "MultiPolygon"
            else [geometry.get("coordinates", [])]
        )
        for polygon in polygons:
            if not polygon or not polygon[0]:
                continue
            ring = [local_xy(pt[0], pt[1]) for pt in polygon[0][:-1]]
            if len(ring) < 3:
                continue
            cx = sum(p[0] for p in ring) / len(ring)
            cy = sum(p[1] for p in ring) / len(ring)
            z0 = ground_at(cx, cy)
            kept += 1
            distance, along = _distance_to_path(Vector((cx, cy, 0.0)), path)
            # Landmarks beyond the corridor fall the moment the crab draws
            # level with them.
            if distance > CORRIDOR_M:
                for lon, lat, radius in LANDMARK_DEMOLITIONS:
                    zx, zy = local_xy(lon, lat)
                    if math.hypot(cx - zx, cy - zy) <= radius:
                        distance, along = 0.0, _distance_to_path(
                            Vector((zx, zy, 0.0)), path)[1]
                        break
            if distance <= CORRIDOR_M:
                verts: list = []
                faces: list = []
                add_prism([(x - cx, y - cy) for x, y in ring], 0.0, height, verts, faces)
                mesh = bpy.data.meshes.new("Destructible")
                mesh.from_pydata(verts, [], faces)
                mesh.update()
                obj = bpy.data.objects.new("Destructible", mesh)
                obj.location = (cx, cy, z0)
                obj.data.materials.append(material)
                obj.data.materials.append(roof)
                apply_surface(mesh, cx, cy)
                obj["hit_along"] = along
                # ID properties are C ints; the FMZK id only seeds the crush.
                obj["fmzk"] = int(props.get("FMZK_ID") or 0) % 1_000_000_000
                bpy.context.scene.collection.objects.link(obj)
                destructibles.append(obj)
            else:
                add_prism(ring, z0, height, static_verts, static_faces)

    mesh = bpy.data.meshes.new("Ring Buildings")
    mesh.from_pydata(static_verts, [], static_faces)
    mesh.update()
    static = bpy.data.objects.new("Ring Buildings", mesh)
    static.data.materials.append(material)
    static.data.materials.append(roof)
    apply_surface(mesh, 0.0, 0.0)
    bpy.context.scene.collection.objects.link(static)
    print(f"buildings: {kept} parts, {len(destructibles)} destructible")
    return static, destructibles


def import_blob_glb(sha: str, name: str) -> bpy.types.Object:
    blob = DATA / "blobs" / sha[:2] / sha[2:4] / sha
    temp = Path(tempfile.gettempdir()) / f"{sha[:16]}.glb"
    shutil.copyfile(blob, temp)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(temp))
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    obj = imported[0]
    obj.name = name
    return obj


def _normalize_feet(obj: bpy.types.Object, target_height: float) -> float:
    """Uniform-scale to target height; returns the z offset that puts feet at 0."""
    bpy.context.view_layer.update()
    bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_z = min(v.z for v in bounds)
    max_z = max(v.z for v in bounds)
    scale = target_height / max(1e-6, max_z - min_z)
    obj.scale = (scale, scale, scale)
    return -min_z * scale


def build_roster(ground_at, manifest: dict) -> list[bpy.types.Object]:
    """The whole cast, 10 m tall, shoulder to shoulder on the Heldenplatz."""
    names = sorted(name for name in manifest if name != "secrab")
    cx, cy = local_xy(*ROSTER_CENTER)
    roster: list[bpy.types.Object] = []
    for index, name in enumerate(names):
        entry = manifest[name]
        avatar = import_blob_glb(entry["sha256"], f"roster_{name}")
        foot_z = _normalize_feet(avatar, AVATAR_HEIGHT_M)
        x = cx + (index - (len(names) - 1) / 2.0) * ROSTER_SPACING
        # A gentle arc, so the line reads as a gathering, not a police lineup.
        y = cy + 10.0 * math.sin(index / max(1, len(names) - 1) * math.pi)
        avatar.location = (x, y, ground_at(x, y) + foot_z)
        # Imported glTF faces -Y: rotation zero already looks at the camera
        # side of the square.
        avatar.rotation_euler = (0.0, 0.0, 0.0)
        avatar["foot_z"] = foot_z
        roster.append(avatar)
    print(f"roster: {len(roster)} characters on the platz")
    return roster


def build_crab(ground_at, manifest: dict) -> bpy.types.Object:
    entry = manifest["secrab"]
    crab = import_blob_glb(entry["sha256"], "secrab")

    # The gait frames share vertex order with the rest pose, so each one
    # becomes a shape key of the same mesh — via the data API, which needs
    # no operator context.
    crab.shape_key_add(name="Basis", from_mix=False)
    buffer = [0.0] * (len(crab.data.vertices) * 3)
    for index, sha in enumerate(dict.fromkeys(entry.get("frames", []))):
        frame_obj = import_blob_glb(sha, f"secrab_frame_{index}")
        frame_obj.data.vertices.foreach_get("co", buffer)
        key = crab.shape_key_add(name=f"frame_{index}", from_mix=False)
        key.data.foreach_set("co", buffer)
        mesh = frame_obj.data
        bpy.data.objects.remove(frame_obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)

    crab["foot_z"] = _normalize_feet(crab, CRAB_HEIGHT_M)
    start = _path_points()[0]
    crab.location = (start.x, start.y, ground_at(start.x, start.y) + crab["foot_z"])
    return crab


def _sphere_geometry(segments: int = 24, rings: int = 12) -> tuple[list, list]:
    """Unit UV sphere as raw geometry — no operator context required."""
    verts: list[tuple[float, float, float]] = [(0.0, 0.0, 1.0)]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        for segment in range(segments):
            theta = 2.0 * math.pi * segment / segments
            verts.append((
                math.sin(phi) * math.cos(theta),
                math.sin(phi) * math.sin(theta),
                math.cos(phi),
            ))
    verts.append((0.0, 0.0, -1.0))
    bottom = len(verts) - 1
    faces: list[tuple[int, ...]] = []
    for segment in range(segments):
        faces.append((0, 1 + segment, 1 + (segment + 1) % segments))
    for ring in range(rings - 2):
        a = 1 + ring * segments
        b = 1 + (ring + 1) * segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            faces.append((a + segment, b + segment, b + nxt, a + nxt))
    last = 1 + (rings - 2) * segments
    for segment in range(segments):
        faces.append((bottom, last + (segment + 1) % segments, last + segment))
    return verts, faces


def _cone_geometry(segments: int = 12, radius: float = 1.0,
                   depth: float = 1.0) -> tuple[list, list]:
    """Unit cone (tip up) as raw geometry."""
    verts = [(0.0, 0.0, depth / 2.0)]
    for segment in range(segments):
        theta = 2.0 * math.pi * segment / segments
        verts.append((radius * math.cos(theta), radius * math.sin(theta), -depth / 2.0))
    faces: list[tuple[int, ...]] = []
    for segment in range(segments):
        faces.append((0, 1 + segment, 1 + (segment + 1) % segments))
    faces.append(tuple(range(segments, 0, -1)))
    return verts, faces


def build_toy_goose() -> bpy.types.Object:
    """A deterministic toy goose: white body, orange beak and feet."""

    def flat(name: str, color: tuple[float, float, float]) -> bpy.types.Material:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        material.node_tree.nodes["Principled BSDF"].inputs[
            "Base Color"].default_value = (*color, 1.0)
        return material

    white = flat("Goose White", (0.93, 0.92, 0.88))
    orange = flat("Goose Orange", (1.0, 0.42, 0.0))
    black = flat("Goose Black", (0.05, 0.05, 0.05))

    goose = bpy.data.objects.new("Goose", None)
    bpy.context.scene.collection.objects.link(goose)

    def part(name: str, geometry: tuple[list, list], material: bpy.types.Material,
             location: tuple[float, float, float],
             scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
             rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> None:
        verts, faces = geometry
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        obj.data.materials.append(material)
        obj.location = location
        obj.scale = scale
        obj.rotation_euler = rotation
        obj.parent = goose
        bpy.context.scene.collection.objects.link(obj)

    sphere = _sphere_geometry()
    dot = _sphere_geometry(12, 8)
    # Metres; the goose faces -Y like every glTF import in this film.
    part("Goose Body", sphere, white, (0.0, 0.0, 1.1), (1.05, 1.45, 0.95))
    part("Goose Head", sphere, white, (0.0, -1.55, 2.55), (0.42, 0.46, 0.42))
    part("Goose Neck", sphere, white, (0.0, -1.15, 1.85), (0.24, 0.26, 0.75),
         (math.radians(28), 0.0, 0.0))
    part("Goose Beak", _cone_geometry(12, 0.16, 0.55), orange,
         (0.0, -2.05, 2.5), rotation=(math.radians(-90), 0.0, 0.0))
    part("Goose Eye L", dot, black, (0.2, -1.7, 2.68), (0.055, 0.055, 0.055))
    part("Goose Eye R", dot, black, (-0.2, -1.7, 2.68), (0.055, 0.055, 0.055))
    part("Goose Wing L", sphere, white, (0.85, 0.15, 1.25), (0.28, 1.0, 0.55),
         (0.0, math.radians(18), 0.0))
    part("Goose Wing R", sphere, white, (-0.85, 0.15, 1.25), (0.28, 1.0, 0.55),
         (0.0, math.radians(-18), 0.0))
    part("Goose Tail", sphere, white, (0.0, 1.35, 1.35), (0.4, 0.55, 0.3),
         (math.radians(-24), 0.0, 0.0))
    part("Goose Foot L", _cone_geometry(10, 0.3, 0.35), orange,
         (0.35, 0.1, 0.18), rotation=(math.radians(180), 0.0, 0.0))
    part("Goose Foot R", _cone_geometry(10, 0.3, 0.35), orange,
         (-0.35, 0.1, 0.18), rotation=(math.radians(180), 0.0, 0.0))
    return goose


def build_goose_rig(ground_at, crab_end: Vector) -> bpy.types.Object | None:
    """The beaten crab's spirit: a goose under orange balloon nodes."""
    morph = BUNDLE / "SECrab_Morph_Assets.blend"
    rig = bpy.data.objects.new("Goose Rig", None)
    bpy.context.scene.collection.objects.link(rig)

    goose = build_toy_goose()
    goose.parent = rig
    goose.location = (0.0, 0.0, 0.0)

    if morph.is_file():
        with bpy.data.libraries.load(str(morph), link=False) as (src, dst):
            dst.collections = ["MESHNET_BALLOONS_ASSET"]
        balloon_collection = dst.collections[0]
        bpy.context.scene.collection.children.link(balloon_collection)
        root = bpy.data.objects.get("MESHNET_BALLOONS_ROOT")
        if root is not None:
            bpy.context.view_layer.update()
            bounds_min = Vector((1e9, 1e9, 1e9))
            bounds_max = Vector((-1e9, -1e9, -1e9))
            for obj in balloon_collection.objects:
                if obj.type != "MESH":
                    continue
                for corner in obj.bound_box:
                    world = obj.matrix_world @ Vector(corner)
                    bounds_min = Vector(map(min, bounds_min, world))
                    bounds_max = Vector(map(max, bounds_max, world))
            spread = max(1e-6, max(bounds_max.x - bounds_min.x,
                                   bounds_max.y - bounds_min.y))
            factor = 26.0 / spread
            root.scale = (factor, factor, factor)
            root.parent = rig
            root.location = (0.0, 0.0, 3.2 - bounds_min.z * factor)
            # Hang the goose under the measured cluster floor (the harness
            # ring), not under an assumed one.
            bpy.context.view_layer.update()
            floor = 1e9
            for obj in balloon_collection.objects:
                if obj.type != "MESH":
                    continue
                for corner in obj.bound_box:
                    floor = min(floor, (obj.matrix_world @ Vector(corner)).z)
            goose.scale = (1.5, 1.5, 1.5)
            goose.location = (0.0, 0.0, floor / max(1e-6, rig.scale.z) - 4.6)

    # Twice life-size, so goose and balloons read from the finale camera.
    rig.scale = (2.0, 2.0, 2.0)
    ground = ground_at(crab_end.x, crab_end.y)
    # Parked out of sight below the city until the transformation.
    rig.location = (crab_end.x, crab_end.y, ground - 600.0)
    rig.keyframe_insert("location", frame=1)
    rig.keyframe_insert("location", frame=GOOSE_RISE_START_F - 2)
    rig.location = (crab_end.x, crab_end.y, ground + 2.0)
    rig.keyframe_insert("location", frame=GOOSE_RISE_START_F)
    rig.rotation_euler = (0.0, 0.0, 0.0)
    rig.keyframe_insert("rotation_euler", frame=GOOSE_RISE_START_F)
    rig.location = (crab_end.x + 30.0, crab_end.y - 24.0, ground + 320.0)
    rig.rotation_euler = (0.0, 0.0, math.radians(55))
    rig.keyframe_insert("location", frame=END_FRAME)
    rig.keyframe_insert("rotation_euler", frame=END_FRAME)
    return rig


def build_endcard(camera: bpy.types.Object) -> None:
    """SEC brandmark: full-frame black card with the mark, fading in late."""

    def flat_material(name: str, image_path: Path | None,
                      fade: tuple[int, int]) -> bpy.types.Material:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        material.blend_method = "BLEND"
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        emission = nodes.new("ShaderNodeEmission")
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        material.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
        material.node_tree.links.new(emission.outputs[0], mix.inputs[2])
        material.node_tree.links.new(mix.outputs[0], output.inputs["Surface"])
        if image_path is not None:
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = bpy.data.images.load(str(image_path))
            material.node_tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
        else:
            emission.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        fac = mix.inputs["Fac"]
        fac.default_value = 0.0
        fac.keyframe_insert("default_value", frame=fade[0])
        fac.default_value = 1.0
        fac.keyframe_insert("default_value", frame=fade[1])
        return material

    def card(name: str, size_x: float, size_y: float, distance: float,
             material: bpy.types.Material) -> None:
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(
            [(-size_x, -size_y, 0), (size_x, -size_y, 0), (size_x, size_y, 0), (-size_x, size_y, 0)],
            [],
            [(0, 1, 2, 3)],
        )
        uv_layer = mesh.uv_layers.new(name="UV")
        quad_uv = ((0, 0), (1, 0), (1, 1), (0, 1))
        for poly in mesh.polygons:
            for loop_index, uv in zip(poly.loop_indices, quad_uv):
                uv_layer.data[loop_index].uv = uv
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        obj.data.materials.append(material)
        obj.parent = camera
        obj.location = (0.0, 0.0, -distance)
        bpy.context.scene.collection.objects.link(obj)

    # Frame extents at 1 m for a 42 mm-ish lens: sensor 36 mm -> half width.
    half_width = (36.0 / 42.0) / 2.0
    half_height = half_width * 9.0 / 16.0
    # The frame fades to black first; the mark only appears on solid black,
    # so no card edge is ever visible mid-fade.
    card("Endcard Black", half_width * 1.2, half_height * 1.2, 1.0,
         flat_material("Endcard Black", None, fade=(484, 500)))
    mark_half_height = half_height * 0.92
    mark_half_width = mark_half_height * 1080.0 / 1920.0
    card("Endcard Mark", mark_half_width, mark_half_height, 0.98,
         flat_material("Endcard Mark", BRANDMARK, fade=(496, 503)))


def _all_fcurves(action) -> list:
    """F-curves across Blender's legacy and 5.x layered-action APIs."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


#: The city does not exist yet during the roster highlight; it is generated
#: before the viewer's eyes right after.
CITY_SPAWN_START_F = 112
CITY_SPAWN_END_F = 140


def animate(crab: bpy.types.Object, destructibles: list[bpy.types.Object],
            roster: list[bpy.types.Object], ground_at,
            static: bpy.types.Object) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = END_FRAME
    scene.render.fps = FPS

    # Only terrain and roster at first: after the avatar highlight the whole
    # city grows out of the map — the DVM generation made visible.
    for obj in [static, *destructibles]:
        obj.scale = (1.0, 1.0, 0.0008)
        obj.keyframe_insert("scale", frame=1)
        obj.keyframe_insert("scale", frame=CITY_SPAWN_START_F)
        obj.scale = (1.0, 1.0, 1.0)
        obj.keyframe_insert("scale", frame=CITY_SPAWN_END_F)

    path = _path_points()
    lengths = [(path[i + 1] - path[i]).length for i in range(len(path) - 1)]
    total = sum(lengths)

    def point_at(fraction: float) -> tuple[Vector, Vector]:
        walked = max(0.0, min(1.0, fraction)) * total
        for i, seg in enumerate(lengths):
            if walked <= seg or i == len(lengths) - 1:
                t = walked / seg
                position = path[i] + (path[i + 1] - path[i]) * t
                direction = (path[i + 1] - path[i]).normalized()
                return position, direction
            walked -= seg
        return path[-1], (path[-1] - path[-2]).normalized()

    foot_z = float(crab["foot_z"])

    def walk_fraction(frame: float) -> float:
        return max(0.0, min(1.0, (frame - WALK_START_F) / (WALK_END_F - WALK_START_F)))

    # The crab bursts from the ground once the city stands, then walks —
    # slower now, heavier.
    steps = 48
    for step in range(steps + 1):
        frame = 1 + (step / steps) * (TOPPLE_F - 1)
        fraction = walk_fraction(frame)
        position, direction = point_at(fraction)
        bob = abs(math.sin(fraction * 26.0)) * 1.1
        submerged = frame < CITY_SPAWN_END_F - 2
        crab.location = (
            position.x,
            position.y,
            (ground_at(position.x, position.y) + foot_z + bob) if not submerged
            else ground_at(position.x, position.y) - 90.0,
        )
        # Imported glTF faces -Y at rest; steer that nose along the path.
        crab.rotation_euler = (0.0, 0.0, math.atan2(direction.x, -direction.y))
        crab.keyframe_insert("location", frame=frame)
        crab.keyframe_insert("rotation_euler", frame=frame)

    # The takedown: the crab lurches, then goes over on its back.
    crab_end, end_direction = point_at(1.0)
    end_yaw = math.atan2(end_direction.x, -end_direction.y)
    ground_end = ground_at(crab_end.x, crab_end.y)
    crab.location = (crab_end.x, crab_end.y, ground_end + foot_z + 7.0)
    crab.rotation_euler = (math.radians(-18), 0.0, end_yaw)
    crab.keyframe_insert("location", frame=TOPPLE_F + 8)
    crab.keyframe_insert("rotation_euler", frame=TOPPLE_F + 8)
    crab.location = (crab_end.x, crab_end.y, ground_end + foot_z * 0.45)
    crab.rotation_euler = (math.radians(118), 0.0, end_yaw)
    crab.keyframe_insert("location", frame=TOPPLE_END_F)
    crab.keyframe_insert("rotation_euler", frame=TOPPLE_END_F)

    # Gait cycle until the fall, then stillness.
    shape_keys = crab.data.shape_keys
    if shape_keys:
        blocks = shape_keys.key_blocks[1:]  # skip Basis
        cycle_frames = int(GAIT_CYCLE_S * FPS)
        stride = max(1, cycle_frames // max(1, len(blocks)))
        for frame in range(1, TOPPLE_F + 1, stride):
            active = int(((frame / cycle_frames) % 1.0) * len(blocks)) % len(blocks)
            for index, block in enumerate(blocks):
                block.value = 1.0 if index == active else 0.0
                block.keyframe_insert("value", frame=frame)
        for block in blocks:
            block.value = 0.0
            block.keyframe_insert("value", frame=TOPPLE_F + 6)
        if shape_keys.animation_data and shape_keys.animation_data.action:
            for curve in _all_fcurves(shape_keys.animation_data.action):
                for point in curve.keyframe_points:
                    point.interpolation = "CONSTANT"

    # Buildings topple as the crab reaches them.
    for obj in destructibles:
        along = float(obj["hit_along"])
        hit = int(WALK_START_F + along * (WALK_END_F - WALK_START_F))
        seed = int(obj["fmzk"]) or 7
        lean = math.radians(18 + (seed % 17))
        tilt_axis = (seed >> 3) % 2
        sink = 0.35 + ((seed >> 5) % 20) / 100.0
        height = obj.dimensions.z
        obj.keyframe_insert("rotation_euler", frame=hit)
        obj.keyframe_insert("location", frame=hit)
        obj.keyframe_insert("scale", frame=hit)
        obj.rotation_euler = (
            lean if tilt_axis == 0 else 0.0,
            lean if tilt_axis == 1 else 0.0,
            obj.rotation_euler.z,
        )
        obj.location.z -= height * sink * 0.4
        obj.scale = (1.0, 1.0, 1.0 - sink * 0.5)
        for channel in ("rotation_euler", "location", "scale"):
            obj.keyframe_insert(channel, frame=hit + 14)

    # Four giants leave the line and put the crab down: two arcing hops in.
    attackers = roster[:: max(1, len(roster) // 4)][:4]
    for index, avatar in enumerate(attackers):
        start = Vector(avatar.location)
        angle = index * (math.pi / 2) + math.pi / 6
        ring_spot = Vector((
            crab_end.x + math.cos(angle) * 42.0,
            crab_end.y + math.sin(angle) * 42.0,
            0.0,
        ))
        ring_spot.z = ground_at(ring_spot.x, ring_spot.y) + float(avatar["foot_z"])
        mid = start.lerp(ring_spot, 0.5)
        mid.z = max(start.z, ring_spot.z) + 16.0
        face = math.atan2(crab_end.x - ring_spot.x, -(crab_end.y - ring_spot.y))
        avatar.keyframe_insert("location", frame=ATTACK_START_F)
        avatar.keyframe_insert("rotation_euler", frame=ATTACK_START_F)
        for frame, spot in ((ATTACK_START_F + 14, mid), (ATTACK_START_F + 26, ring_spot)):
            avatar.location = spot
            avatar.rotation_euler = (0.0, 0.0, face)
            avatar.keyframe_insert("location", frame=frame)
            avatar.keyframe_insert("rotation_euler", frame=frame)

    return _animate_camera(scene, point_at, walk_fraction, ground_at, crab_end)


def _animate_camera(scene, point_at, walk_fraction, ground_at,
                    crab_end: Vector) -> bpy.types.Object:
    """One camera, one look target, five storyboard phases."""
    target = bpy.data.objects.new("Look Target", None)
    scene.collection.objects.link(target)

    camera_data = bpy.data.cameras.new("Demo Camera")
    camera_data.lens = 42
    camera_data.clip_end = 20_000
    camera = bpy.data.objects.new("Demo Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    track = camera.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    cx, cy = local_xy(*ROSTER_CENTER)
    oper = point_at(0.0)[0]
    ground_end = ground_at(crab_end.x, crab_end.y)

    def key(frame: float, eye: tuple[float, float, float],
            look: tuple[float, float, float]) -> None:
        camera.location = eye
        camera.keyframe_insert("location", frame=frame)
        target.location = look
        target.keyframe_insert("location", frame=frame)

    # Phase 1 (F1-110): dolly along the assembled roster, every face in view.
    # Heights ride on the terrain — scene z is metres above the DEM base.
    platz = ground_at(cx, cy)
    key(1, (cx - 120.0, cy - 80.0, platz + 12.0), (cx - 68.0, cy + 4.0, platz + 6.0))
    key(110, (cx + 120.0, cy - 80.0, platz + 12.0), (cx + 68.0, cy + 4.0, platz + 6.0))
    # Phase 2 (F110-160): pull wide and swing to the Oper — the crab enters.
    key(135, (cx + 150.0, cy - 210.0, 60.0), (cx, cy, 12.0))
    key(160, (oper.x + 240.0, oper.y - 280.0, 120.0), (oper.x, oper.y, 30.0))
    # Phase 3 (F160-430): track the slow wreck of the Ring.
    for step in range(9):
        frame = 190 + (step / 8) * (WALK_END_F - 190)
        fraction = walk_fraction(frame)
        position, direction = point_at(fraction)
        side = Vector((-direction.y, direction.x, 0.0))
        eye = position + side * 185.0 - direction * 115.0
        eye_z = ground_at(eye.x, eye.y) + 88.0
        key(frame, (eye.x, eye.y, eye_z),
            (position.x, position.y, CRAB_HEIGHT_M * 0.5))
    # Phase 4 (F368-408): wide witness shot of the takedown.
    key(392, (crab_end.x + 260.0, crab_end.y - 330.0, 150.0),
        (crab_end.x, crab_end.y, 22.0))
    # Phase 5 (F408-504): a long, unhurried rise with the goose.
    key(440, (crab_end.x + 170.0, crab_end.y - 230.0, ground_end + 160.0),
        (crab_end.x + 16.0, crab_end.y - 13.0, ground_end + 130.0))
    key(END_FRAME, (crab_end.x + 110.0, crab_end.y - 150.0, ground_end + 330.0),
        (crab_end.x + 30.0, crab_end.y - 24.0, ground_end + 315.0))
    return camera


def light_and_save() -> None:
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080

    sun_data = bpy.data.lights.new("Demo Sun", "SUN")
    sun_data.energy = 4.0
    sun_data.color = (1.0, 0.87, 0.7)
    sun = bpy.data.objects.new("Demo Sun", sun_data)
    sun.rotation_euler = (math.radians(50), 0.0, math.radians(140))
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("Smoke Sky")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.24, 0.16, 0.10, 1.0)
    background.inputs["Strength"].default_value = 0.9
    scene.world = world

    # QA stills as PNG, one per storyboard phase.
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    for frame in (40, 135, 300, 452, 480, 504):
        scene.frame_set(frame)
        scene.render.filepath = str(PREVIEW_DIR / f"secrab_ring_f{frame:03d}.png")
        bpy.ops.render.render(write_still=True)

    # The saved file renders the PNG sequence with `blender -b ... -a`;
    # ffmpeg turns it into the MP4 (Blender 5.x ships no video output).
    scene.render.filepath = r"G:\Github\.local\secrab-ring-frames\frame_####"


def build() -> None:
    bpy.ops.wm.read_homefile(use_empty=True)
    manifest = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))
    grid = load_dem_grid()
    base = min(min(row) for row in grid)
    ground_at = make_ground_sampler(grid, base)
    build_terrain(grid, base)
    static, destructibles = build_buildings(ground_at)
    roster = build_roster(ground_at, manifest)
    crab = build_crab(ground_at, manifest)
    camera = animate(crab, destructibles, roster, ground_at, static)
    build_goose_rig(ground_at, _path_points()[-1])
    build_endcard(camera)
    light_and_save()
    BLEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    print(f"SECRAB_RING_OK v2 destructibles={len(destructibles)} blend={BLEND_OUT}")


build()
