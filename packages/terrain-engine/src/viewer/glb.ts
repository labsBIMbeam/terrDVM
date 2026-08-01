/**
 * Minimal binary-glTF (.glb) parser for the hand-rolled engine.
 *
 * Scope on purpose: static triangle meshes — POSITION, optional NORMAL,
 * optional TEXCOORD_0, optional indices, node TRS transforms, plus the one
 * embedded baseColor image so lore characters keep their painted skin. No
 * skins or animations; anything outside that scope throws a named error and
 * the caller fails closed.
 *
 * HOSTILE INPUT IS THE NORMAL CASE. Avatars are fetched by content hash from a
 * public corpus, so every number in the JSON chunk — node children, accessor
 * counts, buffer-view lengths and strides, vertex indices — is attacker-chosen
 * and is bounded before it is used. Nothing here is allowed to allocate or
 * recurse on a declared size it has not first checked against the bytes that
 * actually arrived, and nothing is allowed to paper over a bad file with a
 * fabricated mesh: it throws, and the caller shows the failure.
 */

export type GlbMesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Per-vertex texture coordinates; null when any primitive lacks them. */
  uvs: Float32Array | null;
  /** The material's embedded baseColor image, still encoded (JPEG/PNG). */
  texture: { bytes: Uint8Array<ArrayBuffer>; mimeType: string } | null;
};

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * How many distinct nodes one scene traversal may enter.
 *
 * The node graph is the cheapest thing in a GLB to make expensive: glTF lets a
 * node be named by several parents and the byte format does not forbid a
 * cycle, so thirty nodes that each name their successor TWICE describe 2^30
 * visits in about six hundred bytes of JSON. Avatars here arrive by hash from
 * a public corpus, so that is reachable input, not a hypothetical. The budget
 * plus the visited set below turn it into a named error.
 */
export const MAX_GLB_NODES = 4096;

/**
 * The node budget bounds how many nodes are *visited*; it does not bound how
 * much geometry they emit. Each node may name a mesh whose accessor spans the
 * whole binary chunk, and every accessor passes its own bounds check because it
 * reads real bytes — so 4096 distinct nodes pointing at one full-chunk mesh is
 * legal on every per-item rule and still expands without limit.
 *
 * Measured against this parser: 38 kB in produced 56 MB out, a 1427x
 * amplification, on the UI thread. Bounding the product is the missing rule.
 *
 * 500k vertices is ~13x the 192-grid terrain mesh (~37k) and comfortably above
 * the ~14 MB character avatars, so no legitimate model here comes close.
 */
export const MAX_GLB_VERTICES = 500_000;

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
  materials?: {
    pbrMetallicRoughness?: { baseColorTexture?: { index?: number } };
  }[];
  textures?: { source?: number }[];
  images?: { bufferView?: number; mimeType?: string }[];
};

type GltfPrimitive = {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
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
    // A declared length is not a real one. Unchecked, an oversized chunk
    // header turns into a raw RangeError out of the TypedArray constructor
    // instead of a named parse failure.
    if (start + chunkLength > buffer.byteLength) {
      throw new Error('GLB chunk runs past the end of the container.');
    }
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
    // Interleaved vertex buffers address each attribute via the accessor's
    // own byteOffset on top of the view's — dropping it reads position
    // bytes as UVs.
    const viewOffset = bufferView.byteOffset ?? 0;
    const accessorOffset = accessor.byteOffset ?? 0;
    const start = bin.byteOffset + viewOffset + accessorOffset;
    const elementCount = accessor.count * componentCount;
    const tightStride = componentCount * componentBytes;
    const stride = bufferView.byteStride ?? tightStride;

    // THE SECOND UNBOUNDED LOOP. `count` and `byteStride` are attacker-chosen
    // numbers in the JSON chunk, and the interleaved branch below allocates
    // `elementCount` BEFORE it reads anything: a `count` of 1e9 in a hundred
    // bytes of JSON is a four-gigabyte allocation. Everything the accessor
    // will touch is bounded against the binary chunk here, once, so both
    // branches are safe by the time they run.
    if (!Number.isInteger(accessor.count) || accessor.count < 0) {
      throw new Error(`Accessor ${index} declares a non-integral count.`);
    }
    if (!Number.isInteger(stride) || stride < tightStride) {
      throw new Error(`Accessor ${index} sits in a buffer view with an unusable byteStride.`);
    }
    if (!Number.isInteger(viewOffset) || viewOffset < 0 || accessorOffset < 0) {
      throw new Error(`Accessor ${index} declares a negative offset.`);
    }
    const spanBytes = accessor.count === 0 ? 0 : (accessor.count - 1) * stride + tightStride;
    if (viewOffset + accessorOffset + spanBytes > bin.byteLength) {
      throw new Error(`Accessor ${index} reads past the end of the binary chunk.`);
    }
    // A misaligned start is a RangeError from the TypedArray constructor on
    // the tight path; name it here rather than let it escape unlabelled.
    if (start % componentBytes !== 0) {
      throw new Error(`Accessor ${index} is not aligned to its component size.`);
    }

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
  const uvs: number[] = [];
  const indices: number[] = [];
  let hasAllNormals = true;
  let hasAllUVs = true;
  let textureMaterial: number | null = null;

  const appendPrimitive = (primitive: GltfPrimitive, matrix: Mat): void => {
    if (primitive.mode !== undefined && primitive.mode !== 4) return; // triangles only
    const positionIndex = primitive.attributes?.POSITION;
    if (positionIndex === undefined) return;
    const position = readAccessor(positionIndex).data as Float32Array;
    const vertexCount = Math.floor(position.length / 3);
    // A NORMAL or TEXCOORD_0 accessor SHORTER than POSITION reads undefined
    // off its own end and bakes NaN into the mesh, which renders as a hole
    // rather than as a failure. A mismatched attribute counts as absent, so
    // the existing fallbacks (flat normals, untextured) take over.
    const normalIndex = primitive.attributes?.NORMAL;
    const rawNormal =
      normalIndex === undefined ? null : (readAccessor(normalIndex).data as Float32Array);
    const normal = rawNormal && rawNormal.length >= position.length ? rawNormal : null;
    if (!normal) hasAllNormals = false;
    const uvIndex = primitive.attributes?.TEXCOORD_0;
    const rawUv = uvIndex === undefined ? null : (readAccessor(uvIndex).data as Float32Array);
    const uv = rawUv && rawUv.length >= vertexCount * 2 ? rawUv : null;
    if (!uv) hasAllUVs = false;
    if (primitive.material !== undefined && textureMaterial === null) {
      textureMaterial = primitive.material;
    }

    const base = positions.length / 3;
    if (base + position.length / 3 > MAX_GLB_VERTICES) {
      throw new Error(`GLB exceeds the ${MAX_GLB_VERTICES}-vertex budget.`);
    }
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
      if (uv) {
        const vertex = i / 3;
        uvs.push(uv[vertex * 2], uv[vertex * 2 + 1]);
      } else {
        uvs.push(0, 0);
      }
    }
    if (primitive.indices !== undefined) {
      const primitiveIndices = readAccessor(primitive.indices).data;
      for (let i = 0; i < primitiveIndices.length; i += 1) {
        const vertex = primitiveIndices[i];
        // An index past this primitive's own vertices is not a triangle. Left
        // alone it reads undefined out of `positions` in the flat-normal pass
        // and writes NaN back — a fabricated result, which is exactly what
        // this parser is not allowed to produce.
        if (!(vertex >= 0 && vertex < vertexCount)) {
          throw new Error('GLB primitive indexes a vertex it does not have.');
        }
        indices.push(base + vertex);
      }
    } else {
      for (let i = 0; i < vertexCount; i += 1) indices.push(base + i);
    }
  };

  /** Every node already drawn, anywhere in the traversal. */
  const seen = new Set<number>();
  /** The nodes on the path from a scene root to the node being visited. */
  const path = new Set<number>();

  const visit = (nodeIndex: number, parent: Mat): void => {
    const node = json?.nodes?.[nodeIndex];
    if (!node) return;
    // A node that is its own ancestor is not a scene. This is the difference
    // between a cycle and a diamond, and the two need different answers.
    if (path.has(nodeIndex)) {
      throw new Error(`GLB node graph contains a cycle at node ${nodeIndex}.`);
    }
    // A diamond — one node named by two parents — is legal glTF and is drawn
    // ONCE, at the first transform that reached it. Drawing it per path is
    // what makes the exponential blow-up possible.
    if (seen.has(nodeIndex)) return;
    if (seen.size >= MAX_GLB_NODES) {
      throw new Error(`GLB node graph exceeds the ${MAX_GLB_NODES}-node budget.`);
    }
    seen.add(nodeIndex);
    path.add(nodeIndex);
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json?.meshes?.[node.mesh]?.primitives ?? []) {
        appendPrimitive(primitive, matrix);
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
    path.delete(nodeIndex);
  };

  const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const nodeIndex of sceneNodes) visit(nodeIndex, identity());
  if (positions.length === 0) throw new Error('GLB contains no triangle geometry.');

  // The painted skin: follow material → texture → image to the embedded
  // baseColor bytes. Anything missing along the chain means an untextured
  // model, never an error — the viewer tints those itself.
  let texture: GlbMesh['texture'] = null;
  const baseColorIndex =
    textureMaterial === null
      ? undefined
      : json.materials?.[textureMaterial]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const imageIndex =
    baseColorIndex === undefined ? undefined : json.textures?.[baseColorIndex]?.source;
  const image = imageIndex === undefined ? undefined : json.images?.[imageIndex];
  if (image?.bufferView !== undefined && image.mimeType && bin) {
    const bufferView = json.bufferViews?.[image.bufferView];
    if (bufferView) {
      // A MISSING texture is not an error, but an out-of-range one is not
      // missing — it is a declared length the file cannot back, and honouring
      // it would read whatever else shares the buffer.
      const imageOffset = bufferView.byteOffset ?? 0;
      const imageLength = bufferView.byteLength;
      if (
        !Number.isInteger(imageOffset) ||
        !Number.isInteger(imageLength) ||
        imageOffset < 0 ||
        imageLength < 0 ||
        imageOffset + imageLength > bin.byteLength
      ) {
        throw new Error('GLB baseColor image runs past the end of the binary chunk.');
      }
      // Copy out of the parse buffer so the image survives it.
      texture = {
        bytes: new Uint8Array(
          new Uint8Array(bin.buffer, bin.byteOffset + imageOffset, imageLength),
        ),
        mimeType: image.mimeType,
      };
    }
  }

  const result: GlbMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    uvs: hasAllUVs && uvs.length > 0 ? new Float32Array(uvs) : null,
    texture,
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
