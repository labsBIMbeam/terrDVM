import type { BuildingMesh } from '../buildings/extrude';
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
out vec3 vNormal;
out float vHeight;
void main() {
  vNormal = aNormal;
  vHeight = aPosition.y * uInvMaxHeight;
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHeight;
uniform vec3 uLightDir;
uniform vec3 uOverrideColor;
uniform float uUseOverride;
out vec4 outColor;

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
  vec3 base = mix(ramp(clamp(vHeight, 0.0, 1.0)), uOverrideColor, uUseOverride);
  outColor = vec4(base * light, 1.0);
}`;

type Mat4 = Float32Array;

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

export type TerrainViewer = {
  destroy: () => void;
};

/** 600B orange, so structures read clearly against the natural terrain ramp. */
const BUILDING_COLOR: readonly [number, number, number] = [0.969, 0.576, 0.102];

/** Asphalt: dark and desaturated so roads read as ground, not as objects. */
const ROAD_COLOR: readonly [number, number, number] = [0.13, 0.13, 0.14];

export function createTerrainViewer(
  canvas: HTMLCanvasElement,
  mesh: TerrainMesh,
  options: { autoRotate?: boolean; buildings?: BuildingMesh; roads?: RoadMesh } = {},
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

  const uModelView = gl.getUniformLocation(program, 'uModelView');
  const uProjection = gl.getUniformLocation(program, 'uProjection');
  const uLightDir = gl.getUniformLocation(program, 'uLightDir');
  const uInvMaxHeight = gl.getUniformLocation(program, 'uInvMaxHeight');
  const uOverrideColor = gl.getUniformLocation(program, 'uOverrideColor');
  const uUseOverride = gl.getUniformLocation(program, 'uUseOverride');

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

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let autoRotate = (options.autoRotate ?? true) && !reduceMotion;

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = (): void => {
    if (destroyed) return;
    resize();
    if (autoRotate) yaw += 0.0022;

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
    gl.uniformMatrix4fv(uProjection, false, perspective(Math.PI / 4, aspect, 0.01, 100));
    gl.uniformMatrix4fv(uModelView, false, lookAt(eye, [0, 0, 0], [0, 1, 0]));
    gl.uniform3f(uLightDir, 0.5, 0.82, 0.28);
    gl.uniform1f(uInvMaxHeight, 1 / maxHeightScaled);
    gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);

    gl.uniform1f(uUseOverride, 0);
    gl.bindVertexArray(terrain.vao);
    gl.drawElements(gl.TRIANGLES, terrain.count, gl.UNSIGNED_INT, 0);

    // Roads before buildings: they are ground-hugging, so any overlap should
    // resolve in favour of the structure standing on them.
    if (roadways) {
      gl.uniform1f(uUseOverride, 1);
      gl.uniform3f(uOverrideColor, ...ROAD_COLOR);
      gl.bindVertexArray(roadways.vao);
      gl.drawElements(gl.TRIANGLES, roadways.count, gl.UNSIGNED_INT, 0);
      gl.uniform3f(uOverrideColor, ...BUILDING_COLOR);
    }

    if (structures) {
      gl.uniform1f(uUseOverride, 1);
      gl.bindVertexArray(structures.vao);
      gl.drawElements(gl.TRIANGLES, structures.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);

    frame = requestAnimationFrame(draw);
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    autoRotate = false;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    yaw -= (event.clientX - lastX) * 0.008;
    pitch = Math.min(1.45, Math.max(0.08, pitch + (event.clientY - lastY) * 0.006));
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
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      for (const drawable of [terrain, structures, roadways]) {
        if (!drawable) continue;
        for (const buffer of drawable.buffers) gl.deleteBuffer(buffer);
        gl.deleteVertexArray(drawable.vao);
      }
      gl.deleteProgram(program);
    },
  };
}
