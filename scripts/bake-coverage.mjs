// Bake a server coverage survey into the napplet's shipped config.
//
//   node scripts/bake-coverage.mjs <survey.geojson> <out.json>
//
// The overlay draws only gap cells, so covered and sea features are dead
// weight in a single-file artifact — a z7 Europe survey is 209 kB raw, most
// of it ocean rectangles. Baking keeps the gap features (trimmed to status
// and tile id, coordinates rounded to ~11 m) and preserves the survey's
// top-level counts, which is where the client summary reads from.

import { readFile, writeFile } from 'node:fs/promises';

const [surveyPath, outPath] = process.argv.slice(2);
if (!surveyPath || !outPath) {
  console.error('usage: node scripts/bake-coverage.mjs <survey.geojson> <out.json>');
  process.exit(1);
}

const survey = JSON.parse(await readFile(surveyPath, 'utf-8'));
const round = (value) => Math.round(value * 10_000) / 10_000;

const gaps = survey.features
  .filter((feature) => feature.properties?.status === 'gap')
  .map((feature) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: feature.geometry.coordinates.map((ring) =>
        ring.map(([lon, lat]) => [round(lon), round(lat)]),
      ),
    },
    properties: {
      tile: feature.properties.tile,
      status: 'gap',
    },
  }));

const baked = {
  type: 'FeatureCollection',
  properties: survey.properties,
  features: gaps,
};

await writeFile(outPath, JSON.stringify(baked), 'utf-8');
console.log(
  `${outPath}: ${gaps.length} gap cells of ${survey.features.length} surveyed, ` +
    `counts: covered=${survey.properties?.covered} gaps=${survey.properties?.gaps} ` +
    `sea=${survey.properties?.sea}`,
);
