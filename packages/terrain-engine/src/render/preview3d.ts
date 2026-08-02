import type { BuildingMesh } from '../buildings/extrude';
import type { LandcoverMesh } from '../features/landcover';
import type { RoadMesh } from '../features/ribbon';
import type { TerrainMesh } from '../terrain/mesh';

/**
 * Minimal WebGL2 heightfield viewer.
 *
 * Written against the raw API on purpose: the napplet ships as a single-file
 * artifact, so pulling a general-purpose 3D engine in for one orbiting mesh
 * would dominate the bundle.
 */

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uInvMaxHeight;
uniform vec2 uGroundSize;
out vec3 vNormal;
out float vHeight;
out vec2 vUV;
out vec2 vModelUV;
out vec3 vWorld;
void main() {
  // uModel is identity for the scene; only dynamic props (the character)
  // carry a transform of their own.
  vec4 world = uModel * vec4(aPosition, 1.0);
  vNormal = normalize(mat3(uModel) * aNormal);
  vHeight = world.y * uInvMaxHeight;
  // The terrain grid is centred on the origin with north at -Z, and the
  // orthophoto's first row is north — so no flip is needed on either axis.
  vUV = world.xz / uGroundSize + 0.5;
  vModelUV = aUV;
  vWorld = world.xyz;
  gl_Position = uProjection * uModelView * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHeight;
in vec2 vUV;
in vec2 vModelUV;
in vec3 vWorld;
uniform vec3 uLightDir;
uniform vec3 uOverrideColor;
uniform float uUseOverride;
uniform sampler2D uOrtho;
uniform float uUseOrtho;
uniform sampler2D uModelTex;
uniform float uUseModelTexture;
uniform float uTexturedStructure;
uniform float uPosterize;
uniform float uWindowCol;
uniform float uFloorRow;
out vec4 outColor;

// 4x4 ordered dither: gradients become pixel patterns, the way game art
// actually handled limited palettes.
float bayer4(vec2 position) {
  const int matrix[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  int x = int(mod(position.x, 4.0));
  int y = int(mod(position.y, 4.0));
  return float(matrix[y * 4 + x]) / 16.0;
}

vec3 ramp(float t) {
  vec3 shore = vec3(0.15, 0.30, 0.30);
  vec3 low   = vec3(0.24, 0.42, 0.24);
  vec3 mid   = vec3(0.46, 0.43, 0.25);
  vec3 high  = vec3(0.52, 0.44, 0.38);
  vec3 peak  = vec3(0.80, 0.80, 0.78);
  if (t < 0.25) return mix(shore, low, t / 0.25);
  if (t < 0.50) return mix(low, mid, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(mid, high, (t - 0.50) / 0.25);
  return mix(high, peak, (t - 0.75) / 0.25);
}

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
  float light = 0.35 + 0.65 * diffuse;
  vec3 aerial = texture(uOrtho, vUV).rgb;
  vec3 ground = mix(ramp(clamp(vHeight, 0.0, 1.0)), aerial, uUseOrtho);
  // Textured structures: the roof takes its own aerial pixel — the ortho IS
  // the roofscape — and walls a darkened version so massing stays readable.
  // Without imagery the override colour stands as before.
  vec3 structureColor = uOverrideColor;
  if (uUseOrtho > 0.5 && uTexturedStructure > 0.5) {
    if (normal.y > 0.6) {
      // The aerial image IS the roofscape.
      structureColor = aerial;
    } else {
      // Procedural facade: a plaster tone tinted by the roof pixel, with a
      // storey-and-window grid carved in — buildings read as buildings, not
      // as extruded colour blocks.
      vec3 plaster = mix(aerial, vec3(0.82, 0.78, 0.72), 0.55) * 0.92;
      float along = abs(normal.x) > abs(normal.z) ? vWorld.z : vWorld.x;
      float column = fract(along / uWindowCol);
      float row = fract(vWorld.y / uFloorRow);
      bool window = column > 0.26 && column < 0.74 && row > 0.22 && row < 0.62;
      // A per-cell hash gives windows individual depth — a scatter of them
      // reads warm, as if lit — so facades stop looking copy-pasted.
      vec2 cell = vec2(floor(along / uWindowCol), floor(vWorld.y / uFloorRow));
      float cellHash = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 glass = mix(vec3(0.15, 0.21, 0.29), vec3(0.42, 0.36, 0.22), step(0.85, cellHash));
      // Grounding: facades darken toward the street.
      float grounding = 0.82 + 0.18 * clamp(vWorld.y / (uFloorRow * 6.0), 0.0, 1.0);
      structureColor = window ? glass : plaster * grounding;
    }
  }
  vec3 base = mix(ground, structureColor, uUseOverride);
  // Models with a painted skin (lore characters) wear it verbatim; the
  // terrain lighting still shapes them so they sit in the scene.
  if (uUseModelTexture > 0.5) base = texture(uModelTex, vModelUV).rgb;
  vec3 lit = base * light;
  // Pixel look: a slight saturation lift, then ordered dither and a coarse
  // palette quantised in gamma space — linear quantisation crushes the darks
  // into one muddy step, gamma keeps them articulated. Zero disables it all.
  if (uPosterize > 0.5) {
    float luma = dot(lit, vec3(0.299, 0.587, 0.114));
    lit = clamp(mix(vec3(luma), lit, 1.18) * 1.04, 0.0, 1.0);
    vec3 graded = pow(lit, vec3(0.6));
    graded += (bayer4(gl_FragCoord.xy) - 0.5) / uPosterize;
    graded = floor(graded * uPosterize + 0.5) / uPosterize;
    lit = pow(clamp(graded, 0.0, 1.0), vec3(1.6667));
  }
  outColor = vec4(lit, 1.0);
}`;

type Mat4 = Float32Array;

/**
 * Orthographic projection for the isometric game-map view: no perspective
 * convergence, so parallel streets stay parallel — the SimCity look, and the
 * projection every isometric-tile pipeline expects as input.
 */
export function orthographic(
  halfHeight: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const halfWidth = halfHeight * aspect;
  return new Float32Array([
    1 / halfWidth, 0, 0, 0,
    0, 1 / halfHeight, 0, 0,
    0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ]);
}

function perspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  const rangeInv = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * rangeInv, -1,
    0, 0, 2 * far * near * rangeInv, 0,
  ]);
}

function lookAt(eye: readonly number[], center: readonly number[], up: readonly number[]): Mat4 {
  const z = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
  let length = Math.hypot(z[0], z[1], z[2]) || 1;
  z[0] /= length; z[1] /= length; z[2] /= length;

  const x = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ];
  length = Math.hypot(x[0], x[1], x[2]) || 1;
  x[0] /= length; x[1] /= length; x[2] /= length;

  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];

  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create a WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Terrain shader failed to compile: ${log ?? 'unknown error'}`);
  }
  return shader;
}

export type ViewerLayer = 'ortho' | 'buildings' | 'roads' | 'landcover' | 'waterways';

export type ViewerProjection = 'perspective' | 'isometric';

/** A model handed to the viewer: geometry plus an optional decoded skin. */
export type ViewerModel = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array | null;
  texture?: TexImageSource | null;
};

export type TerrainViewer = {
  setLayerVisible: (layer: ViewerLayer, visible: boolean) => void;
  setProjection: (mode: ViewerProjection) => void;
  /** Chunky pixels and a coarse palette — the retro game-map aesthetic. */
  setPixelLook: (on: boolean) => void;
  /** First-person walk: WASD moves, click locks the pointer, mouse looks. */
  setWalkMode: (on: boolean) => void;
  /** Where the walker stands, in local metres — null before any walk. */
  getWalkPosition: () => { x: number; z: number; headingRad: number } | null;
  /**
   * Give the walker a body: a static mesh in metres, Y-up, facing -Z, with
   * an optional decoded baseColor image. Null removes it. With a body,
   * walking is third person — you see the avatar walk; without one, first
   * person. The camera boom and stride adapt to the model's height, so a
   * 21 m giant is framed like a giant.
   */
  setCharacter: (mesh: ViewerModel | null) => void;
  /**
   * Stand geo-anchored avatars in the scene: meshes in metres with local
   * positions and headings. Replaces any previous set.
   */
  setNpcs: (npcs: { mesh: ViewerModel; x: number; z: number; theta: number }[]) => void;
  /**
   * Drop a kaiju into the scene: one or more animation frames in metres that
   * stomp back and forth across the selection on their own. Null removes it.
   */
  setKaiju: (frames: ViewerModel[] | null) => void;
  /** Render one high-resolution frame and hand it back as a PNG blob. */
  exportImage: () => Promise<Blob | null>;
  destroy: () => void;
};

/** 600B orange, so structures read clearly against the natural terrain ramp. */
const BUILDING_COLOR: readonly [number, number, number] = [0.969, 0.576, 0.102];

/** Asphalt: dark and desaturated so roads read as ground, not as objects. */
const ROAD_COLOR: readonly [number, number, number] = [0.13, 0.13, 0.14];

/** Waterways: a shade brighter than still-water patches so currents read. */
const WATERWAY_COLOR: readonly [number, number, number] = [0.14, 0.34, 0.48];

/** The avatar: warm bone-white, distinct from every data layer. */
const CHARACTER_COLOR: readonly [number, number, number] = [0.92, 0.88, 0.8];

const IDENTITY_MODEL = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function createTerrainViewer(
  canvas: HTMLCanvasElement,
  mesh: TerrainMesh,
  options: {
    autoRotate?: boolean;
    buildings?: BuildingMesh;
    roads?: RoadMesh;
    /** Orthophoto to drape over the terrain; heightfield ramp when absent. */
    ortho?: TexImageSource;
    /** Land-cover patches (forest, meadow, water …) draped on the terrain. */
    landcover?: LandcoverMesh;
    /** Waterway ribbons (rivers, streams, canals) draped on the terrain. */
    waterways?: RoadMesh;
    /**
     * Opening flight along the terrain's own alignment line: from 21 m above
     * the lowest vertex straight to the highest, then settling into the
     * straight-down ortho view. Any input hands the camera to the user;
     * reduced motion jumps straight to the end state.
     */
    intro?: boolean;
    /**
     * Footstep and kaiju-stomp callbacks fired on the gait beats, plus an
     * altitude signal (0 ground … 1 high orbit) for the ambient wind.
     */
    audio?: { step?: () => void; stomp?: () => void; lift?: (value: number) => void };
  } = {},
): TerrainViewer {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL2 is unavailable in this browser.');

  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create the terrain shader program.');
  const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Terrain program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  // Work in a normalised model space so depth precision does not depend on the
  // selection being kilometres wide.
  const groundExtent = Math.max(mesh.stats.widthM, mesh.stats.depthM) || 1;
  const scale = 2 / groundExtent;
  const scaled = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 1) scaled[i] = mesh.positions[i] * scale;
  const maxHeightScaled = Math.max(
    1e-6,
    (mesh.stats.maxElevationM - mesh.stats.minElevationM) * scale,
  );

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const normalLocation = gl.getAttribLocation(program, 'aNormal');
  const uvLocation = gl.getAttribLocation(program, 'aUV');
  // Drawables without a UV buffer read this constant instead.
  if (uvLocation >= 0) gl.vertexAttrib2f(uvLocation, 0, 0);

  type Drawable = {
    vao: WebGLVertexArrayObject | null;
    count: number;
    buffers: (WebGLBuffer | null)[];
  };

  const upload = (
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
    uvs?: Float32Array | null,
  ): Drawable => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(normalLocation);
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

    const buffers: (WebGLBuffer | null)[] = [positionBuffer, normalBuffer];
    if (uvs && uvs.length > 0 && uvLocation >= 0) {
      const uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      buffers.push(uvBuffer);
    }

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    buffers.push(indexBuffer);

    return { vao, count: indices.length, buffers };
  };

  /** Upload a decoded baseColor image; glTF UVs match GL's un-flipped rows. */
  const makeModelTexture = (source: TexImageSource): WebGLTexture | null => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
    return texture;
  };

  const terrain = upload(scaled, mesh.normals, mesh.indices);

  // Buildings arrive in the same metric frame as the terrain, so they take the
  // identical normalising scale and need no separate transform.
  let structures: Drawable | null = null;
  const buildings = options.buildings;
  if (buildings && buildings.indices.length > 0) {
    const scaledBuildings = new Float32Array(buildings.positions.length);
    for (let i = 0; i < buildings.positions.length; i += 1) {
      scaledBuildings[i] = buildings.positions[i] * scale;
    }
    structures = upload(scaledBuildings, buildings.normals, buildings.indices);
  }

  let roadways: Drawable | null = null;
  const roads = options.roads;
  if (roads && roads.indices.length > 0) {
    const scaledRoads = new Float32Array(roads.positions.length);
    for (let i = 0; i < roads.positions.length; i += 1) {
      scaledRoads[i] = roads.positions[i] * scale;
    }
    roadways = upload(scaledRoads, roads.normals, roads.indices);
  }

  let waterways: Drawable | null = null;
  const waterwayMesh = options.waterways;
  if (waterwayMesh && waterwayMesh.indices.length > 0) {
    const scaledWater = new Float32Array(waterwayMesh.positions.length);
    for (let i = 0; i < waterwayMesh.positions.length; i += 1) {
      scaledWater[i] = waterwayMesh.positions[i] * scale;
    }
    waterways = upload(scaledWater, waterwayMesh.normals, waterwayMesh.indices);
  }

  // One drawable per land-cover class, each with its own override colour.
  const landcover: { drawable: Drawable; color: readonly [number, number, number] }[] = [];
  for (const patch of options.landcover?.classes ?? []) {
    if (patch.indices.length === 0) continue;
    const scaledPatch = new Float32Array(patch.positions.length);
    for (let i = 0; i < patch.positions.length; i += 1) {
      scaledPatch[i] = patch.positions[i] * scale;
    }
    landcover.push({ drawable: upload(scaledPatch, patch.normals, patch.indices), color: patch.color });
  }

  const uModelView = gl.getUniformLocation(program, 'uModelView');
  const uProjection = gl.getUniformLocation(program, 'uProjection');
  const uLightDir = gl.getUniformLocation(program, 'uLightDir');
  const uInvMaxHeight = gl.getUniformLocation(program, 'uInvMaxHeight');
  const uOverrideColor = gl.getUniformLocation(program, 'uOverrideColor');
  const uUseOverride = gl.getUniformLocation(program, 'uUseOverride');
  const uGroundSize = gl.getUniformLocation(program, 'uGroundSize');
  const uOrtho = gl.getUniformLocation(program, 'uOrtho');
  const uUseOrtho = gl.getUniformLocation(program, 'uUseOrtho');
  const uTexturedStructure = gl.getUniformLocation(program, 'uTexturedStructure');
  const uPosterize = gl.getUniformLocation(program, 'uPosterize');
  const uWindowCol = gl.getUniformLocation(program, 'uWindowCol');
  const uFloorRow = gl.getUniformLocation(program, 'uFloorRow');
  const uModel = gl.getUniformLocation(program, 'uModel');
  const uModelTex = gl.getUniformLocation(program, 'uModelTex');
  const uUseModelTexture = gl.getUniformLocation(program, 'uUseModelTexture');

  // WebGL2 has no NPOT restrictions, so the bbox-shaped orthophoto uploads
  // as-is and still gets mipmaps for the oblique viewing angles.
  let orthoTexture: WebGLTexture | null = null;
  if (options.ortho) {
    orthoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, orthoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.ortho);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  let yaw = Math.PI * 0.25;
  let pitch = 0.62;
  // Model space is normalised to 2 units across, so this frames the mesh with a
  // small margin at the 45° vertical field of view used below.
  let distance = 2.5;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let destroyed = false;
  let frame = 0;
  let projectionMode: ViewerProjection = 'perspective';
  let pixelLook = false;
  const layerVisible: Record<ViewerLayer, boolean> = {
    ortho: true,
    buildings: true,
    roads: true,
    landcover: true,
    waterways: true,
  };

  // Classic dimetric game angle: atan(1/2) pitch, camera on a diagonal.
  const ISO_PITCH = Math.atan(0.5);
  const ISO_YAW = Math.PI / 4;
  /** Render at a third of the pixels and upscale nearest — chunky, not blurry. */
  const PIXEL_SCALE = 3;
  const POSTERIZE_LEVELS = 7;

  // --- First-person walk ----------------------------------------------------
  // Eye height carries the vertical exaggeration so the walker matches the
  // buildings; horizontal speed is true metres at a brisk demo pace.
  const WALK_EYE_UNITS = 1.7 * 1.5 * scale;
  const WALK_SPEED = 12 * scale;
  const WALK_RUN_SPEED = 36 * scale;
  let walkMode = false;
  let walkTouched = false;
  let walkYaw = 0;
  let walkPitch = -0.05;
  let walkX = 0;
  let walkZ = 0;
  /** Third-person boom length in metres; the mouse wheel zooms it. */
  let walkBoom = 5;
  /** Stride phase driving the procedural walk bob. */
  let walkPhase = 0;
  let walkStepBeat = 0;
  let walkMoving = false;
  let lastFrameTime = 0;
  let lastLiftAt = 0;
  const keysDown = new Set<string>();
  let character: Drawable | null = null;
  let characterTexture: WebGLTexture | null = null;
  /** Model height in metres; boom, stride and clearances all key off it. */
  let characterHeightM = 1.75;
  let kaiju: {
    drawables: Drawable[];
    texture: WebGLTexture | null;
    x: number;
    z: number;
    heading: number;
    phase: number;
    lastStomp: number;
  } | null = null;
  let npcs: {
    drawable: Drawable;
    texture: WebGLTexture | null;
    x: number;
    z: number;
    theta: number;
  }[] = [];

  // A giant reads as a giant through the camera: everything that framed a
  // 1.75 m human stretches with the model's height.
  const charFactor = (): number => characterHeightM / 1.75;
  /** Giants pace slower but cover more ground per stride. */
  const strideScale = (): number => Math.max(1, characterHeightM / 5);

  /** Bilinear terrain height at a point in scaled model space. */
  const groundAt = (x: number, z: number): number => {
    const gridN = mesh.stats.gridN;
    const width = Math.max(1e-6, mesh.stats.widthM * scale);
    const depth = Math.max(1e-6, mesh.stats.depthM * scale);
    const col = Math.min(gridN - 1, Math.max(0, (x / width + 0.5) * (gridN - 1)));
    const row = Math.min(gridN - 1, Math.max(0, (z / depth + 0.5) * (gridN - 1)));
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const c1 = Math.min(gridN - 1, c0 + 1);
    const r1 = Math.min(gridN - 1, r0 + 1);
    const fc = col - c0;
    const fr = row - r0;
    const heightAt = (r: number, c: number): number => scaled[(r * gridN + c) * 3 + 1];
    return (
      heightAt(r0, c0) * (1 - fc) * (1 - fr) +
      heightAt(r0, c1) * fc * (1 - fr) +
      heightAt(r1, c0) * (1 - fc) * fr +
      heightAt(r1, c1) * fc * fr
    );
  };

  const onWalkKeyDown = (event: KeyboardEvent): void => {
    if (!walkMode) return;
    keysDown.add(event.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  };
  const onWalkKeyUp = (event: KeyboardEvent): void => {
    keysDown.delete(event.code);
  };
  const onWalkMouseMove = (event: MouseEvent): void => {
    if (!walkMode || document.pointerLockElement !== canvas) return;
    walkYaw += event.movementX * 0.0025;
    walkPitch = Math.min(1.35, Math.max(-1.35, walkPitch - event.movementY * 0.0022));
  };
  const onWalkClick = (): void => {
    if (walkMode && document.pointerLockElement !== canvas) canvas.requestPointerLock();
  };
  window.addEventListener('keydown', onWalkKeyDown);
  window.addEventListener('keyup', onWalkKeyUp);
  document.addEventListener('mousemove', onWalkMouseMove);
  canvas.addEventListener('click', onWalkClick);

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let autoRotate = (options.autoRotate ?? true) && !reduceMotion;

  const INTRO_DURATION_MS = 4500;
  // Spiral reveal: high and far, ~1.75 turns around the scene while closing
  // in, everything on one shared ease so the axes never fight each other.
  const INTRO_TURNS = 1.75;
  const INTRO_START_PITCH = 1.3;
  const INTRO_START_DIST = 7;
  const INTRO_END_PITCH = 0.62; // the viewer's own default oblique pose
  const INTRO_END_DIST = 2.5;
  /** The spiral clears every ridge by this much instead of flying through. */
  const INTRO_CLEARANCE = 24 * 1.5 * scale;

  type Vec3 = [number, number, number];
  let intro: { start: number; last: number; endYaw: number; eye: Vec3 } | null = null;

  if (options.intro) {
    // End the reveal facing uphill: the azimuth of the low→high terrain axis.
    const vertexTotal = scaled.length / 3;
    let lowIndex = 0;
    let highIndex = 0;
    for (let i = 1; i < vertexTotal; i += 1) {
      const y = scaled[i * 3 + 1];
      if (y < scaled[lowIndex * 3 + 1]) lowIndex = i;
      if (y > scaled[highIndex * 3 + 1]) highIndex = i;
    }
    const dirX = scaled[highIndex * 3] - scaled[lowIndex * 3];
    const dirZ = scaled[highIndex * 3 + 2] - scaled[lowIndex * 3 + 2];
    const horizontal = Math.hypot(dirX, dirZ);
    const endYaw =
      horizontal > 1e-6 ? Math.atan2(-dirX / horizontal, -dirZ / horizontal) : 0;

    if (reduceMotion) {
      yaw = endYaw;
      pitch = INTRO_END_PITCH;
      distance = INTRO_END_DIST;
    } else {
      intro = { start: 0, last: 0, endYaw, eye: [0, 0, 0] };
    }
    autoRotate = false;
  }

  /** Hand the camera to the user where the flight currently is, then stop it. */
  const cancelIntro = (): void => {
    if (!intro) return;
    const [ex, ey, ez] = intro.eye;
    const magnitude = Math.hypot(ex, ey, ez);
    if (magnitude > 1e-3) {
      distance = Math.min(9, Math.max(0.05, magnitude));
      pitch = Math.min(1.45, Math.max(0.08, Math.asin(Math.min(1, Math.max(-1, ey / magnitude)))));
      yaw = Math.atan2(ex, ez);
    }
    intro = null;
  };

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2) / (pixelLook ? PIXEL_SCALE : 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const renderScene = (): void => {
    const frameNow = performance.now();
    const dt = lastFrameTime === 0 ? 0.016 : Math.min(0.1, (frameNow - lastFrameTime) / 1000);
    lastFrameTime = frameNow;

    if (autoRotate) yaw += 0.0022;

    // Eye height of whichever camera wins this frame, for the wind swell.
    let currentEyeY = 0;
    let walkView: Mat4 | null = null;
    if (walkMode) {
      const forward =
        (keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0);
      const strafe = (keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0);
      const running = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
      const speed = (running ? WALK_RUN_SPEED : WALK_SPEED) * (character ? strideScale() : 1);
      walkMoving = forward !== 0 || strafe !== 0;
      if (walkMoving) {
        // Giants take slower, heavier strides.
        walkPhase += (dt * (running ? 15 : 9)) / Math.sqrt(character ? strideScale() : 1);
        // One footfall per half stride; a giant's footfall is a stomp.
        const beat = Math.floor(walkPhase / Math.PI);
        if (beat !== walkStepBeat) {
          walkStepBeat = beat;
          if (character && characterHeightM > 8) options.audio?.stomp?.();
          else options.audio?.step?.();
        }
      }
      walkX += (Math.sin(walkYaw) * forward + Math.cos(walkYaw) * strafe) * speed * dt;
      walkZ += (-Math.cos(walkYaw) * forward + Math.sin(walkYaw) * strafe) * speed * dt;
      // Stay on the terrain: the walker cannot leave the selection.
      const limitX = mesh.stats.widthM * scale * 0.49;
      const limitZ = mesh.stats.depthM * scale * 0.49;
      walkX = Math.min(limitX, Math.max(-limitX, walkX));
      walkZ = Math.min(limitZ, Math.max(-limitZ, walkZ));

      const groundY = groundAt(walkX, walkZ);
      const lookXh = Math.sin(walkYaw);
      const lookZh = -Math.cos(walkYaw);
      if (character) {
        // Third person: the camera hangs on a boom behind the avatar. The
        // wheel zooms the boom, mouse pitch tilts it, and a WoW-style
        // collision march zooms in past any terrain that would swallow it.
        // Every length scales with the model's height, so the same code
        // frames a human and a 21 m giant.
        const f = charFactor();
        const targetY = groundY + 1.3 * f * 1.5 * scale;
        const back = walkBoom * scale * Math.cos(walkPitch * 0.6);
        const up = (walkBoom * 0.52 - Math.sin(walkPitch) * walkBoom * 0.44) * 1.5 * scale;
        const desired: Vec3 = [walkX - lookXh * back, groundY + up, walkZ - lookZh * back];
        let clear = 1;
        for (let step = 1; step <= 12; step += 1) {
          const t = step / 12;
          const sx = walkX + (desired[0] - walkX) * t;
          const sy = targetY + (desired[1] - targetY) * t;
          const sz = walkZ + (desired[2] - walkZ) * t;
          if (sy < groundAt(sx, sz) + 0.5 * f * 1.5 * scale) {
            clear = Math.max(0.12, t - 1 / 12);
            break;
          }
        }
        const eyeX = walkX + (desired[0] - walkX) * clear;
        const eyeZ = walkZ + (desired[2] - walkZ) * clear;
        const eyeY = Math.max(
          targetY + (desired[1] - targetY) * clear,
          groundAt(eyeX, eyeZ) + 0.4 * f * 1.5 * scale,
        );
        currentEyeY = eyeY;
        walkView = lookAt([eyeX, eyeY, eyeZ], [walkX, targetY, walkZ], [0, 1, 0]);
      } else {
        // First person: no body loaded, the camera is the walker.
        const eyeY = groundY + WALK_EYE_UNITS;
        currentEyeY = eyeY;
        const lookX = lookXh * Math.cos(walkPitch);
        const lookY = Math.sin(walkPitch);
        const lookZ = lookZh * Math.cos(walkPitch);
        walkView = lookAt(
          [walkX, eyeY, walkZ],
          [walkX + lookX, eyeY + lookY, walkZ + lookZ],
          [0, 1, 0],
        );
      }
    }

    let flightView: Mat4 | null = null;
    if (intro) {
      const now = performance.now();
      if (intro.start === 0) intro.start = now;
      // rAF stalls while the page is hidden or not compositing; resume the
      // flight where it left off instead of skipping to the end.
      if (intro.last !== 0 && now - intro.last > 400) intro.start += now - intro.last;
      intro.last = now;
      const t = Math.min(1, (now - intro.start) / INTRO_DURATION_MS);
      const eased = t * t * (3 - 2 * t);

      // One eased parameter drives angle, distance and pitch together — the
      // spiral unwinds onto the exact orbit pose it hands over to.
      const angle = intro.endYaw + (1 - eased) * INTRO_TURNS * Math.PI * 2;
      const spiralDist = INTRO_START_DIST + (INTRO_END_DIST - INTRO_START_DIST) * eased;
      const spiralPitch = INTRO_START_PITCH + (INTRO_END_PITCH - INTRO_START_PITCH) * eased;
      const ex = Math.cos(spiralPitch) * Math.sin(angle) * spiralDist;
      const ez = Math.cos(spiralPitch) * Math.cos(angle) * spiralDist;
      // Over the relief, never through it.
      const ey = Math.max(Math.sin(spiralPitch) * spiralDist, groundAt(ex, ez) + INTRO_CLEARANCE);
      intro.eye = [ex, ey, ez];
      currentEyeY = ey;
      flightView = lookAt(intro.eye, [0, 0, 0], [0, 1, 0]);

      if (t >= 1) {
        yaw = intro.endYaw;
        pitch = INTRO_END_PITCH;
        distance = INTRO_END_DIST;
        intro = null;
        flightView = null;
      }
    }

    const aspect = canvas.width / Math.max(1, canvas.height);
    const eye = [
      Math.cos(pitch) * Math.sin(yaw) * distance,
      Math.sin(pitch) * distance,
      Math.cos(pitch) * Math.cos(yaw) * distance,
    ];
    if (!walkView && !flightView) currentEyeY = eye[1];
    if (options.audio?.lift && frameNow - lastLiftAt > 250) {
      lastLiftAt = frameNow;
      // 2.2 model units ≈ the default orbit apex; walking pins the wind low.
      options.audio.lift(Math.min(1, Math.max(0, currentEyeY / 2.2)));
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.067, 0.067, 0.067, 1); // --c-soot #111111
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(program);
    // Walking is always perspective — an orthographic first person is nausea.
    gl.uniformMatrix4fv(
      uProjection,
      false,
      projectionMode === 'isometric' && !walkMode
        ? orthographic(distance * 0.5, aspect, -10, 100)
        : perspective(Math.PI / 4, aspect, 0.01, 100),
    );
    gl.uniformMatrix4fv(
      uModelView,
      false,
      walkView ?? flightView ?? lookAt(eye, [0, 0, 0], [0, 1, 0]),
    );
    gl.uniform3f(uLightDir, 0.5, 0.82, 0.28);
    gl.uniform1f(uInvMaxHeight, 1 / maxHeightScaled);
    gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
    gl.uniform2f(
      uGroundSize,
      Math.max(1e-6, mesh.stats.widthM * scale),
      Math.max(1e-6, mesh.stats.depthM * scale),
    );
    gl.uniform1f(uPosterize, pixelLook ? POSTERIZE_LEVELS : 0);
    // Facade grid periods in model units: ~3 m window columns (true metres)
    // and ~4.5 m storeys (heights carry the vertical exaggeration).
    gl.uniform1f(uWindowCol, Math.max(1e-6, 3.0 * scale));
    gl.uniform1f(uFloorRow, Math.max(1e-6, 4.5 * scale));
    gl.uniform1i(uOrtho, 0);
    gl.uniform1i(uModelTex, 1);
    gl.uniform1f(uUseModelTexture, 0);
    gl.uniform1f(uUseOrtho, orthoTexture && layerVisible.ortho ? 1 : 0);
    if (orthoTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, orthoTexture);
    }

    gl.uniformMatrix4fv(uModel, false, IDENTITY_MODEL);
    gl.uniform1f(uUseOverride, 0);
    gl.uniform1f(uTexturedStructure, 0);
    gl.bindVertexArray(terrain.vao);
    gl.drawElements(gl.TRIANGLES, terrain.count, gl.UNSIGNED_INT, 0);

    // Land cover under the roads: a path through the park stays visible.
    if (landcover.length > 0 && layerVisible.landcover) {
      gl.uniform1f(uUseOverride, 1);
      for (const patch of landcover) {
        gl.uniform3f(uOverrideColor, ...patch.color);
        gl.bindVertexArray(patch.drawable.vao);
        gl.drawElements(gl.TRIANGLES, patch.drawable.count, gl.UNSIGNED_INT, 0);
      }
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
    }

    // Waterways above the land cover, below the roads: bridges win.
    if (waterways && layerVisible.waterways) {
      gl.uniform1f(uUseOverride, 1);
      gl.uniform3f(uOverrideColor, ...WATERWAY_COLOR);
      gl.bindVertexArray(waterways.vao);
      gl.drawElements(gl.TRIANGLES, waterways.count, gl.UNSIGNED_INT, 0);
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
    }

    // Roads before buildings: they are ground-hugging, so any overlap should
    // resolve in favour of the structure standing on them.
    if (roadways && layerVisible.roads) {
      gl.uniform1f(uUseOverride, 1);
      gl.uniform3f(uOverrideColor, ...ROAD_COLOR);
      gl.bindVertexArray(roadways.vao);
      gl.drawElements(gl.TRIANGLES, roadways.count, gl.UNSIGNED_INT, 0);
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
    }

    if (structures && layerVisible.buildings) {
      gl.uniform1f(uUseOverride, 1);
      // Buildings take their roof pixels from the drape when it is on;
      // toggling the ortho layer off reverts them to the flat 600B orange.
      gl.uniform1f(uTexturedStructure, 1);
      gl.bindVertexArray(structures.vao);
      gl.drawElements(gl.TRIANGLES, structures.count, gl.UNSIGNED_INT, 0);
      gl.uniform1f(uTexturedStructure, 0);
    }

    // Geo-anchored avatars stand where their placement record says.
    if (npcs.length > 0) {
      gl.uniform1f(uUseOverride, 1);
      gl.uniform1f(uTexturedStructure, 0);
      gl.uniform3f(uOverrideColor, ...CHARACTER_COLOR);
      for (const npc of npcs) {
        const c = Math.cos(npc.theta);
        const s = Math.sin(npc.theta);
        gl.uniformMatrix4fv(
          uModel,
          false,
          new Float32Array([
            scale * c, 0, -scale * s, 0,
            0, scale, 0, 0,
            scale * s, 0, scale * c, 0,
            npc.x, groundAt(npc.x, npc.z), npc.z, 1,
          ]),
        );
        if (npc.texture) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, npc.texture);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1f(uUseModelTexture, 1);
        }
        gl.bindVertexArray(npc.drawable.vao);
        gl.drawElements(gl.TRIANGLES, npc.drawable.count, gl.UNSIGNED_INT, 0);
        gl.uniform1f(uUseModelTexture, 0);
      }
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
      gl.uniformMatrix4fv(uModel, false, IDENTITY_MODEL);
    }

    // The kaiju stomps across the selection on its own clock, heading for
    // the far side and turning back at the edge.
    if (kaiju) {
      const stompSpeed = 10 * scale;
      kaiju.phase += dt * 4.5;
      const stompBeat = Math.floor(kaiju.phase / Math.PI);
      if (stompBeat !== kaiju.lastStomp) {
        kaiju.lastStomp = stompBeat;
        options.audio?.stomp?.();
      }
      kaiju.x += Math.sin(kaiju.heading) * stompSpeed * dt;
      kaiju.z += -Math.cos(kaiju.heading) * stompSpeed * dt;
      const limitX = mesh.stats.widthM * scale * 0.45;
      const limitZ = mesh.stats.depthM * scale * 0.45;
      if (Math.abs(kaiju.x) > limitX || Math.abs(kaiju.z) > limitZ) {
        kaiju.x = Math.min(limitX, Math.max(-limitX, kaiju.x));
        kaiju.z = Math.min(limitZ, Math.max(-limitZ, kaiju.z));
        kaiju.heading += Math.PI * 0.72; // turn, but never retrace exactly
      }
      // The baked gait carries the leg motion; only a mild body bob remains.
      const stompBob = Math.abs(Math.sin(kaiju.phase)) * 0.8 * 1.5 * scale;
      const theta = Math.PI - kaiju.heading;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      gl.uniformMatrix4fv(
        uModel,
        false,
        new Float32Array([
          scale * c, 0, -scale * s, 0,
          0, scale, 0, 0,
          scale * s, 0, scale * c, 0,
          kaiju.x, groundAt(kaiju.x, kaiju.z) + stompBob, kaiju.z, 1,
        ]),
      );
      gl.uniform1f(uUseOverride, 1);
      gl.uniform1f(uTexturedStructure, 0);
      gl.uniform3f(uOverrideColor, 0.82, 0.32, 0.2);
      if (kaiju.texture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, kaiju.texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(uUseModelTexture, 1);
      }
      const frameIndex =
        Math.floor(((kaiju.phase / (Math.PI * 2)) % 1) * kaiju.drawables.length) %
        kaiju.drawables.length;
      const frame = kaiju.drawables[frameIndex];
      gl.bindVertexArray(frame.vao);
      gl.drawElements(gl.TRIANGLES, frame.count, gl.UNSIGNED_INT, 0);
      gl.uniform1f(uUseModelTexture, 0);
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
      gl.uniformMatrix4fv(uModel, false, IDENTITY_MODEL);
    }

    // The avatar walks in third person and stays standing where the walker
    // left it, visible from orbit and isometric views. With no body loaded
    // the walk is first person, so there is nothing to draw.
    if (character && walkTouched) {
      // glTF models face +Z, so π−walkYaw points the face along the walking
      // direction and the camera sees the back — with a stride sway and a
      // double-step bob selling the walk on a rigid mesh.
      const sway = walkMode && walkMoving ? Math.sin(walkPhase * 0.5) * 0.06 : 0;
      const theta = Math.PI - walkYaw + sway;
      const cosYaw = Math.cos(theta);
      const sinYaw = Math.sin(theta);
      const bob =
        walkMode && walkMoving
          ? Math.abs(Math.sin(walkPhase)) * 0.1 * charFactor() * 1.5 * scale
          : 0;
      const groundY = groundAt(walkX, walkZ) + bob;
      // Column-major translate(walk position) · rotateY(theta) · scale.
      gl.uniformMatrix4fv(
        uModel,
        false,
        new Float32Array([
          scale * cosYaw, 0, -scale * sinYaw, 0,
          0, scale, 0, 0,
          scale * sinYaw, 0, scale * cosYaw, 0,
          walkX, groundY, walkZ, 1,
        ]),
      );
      gl.uniform1f(uUseOverride, 1);
      gl.uniform3f(uOverrideColor, ...CHARACTER_COLOR);
      if (characterTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, characterTexture);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(uUseModelTexture, 1);
      }
      gl.bindVertexArray(character.vao);
      gl.drawElements(gl.TRIANGLES, character.count, gl.UNSIGNED_INT, 0);
      gl.uniform1f(uUseModelTexture, 0);
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
      gl.uniformMatrix4fv(uModel, false, IDENTITY_MODEL);
    }
    gl.bindVertexArray(null);
  };

  const draw = (): void => {
    if (destroyed) return;
    resize();
    renderScene();
    frame = requestAnimationFrame(draw);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // In walk mode dragging steers the look — pointer lock is only an
    // enhancement, since iframes and embedded panes routinely deny it.
    dragging = true;
    autoRotate = false;
    if (!walkMode) cancelIntro();
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    if (walkMode) {
      walkYaw += (event.clientX - lastX) * 0.005;
      walkPitch = Math.min(1.35, Math.max(-1.35, walkPitch - (event.clientY - lastY) * 0.004));
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    yaw -= (event.clientX - lastX) * 0.008;
    // The dimetric angle is the whole point of the isometric mode, so only
    // yaw responds to drag there.
    if (projectionMode !== 'isometric') {
      pitch = Math.min(1.45, Math.max(0.08, pitch + (event.clientY - lastY) * 0.006));
    }
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (walkMode) {
      // WoW-style: the wheel zooms the third-person boom, in strides of the
      // avatar's own size so a giant zooms in giant steps.
      const f = charFactor();
      walkBoom = Math.min(
        14 * f,
        Math.max(2 * f, walkBoom + Math.sign(event.deltaY) * 0.8 * f),
      );
      return;
    }
    autoRotate = false;
    cancelIntro();
    distance = Math.min(9, Math.max(1.2, distance + Math.sign(event.deltaY) * 0.2));
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Draw once synchronously so a still frame exists even where rAF is throttled.
  draw();

  return {
    setLayerVisible: (layer: ViewerLayer, visible: boolean) => {
      layerVisible[layer] = visible;
    },
    setProjection: (mode: ViewerProjection) => {
      projectionMode = mode;
      if (mode === 'isometric') {
        cancelIntro();
        autoRotate = false;
        pitch = ISO_PITCH;
        // Snap to the nearest diagonal so facades read at the classic angle.
        yaw = Math.round((yaw - ISO_YAW) / (Math.PI / 2)) * (Math.PI / 2) + ISO_YAW;
      }
    },
    setPixelLook: (on: boolean) => {
      pixelLook = on;
      canvas.style.imageRendering = on ? 'pixelated' : '';
    },
    setWalkMode: (on: boolean) => {
      walkMode = on;
      if (on) {
        cancelIntro();
        autoRotate = false;
        walkTouched = true;
        walkX = 0;
        walkZ = 0;
        // Face the way the orbit camera was looking, so entering walk mode
        // does not spin the world.
        walkYaw = -yaw;
        walkPitch = -0.05;
        keysDown.clear();
      } else {
        keysDown.clear();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
    },
    getWalkPosition: () => {
      if (!walkTouched) return null;
      // Positions are scaled model units; hand back true metres.
      return { x: walkX / scale, z: walkZ / scale, headingRad: walkYaw };
    },
    setCharacter: (characterMesh) => {
      if (destroyed) return;
      if (character) {
        for (const buffer of character.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(character.vao);
        character = null;
      }
      if (characterTexture) {
        gl.deleteTexture(characterTexture);
        characterTexture = null;
      }
      characterHeightM = 1.75;
      if (characterMesh) {
        character = upload(
          characterMesh.positions,
          characterMesh.normals,
          characterMesh.indices,
          characterMesh.uvs,
        );
        characterTexture = characterMesh.texture ? makeModelTexture(characterMesh.texture) : null;
        // The mesh arrives normalised with feet at y = 0, so its top IS its
        // height in metres — the camera scales itself from this one number.
        let top = 0;
        for (let i = 1; i < characterMesh.positions.length; i += 3) {
          top = Math.max(top, characterMesh.positions[i]);
        }
        characterHeightM = Math.max(0.5, top || 1.75);
        walkBoom = characterHeightM * 2.85;
      }
    },
    setNpcs: (list) => {
      if (destroyed) return;
      for (const npc of npcs) {
        for (const buffer of npc.drawable.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(npc.drawable.vao);
        if (npc.texture) gl.deleteTexture(npc.texture);
      }
      npcs = list.map((npc) => ({
        drawable: upload(npc.mesh.positions, npc.mesh.normals, npc.mesh.indices, npc.mesh.uvs),
        texture: npc.mesh.texture ? makeModelTexture(npc.mesh.texture) : null,
        x: npc.x,
        z: npc.z,
        theta: npc.theta,
      }));
    },
    setKaiju: (frames) => {
      if (destroyed) return;
      if (kaiju) {
        for (const drawable of kaiju.drawables) {
          for (const buffer of drawable.buffers) gl.deleteBuffer(buffer);
          gl.deleteVertexArray(drawable.vao);
        }
        if (kaiju.texture) gl.deleteTexture(kaiju.texture);
        kaiju = null;
      }
      if (frames && frames.length > 0) {
        // One shared skin: every gait frame deforms the same painted body.
        const skin = frames.find((frame) => frame.texture)?.texture ?? null;
        kaiju = {
          drawables: frames.map((frame) =>
            upload(frame.positions, frame.normals, frame.indices, frame.uvs),
          ),
          texture: skin ? makeModelTexture(skin) : null,
          // Spawn dead centre — the crab IS the event, not an arrival.
          x: 0,
          z: 0,
          heading: Math.PI * 0.25,
          phase: 0,
          lastStomp: 0,
        };
      }
    },
    exportImage: async (): Promise<Blob | null> => {
      if (destroyed) return null;
      // One synchronous high-resolution frame, read back before anything else
      // can touch the buffer — no preserveDrawingBuffer needed. The rAF loop
      // is cancelled around the manual render so it cannot fork.
      cancelAnimationFrame(frame);
      const EXPORT_LONG_SIDE = 2560;
      const aspect = Math.max(
        0.2,
        Math.min(5, canvas.clientWidth / Math.max(1, canvas.clientHeight)),
      );
      let width = aspect >= 1 ? EXPORT_LONG_SIDE : Math.round(EXPORT_LONG_SIDE * aspect);
      let height = Math.round(width / aspect);
      // Pixel look renders coarse and upscales nearest — big crisp pixels,
      // not interpolated mush.
      const upscale = pixelLook ? PIXEL_SCALE : 1;
      width = Math.max(1, Math.round(width / upscale));
      height = Math.max(1, Math.round(height / upscale));

      const previousWidth = canvas.width;
      const previousHeight = canvas.height;
      canvas.width = width;
      canvas.height = height;
      renderScene();
      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      canvas.width = previousWidth;
      canvas.height = previousHeight;
      frame = requestAnimationFrame(draw);

      // GL rows are bottom-up; canvases are top-down.
      const flipped = new Uint8ClampedArray(raw.length);
      const rowBytes = width * 4;
      for (let row = 0; row < height; row += 1) {
        flipped.set(
          raw.subarray(row * rowBytes, (row + 1) * rowBytes),
          (height - 1 - row) * rowBytes,
        );
      }

      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      const sourceContext = source.getContext('2d');
      if (!sourceContext) return null;
      sourceContext.putImageData(new ImageData(flipped, width, height), 0, 0);

      const surface = document.createElement('canvas');
      surface.width = width * upscale;
      surface.height = height * upscale;
      const context = surface.getContext('2d');
      if (!context) return null;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, surface.width, surface.height);
      return new Promise((resolve) => surface.toBlob(resolve, 'image/png'));
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onWalkKeyDown);
      window.removeEventListener('keyup', onWalkKeyUp);
      document.removeEventListener('mousemove', onWalkMouseMove);
      canvas.removeEventListener('click', onWalkClick);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const drawable of [
        terrain,
        structures,
        roadways,
        waterways,
        character,
        ...(kaiju?.drawables ?? []),
        ...npcs.map((npc) => npc.drawable),
        ...landcover.map((p) => p.drawable),
      ]) {
        if (!drawable) continue;
        for (const buffer of drawable.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(drawable.vao);
      }
      if (orthoTexture) gl.deleteTexture(orthoTexture);
      if (characterTexture) gl.deleteTexture(characterTexture);
      if (kaiju?.texture) gl.deleteTexture(kaiju.texture);
      for (const npc of npcs) if (npc.texture) gl.deleteTexture(npc.texture);
      gl.deleteProgram(program);
    },
  };
}
