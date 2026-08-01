import { area } from '@turf/area';

import { MAX_AREA_KM2 } from '../config/defaults';
import {
  type BBox4326,
  type BBoxResult,
  validateBBoxStructure,
} from './validate';

export function geodesicAreaKm2(bbox: BBox4326): number {
  const [west, south, east, north] = bbox;
  const polygon = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };

  return area(polygon) / 1_000_000;
}

export function validateBBox(input: unknown): BBoxResult {
  return validateBBoxStructure(input, {
    maxAreaKm2: MAX_AREA_KM2,
    areaKm2: geodesicAreaKm2,
  });
}
