// Bake Natural Earth 110m land into the matrix globe's dot field.
//
//   node scripts/bake-globe-dots.mjs <ne_admin0.geojson> <out.json>
//
// A regular lon/lat grid is sampled point-in-polygon against every country;
// hits become dots. Latitude rows are cosine-compensated so dot density
// looks even on an orthographic globe. Output: [[lon, lat], ...] rounded to
// one decimal — Natural Earth is public domain.

import { readFile, writeFile } from 'node:fs/promises';

const [worldPath, outPath] = process.argv.slice(2);
if (!worldPath || !outPath) {
  console.error('usage: node scripts/bake-globe-dots.mjs <ne_admin0> <out>');
  process.exit(1);
}

const world = JSON.parse(await readFile(worldPath, 'utf-8'));

const rings = [];
for (const feature of world.features) {
  const geometry = feature.geometry;
  if (!geometry) continue;
  const polygons =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  for (const polygon of polygons) rings.push(polygon);
}

function inPolygon(lon, lat, polygon) {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const STEP = 1.8;
const dots = [];
for (let lat = -58; lat <= 78; lat += STEP) {
  const stride = STEP / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  for (let lon = -180; lon < 180; lon += stride) {
    if (rings.some((polygon) => inPolygon(lon, lat, polygon))) {
      dots.push([Math.round(lon * 10) / 10, Math.round(lat * 10) / 10]);
    }
  }
}

await writeFile(outPath, JSON.stringify(dots));
console.log(`globe dots: ${dots.length}`);
