/**
 * Vector features carried in a feature tile.
 *
 * Buildings and roads are kept in separate layers rather than one tagged
 * collection: they are fetched, encoded, cached and rendered independently, and
 * a client that only wants roads should never pay for building geometry.
 */

/** Road classes, ordered coarse to fine. Stored as a single byte. */
export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
  'track',
  'path',
] as const;

export type RoadClass = (typeof ROAD_CLASSES)[number];

/** Rendered half-width in metres per class. */
export const ROAD_WIDTH_M: Record<RoadClass, number> = {
  motorway: 12,
  trunk: 10,
  primary: 8,
  secondary: 7,
  tertiary: 6,
  residential: 4.5,
  service: 3,
  track: 2.5,
  path: 1.5,
};

/**
 * Land cover / land use classes.
 *
 * Chosen for the climate and circular-economy questions this serves: what
 * absorbs heat, what stores carbon, what is sealed surface, what is productive
 * land. Stored as a single byte, so order is part of the wire format — append
 * only, never reorder.
 */
export const LANDUSE_CLASSES = [
  'forest',
  'farmland',
  'meadow',
  'grass',
  'vineyard',
  'orchard',
  'scrub',
  'heath',
  'wetland',
  'water',
  'residential',
  'industrial',
  'commercial',
  'quarry',
  'bare_rock',
] as const;

export type LanduseClass = (typeof LANDUSE_CLASSES)[number];

export type LanduseFeature = {
  /** Outer ring in lon/lat degrees. */
  ring: readonly (readonly [number, number])[];
  landuseClass: LanduseClass;
};

export function landuseClassIndex(value: string): number {
  const index = (LANDUSE_CLASSES as readonly string[]).indexOf(value);
  return index < 0 ? LANDUSE_CLASSES.indexOf('grass') : index;
}

export type BuildingFeature = {
  /** Outer ring in lon/lat degrees. */
  ring: readonly (readonly [number, number])[];
  /** Metres above ground. */
  heightM: number;
};

export type RoadFeature = {
  /** Centreline in lon/lat degrees. */
  line: readonly (readonly [number, number])[];
  roadClass: RoadClass;
};

export type FeatureTile = {
  z: number;
  x: number;
  y: number;
  buildings: BuildingFeature[];
  roads: RoadFeature[];
  landuse: LanduseFeature[];
};

export function roadClassIndex(value: string): number {
  const index = (ROAD_CLASSES as readonly string[]).indexOf(value);
  return index < 0 ? ROAD_CLASSES.indexOf('residential') : index;
}
