import dots from '../config/globe-dots.json';

/**
 * The matrix console globe: a rotating orthographic dot-earth on a 2D
 * canvas, phosphor green on black. Land is a baked Natural Earth 110m dot
 * field; events (placements, presences) pulse on top. `flyTo` tweens the
 * rotation to a target — the search field's landing animation.
 */

export type GlobeEvent = {
  name: string;
  lon: number;
  lat: number;
  kind: 'placement' | 'presence';
  message?: string;
};

export type MatrixGlobe = {
  setEvents: (events: GlobeEvent[]) => void;
  flyTo: (lon: number, lat: number) => void;
  destroy: () => void;
};

const DEG = Math.PI / 180;
const LAND = (dots as [number, number][]).map(([lon, lat]) => {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return {
    x: Math.cos(phi) * Math.sin(lambda),
    y: Math.sin(phi),
    z: Math.cos(phi) * Math.cos(lambda),
  };
});

export function createMatrixGlobe(canvas: HTMLCanvasElement): MatrixGlobe {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable.');

  let events: (GlobeEvent & { x: number; y: number; z: number })[] = [];
  let yaw = 0.6;
  let pitch = 0.42;
  let autoSpin = true;
  let flight: { fromYaw: number; fromPitch: number; toYaw: number; toPitch: number;
    start: number } | null = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let frame = 0;
  let destroyed = false;

  const toVector = (lon: number, lat: number) => {
    const phi = lat * DEG;
    const lambda = lon * DEG;
    return {
      x: Math.cos(phi) * Math.sin(lambda),
      y: Math.sin(phi),
      z: Math.cos(phi) * Math.cos(lambda),
    };
  };

  const draw = (): void => {
    if (destroyed) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const now = performance.now();

    if (flight) {
      const t = Math.min(1, (now - flight.start) / 1400);
      const eased = t * t * (3 - 2 * t);
      yaw = flight.fromYaw + (flight.toYaw - flight.fromYaw) * eased;
      pitch = flight.fromPitch + (flight.toPitch - flight.fromPitch) * eased;
      if (t >= 1) flight = null;
    } else if (autoSpin && !dragging) {
      yaw += 0.0016;
    }

    const radius = Math.min(width, height) * 0.42;
    const cx = width / 2;
    const cy = height / 2;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);

    const project = (v: { x: number; y: number; z: number }) => {
      // Rotate around Y (yaw), then X (pitch); z+ faces the viewer.
      const x1 = v.x * cosYaw - v.z * sinYaw;
      const z1 = v.x * sinYaw + v.z * cosYaw;
      const y2 = v.y * cosPitch - z1 * sinPitch;
      const z2 = v.y * sinPitch + z1 * cosPitch;
      return { x: cx + x1 * radius, y: cy - y2 * radius, front: z2 > 0.02 };
    };

    context.clearRect(0, 0, width, height);

    // Sphere limb + faint graticule.
    context.strokeStyle = 'rgba(0, 255, 102, 0.28)';
    context.lineWidth = ratio;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = 'rgba(0, 255, 102, 0.07)';
    for (let lat = -60; lat <= 60; lat += 30) {
      context.beginPath();
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 4) {
        const p = project(toVector(lon, lat));
        if (p.front) {
          if (pen) context.lineTo(p.x, p.y);
          else context.moveTo(p.x, p.y);
          pen = true;
        } else pen = false;
      }
      context.stroke();
    }

    // Land dots — the matrix rain of the map.
    const dotSize = Math.max(1, radius * 0.008);
    context.fillStyle = 'rgba(0, 255, 102, 0.75)';
    for (const v of LAND) {
      const p = project(v);
      if (!p.front) continue;
      context.fillRect(p.x, p.y, dotSize, dotSize);
    }

    // Events pulse.
    const pulse = 0.5 + 0.5 * Math.sin(now / 320);
    for (const event of events) {
      const p = project(event);
      if (!p.front) continue;
      const r = radius * (0.014 + 0.012 * pulse);
      context.strokeStyle =
        event.kind === 'presence' ? 'rgba(255, 167, 51, 0.95)' : 'rgba(0, 255, 102, 0.95)';
      context.lineWidth = ratio * 1.4;
      context.beginPath();
      context.arc(p.x, p.y, r, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.fillRect(p.x - ratio, p.y - ratio, ratio * 2, ratio * 2);
      context.font = `${Math.round(11 * ratio)}px ui-monospace, monospace`;
      context.fillText(event.name, p.x + r + 3 * ratio, p.y + 3 * ratio);
    }

    frame = requestAnimationFrame(draw);
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    autoSpin = false;
    flight = null;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.005;
    pitch = Math.min(1.3, Math.max(-1.3, pitch + (event.clientY - lastY) * 0.005));
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  draw();

  return {
    setEvents: (list) => {
      events = list.map((event) => ({ ...event, ...toVector(event.lon, event.lat) }));
    },
    flyTo: (lon, lat) => {
      // The point faces the viewer when yaw = -lon and pitch = lat.
      const targetYaw = -lon * DEG;
      const targetPitch = Math.min(1.3, Math.max(-1.3, lat * DEG));
      const turns = Math.round((yaw - targetYaw) / (Math.PI * 2));
      flight = {
        fromYaw: yaw,
        fromPitch: pitch,
        toYaw: targetYaw + turns * Math.PI * 2,
        toPitch: targetPitch,
        start: performance.now(),
      };
      autoSpin = false;
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
