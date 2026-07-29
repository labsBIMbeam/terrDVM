/**
 * Region registry.
 *
 * The service used to be hardwired to a single archipelago. Regions are now
 * data: a region declares where selection is allowed, where the map may pan,
 * and which national data services cover it. Adding a country is adding an
 * entry, not editing the map view.
 */

export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** A national or regional data service backing part of a region. */
export type RegionService = {
  /** Human label shown in the source row. */
  name: string;
  /** What the service provides. */
  role: 'imagery' | 'buildings' | 'cadastre';
  /** Licence identifier — mandatory, because retrofitting licences is expensive. */
  license: string;
  /** Attribution string that must be displayed. */
  attribution: string;
};

export type Region = {
  id: string;
  /** Display name. */
  name: string;
  /** ISO 3166-1 alpha-2 of the governing country. */
  country: string;
  /** Selection is refused outside this box. */
  coverage: Bounds;
  /** The map viewport cannot leave this box. */
  viewBounds: Bounds;
  center: readonly [number, number];
  zoom: number;
  minZoom: number;
  /** Region-specific services beyond the global defaults. */
  services: RegionService[];
};

function pad(bounds: Bounds, margin: number): Bounds {
  return {
    west: bounds.west - margin,
    south: bounds.south - margin,
    east: bounds.east + margin,
    north: bounds.north + margin,
  };
}

const MADEIRA_COVERAGE: Bounds = {
  west: -17.32,
  south: 32.35,
  east: -16.24,
  north: 33.15,
};

const SOUTH_TYROL_COVERAGE: Bounds = {
  west: 10.38,
  south: 46.21,
  east: 12.48,
  north: 47.10,
};

/**
 * Europe excluding Russia.
 *
 * Honest limitation: this is a bounding box, and a box cannot exclude a
 * country. The eastern edge is placed to take in Finland, the Baltics and the
 * Aegean while clipping most of European Russia; a sliver still falls inside.
 * Excluding Russia properly needs a country polygon mask, not a rectangle.
 */
const EUROPE_COVERAGE: Bounds = {
  west: -25.0,
  south: 34.0,
  east: 32.0,
  north: 71.5,
};

const INNSBRUCK_COVERAGE: Bounds = {
  west: 11.28,
  south: 47.17,
  east: 11.52,
  north: 47.36,
};

export const REGIONS: Record<string, Region> = {
  europe: {
    id: 'europe',
    name: 'Europe',
    country: 'EU',
    coverage: EUROPE_COVERAGE,
    viewBounds: pad(EUROPE_COVERAGE, 2),
    center: [10.0, 50.0],
    zoom: 4,
    minZoom: 3,
    services: [],
  },
  madeira: {
    id: 'madeira',
    name: 'Madeira',
    country: 'PT',
    coverage: MADEIRA_COVERAGE,
    viewBounds: pad(MADEIRA_COVERAGE, 0.28),
    center: [-16.9, 32.75],
    zoom: 11,
    minZoom: 9,
    services: [],
  },
  innsbruck: {
    id: 'innsbruck',
    name: 'Innsbruck',
    country: 'AT',
    // City floor at ~570 m against the Nordkette at ~2,300 m: the strongest
    // relief-to-city contrast of any region, which is the demo's whole point.
    coverage: INNSBRUCK_COVERAGE,
    viewBounds: pad(INNSBRUCK_COVERAGE, 0.15),
    center: [11.40, 47.27],
    zoom: 11,
    minZoom: 9,
    services: [
      {
        name: 'basemap.at Orthofoto',
        role: 'imagery',
        license: 'CC-BY-4.0',
        attribution: 'Grundkarte: basemap.at',
      },
    ],
  },
  'south-tyrol': {
    id: 'south-tyrol',
    name: 'Südtirol',
    country: 'IT',
    coverage: SOUTH_TYROL_COVERAGE,
    viewBounds: pad(SOUTH_TYROL_COVERAGE, 0.3),
    center: [11.35, 46.62],
    zoom: 10,
    minZoom: 8,
    services: [
      {
        name: 'IRIG INSPIRE Buildings',
        role: 'cadastre',
        license: 'CC0-1.0',
        attribution: 'Autonome Provinz Bozen — Südtirol / Provincia autonoma di Bolzano',
      },
      {
        name: 'IRIG Orthoimagery',
        role: 'imagery',
        license: 'CC0-1.0',
        attribution: 'Autonome Provinz Bozen — Südtirol / Provincia autonoma di Bolzano',
      },
    ],
  },
};

export const DEFAULT_REGION_ID = 'europe';

export function listRegions(): Region[] {
  return Object.values(REGIONS);
}

/** Look up a region, falling back to the default rather than throwing. */
export function getRegion(id: string | undefined | null): Region {
  return (id && REGIONS[id]) || REGIONS[DEFAULT_REGION_ID];
}

export function isWithinRegion(region: Region, bbox: readonly number[]): boolean {
  const [west, south, east, north] = bbox;
  return (
    west >= region.coverage.west &&
    east <= region.coverage.east &&
    south >= region.coverage.south &&
    north <= region.coverage.north
  );
}

/** MapLibre `maxBounds` tuple for a region. */
export function viewBoundsTuple(region: Region): [[number, number], [number, number]] {
  return [
    [region.viewBounds.west, region.viewBounds.south],
    [region.viewBounds.east, region.viewBounds.north],
  ];
}
