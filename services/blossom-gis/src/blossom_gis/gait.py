"""Procedural stomp cycle for a many-legged model.

Replaces the one-off Blender bake with a deterministic pipeline: cluster the
leg vertices with a fixed-seed K-means over the ground plan, split the legs
into the two alternating groups of a tetrapod gait, and shear each leg from
the hip with a lift-and-swing that fades toward the body. Every frame is a
complete GLB (UVs and the painted skin ride along), so the viewer can cycle
frames without knowing anything about the rig.
"""

from __future__ import annotations

import numpy as np

from .character import _pack_glb

#: Fraction of the body height below which vertices count as legs.
HIP_FRACTION = 0.32
#: How far a foot swings along the walk axis, as a fraction of body height.
SWING_FRACTION = 0.10
#: How high a foot lifts mid-stride, as a fraction of body height.
LIFT_FRACTION = 0.12
K_LEGS = 8
KMEANS_ROUNDS = 12


def _cluster_legs(xz: np.ndarray, centre: np.ndarray) -> np.ndarray:
    """Deterministic K-means: centroids seeded evenly by angle round the body."""
    angles = np.arctan2(xz[:, 1] - centre[1], xz[:, 0] - centre[0])
    order = np.argsort(angles)
    stride = len(order) // K_LEGS
    seeds = order[np.arange(K_LEGS) * stride + stride // 2]
    centroids = xz[seeds].astype(np.float64).copy()
    assign = np.zeros(len(xz), dtype=np.int64)
    for _ in range(KMEANS_ROUNDS):
        distances = ((xz[:, None, :] - centroids[None, :, :]) ** 2).sum(axis=2)
        assign = distances.argmin(axis=1)
        for leg in range(K_LEGS):
            members = xz[assign == leg]
            if len(members):
                centroids[leg] = members.mean(axis=0)
    return assign


def bake_gait_frames(
    positions: list[float],
    normals: list[float],
    indices: list[int],
    uvs: list[float] | None = None,
    texture: tuple[bytes, str] | None = None,
    frame_count: int = 10,
) -> list[bytes]:
    """Bake `frame_count` GLBs of one full stride cycle."""
    rest = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    min_y = rest[:, 1].min()
    height = rest[:, 1].max() - min_y
    if not height > 0:
        raise ValueError("model has no height to walk with")
    hip_y = min_y + HIP_FRACTION * height
    legs = rest[:, 1] < hip_y
    if not legs.any():
        raise ValueError("no vertices below the hip line")

    centre = rest[:, [0, 2]].mean(axis=0)
    assign = _cluster_legs(rest[legs][:, [0, 2]], centre)

    # Stable leg order by angle, then alternate: neighbouring legs move in
    # opposite phase — the tetrapod pattern crabs actually use.
    centroids = np.stack(
        [rest[legs][assign == leg][:, [0, 2]].mean(axis=0) for leg in range(K_LEGS)]
    )
    leg_rank = np.argsort(
        np.argsort(np.arctan2(centroids[:, 1] - centre[1], centroids[:, 0] - centre[0]))
    )
    group = leg_rank % 2

    # Feet travel the full arc, hips barely move.
    falloff = np.clip((hip_y - rest[legs][:, 1]) / (hip_y - min_y), 0.0, 1.0)

    frames: list[bytes] = []
    for frame in range(frame_count):
        phase = 2.0 * np.pi * frame / frame_count
        deformed = rest.copy()
        leg_points = deformed[legs]
        for leg in range(K_LEGS):
            members = assign == leg
            if not members.any():
                continue
            leg_phase = phase + (np.pi if group[leg] else 0.0)
            swing = np.sin(leg_phase) * SWING_FRACTION * height
            lift = max(0.0, np.sin(leg_phase + np.pi / 2.0)) * LIFT_FRACTION * height
            t = falloff[members]
            leg_points[members, 2] += swing * t
            leg_points[members, 1] += lift * t
        deformed[legs] = leg_points
        frames.append(
            _pack_glb(
                deformed.reshape(-1).tolist(),
                normals,
                indices,
                uvs=uvs,
                texture=texture,
            )
        )
    return frames
