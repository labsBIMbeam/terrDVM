/**
 * Minimal binary-glTF (.glb) parser for the hand-rolled engine.
 *
 * Scope on purpose: static triangle meshes — POSITION, optional NORMAL,
 * optional indices, node TRS transforms. No skins, animations, materials or
 * textures; the viewer colours the mesh itself. Anything outside that scope
 * throws a named error and the caller fails closed.
 */

export type GlbMesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

type GltfJson = {
  scenes?: { nodes?: number[] }[];
  scene?: number;
  nodes?: {
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }[];
  meshes?: { primitives?: GltfPrimitive[] }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};

type GltfPrimitive = {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
};

type Mat = Float64Array;

function identity(): Mat {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: Mat, b: Mat): Mat {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function nodeMatrix(node: NonNullable<GltfJson['nodes']>[number]): Mat {
  if (node.matrix && node.matrix.length === 16) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // Column-major T * R * S from the quaternion.
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return new Float64Array([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

/**
 * Normalise an arbitrary character model into the walker's frame: feet at
 * y = 0, centred on the origin, scaled to `targetHeightM`. Models arrive in
 * whatever units and origin their author chose; the walker needs 1.75 m of
 * human.
 */
export function normalizeCharacter(mesh: GlbMesh, targetHeightM = 1.75): GlbMesh {
  const { positions } = mesh;
  if (positions.length === 0) return mesh;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const height = maxY - minY;
  if (!(height > 0)) return mesh;
  const factor = targetHeightM / height;
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - centreX) * factor;
    positions[i + 1] = (positions[i + 1] - minY) * factor;
    positions[i + 2] = (positions[i + 2] - centreZ) * factor;
  }
  return mesh;
}

/**
 * Normalise a set of animation frames with ONE shared transform, derived
 * from the first (rest) frame — per-frame normalisation would rescale a
 * lifted leg and make the whole body pump.
 */
export function normalizeCharacterFrames(frames: GlbMesh[], targetHeightM = 1.75): GlbMesh[] {
  if (frames.length === 0) return frames;
  const rest = frames[0].positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < rest.length; i += 3) {
    minX = Math.min(minX, rest[i]);
    maxX = Math.max(maxX, rest[i]);
    minY = Math.min(minY, rest[i + 1]);
    maxY = Math.max(maxY, rest[i + 1]);
    minZ = Math.min(minZ, rest[i + 2]);
    maxZ = Math.max(maxZ, rest[i + 2]);
  }
  const height = maxY - minY;
  if (!(height > 0)) return frames;
  const factor = targetHeightM / height;
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  for (const frame of frames) {
    const { positions } = frame;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] - centreX) * factor;
      positions[i + 1] = (positions[i + 1] - minY) * factor;
      positions[i + 2] = (positions[i + 2] - centreZ) * factor;
    }
  }
  return frames;
}

export function parseGlb(buffer: ArrayBuffer): GlbMesh {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a binary glTF container.');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error('Only glTF 2.0 containers are supported.');
  }

  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
    } else if (chunkType === CHUNK_BIN) {
      bin = new Uint8Array(buffer, start, chunkLength);
    }
    offset = start + chunkLength;
  }
  if (!json) throw new Error('GLB is missing its JSON chunk.');

  const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

  const readAccessor = (index: number): { data: Float32Array | Uint32Array; type: string } => {
    const accessor = json?.accessors?.[index];
    if (!accessor) throw new Error(`Accessor ${index} is missing.`);
    const bufferView = json?.bufferViews?.[accessor.bufferView ?? -1];
    if (!bufferView || !bin) throw new Error('Accessor points outside the binary chunk.');
    const componentCount = accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC2' ? 2 : 1;
    const componentBytes = COMPONENT_BYTES[accessor.componentType];
    if (!componentBytes) {
      throw new Error(`Unsupported accessor component type ${accessor.componentType}.`);
    }
    const start = bin.byteOffset + (bufferView.byteOffset ?? 0);
    const elementCount = accessor.count * componentCount;
    const tightStride = componentCount * componentBytes;
    const stride = bufferView.byteStride ?? tightStride;

    if (stride === tightStride) {
      if (accessor.componentType === 5126) {
        return { data: new Float32Array(bin.buffer, start, elementCount), type: accessor.type };
      }
      if (accessor.componentType === 5123) {
        const raw = new Uint16Array(bin.buffer, start, elementCount);
        return { data: Uint32Array.from(raw), type: accessor.type };
      }
      if (accessor.componentType === 5125) {
        return { data: new Uint32Array(bin.buffer, start, elementCount), type: accessor.type };
      }
      const raw = new Uint8Array(bin.buffer, start, elementCount);
      return { data: Uint32Array.from(raw), type: accessor.type };
    }

    // Interleaved buffer view: copy element-wise through a DataView.
    const view = new DataView(bin.buffer);
    const out =
      accessor.componentType === 5126
        ? new Float32Array(elementCount)
        : new Uint32Array(elementCount);
    for (let element = 0; element < accessor.count; element += 1) {
      const elementStart = start + element * stride;
      for (let component = 0; component < componentCount; component += 1) {
        const at = elementStart + component * componentBytes;
        out[element * componentCount + component] =
          accessor.componentType === 5126
            ? view.getFloat32(at, true)
            : accessor.componentType === 5125
              ? view.getUint32(at, true)
              : accessor.componentType === 5123
                ? view.getUint16(at, true)
                : view.getUint8(at);
      }
    }
    return { data: out, type: accessor.type };
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let hasAllNormals = true;

  const appendPrimitive = (primitive: GltfPrimitive, matrix: Mat): void => {
    if (primitive.mode !== undefined && primitive.mode !== 4) return; // triangles only
    const positionIndex = primitive.attributes?.POSITION;
    if (positionIndex === undefined) return;
    const position = readAccessor(positionIndex).data as Float32Array;
    const normalIndex = primitive.attributes?.NORMAL;
    const normal = normalIndex === undefined ? null : (readAccessor(normalIndex).data as Float32Array);
    if (!normal) hasAllNormals = false;

    const base = positions.length / 3;
    for (let i = 0; i < position.length; i += 3) {
      const x = position[i];
      const y = position[i + 1];
      const z = position[i + 2];
      positions.push(
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      );
      if (normal) {
        const nx = normal[i];
        const ny = normal[i + 1];
        const nz = normal[i + 2];
        const tx = matrix[0] * nx + matrix[4] * ny + matrix[8] * nz;
        const ty = matrix[1] * nx + matrix[5] * ny + matrix[9] * nz;
        const tz = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
        const length = Math.hypot(tx, ty, tz) || 1;
        normals.push(tx / length, ty / length, tz / length);
      } else {
        normals.push(0, 0, 0);
      }
    }
    if (primitive.indices !== undefined) {
      const primitiveIndices = readAccessor(primitive.indices).data;
      for (let i = 0; i < primitiveIndices.length; i += 1) indices.push(base + primitiveIndices[i]);
    } else {
      for (let i = 0; i < position.length / 3; i += 1) indices.push(base + i);
    }
  };

  const visit = (nodeIndex: number, parent: Mat): void => {
    const node = json?.nodes?.[nodeIndex];
    if (!node) return;
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json?.meshes?.[node.mesh]?.primitives ?? []) {
        appendPrimitive(primitive, matrix);
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };

  const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const nodeIndex of sceneNodes) visit(nodeIndex, identity());
  if (positions.length === 0) throw new Error('GLB contains no triangle geometry.');

  const result: GlbMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };

  if (!hasAllNormals) {
    // Flat normals accumulated per vertex — good enough for a low-poly figure.
    const accumulated = new Float32Array(result.positions.length);
    for (let i = 0; i < result.indices.length; i += 3) {
      const [a, b, c] = [result.indices[i], result.indices[i + 1], result.indices[i + 2]];
      const ax = result.positions[a * 3];
      const ay = result.positions[a * 3 + 1];
      const az = result.positions[a * 3 + 2];
      const ux = result.positions[b * 3] - ax;
      const uy = result.positions[b * 3 + 1] - ay;
      const uz = result.positions[b * 3 + 2] - az;
      const vx = result.positions[c * 3] - ax;
      const vy = result.positions[c * 3 + 1] - ay;
      const vz = result.positions[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const vertex of [a, b, c]) {
        accumulated[vertex * 3] += nx;
        accumulated[vertex * 3 + 1] += ny;
        accumulated[vertex * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < accumulated.length; i += 3) {
      const length = Math.hypot(accumulated[i], accumulated[i + 1], accumulated[i + 2]) || 1;
      result.normals[i] = accumulated[i] / length;
      result.normals[i + 1] = accumulated[i + 1] / length;
      result.normals[i + 2] = accumulated[i + 2] / length;
    }
  }

  return result;
}
