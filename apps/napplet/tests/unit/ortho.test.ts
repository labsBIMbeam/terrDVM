import { describe, expect, it } from 'vitest';

import {
  ORTHO_SERVICE,
  isApprovedOrthoUrl,
  orthoImageUrl,
  orthoMetaUrl,
  parseOrthoMeta,
} from '../../src/job/ortho';
import type { BBox4326 } from '@terrcvm/terrain-engine/bbox/validate';

const FUNCHAL: BBox4326 = [-16.92, 32.64, -16.9, 32.66];

const META = {
  m_per_px: 0.25,
  width_px: 2048,
  height_px: 1810,
  source: {
    id: 'drote-madeira-ortho',
    name: 'DROTe Ortofotocartografia RAM 2023',
    license: 'Free use with attribution (non-CC; redistribution terms unconfirmed)',
    attribution: '© DROTe — Região Autónoma da Madeira',
  },
  warnings: ['clamped to 4096px on the long side'],
};

describe('ortho texture URLs', () => {
  it('addresses the bake by extent, not by tile', () => {
    const url = new URL(orthoImageUrl('madeira', FUNCHAL));
    expect(url.pathname).toBe('/texture');
    expect(url.searchParams.get('region')).toBe('madeira');
    expect(url.searchParams.get('bbox')).toBe('-16.920000,32.640000,-16.900000,32.660000');
    expect(url.searchParams.get('target')).toBe(String(ORTHO_SERVICE.targetMPerPx));
  });

  it('meta travels beside the image, same parameters', () => {
    const image = new URL(orthoImageUrl('madeira', FUNCHAL));
    const meta = new URL(orthoMetaUrl('madeira', FUNCHAL));
    expect(meta.pathname).toBe('/texture/meta');
    expect(meta.search).toBe(image.search);
  });

  it('approves only the texture paths on the collection server origin', () => {
    expect(isApprovedOrthoUrl(orthoImageUrl('madeira', FUNCHAL))).toBe(true);
    expect(isApprovedOrthoUrl(orthoMetaUrl('madeira', FUNCHAL))).toBe(true);
    expect(isApprovedOrthoUrl(`${ORTHO_SERVICE.baseUrl}/geo?bbox=0,0,1,1`)).toBe(false);
    expect(isApprovedOrthoUrl('https://server.arcgisonline.com/texture')).toBe(false);
    expect(isApprovedOrthoUrl('not a url')).toBe(false);
  });
});

describe('parseOrthoMeta', () => {
  it('maps the server fields and keeps provenance intact', () => {
    const meta = parseOrthoMeta(META);
    expect(meta.mPerPx).toBe(0.25);
    expect(meta.widthPx).toBe(2048);
    expect(meta.source.name).toBe('DROTe Ortofotocartografia RAM 2023');
    expect(meta.source.attribution).toContain('DROTe');
    expect(meta.warnings).toEqual(['clamped to 4096px on the long side']);
  });

  it('fails closed when provenance is missing', () => {
    expect(() => parseOrthoMeta({ ...META, source: undefined })).toThrow(/provenance/);
    expect(() =>
      parseOrthoMeta({ ...META, source: { ...META.source, license: undefined } }),
    ).toThrow(/provenance/);
    expect(() => parseOrthoMeta(null)).toThrow(/provenance/);
  });

  it('tolerates absent warnings', () => {
    expect(parseOrthoMeta({ ...META, warnings: undefined }).warnings).toEqual([]);
  });
});
