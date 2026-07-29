import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REGION_ID,
  REGIONS,
  getRegion,
  isWithinRegion,
  listRegions,
  viewBoundsTuple,
} from '../../src/config/regions';

describe('region registry', () => {
  it('exposes the default region and resolves unknown ids to it', () => {
    expect(REGIONS[DEFAULT_REGION_ID]).toBeDefined();
    expect(getRegion(undefined).id).toBe(DEFAULT_REGION_ID);
    expect(getRegion(null).id).toBe(DEFAULT_REGION_ID);
    expect(getRegion('does-not-exist').id).toBe(DEFAULT_REGION_ID);
    expect(getRegion('south-tyrol').id).toBe('south-tyrol');
  });

  it.each(listRegions())('$id is internally consistent', (region) => {
    const { coverage, viewBounds, center } = region;

    expect(coverage.west).toBeLessThan(coverage.east);
    expect(coverage.south).toBeLessThan(coverage.north);

    // The pannable area must contain everything selectable, or a user could
    // never reach part of their own coverage.
    expect(viewBounds.west).toBeLessThanOrEqual(coverage.west);
    expect(viewBounds.east).toBeGreaterThanOrEqual(coverage.east);
    expect(viewBounds.south).toBeLessThanOrEqual(coverage.south);
    expect(viewBounds.north).toBeGreaterThanOrEqual(coverage.north);

    // The initial camera must start inside its own coverage.
    expect(center[0]).toBeGreaterThan(coverage.west);
    expect(center[0]).toBeLessThan(coverage.east);
    expect(center[1]).toBeGreaterThan(coverage.south);
    expect(center[1]).toBeLessThan(coverage.north);

    expect(region.minZoom).toBeLessThanOrEqual(region.zoom);
    expect(region.country).toMatch(/^[A-Z]{2}$/);
  });

  it.each(listRegions())('$id declares a licence for every service', (region) => {
    for (const service of region.services) {
      expect(service.license.length).toBeGreaterThan(0);
      expect(service.attribution.length).toBeGreaterThan(0);
    }
  });

  it('accepts a bbox inside coverage and rejects one outside', () => {
    const madeira = getRegion('madeira');
    expect(isWithinRegion(madeira, [-17.0, 32.7, -16.9, 32.8])).toBe(true);
    // Bolzano is far outside Madeira.
    expect(isWithinRegion(madeira, [11.3, 46.4, 11.4, 46.5])).toBe(false);
  });

  it('nests sub-regions inside the continental region', () => {
    const europe = getRegion('europe');
    const madeira = getRegion('madeira');
    const southTyrol = getRegion('south-tyrol');
    const bolzano: [number, number, number, number] = [11.3, 46.4, 11.4, 46.5];

    // Europe is deliberately a superset: it is the unrestricted view.
    expect(isWithinRegion(europe, bolzano)).toBe(true);
    expect(isWithinRegion(southTyrol, bolzano)).toBe(true);
    expect(isWithinRegion(madeira, bolzano)).toBe(false);

    for (const sub of [madeira, southTyrol]) {
      expect(sub.coverage.west).toBeGreaterThanOrEqual(europe.coverage.west);
      expect(sub.coverage.east).toBeLessThanOrEqual(europe.coverage.east);
    }
  });

  it('emits maxBounds in MapLibre order', () => {
    const region = getRegion('south-tyrol');
    const [[west, south], [east, north]] = viewBoundsTuple(region);
    expect(west).toBe(region.viewBounds.west);
    expect(south).toBe(region.viewBounds.south);
    expect(east).toBe(region.viewBounds.east);
    expect(north).toBe(region.viewBounds.north);
  });
});
