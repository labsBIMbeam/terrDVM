// Bake the continental coverage survey onto country boundaries.
//
//   node scripts/bake-countries.mjs <survey.geojson> <ne_admin0.geojson> <out.json>
//
// Survey cells are a probe grid, not a message a user should read — country
// shapes are. A country whose sampled land cells are majority-gap is marked
// as one gap feature; everything else is not drawn. The z7 counts stay in
// the header, which is where the client summary reads from. Boundaries are
// Natural Earth 110m (public domain), rounded to ~1 km.

import { readFile, writeFile } from 'node:fs/promises';

const [surveyPath, countriesPath, outPath] = process.argv.slice(2);
if (!surveyPath || !countriesPath || !outPath) {
  console.error('usage: node scripts/bake-countries.mjs <survey> <ne_admin0> <out>');
  process.exit(1);
}

const survey = JSON.parse(await readFile(surveyPath, 'utf-8'));
const world = JSON.parse(await readFile(countriesPath, 'utf-8'));

const cells = survey.features
  .filter((f) => f.properties?.status === 'covered' || f.properties?.status === 'gap')
  .map((f) => {
    const ring = f.geometry.coordinates[0];
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    return {
      lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      gap: f.properties.status === 'gap',
    };
  });

// Even-odd ray casting over every ring covers holes for free.
const insidePolygon = (lon, lat, polygon) => {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
};

const insideCountry = (lon, lat, geometry) => {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => insidePolygon(lon, lat, polygon));
};

const round = (v) => Math.round(v * 100) / 100;
const roundGeometry = (geometry) => {
  const roundRing = (ring) => ring.map(([lon, lat]) => [round(lon), round(lat)]);
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(roundRing) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map(roundRing)) };
};

const bounds = { west: -25, south: 34, east: 32, north: 71.5 };
const features = [];
let assigned = 0;
for (const country of world.features) {
  const name = country.properties?.NAME ?? country.properties?.name ?? '?';
  const [w, s, e, n] = country.bbox ?? [-180, -90, 180, 90];
  if (e < bounds.west || w > bounds.east || n < bounds.south || s > bounds.north) continue;

  const own = cells.filter((c) => insideCountry(c.lon, c.lat, country.geometry));
  assigned += own.length;
  if (own.length === 0) continue;
  const gapShare = own.filter((c) => c.gap).length / own.length;
  if (gapShare < 0.5) continue;

  features.push({
    type: 'Feature',
    geometry: roundGeometry(country.geometry),
    properties: {
      status: 'gap',
      name,
      landCells: own.length,
      gapShare: Math.round(gapShare * 100) / 100,
    },
  });
}

const baked = {
  type: 'FeatureCollection',
  properties: {
    ...survey.properties,
    note:
      'Country shapes are a presentation of the z7 probe grid: a country is ' +
      'marked when the majority of its sampled land cells have no ' +
      'architectural-resolution imagery. Boundaries: Natural Earth (PD).',
  },
  features,
};
await writeFile(outPath, JSON.stringify(baked), 'utf-8');
console.log(
  `${outPath}: ${features.length} majority-gap countries ` +
    `(${assigned}/${cells.length} land cells assigned to countries)`,
);
