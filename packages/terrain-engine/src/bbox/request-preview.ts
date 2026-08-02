import { OUTPUT_MIME, RES_M } from '../config/defaults';
import type { BBox4326 } from './validate';

export type SourceState =
  | { kind: 'live'; name: string }
  | { kind: 'fixture'; name: string }
  | { kind: 'local-fallback'; name: string }
  | { kind: 'none'; name: string };

export type SourceSuffix =
  | 'live'
  | 'test fixture'
  | 'local fallback'
  | 'unavailable';

type CoordinateAxis = 'W' | 'S' | 'E' | 'N';

type RequestPreviewCoordinate = {
  axis: CoordinateAxis;
  value: number;
  display: string;
};

export type RequestPreviewDTO = {
  bbox: readonly [
    RequestPreviewCoordinate,
    RequestPreviewCoordinate,
    RequestPreviewCoordinate,
    RequestPreviewCoordinate,
  ];
  crs: 'EPSG:4326';
  areaKm2: {
    value: number;
    display: string;
  };
  resolutionM: number;
  outputMime: string;
  source: {
    name: string;
    suffix: SourceSuffix;
  };
};

const SOURCE_SUFFIX: Record<SourceState['kind'], SourceSuffix> = {
  live: 'live',
  fixture: 'test fixture',
  'local-fallback': 'local fallback',
  none: 'unavailable',
};

const AREA_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function coordinate(
  axis: CoordinateAxis,
  value: number,
): RequestPreviewCoordinate {
  return {
    axis,
    value,
    display: value.toFixed(6),
  };
}

export function buildRequestPreview(
  bbox: BBox4326,
  areaKm2: number,
  source: SourceState,
): RequestPreviewDTO {
  const [west, south, east, north] = bbox;

  return {
    bbox: [
      coordinate('W', west),
      coordinate('S', south),
      coordinate('E', east),
      coordinate('N', north),
    ],
    crs: 'EPSG:4326',
    areaKm2: {
      value: areaKm2,
      display: AREA_FORMATTER.format(areaKm2),
    },
    resolutionM: RES_M,
    outputMime: OUTPUT_MIME,
    source: {
      name: source.name,
      suffix: SOURCE_SUFFIX[source.kind],
    },
  };
}
