import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

/**
 * The curated places: prewarmed selections that double as GPS-pinned buttons
 * on the player's globe and as each region's demo shortcut in the terrain
 * app. One list, because a pin and a demo must land on the same ground.
 */
export type Curated = {
  key: string;
  name: string;
  region: string;
  lon: number;
  lat: number;
  bbox: BBox4326;
};

export const CURATED: Curated[] = [
  { key: 'ring', name: 'Wien Ring', region: 'vienna',
    lon: 16.37, lat: 48.205, bbox: [16.355, 48.195, 16.385, 48.215] },
  { key: 'schoenbrunn', name: 'Schönbrunn', region: 'vienna',
    lon: 16.31, lat: 48.184, bbox: [16.3, 48.178, 16.32, 48.19] },
  { key: 'funchal', name: 'Funchal', region: 'madeira',
    lon: -16.91, lat: 32.65, bbox: [-16.92, 32.64, -16.9, 32.66] },
  { key: 'bruneck', name: 'Bruneck', region: 'south-tyrol',
    lon: 11.94, lat: 46.796, bbox: [11.925, 46.788, 11.955, 46.805] },
  { key: 'innichen', name: 'Innichen', region: 'south-tyrol',
    lon: 12.28, lat: 46.735, bbox: [12.265, 46.725, 12.295, 46.745] },
];
