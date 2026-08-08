import { fetchOrthoTexture, type OrthoTexture } from '../job/ortho';
import { WIEN_BUILDINGS_ATTRIBUTION, fetchWienBuildings } from '../buildings/source-wien';
import { fetchFeatures } from '../features/source-osm';
import { generateTerrain, TERRAIN_EXAGGERATION, type TerrainProgress } from '../terrain/generate';
import {
  extrudeFootprints,
  type BuildingMesh,
  type Footprint,
} from '@terrcvm/terrain-engine/buildings/extrude';
import { createGroundSampler, type GroundSampler } from '@terrcvm/terrain-engine/buildings/ground';
import { buildLandcoverMesh, type LandcoverMesh } from '@terrcvm/terrain-engine/features/landcover';
import { buildRibbonMesh, buildRoadMesh, type RoadMesh } from '@terrcvm/terrain-engine/features/ribbon';
import { WATERWAY_WIDTH_M } from '@terrcvm/terrain-engine/features/types';
import type { TerrainMesh } from '@terrcvm/terrain-engine/terrain/mesh';
import type { Region } from '@terrcvm/terrain-engine/config/regions';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

/**
 * The generation pipeline behind the job flow, extracted from the monolith's
 * `runTerrainJob` so the terrain and player napplets run the SAME sequence —
 * same fallback chain, same enhancement-not-gate rules, same provenance —
 * without either app carrying a copy. Everything DOM-shaped (progress bars,
 * stage switching, sound) stays in the apps; this module only fetches and
 * builds.
 */

/**
 * Nearest-vertex lookup into the generated heightfield, so a footprint can be
 * placed on the terrain surface rather than at datum zero.
 *
 * The surface model is not guessed here. `generateTerrain` walks a fallback
 * chain and does not yet report which source actually answered, so asking the
 * registry for the *preferred* source would claim bare earth on a run that
 * quietly demoted to Terrarium — a fabricated provenance, which is worse than
 * none. Until the terrain layer returns the source it used, this reports
 * `'unknown'`, which the engine treats exactly as harshly as a DSM: geometry
 * still renders, and it renders labelled.
 */
export function sampleTerrain(mesh: TerrainMesh): GroundSampler {
  const { gridN, widthM, depthM } = mesh.stats;
  const stepX = widthM / (gridN - 1);
  const stepZ = depthM / (gridN - 1);
  return createGroundSampler({
    sample: (x, z) => {
      const col = Math.min(gridN - 1, Math.max(0, Math.round((x + widthM / 2) / stepX)));
      const row = Math.min(gridN - 1, Math.max(0, Math.round((z + depthM / 2) / stepZ)));
      return mesh.positions[(row * gridN + col) * 3 + 1];
    },
    model: 'unknown',
    sourceId: 'unreported',
    onNonBareEarth: 'render-indicative',
  });
}

/** Phases after the tile fetch, in the order the pipeline enters them. */
export type ScenePhase = 'features' | 'ortho';

export type BuildSceneOptions = {
  signal?: AbortSignal;
  /** Elevation tile progress, straight from `generateTerrain`. */
  onTerrainProgress?: (progress: TerrainProgress) => void;
  /** Fired as the pipeline moves past the terrain fetch. */
  onPhase?: (phase: ScenePhase) => void;
};

export type BuiltScene = {
  bbox: BBox4326;
  mesh: TerrainMesh;
  buildings?: BuildingMesh;
  roads?: RoadMesh;
  landcover?: LandcoverMesh;
  waterways?: RoadMesh;
  /** null: the collection server did not answer — stated, not guessed. */
  ortho: OrthoTexture | null;
  /**
   * "Zero features" and "the source did not answer" are different facts;
   * conflating them turns an outage into a claim about the area.
   */
  featuresFailed: boolean;
  /** Non-null when the measured Vienna model, not OSM guesses, was built. */
  buildingsAttribution: string | null;
  /** Non-null whenever the geometry is not standing on bare earth. */
  surfaceNotice: string | null;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Scene build aborted.', 'AbortError');
  }
}

/**
 * Build the full scene for a bbox: terrain first, then features, buildings
 * and the orthophoto bake — each enhancement layer failing towards a named
 * absence rather than gating the terrain.
 */
export async function buildScene(
  bbox: BBox4326,
  region: Region,
  { signal, onTerrainProgress, onPhase }: BuildSceneOptions = {},
): Promise<BuiltScene> {
  // The orthophoto bake runs beside the terrain fetch. Like buildings it is
  // an enhancement, never a gate: without a collection server the preview
  // ships with the elevation ramp and says so.
  const orthoPromise: Promise<OrthoTexture | null> = fetchOrthoTexture(region.id, bbox, {
    signal,
  }).catch(() => null);

  // Vienna's measured building-body model beats OSM storey guesses; any
  // failure falls back to the OSM footprints from the feature fetch.
  const wienPromise =
    region.id === 'vienna'
      ? fetchWienBuildings(bbox, { signal }).catch(() => null)
      : Promise.resolve(null);

  const mesh = await generateTerrain(bbox, {
    // Without this the elevation chain short-circuits to Terrarium — the
    // 30 m radar DSM — and every national LiDAR DTM is unreachable. The
    // registry, its licences and the transcode path all exist; omitting
    // `region` here is what made them dead code in the shipping app.
    region: region.id,
    signal,
    onProgress: onTerrainProgress,
  });
  throwIfAborted(signal);
  onPhase?.('features');

  // Buildings are an enhancement, never a gate: if the footprint source
  // is slow, blocked or empty, the terrain still ships.
  let buildings: BuildingMesh | undefined;
  let roads: RoadMesh | undefined;
  let landcover: LandcoverMesh | undefined;
  let waterways: RoadMesh | undefined;
  let osmBuildings: Footprint[] = [];
  let featuresOk = true;
  const ground = sampleTerrain(mesh);
  try {
    const features = await fetchFeatures(bbox, { signal });
    osmBuildings = features.buildings;
    if (features.roads.length > 0) {
      roads = buildRoadMesh(features.roads, bbox, ground, TERRAIN_EXAGGERATION);
    }
    if (features.landuse.length > 0) {
      landcover = buildLandcoverMesh(features.landuse, bbox, ground, TERRAIN_EXAGGERATION);
      if (landcover.classes.length === 0) landcover = undefined;
    }
    if (features.waterways.length > 0) {
      // Below the road lift so bridges keep winning at crossings.
      waterways = buildRibbonMesh(
        features.waterways.map((w) => ({ line: w.line, widthM: WATERWAY_WIDTH_M[w.waterwayClass] })),
        bbox,
        ground,
        TERRAIN_EXAGGERATION,
        0.8,
      );
      if (waterways.indices.length === 0) waterways = undefined;
    }
  } catch {
    roads = undefined;
    landcover = undefined;
    waterways = undefined;
    featuresOk = false;
  }

  // Vienna's measured building bodies stand on their own: an Overpass
  // outage must not cost the better source, and vice versa.
  const wienFootprints = await wienPromise;
  const fromWien = Boolean(wienFootprints && wienFootprints.length > 0);
  const footprints = fromWien ? wienFootprints! : osmBuildings;
  if (footprints.length > 0) {
    // The ground sample comes from the exaggerated terrain, so building
    // heights must take the same vertical scale or they sit squashed
    // against the relief.
    buildings = extrudeFootprints(
      footprints.map((f) => ({ ...f, heightM: f.heightM * TERRAIN_EXAGGERATION })),
      bbox,
      ground,
    );
  }
  throwIfAborted(signal);
  onPhase?.('ortho');
  const ortho = await orthoPromise;
  throwIfAborted(signal);

  return {
    bbox,
    mesh,
    buildings,
    roads,
    landcover,
    waterways,
    ortho,
    featuresFailed: !featuresOk,
    buildingsAttribution: fromWien ? WIEN_BUILDINGS_ATTRIBUTION : null,
    surfaceNotice: ground.surface.notice,
  };
}
