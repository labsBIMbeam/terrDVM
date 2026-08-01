import { describe, expect, it } from 'vitest';

import {
  countQuery,
  demResolution,
  orthoPlanUrl,
  parseOrthoPlan,
  parseOverpassCount,
} from '../../src/job/preflight';
import type { BBox4326 } from '@terrdvm/terrain-engine/bbox/validate';

const SCHOENBRUNN: BBox4326 = [16.3, 48.178, 16.32, 48.19];

describe('preflight availability', () => {
  it('states the DEM resolution the terrain will actually sample', () => {
    const { zoom, mPerPx } = demResolution(SCHOENBRUNN);
    expect(zoom).toBeGreaterThanOrEqual(8);
    expect(zoom).toBeLessThanOrEqual(14);
    expect(mPerPx).toBeGreaterThan(0);
  });

  it('builds Overpass count queries per layer', () => {
    const streets = countQuery(SCHOENBRUNN, 'highway');
    expect(streets).toContain('way["highway"](48.178,16.3,48.19,16.32)');
    expect(streets).toContain('out count');
    expect(countQuery(SCHOENBRUNN, 'waterway')).toContain('way["waterway"]');
  });

  it('parses the count answer and fails closed on junk', () => {
    expect(
      parseOverpassCount({ elements: [{ tags: { ways: '1922', total: '1922' } }] }),
    ).toBe(1922);
    expect(parseOverpassCount({ elements: [] })).toBeNull();
    expect(parseOverpassCount(null)).toBeNull();
  });

  it('asks the plan endpoint with the same parameters as the bake', () => {
    const url = new URL(orthoPlanUrl('vienna', SCHOENBRUNN));
    expect(url.pathname).toBe('/texture/plan');
    expect(url.searchParams.get('region')).toBe('vienna');
    expect(url.searchParams.get('bbox')).toBe('16.300000,48.178000,16.320000,48.190000');
  });

  it('parses a plan and rejects one without provenance', () => {
    const plan = parseOrthoPlan({
      region: 'madeira',
      m_per_px: 0.544,
      source: { name: 'DROTe Ortofotocartografia RAM 2023' },
      notes: ['clamped to 4096px — a smaller selection gets sharper'],
    });
    expect(plan.region).toBe('madeira');
    expect(plan.sourceName).toContain('DROTe');
    expect(plan.notes).toHaveLength(1);
    expect(() => parseOrthoPlan({ m_per_px: 1 })).toThrow(/plan/i);
  });
});
