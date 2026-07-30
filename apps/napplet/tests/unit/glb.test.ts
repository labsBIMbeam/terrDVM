import { describe, expect, it } from 'vitest';

import { normalizeCharacter, parseGlb } from '../../src/viewer/glb';

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
