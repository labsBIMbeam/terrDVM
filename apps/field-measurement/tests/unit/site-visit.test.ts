import { describe, expect, it } from 'vitest';

import {
  POLE_MARK_M,
  validateSiteVisit,
  type SiteVisit,
} from '../../src/protocol/site-visit';

function validVisit(overrides: Partial<SiteVisit> = {}): SiteVisit {
  return {
    siteId: 'S-014',
    operatorId: 'OP-3',
    date: '2026-08-02',
    arrivalLocal: '09:12',
    windowStartUtc: '2026-08-02T07:20:00Z',
    windowEndUtc: '2026-08-02T07:29:00Z',
    stationMarks: 36,
    loopbackOpen: true,
    loopbackClose: true,
    poleMarkM: POLE_MARK_M,
    antennaTiltDeg: 5,
    poleFoot: 'soil',
    nodeSerial: 'HTV3-0042',
    antennaSerial: 'ANT-0042',
    configHash: 'a1b2c3',
    gnssLat: 47.1,
    gnssLon: 9.5,
    gnssAccM: 8,
    gnssScatterM: 3.2,
    leafState: 'in-leaf',
    precip: 'dry',
    wind: 'calm',
    photoCount: 6,
    notes: '',
    ...overrides,
  };
}

describe('validateSiteVisit', () => {
  it('accepts a complete sheet, nulls included by construction', () => {
    expect(validateSiteVisit(validVisit())).toEqual({ ok: true });
  });

  it('names every missing required field', () => {
    const result = validateSiteVisit(validVisit({ siteId: ' ', configHash: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toContain('site_id is required');
      expect(result.problems).toContain('config_hash is required');
    }
  });

  it('rejects a window that ends before it starts', () => {
    const result = validateSiteVisit(
      validVisit({ windowStartUtc: '2026-08-02T08:00:00Z', windowEndUtc: '2026-08-02T07:00:00Z' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((problem) => problem.includes('after'))).toBe(true);
    }
  });

  it('rejects a tilt outside the physical range', () => {
    const result = validateSiteVisit(validVisit({ antennaTiltDeg: 120 }));
    expect(result.ok).toBe(false);
  });

  it('rejects unknown enum values instead of coercing them', () => {
    const result = validateSiteVisit(
      validVisit({ leafState: 'lush' as SiteVisit['leafState'] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toContain('leaf_state is not a known value');
    }
  });

  it('rejects positions outside the coordinate domain', () => {
    const result = validateSiteVisit(validVisit({ gnssLat: 95, gnssLon: -190 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(2);
    }
  });

  it('keeps zero station marks out — a window with no stations is no window', () => {
    const result = validateSiteVisit(validVisit({ stationMarks: 0 }));
    expect(result.ok).toBe(false);
  });
});
