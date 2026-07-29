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
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uInvMaxHeight;
uniform vec2 uGroundSize;
out vec3 vNormal;
out float vHeight;
out vec2 vUV;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vHeight = aPosition.y * uInvMaxHeight;
  // The terrain grid is centred on the origin with north at -Z, and the
  // orthophoto's first row is north — so no flip is needed on either axis.
  vUV = aPosition.xz / uGroundSize + 0.5;
  vWorld = aPosition;
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHeight;
in vec2 vUV;
in vec3 vWorld;
uniform vec3 uLightDir;
uniform vec3 uOverrideColor;
uniform float uUseOverride;
uniform sampler2D uOrtho;
uniform float uUseOrtho;
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

export type TerrainViewer = {
  setLayerVisible: (layer: ViewerLayer, visible: boolean) => void;
  setProjection: (mode: ViewerProjection) => void;
  /** Chunky pixels and a coarse palette — the retro game-map aesthetic. */
  setPixelLook: (on: boolean) => void;
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

  type Drawable = {
    vao: WebGLVertexArrayObject | null;
    count: number;
    buffers: (WebGLBuffer | null)[];
  };

  const upload = (
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
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

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    return {
      vao,
      count: indices.length,
      buffers: [positionBuffer, normalBuffer, indexBuffer],
    };
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

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let autoRotate = (options.autoRotate ?? true) && !reduceMotion;

  const INTRO_EYE_HEIGHT_M = 21;
  const INTRO_DURATION_MS = 4000;
  const ORTHO_PITCH = 1.45; // the viewer's own pitch clamp — near-vertical
  const ORTHO_DISTANCE = 2.5;
  /** Fraction of the intro spent tracing the low→high line; the rest settles into the ortho view. */
  const INTRO_LINE_FRACTION = 0.7;

  type Vec3 = [number, number, number];
  let intro: {
    start: number;
    last: number;
    lowEye: Vec3;
    highEye: Vec3;
    peak: Vec3;
    endEye: Vec3;
    endYaw: number;
    eye: Vec3;
  } | null = null;

  if (options.intro) {
    if (reduceMotion) {
      yaw = 0;
      pitch = ORTHO_PITCH;
      distance = ORTHO_DISTANCE;
    } else {
      // The flight traces the terrain's own extremes: 21 m above the lowest
      // vertex, straight along the line to the highest, then settling into
      // the straight-down ortho view. The low→high line is the alignment.
      const vertexTotal = scaled.length / 3;
      let lowIndex = 0;
      let highIndex = 0;
      for (let i = 1; i < vertexTotal; i += 1) {
        const y = scaled[i * 3 + 1];
        if (y < scaled[lowIndex * 3 + 1]) lowIndex = i;
        if (y > scaled[highIndex * 3 + 1]) highIndex = i;
      }
      const at = (index: number): Vec3 => [
        scaled[index * 3],
        scaled[index * 3 + 1],
        scaled[index * 3 + 2],
      ];
      const peak = at(highIndex);
      let low = at(lowIndex);
      // A flat selection has no meaningful line — approach from the south.
      if (peak[1] - low[1] < 1e-4) low = [peak[0], peak[1], Math.min(1, peak[2] + 0.8)];

      const lift = INTRO_EYE_HEIGHT_M * scale;
      const horizontal = Math.hypot(peak[0] - low[0], peak[2] - low[2]);
      const direction: Vec3 =
        horizontal > 1e-6
          ? [(peak[0] - low[0]) / horizontal, 0, (peak[2] - low[2]) / horizontal]
          : [0, 0, -1];
      // The ending orbit eye sits opposite the flight direction, so the
      // settle keeps looking the way the flight was going.
      const endYaw = Math.atan2(-direction[0], -direction[2]);
      const endEye: Vec3 = [
        Math.cos(ORTHO_PITCH) * Math.sin(endYaw) * ORTHO_DISTANCE,
        Math.sin(ORTHO_PITCH) * ORTHO_DISTANCE,
        Math.cos(ORTHO_PITCH) * Math.cos(endYaw) * ORTHO_DISTANCE,
      ];
      intro = {
        start: 0,
        last: 0,
        lowEye: [low[0], low[1] + lift, low[2]],
        // Hold short of the peak so the look-down never turns exactly
        // vertical, which would degenerate the view basis.
        highEye: [peak[0] - direction[0] * lift, peak[1] + lift, peak[2] - direction[2] * lift],
        peak,
        endEye,
        endYaw,
        eye: [0, 0, 0],
      };
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
    if (autoRotate) yaw += 0.0022;

    let flightView: Mat4 | null = null;
    if (intro) {
      const now = performance.now();
      if (intro.start === 0) intro.start = now;
      // rAF stalls while the page is hidden or not compositing; resume the
      // flight where it left off instead of skipping to the end.
      if (intro.last !== 0 && now - intro.last > 400) intro.start += now - intro.last;
      intro.last = now;
      const t = Math.min(1, (now - intro.start) / INTRO_DURATION_MS);
      const smooth = (k: number): number => k * k * (3 - 2 * k);
      const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        a[2] + (b[2] - a[2]) * k,
      ];

      let flightEye: Vec3;
      let flightTarget: Vec3;
      if (t < INTRO_LINE_FRACTION) {
        // Trace the low→high line, eyes on the peak.
        const k = smooth(t / INTRO_LINE_FRACTION);
        flightEye = lerp3(intro.lowEye, intro.highEye, k);
        flightTarget = intro.peak;
      } else {
        // Settle from above the peak into the straight-down ortho view.
        const k = smooth((t - INTRO_LINE_FRACTION) / (1 - INTRO_LINE_FRACTION));
        flightEye = lerp3(intro.highEye, intro.endEye, k);
        flightTarget = lerp3(intro.peak, [0, 0, 0], k);
      }
      intro.eye = flightEye;
      flightView = lookAt(flightEye, flightTarget, [0, 1, 0]);

      if (t >= 1) {
        // The final flight frame equals this orbit pose, so the handover is
        // seamless.
        yaw = intro.endYaw;
        pitch = ORTHO_PITCH;
        distance = ORTHO_DISTANCE;
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

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.067, 0.067, 0.067, 1); // --c-soot #111111
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(program);
    gl.uniformMatrix4fv(
      uProjection,
      false,
      projectionMode === 'isometric'
        ? orthographic(distance * 0.5, aspect, -10, 100)
        : perspective(Math.PI / 4, aspect, 0.01, 100),
    );
    gl.uniformMatrix4fv(uModelView, false, flightView ?? lookAt(eye, [0, 0, 0], [0, 1, 0]));
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
    gl.uniform1f(uUseOrtho, orthoTexture && layerVisible.ortho ? 1 : 0);
    if (orthoTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, orthoTexture);
    }

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
    gl.bindVertexArray(null);
  };

  const draw = (): void => {
    if (destroyed) return;
    resize();
    renderScene();
    frame = requestAnimationFrame(draw);
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    autoRotate = false;
    cancelIntro();
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
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
      for (const drawable of [
        terrain,
        structures,
        roadways,
        waterways,
        ...landcover.map((p) => p.drawable),
      ]) {
        if (!drawable) continue;
        for (const buffer of drawable.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(drawable.vao);
      }
      if (orthoTexture) gl.deleteTexture(orthoTexture);
      gl.deleteProgram(program);
    },
  };
}
