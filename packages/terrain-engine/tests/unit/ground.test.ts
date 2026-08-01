import { describe, expect, it } from 'vitest';

import {
  SurfaceModelError,
  createGroundSampler,
  isBareEarth,
  type GroundSampler,
} from '../../src/buildings/ground';
import { extrudeFootprints, type Footprint } from '../../src/buildings/extrude';
import { buildLandcoverMesh } from '../../src/features/landcover';
import { buildRibbonMesh, buildRoadMesh } from '../../src/features/ribbon';
import type { LanduseFeature, RoadFeature } from '../../src/features/types';
import type { BBox4326 } from '../../src/bbox/validate';

const BBOX: BBox4326 = [-16.93, 32.64, -16.9, 32.66];

/** Bare earth at a constant height — the case where every height is true. */
function dtm(sample: (x: number, z: number) => number = () => 0): GroundSampler {
  return createGroundSampler({ sample, model: 'dtm', sourceId: 'it-bz-dtm-05m' });
}

/** The same relief, declared for what Terrarium actually is. */
function dsm(sample: (x: number, z: number) => number = () => 0): GroundSampler {
  return createGroundSampler({
    sample,
    model: 'dsm',
    sourceId: 'mapzen-terrarium',
    onNonBareEarth: 'render-indicative',
  });
}

function square(size = 0.001, heightM = 10): Footprint {
  const w = BBOX[0] + 0.001;
  const s = BBOX[1] + 0.001;
  return {
    ring: [
      [w, s],
      [w + size, s],
      [w + size, s + size],
      [w, s + size],
    ],
    heightM,
  };
}

const ROAD: RoadFeature = {
  line: [
    [-16.925, 32.645],
    [-16.915, 32.645],
  ],
  roadClass: 'primary',
};

const PATCH: LanduseFeature = {
  ring: [
    [-16.925, 32.645],
    [-16.922, 32.645],
    [-16.922, 32.648],
    [-16.925, 32.648],
  ],
  landuseClass: 'forest',
};

describe('ground sampler', () => {
  it('treats only a DTM as bare earth', () => {
    expect(isBareEarth('dtm')).toBe(true);
    expect(isBareEarth('dsm')).toBe(false);
    expect(isBareEarth('mixed')).toBe(false);
    expect(isBareEarth('unknown')).toBe(false);
  });

  it('builds a bare-earth sampler without ceremony and discloses nothing to qualify', () => {
    const sampler = dtm(() => 42);
    expect(sampler.sample(0, 0)).toBe(42);
    expect(sampler.surface).toEqual({
      model: 'dtm',
      sourceId: 'it-bz-dtm-05m',
      bareEarth: true,
      notice: null,
    });
  });

  it('refuses a non-bare-earth sampler that has not been acknowledged', () => {
    for (const model of ['dsm', 'mixed', 'unknown'] as const) {
      const build = () =>
        createGroundSampler({ sample: () => 0, model, sourceId: 'mapzen-terrarium' });
      expect(build).toThrow(SurfaceModelError);
      try {
        build();
      } catch (error) {
        expect((error as SurfaceModelError).code).toBe('BARE_EARTH_REQUIRED');
        expect((error as SurfaceModelError).message).toContain('mapzen-terrarium');
      }
    }
  });

  it('accepts a non-bare-earth sampler that is acknowledged, and hands back the notice', () => {
    const sampler = dsm();
    expect(sampler.surface.bareEarth).toBe(false);
    expect(sampler.surface.notice).toContain('mapzen-terrarium');
    expect(sampler.surface.notice).toContain('+5.54 m');
  });

  it('says the elevation layer stayed silent when the model is unknown', () => {
    const sampler = createGroundSampler({
      sample: () => 0,
      model: 'unknown',
      sourceId: 'unreported',
      onNonBareEarth: 'render-indicative',
    });
    expect(sampler.surface.notice).toContain('did not report');
  });

  it('computes the disclosure from the model, never from the acknowledgement', () => {
    // Passing the acknowledgement unconditionally must not make a DTM look
    // qualified — otherwise a caller that always passes it would relabel good
    // data the day a real DTM lands.
    const sampler = createGroundSampler({
      sample: () => 0,
      model: 'dtm',
      sourceId: 'at-bev-dtm-1m',
      onNonBareEarth: 'render-indicative',
    });
    expect(sampler.surface.bareEarth).toBe(true);
    expect(sampler.surface.notice).toBeNull();
  });

  it('names its failures instead of returning a half-built sampler', () => {
    const cases: [() => unknown, string][] = [
      [
        () => createGroundSampler({ sample: undefined as never, model: 'dtm', sourceId: 'x' }),
        'GROUND_SAMPLER_REQUIRED',
      ],
      [
        () => createGroundSampler({ sample: () => 0, model: 'dtm', sourceId: '  ' }),
        'GROUND_SAMPLER_REQUIRED',
      ],
      [
        () => createGroundSampler({ sample: () => 0, model: 'lidar' as never, sourceId: 'x' }),
        'SURFACE_MODEL_UNRECOGNISED',
      ],
    ];
    for (const [build, code] of cases) {
      expect(build).toThrow(SurfaceModelError);
      try {
        build();
      } catch (error) {
        expect((error as SurfaceModelError).code).toBe(code);
      }
    }
  });
});

describe('geometry on bare earth', () => {
  it('places a roof exactly heightM above the DTM surface', () => {
    const mesh = extrudeFootprints([square(0.001, 25)], BBOX, dtm(() => 100));
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    // Base on the ground, roof at the surveyed height — no double count.
    expect(Math.min(...ys)).toBeCloseTo(100, 6);
    expect(Math.max(...ys)).toBeCloseTo(125, 6);
    expect(mesh.surface.bareEarth).toBe(true);
    expect(mesh.surface.notice).toBeNull();
  });

  it('keeps a building exactly heightM tall on a slope', () => {
    const mesh = extrudeFootprints([square()], BBOX, dtm((x) => x));
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 6);
  });
});

describe('geometry on a non-bare-earth surface', () => {
  it('renders the same vertices as on a DTM — no invented offset', () => {
    // The decision recorded in ground.ts: a DSM is not silently corrected, so
    // the geometry is bit-for-bit what it always was. Only the disclosure is
    // new. A test that allowed a "-5.54 m" fudge to appear here would pass
    // silently; this one fails.
    const onDtm = extrudeFootprints([square()], BBOX, dtm(() => 200));
    const onDsm = extrudeFootprints([square()], BBOX, dsm(() => 200));
    expect(Array.from(onDsm.positions)).toEqual(Array.from(onDtm.positions));
    expect(onDsm.stats).toEqual(onDtm.stats);
  });

  it('is deterministic: the same input twice gives the same mesh and the same notice', () => {
    const first = extrudeFootprints([square()], BBOX, dsm(() => 7));
    const second = extrudeFootprints([square()], BBOX, dsm(() => 7));
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    expect(first.surface).toEqual(second.surface);
  });

  it('carries the notice on buildings, roads, waterways and land cover alike', () => {
    const ground = dsm(() => 5);
    const meshes = [
      extrudeFootprints([square()], BBOX, ground).surface,
      buildRoadMesh([ROAD], BBOX, ground).surface,
      buildRibbonMesh([{ line: ROAD.line, widthM: 6 }], BBOX, ground, 1, 0.8).surface,
      buildLandcoverMesh([PATCH], BBOX, ground).surface,
    ];
    for (const surface of meshes) {
      expect(surface.bareEarth).toBe(false);
      expect(surface.notice).not.toBeNull();
      expect(surface).toEqual(ground.surface);
    }
  });

  it('discloses even when a layer produced nothing', () => {
    const ground = dsm();
    expect(extrudeFootprints([], BBOX, ground).surface).toEqual(ground.surface);
    expect(buildRoadMesh([], BBOX, ground).surface).toEqual(ground.surface);
    expect(buildLandcoverMesh([], BBOX, ground).surface).toEqual(ground.surface);
    // A layer whose every feature was degenerate takes the other empty path.
    const degenerate: RoadFeature = { line: [[-16.92, 32.65]], roadClass: 'primary' };
    expect(buildRoadMesh([degenerate], BBOX, ground).surface).toEqual(ground.surface);
    expect(extrudeFootprints([{ ...square(), heightM: 0 }], BBOX, ground).surface).toEqual(
      ground.surface,
    );
  });
});

describe('the old signature', () => {
  it('is refused at runtime by every builder, with the migration in the message', () => {
    // TypeScript already rejects this; JavaScript callers and stale tests do
    // not compile, so the same refusal has to exist at runtime or they would
    // go on quietly extruding buildings from rooftops.
    const bare = (() => 0) as unknown as GroundSampler;
    for (const build of [
      () => extrudeFootprints([square()], BBOX, bare),
      () => buildRoadMesh([ROAD], BBOX, bare),
      () => buildRibbonMesh([{ line: ROAD.line, widthM: 6 }], BBOX, bare),
      () => buildLandcoverMesh([PATCH], BBOX, bare),
    ]) {
      expect(build).toThrow(SurfaceModelError);
      expect(build).toThrow(/GROUND_SAMPLER_REQUIRED/);
      expect(build).toThrow(/createGroundSampler/);
    }
  });

  it('rejects an object that is not a sampler', () => {
    const wrong = { sample: () => 0 } as unknown as GroundSampler;
    expect(() => extrudeFootprints([square()], BBOX, wrong)).toThrow(SurfaceModelError);
  });
});
