import { describe, expect, it } from 'vitest';

import { OUTPUT_MIME, RES_M } from '../../src/config/defaults';
import {
  buildRequestPreview,
  type SourceState,
} from '../../src/bbox/request-preview';

describe('canonical request preview', () => {
  it('request_preview_uses_west_south_east_north_epsg4326', () => {
    const preview = buildRequestPreview(
      [-8.1234567, 46.7654321, -7.25, 47.5],
      1234.56,
      { kind: 'live', name: 'Approved orthophoto' },
    );

    expect(preview.bbox).toEqual([
      { axis: 'W', value: -8.1234567, display: '-8.123457' },
      { axis: 'S', value: 46.7654321, display: '46.765432' },
      { axis: 'E', value: -7.25, display: '-7.250000' },
      { axis: 'N', value: 47.5, display: '47.500000' },
    ]);
    expect(preview.crs).toBe('EPSG:4326');
    expect(preview.areaKm2).toEqual({
      value: 1234.56,
      display: '1,234.6',
    });
  });

  it('request_preview_uses_fixed_resolution_and_output', () => {
    const preview = buildRequestPreview([7, 46, 8, 47], 10, {
      kind: 'fixture',
      name: 'Bundled orthophoto',
    });

    expect(preview.resolutionM).toBe(5);
    expect(preview.outputMime).toBe('model/gltf-binary');
    expect(preview.resolutionM).toBe(RES_M);
    expect(preview.outputMime).toBe(OUTPUT_MIME);
  });

  it('request_preview_names_active_source_or_fallback', () => {
    const cases: Array<{
      source: SourceState;
      expectedSuffix:
        | 'live'
        | 'test fixture'
        | 'local fallback'
        | 'unavailable';
    }> = [
      {
        source: { kind: 'live', name: 'Approved orthophoto' },
        expectedSuffix: 'live',
      },
      {
        source: { kind: 'fixture', name: 'Bundled orthophoto' },
        expectedSuffix: 'test fixture',
      },
      {
        source: { kind: 'local-fallback', name: 'Local orthophoto' },
        expectedSuffix: 'local fallback',
      },
      {
        source: { kind: 'none', name: 'No trusted source' },
        expectedSuffix: 'unavailable',
      },
    ];

    for (const { source, expectedSuffix } of cases) {
      const preview = buildRequestPreview([7, 46, 8, 47], 10, source);

      expect(preview.source).toEqual({
        name: source.name,
        suffix: expectedSuffix,
      });
      expect(Array.isArray(preview.source.suffix)).toBe(false);
      expect(preview.source.suffix).not.toBe('');
    }
  });
});
