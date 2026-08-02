import { describe, expect, it } from 'vitest';

import {
  MAX_GLB_NODES,
  MAX_GLB_VERTICES,
  normalizeCharacter,
  parseGlb,
} from '../../src/viewer/glb';

/** The four bytes the texture test hides in the GLB as its "JPEG". */
const FAKE_JPEG = [0xff, 0xd8, 0xff, 0xe0];

/** Build a minimal valid GLB: one triangle, u16 indices, a translated node. */
function makeGlb({ withNormals = false, translation = [0, 0, 0], withTexture = false } = {}): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte alignment
  const imageBytes = new Uint8Array(FAKE_JPEG);

  const parts: Uint8Array[] = [new Uint8Array(positions.buffer)];
  if (withNormals) parts.push(new Uint8Array(normals.buffer));
  if (withTexture) parts.push(new Uint8Array(uvs.buffer));
  parts.push(new Uint8Array(indices.buffer));
  if (withTexture) parts.push(imageBytes);

  const binLength = parts.reduce((sum, part) => sum + part.length, 0);
  const bin = new Uint8Array(binLength);
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let cursor = 0;
  for (const part of parts) {
    bin.set(part, cursor);
    bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: part.length });
    cursor += part.length;
  }

  const accessors: Record<string, unknown>[] = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
  ];
  const attributes: Record<string, number> = { POSITION: 0 };
  let viewIndex = 1;
  if (withNormals) {
    accessors.push({ bufferView: viewIndex, componentType: 5126, count: 3, type: 'VEC3' });
    attributes.NORMAL = accessors.length - 1;
    viewIndex += 1;
  }
  if (withTexture) {
    accessors.push({ bufferView: viewIndex, componentType: 5126, count: 3, type: 'VEC2' });
    attributes.TEXCOORD_0 = accessors.length - 1;
    viewIndex += 1;
  }
  accessors.push({ bufferView: viewIndex, componentType: 5123, count: 3, type: 'SCALAR' });
  const imageView = viewIndex + 1;

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation }],
    meshes: [
      {
        primitives: [
          {
            attributes,
            indices: accessors.length - 1,
            ...(withTexture ? { material: 0 } : {}),
          },
        ],
      },
    ],
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors,
    ...(withTexture
      ? {
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
          textures: [{ source: 0 }],
          images: [{ bufferView: imageView, mimeType: 'image/jpeg' }],
        }
      : {}),
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPadding) {
    const padded = new Uint8Array(jsonBytes.length + jsonPadding).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, bin.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  bytes.set(bin, binStart + 8);
  return out;
}

describe('glb parser', () => {
  it('reads positions, indices and node translation', () => {
    const mesh = parseGlb(makeGlb({ withNormals: true, translation: [1, 2, 3] }));
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(mesh.positions[0]).toBeCloseTo(1);
    expect(mesh.positions[1]).toBeCloseTo(2);
    expect(mesh.positions[2]).toBeCloseTo(3);
    expect(mesh.normals[1]).toBeCloseTo(1);
  });

  it('computes flat normals when the file carries none', () => {
    const mesh = parseGlb(makeGlb({ withNormals: false }));
    // Triangle (0,0,0)-(1,0,0)-(0,0,-1) winds +Y up.
    expect(mesh.normals[1]).toBeCloseTo(1);
    expect(mesh.normals[0]).toBeCloseTo(0);
  });

  it('fails closed on junk', () => {
    expect(() => parseGlb(new ArrayBuffer(8))).toThrow(/binary glTF/);
    expect(() => parseGlb(new TextEncoder().encode('not a glb').buffer as ArrayBuffer)).toThrow();
  });

  it('reads TEXCOORD_0 and the embedded baseColor image', () => {
    const mesh = parseGlb(makeGlb({ withNormals: true, withTexture: true }));
    expect(mesh.uvs).not.toBeNull();
    expect([...mesh.uvs!]).toEqual([0, 0, 1, 0, 0, 1]);
    expect(mesh.texture?.mimeType).toBe('image/jpeg');
    expect([...(mesh.texture?.bytes ?? [])]).toEqual(FAKE_JPEG);
  });

  it('leaves texture null on plain geometry', () => {
    const mesh = parseGlb(makeGlb({ withNormals: true }));
    expect(mesh.uvs).toBeNull();
    expect(mesh.texture).toBeNull();
  });

  it('honours accessor byteOffset in interleaved vertex buffers', () => {
    // One triangle, P(12)+N(12)+UV(8) interleaved, stride 32 — the Meshy
    // avatar layout that turned skins to noise when byteOffset was dropped.
    const vertices = [
      // px py pz   nx ny nz   u v
      [0, 0, 0, 0, 1, 0, 0.25, 0.75],
      [1, 0, 0, 0, 1, 0, 0.5, 0.25],
      [0, 0, -1, 0, 1, 0, 0.75, 0.5],
    ];
    const interleaved = new Float32Array(vertices.flat());
    const indices = new Uint16Array([0, 1, 2, 0]);
    const bin = new Uint8Array(interleaved.byteLength + indices.byteLength);
    bin.set(new Uint8Array(interleaved.buffer), 0);
    bin.set(new Uint8Array(indices.buffer), interleaved.byteLength);

    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 },
          ],
        },
      ],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: interleaved.byteLength, byteStride: 32 },
        { buffer: 0, byteOffset: interleaved.byteLength, byteLength: indices.byteLength },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: 24, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const padding = (4 - (jsonBytes.length % 4)) % 4;
    if (padding) {
      const padded = new Uint8Array(jsonBytes.length + padding).fill(0x20);
      padded.set(jsonBytes);
      jsonBytes = padded;
    }
    const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
    const out = new ArrayBuffer(total);
    const view = new DataView(out);
    const bytes = new Uint8Array(out);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonBytes.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.set(jsonBytes, 20);
    const binStart = 20 + jsonBytes.length;
    view.setUint32(binStart, bin.length, true);
    view.setUint32(binStart + 4, 0x004e4942, true);
    bytes.set(bin, binStart + 8);

    const mesh = parseGlb(out);
    expect([...mesh.positions.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...mesh.positions.slice(3, 6)]).toEqual([1, 0, 0]);
    expect(mesh.normals[1]).toBeCloseTo(1);
    expect([...mesh.uvs!]).toEqual([0.25, 0.75, 0.5, 0.25, 0.75, 0.5]);
  });
});

/**
 * Wrap an arbitrary glTF JSON object and BIN payload in a GLB container.
 *
 * The suite below needs files no exporter would ever write, so the container
 * is built from the JSON up rather than from a fixed template.
 */
function packGlb(json: unknown, bin: Uint8Array): ArrayBuffer {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  if (padding) {
    const padded = new Uint8Array(jsonBytes.length + padding).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, bin.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  bytes.set(bin, binStart + 8);
  return out;
}

/** One unit triangle in the BIN chunk, plus the views and accessors for it. */
const TRIANGLE_BIN = (() => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte alignment
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  return { bin, positionBytes: positions.byteLength, indexBytes: indices.byteLength };
})();

const TRIANGLE_MESH = {
  buffers: [{ byteLength: TRIANGLE_BIN.bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: TRIANGLE_BIN.positionBytes },
    {
      buffer: 0,
      byteOffset: TRIANGLE_BIN.positionBytes,
      byteLength: TRIANGLE_BIN.indexBytes,
    },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
};

/** A GLB whose scene is exactly `nodes`, all sharing the one triangle mesh. */
function graphGlb(nodes: unknown[], sceneNodes: number[]): ArrayBuffer {
  return packGlb(
    { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: sceneNodes }], nodes, ...TRIANGLE_MESH },
    TRIANGLE_BIN.bin,
  );
}

describe('a GLB node graph is untrusted input', () => {
  it('still walks an ordinary nested graph and composes the transforms', () => {
    // root(+10 x) → mid(+1 y) → leaf(mesh). The leaf's vertices must land at
    // the product of the two, which is what makes the traversal worth having.
    const mesh = parseGlb(
      graphGlb(
        [
          { translation: [10, 0, 0], children: [1] },
          { translation: [0, 1, 0], children: [2] },
          { mesh: 0 },
        ],
        [0],
      ),
    );
    expect(mesh.positions).toHaveLength(9);
    expect(mesh.positions[0]).toBeCloseTo(10);
    expect(mesh.positions[1]).toBeCloseTo(1);
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('draws a shared child ONCE, not once per parent', () => {
    // The diamond: 0 → {1, 2}, and both 1 and 2 name 3. Legal glTF. Drawing 3
    // per path is what makes the doubling chain below exponential, so it is
    // drawn at the first transform that reached it and skipped afterwards.
    const mesh = parseGlb(
      graphGlb(
        [
          { children: [1, 2] },
          { translation: [5, 0, 0], children: [3] },
          { translation: [0, 0, 5], children: [3] },
          { mesh: 0 },
        ],
        [0],
      ),
    );
    expect(mesh.positions).toHaveLength(9);
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
    // First parent wins: the leaf sits at +5 x, not at +5 z and not at both.
    expect(mesh.positions[0]).toBeCloseTo(5);
    expect(mesh.positions[2]).toBeCloseTo(0);
  });

  it('refuses a cycle instead of recursing into it', () => {
    expect(() => parseGlb(graphGlb([{ mesh: 0, children: [1] }, { children: [0] }], [0]))).toThrow(
      /cycle/,
    );
    // A node that names itself is the degenerate case of the same thing.
    expect(() => parseGlb(graphGlb([{ mesh: 0, children: [0] }], [0]))).toThrow(/cycle/);
  });

  it('refuses to expand past the vertex budget, however few nodes it takes', () => {
    // The node budget bounds VISITS, not geometry. Every node here is distinct
    // (so the visited set never short-circuits) and every accessor reads real
    // bytes (so the per-accessor bound passes), yet the product is unbounded.
    // Measured against the unguarded parser: 38 kB in produced 56 MB out.
    const verts = 60_000;
    const nodeCount = Math.ceil(MAX_GLB_VERTICES / verts) + 1;
    const positions = new Float32Array(verts * 3);
    const bin = new Uint8Array(positions.buffer);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: Array.from({ length: nodeCount }, (_, i) => i) }],
      nodes: Array.from({ length: nodeCount }, () => ({ mesh: 0 })),
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: verts, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    };

    expect(nodeCount).toBeLessThan(MAX_GLB_NODES); // the node budget would not have caught this
    expect(() => parseGlb(packGlb(json, bin))).toThrow(/vertex budget/);
  });

  it('still accepts a model comfortably inside the vertex budget', () => {
    const verts = 1_000;
    const positions = new Float32Array(verts * 3);
    const bin = new Uint8Array(positions.buffer);
    const mesh = parseGlb(
      packGlb(
        {
          asset: { version: '2.0' },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          buffers: [{ byteLength: bin.length }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
          accessors: [{ bufferView: 0, componentType: 5126, count: verts, type: 'VEC3' }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        },
        bin,
      ),
    );
    expect(mesh.positions).toHaveLength(verts * 3);
  });

  it('refuses a graph wider than the node budget', () => {
    const nodes = Array.from({ length: MAX_GLB_NODES + 1 }, () => ({}));
    const scene = nodes.map((_, index) => index);
    expect(() => parseGlb(graphGlb(nodes, scene))).toThrow(/budget/);
  });

  it('survives the doubling chain that is the whole point of the visited set', () => {
    // Thirty nodes, each naming its successor TWICE: 2^30 visits without a
    // visited set, thirty with one. If this test ever hangs, the fix is gone.
    const depth = 30;
    const nodes: unknown[] = [];
    for (let i = 0; i < depth; i += 1) nodes.push({ children: [i + 1, i + 1] });
    nodes.push({ mesh: 0 });
    const started = Date.now();
    const mesh = parseGlb(graphGlb(nodes, [0]));
    expect(mesh.positions).toHaveLength(9);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('a GLB declares sizes it does not have to honour', () => {
  it('refuses a chunk header that runs past the end of the file', () => {
    const glb = graphGlb([{ mesh: 0 }], [0]);
    // Inflate the JSON chunk length in place; every byte after it is a lie.
    new DataView(glb).setUint32(12, 0xffff_0000, true);
    expect(() => parseGlb(glb)).toThrow(/past the end of the container/);
  });

  it('refuses an accessor count the binary chunk cannot back', () => {
    // A billion VEC3s described in a hundred bytes. The interleaved branch
    // allocates `count * 3` floats before it reads anything, so this is a
    // 12 GB allocation request unless the count is bounded first.
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      ...TRIANGLE_MESH,
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: TRIANGLE_BIN.positionBytes, byteStride: 16 },
        TRIANGLE_MESH.bufferViews[1],
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 1_000_000_000, type: 'VEC3' },
        TRIANGLE_MESH.accessors[1],
      ],
    };
    const started = Date.now();
    expect(() => parseGlb(packGlb(json, TRIANGLE_BIN.bin))).toThrow(/past the end of the binary/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('refuses a negative or fractional accessor count', () => {
    for (const count of [-1, 2.5]) {
      const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        ...TRIANGLE_MESH,
        accessors: [
          { bufferView: 0, componentType: 5126, count, type: 'VEC3' },
          TRIANGLE_MESH.accessors[1],
        ],
      };
      expect(() => parseGlb(packGlb(json, TRIANGLE_BIN.bin))).toThrow(/non-integral count/);
    }
  });

  it('refuses an index that points past the primitive it belongs to', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]);
    const indices = new Uint16Array([0, 1, 9, 0]);
    const bin = new Uint8Array(positions.byteLength + indices.byteLength);
    bin.set(new Uint8Array(positions.buffer), 0);
    bin.set(new Uint8Array(indices.buffer), positions.byteLength);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      ...TRIANGLE_MESH,
      buffers: [{ byteLength: bin.length }],
    };
    expect(() => parseGlb(packGlb(json, bin))).toThrow(/indexes a vertex it does not have/);
  });

  it('refuses a baseColor image whose buffer view overruns the binary chunk', () => {
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      ...TRIANGLE_MESH,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      bufferViews: [
        ...TRIANGLE_MESH.bufferViews,
        { buffer: 0, byteOffset: 0, byteLength: 1_000_000 },
      ],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ bufferView: 2, mimeType: 'image/png' }],
    };
    expect(() => parseGlb(packGlb(json, TRIANGLE_BIN.bin))).toThrow(
      /baseColor image runs past the end/,
    );
  });

  it('treats an attribute shorter than POSITION as absent rather than baking NaN', () => {
    // One vertex of NORMAL for a three-vertex primitive. Read straight through
    // it, vertices 1 and 2 get `undefined` and the mesh normals become NaN.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]);
    const shortNormal = new Float32Array([0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0]);
    const bin = new Uint8Array(
      positions.byteLength + shortNormal.byteLength + indices.byteLength,
    );
    bin.set(new Uint8Array(positions.buffer), 0);
    bin.set(new Uint8Array(shortNormal.buffer), positions.byteLength);
    bin.set(new Uint8Array(indices.buffer), positions.byteLength + shortNormal.byteLength);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
        { buffer: 0, byteOffset: positions.byteLength, byteLength: shortNormal.byteLength },
        {
          buffer: 0,
          byteOffset: positions.byteLength + shortNormal.byteLength,
          byteLength: indices.byteLength,
        },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 1, type: 'VEC3' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] },
      ],
    };
    const mesh = parseGlb(packGlb(json, bin));
    expect([...mesh.normals].every((value) => Number.isFinite(value))).toBe(true);
    // Fell back to the flat normal of the triangle, which winds +Y up.
    expect(mesh.normals[1]).toBeCloseTo(1);
  });
});

describe('normalizeCharacter', () => {
  it('scales any model to walker height with feet on the ground', () => {
    const mesh = {
      positions: new Float32Array([100, 50, 100, 100, 250, 100, 300, 50, 100]),
      normals: new Float32Array(9),
      indices: new Uint32Array([0, 1, 2]),
      uvs: null,
      texture: null,
    };
    normalizeCharacter(mesh, 1.75);
    const ys = [mesh.positions[1], mesh.positions[4], mesh.positions[7]];
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(1.75);
    // Centred: x extents symmetric around the origin.
    const xs = [mesh.positions[0], mesh.positions[3], mesh.positions[6]];
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
  });

  it('leaves a degenerate mesh alone', () => {
    const mesh = {
      positions: new Float32Array([1, 2, 3]),
      normals: new Float32Array(3),
      indices: new Uint32Array([0]),
      uvs: null,
      texture: null,
    };
    normalizeCharacter(mesh);
    expect(mesh.positions[1]).toBe(2);
  });
});
