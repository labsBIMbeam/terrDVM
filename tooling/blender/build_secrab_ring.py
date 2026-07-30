"""Build the demo intro: secrab destroys the DVM-generated Wiener Ringstrasse.

A 21-second (504 frames @ 24 fps) film assembled deterministically from
cached DVM artifacts and last week's 600BillionCWO bundle:

* terrain      — cached Mapzen terrarium tiles (z14) for the Ring selection
* orthophoto   — the basemap.at bake the collection server produced
* buildings    — Vienna Baukoerpermodell WFS pull (measured part heights)
* secrab       — art/characters/secrab/secrab.glb (Draco original) via the
                 blossom-transcoded rest pose + gait-frame blobs (shape keys)
* avatars      — lore characters from the blossom store, 21 m giants
* balloons     — MESHNET_BALLOONS_ASSET appended from last week's
                 SECrab_Morph_Assets.blend (ubot's balloon nodes)
* end card     — SEC brandmark from art/brand/

Storyboard: dive from orbit (0-4 s) -> sweep past the giant avatars
(4-8 s) -> secrab walks the Ring and the corridor topples (7-18.5 s) ->
balloon nodes rise over the Rathaus while the frame settles, SEC end card
(17-21 s).

Run inside Blender:
    exec(compile(open(PATH, encoding="utf-8").read(), PATH, "exec"))

QA stills render immediately; the full MP4 is rendered afterwards with
`blender -b art/blender/secrab_ring.blend -a` (output settings are saved
in the file).
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
MOVIE_OUT = PREVIEW_DIR / "secrab_ring_intro.mp4"
BRANDMARK = ROOT / "art" / "brand" / "sec-05-brandmark-white-on-black-1080x1920.png"

#: The Ring selection exactly as generated in the napplet (prewarm "ring").
BBOX = (16.355, 48.195, 16.385, 48.215)
DEM_ZOOM = 14
WFS_JSON = DATA / "cache" / "wfs" / "11f9b5180e268ba2.json"
ORTHO_JPG = DATA / "textures" / "vienna-00a68583fd27bb39.jpg"

CRAB_HEIGHT_M = 42.0
AVATAR_HEIGHT_M = 21.0
FPS = 24
END_FRAME = 504  # 21 seconds, and not one frame more
CORRIDOR_M = 55.0

#: secrab's walk: Oper -> Burgring -> Parlament -> Rathaus.
WAYPOINTS_LONLAT = (
    (16.3690, 48.2022),
    (16.3617, 48.2038),
    (16.3597, 48.2078),
    (16.3590, 48.2118),
)
WALK_START_F = 168
WALK_END_F = 456

#: The giants stand along the Ring and watch: (name, lon, lat, yaw deg).
AVATARS = (
    ("flx600", 16.3634, 48.2065, 130.0),
    ("gigi", 16.3616, 48.2036, 90.0),
    ("honeybadger", 16.3660, 48.2050, 220.0),
)

#: ubot's balloon meshnet rises over the Rathaus.
BALLOON_ANCHOR = (16.3577, 48.2107)
BALLOON_RISE_START_F = 400

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

    material = bpy.data.materials.new("Ring Kalk")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.78, 0.73, 0.65, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9

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
    bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_z = min(v.z for v in bounds)
    max_z = max(v.z for v in bounds)
    scale = target_height / max(1e-6, max_z - min_z)
    obj.scale = (scale, scale, scale)
    return -min_z * scale


def build_avatars(ground_at, manifest: dict) -> None:
    """The lore giants stand along the Ring and watch it happen."""
    for name, lon, lat, yaw_deg in AVATARS:
        entry = manifest.get(name)
        if not entry:
            continue
        avatar = import_blob_glb(entry["sha256"], f"giant_{name}")
        foot_z = _normalize_feet(avatar, AVATAR_HEIGHT_M)
        x, y = local_xy(lon, lat)
        avatar.location = (x, y, ground_at(x, y) + foot_z)
        avatar.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))


def build_crab(ground_at, manifest: dict) -> bpy.types.Object:
    entry = manifest["secrab"]
    crab = import_blob_glb(entry["sha256"], "secrab")

    # The gait frames share vertex order with the rest pose, so each one
    # becomes a shape key of the same mesh.
    for index, sha in enumerate(dict.fromkeys(entry.get("frames", []))):
        frame_obj = import_blob_glb(sha, f"secrab_frame_{index}")
        bpy.ops.object.select_all(action="DESELECT")
        frame_obj.select_set(True)
        crab.select_set(True)
        bpy.context.view_layer.objects.active = crab
        bpy.ops.object.join_shapes()
        bpy.data.objects.remove(frame_obj, do_unlink=True)

    crab["foot_z"] = _normalize_feet(crab, CRAB_HEIGHT_M)
    start = _path_points()[0]
    crab.location = (start.x, start.y, ground_at(start.x, start.y) + crab["foot_z"])
    return crab


def build_balloons(ground_at) -> bpy.types.Object | None:
    """Append ubot's balloon meshnet from last week's morph assets."""
    morph = BUNDLE / "SECrab_Morph_Assets.blend"
    if not morph.is_file():
        print("balloon assets missing — skipping the meshnet")
        return None
    with bpy.data.libraries.load(str(morph), link=False) as (src, dst):
        dst.collections = ["MESHNET_BALLOONS_ASSET"]
    balloon_collection = dst.collections[0]
    bpy.context.scene.collection.children.link(balloon_collection)
    root = bpy.data.objects.get("MESHNET_BALLOONS_ROOT")
    if root is None:
        return None
    bounds_min = Vector((1e9, 1e9, 1e9))
    bounds_max = Vector((-1e9, -1e9, -1e9))
    for obj in balloon_collection.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            bounds_min = Vector(map(min, bounds_min, world))
            bounds_max = Vector(map(max, bounds_max, world))
    spread = max(1e-6, max(bounds_max.x - bounds_min.x, bounds_max.y - bounds_min.y))
    factor = 140.0 / spread
    root.scale = (factor, factor, factor)
    x, y = local_xy(*BALLOON_ANCHOR)
    ground = ground_at(x, y)
    # Parked out of sight below the city until the finale, then the balloon
    # nodes climb straight out of the streets to 260 m.
    root.location = (x, y, ground - 420.0)
    root.keyframe_insert("location", frame=1)
    root.keyframe_insert("location", frame=BALLOON_RISE_START_F)
    root.rotation_euler = (0.0, 0.0, 0.0)
    root.keyframe_insert("rotation_euler", frame=BALLOON_RISE_START_F)
    root.location = (x, y, ground + 260.0)
    root.rotation_euler = (0.0, 0.0, math.radians(35))
    root.keyframe_insert("location", frame=END_FRAME)
    root.keyframe_insert("rotation_euler", frame=END_FRAME)
    return root


def build_endcard(camera: bpy.types.Object) -> None:
    """SEC brandmark: full-frame black card with the mark, fading in late."""

    def flat_material(name: str, image_path: Path | None,
                      fade: tuple[int, int] = (462, 486)) -> bpy.types.Material:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        material.blend_method = "BLEND"
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        emission = nodes.new("ShaderNodeEmission")
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = 0.0  # 0 = fully transparent
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
         flat_material("Endcard Black", None, fade=(462, 486)))
    mark_half_height = half_height * 0.92
    mark_half_width = mark_half_height * 1080.0 / 1920.0
    card("Endcard Mark", mark_half_width, mark_half_height, 0.98,
         flat_material("Endcard Mark", BRANDMARK, fade=(488, 500)))


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


def animate(crab: bpy.types.Object, destructibles: list[bpy.types.Object],
            ground_at) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = END_FRAME
    scene.render.fps = FPS

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

    def crab_walk_fraction(frame: float) -> float:
        return max(0.0, min(1.0, (frame - WALK_START_F) / (WALK_END_F - WALK_START_F)))

    # The crab holds at the Oper, then walks the Ring with a stomp-bob.
    steps = 48
    for step in range(steps + 1):
        frame = 1 + (step / steps) * (END_FRAME - 1)
        fraction = crab_walk_fraction(frame)
        position, direction = point_at(fraction)
        bob = abs(math.sin(fraction * 40.0)) * 1.2
        crab.location = (
            position.x,
            position.y,
            ground_at(position.x, position.y) + foot_z + bob,
        )
        # Imported glTF faces -Y at rest; steer that nose along the path.
        crab.rotation_euler = (0.0, 0.0, math.atan2(direction.x, -direction.y))
        crab.keyframe_insert("location", frame=frame)
        crab.keyframe_insert("rotation_euler", frame=frame)

    # Gait cycle: constant-interpolated shape-key flips, ~1.4 s per cycle.
    shape_keys = crab.data.shape_keys
    if shape_keys:
        blocks = shape_keys.key_blocks[1:]  # skip Basis
        cycle_frames = int(1.4 * FPS)
        stride = max(1, cycle_frames // max(1, len(blocks)))
        for frame in range(1, END_FRAME + 1, stride):
            active = int(((frame / cycle_frames) % 1.0) * len(blocks)) % len(blocks)
            for index, block in enumerate(blocks):
                block.value = 1.0 if index == active else 0.0
                block.keyframe_insert("value", frame=frame)
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

    return _animate_camera(scene, point_at, crab_walk_fraction, ground_at)


def _animate_camera(scene, point_at, crab_walk_fraction, ground_at) -> bpy.types.Object:
    """One camera, one look target, four storyboard phases."""
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

    oper = point_at(0.0)[0]
    flx_x, flx_y = local_xy(AVATARS[0][1], AVATARS[0][2])
    rat_x, rat_y = local_xy(*BALLOON_ANCHOR)

    def key(frame: float, eye: tuple[float, float, float],
            look: tuple[float, float, float]) -> None:
        camera.location = eye
        camera.keyframe_insert("location", frame=frame)
        target.location = look
        target.keyframe_insert("location", frame=frame)

    # Phase 1 (F1-96): dive from orbit toward the Oper.
    key(1, (900.0, -1500.0, 1400.0), (0.0, 0.0, 60.0))
    key(96, (oper.x + 260.0, oper.y - 420.0, 240.0), (oper.x, oper.y, 40.0))
    # Phase 2 (F96-192): over the open Heldenplatz, eye to eye with the
    # giants — high enough that no block ever swallows the camera.
    key(150, (flx_x - 40.0, flx_y - 260.0, 130.0), (flx_x, flx_y, 16.0))
    key(192, (flx_x - 150.0, flx_y - 190.0, 120.0),
        (oper.x, oper.y, 40.0))
    # Phase 3 (F192-456): track the crab along the Ring.
    for step in range(10 + 1):
        frame = 192 + (step / 10) * (WALK_END_F - 192)
        fraction = crab_walk_fraction(frame)
        position, direction = point_at(fraction)
        side = Vector((-direction.y, direction.x, 0.0))
        eye = position + side * 175.0 - direction * 110.0
        eye_z = ground_at(eye.x, eye.y) + 90.0
        key(frame, (eye.x, eye.y, eye_z),
            (position.x, position.y, CRAB_HEIGHT_M * 0.55))
    # Phase 4 (F456-504): pull back and up — the whole balloon net rises.
    key(END_FRAME, (rat_x + 680.0, rat_y - 840.0, 430.0), (rat_x, rat_y, 190.0))
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

    # QA stills as PNG.
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    for frame in (1, 96, 150, 260, 380, 470, 504):
        scene.frame_set(frame)
        scene.render.filepath = str(PREVIEW_DIR / f"secrab_ring_f{frame:03d}.png")
        bpy.ops.render.render(write_still=True)

    # The saved file renders the MP4 directly with `blender -b ... -a`.
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.filepath = str(MOVIE_OUT)


def build() -> None:
    bpy.ops.wm.read_homefile(use_empty=True)
    manifest = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))
    grid = load_dem_grid()
    base = min(min(row) for row in grid)
    ground_at = make_ground_sampler(grid, base)
    build_terrain(grid, base)
    _, destructibles = build_buildings(ground_at)
    build_avatars(ground_at, manifest)
    crab = build_crab(ground_at, manifest)
    camera = animate(crab, destructibles, ground_at)
    build_balloons(ground_at)
    build_endcard(camera)
    light_and_save()
    BLEND_OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    print(f"SECRAB_RING_OK destructibles={len(destructibles)} blend={BLEND_OUT}")


build()
