import { describe, expect, it } from 'vitest';

import { parseGlb } from '../../src/viewer/glb';

/** Build a minimal valid GLB: one triangle, u16 indices, a translated node. */
function makeGlb({ withNormals = false, translation = [0, 0, 0] } = {}): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4-byte alignment

  const positionBytes = new Uint8Array(positions.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const binLength = positionBytes.length + (withNormals ? normalBytes.length : 0) + indexBytes.length;
  const bin = new Uint8Array(binLength);
  bin.set(positionBytes, 0);
  let cursor = positionBytes.length;
  if (withNormals) {
    bin.set(normalBytes, cursor);
    cursor += normalBytes.length;
  }
  bin.set(indexBytes, cursor);

  const bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
  ];
  const accessors: Record<string, unknown>[] = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
  ];
  const attributes: Record<string, number> = { POSITION: 0 };
  if (withNormals) {
    bufferViews.push({ buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length });
    accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' });
    attributes.NORMAL = 1;
  }
  bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: indexBytes.length });
  accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: 3, type: 'SCALAR' });

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation }],
    meshes: [{ primitives: [{ attributes, indices: accessors.length - 1 }] }],
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors,
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
});
