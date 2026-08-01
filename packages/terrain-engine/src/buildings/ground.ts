import type { ElevationSource } from '../terrain/elevation-sources';

/**
 * What geometry stands on — the contract between the elevation layer and every
 * consumer that places something on the terrain.
 *
 * ## Why this file exists
 *
 * Terrarium, the global fallback DEM, is SRTM/GMTED-derived and is a **DSM**:
 * it measures rooftops and canopy, not bare earth. Measured against the CC0
 * 0.5 m South Tyrol LiDAR DTM on this project's own 192-grid, that surface sits
 * **+5.54 m above bare earth in built-up areas** (and the relief itself is
 * 14.31 m RMS out on a steep bbox, 65.60 m at worst — see
 * `terrain/elevation-sources.ts`).
 *
 * Geometry used to be placed straight onto that surface:
 *
 * - `extrudeFootprints` set a building's base to the sampled height and its
 *   roof to base + the OSM height, so on a DSM the roof was extruded *from the
 *   roof*. The building was counted twice and stood ~5.5 m too tall.
 * - `buildRibbonMesh` and `buildLandcoverMesh` drape on the same surface, so in
 *   a town a street runs along the rooftops it is supposed to pass between.
 *
 * None of those call sites could tell, because each took a bare
 * `(x, z) => number` and a number carries no provenance. This module makes the
 * surface model travel with the sample, and makes it impossible to build
 * geometry on a non-bare-earth surface without saying so in the source.
 *
 * ## The decision: what happens on a DSM
 *
 * Three options were on the table, and this file picks the third.
 *
 * 1. **Refuse to place geometry on anything but a DTM.** The purest reading of
 *    "fail closed", and the wrong call here. Terrarium is the *only* elevation
 *    that exists outside the eight national coverages in the registry —
 *    including Madeira, this demo's own home region, for which no bare-earth
 *    service could be confirmed at all. Refusing would delete buildings, roads
 *    and land cover from most of the planet to buy a correctness nobody could
 *    then see, and it would take a working demo down as the price. Rejected on
 *    the evidence, not on taste.
 * 2. **Subtract the measured offset.** Rejected, and named for what it is: a
 *    fudge. −5.54 m is the *mean* bias over built-up South Tyrol; it is a
 *    property of that sample, not of Terrarium. Applied to a farmhouse in a
 *    field it buries the building; applied under forest canopy it is tens of
 *    metres out; applied anywhere it replaces a measurement with a number this
 *    project invented. That is a fabricated result, which the rules forbid
 *    outright. The offset is therefore recorded in this comment and nowhere in
 *    the code — there is deliberately no constant for it to be tempting.
 * 3. **Gate, then render and disclose.** Chosen. A non-DTM `GroundSampler`
 *    cannot be constructed unless the literal word `'render-indicative'`
 *    appears at the construction site, so a DSM render is a decision somebody
 *    wrote down rather than a default nobody noticed. Every mesh built from a
 *    sampler then carries a `SurfaceDisclosure` whose `notice` is non-null
 *    exactly when the geometry is not standing on bare earth. The failure is
 *    named (`SurfaceModelError`, code `BARE_EARTH_REQUIRED`), the geometry is
 *    never silently corrected, and the demo keeps working — labelled.
 *
 * That gate is what makes this different from a boolean nobody reads: the
 * check is at construction, before a single vertex exists, and it throws.
 *
 * ## Import direction
 *
 * `SurfaceModel` is derived from `ElevationSource['model']` rather than
 * restated, so if the elevation registry renames or splits those variants this
 * file stops compiling instead of drifting — the repo has been bitten by two
 * copies of one definition before. `'unknown'` is added here and only here: a
 * consumer can be handed a sampler whose provenance never reached it, and that
 * case has to fail closed rather than default to bare earth.
 */

/**
 * The surface a sample describes.
 *
 * `'dtm'` is bare earth. `'dsm'` includes rooftops and canopy. `'mixed'` is a
 * mosaic of both (Terrarium). `'unknown'` means the elevation layer did not say
 * — treated exactly as harshly as a DSM.
 */
export type SurfaceModel = ElevationSource['model'] | 'unknown';

const SURFACE_MODELS: readonly SurfaceModel[] = ['dtm', 'dsm', 'mixed', 'unknown'];

export type SurfaceModelCode =
  /** A builder was handed a bare sampling function instead of a tagged sampler. */
  | 'GROUND_SAMPLER_REQUIRED'
  /** The declared surface model is not one this engine knows. */
  | 'SURFACE_MODEL_UNRECOGNISED'
  /** A non-bare-earth sampler was built without the explicit acknowledgement. */
  | 'BARE_EARTH_REQUIRED';

/** The one failure type this module raises. Named, coded, never a bare string. */
export class SurfaceModelError extends Error {
  readonly code: SurfaceModelCode;

  constructor(code: SurfaceModelCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'SurfaceModelError';
    this.code = code;
  }
}

/** Bare earth is the only surface geometry can be placed on and still be true. */
export function isBareEarth(model: SurfaceModel): boolean {
  return model === 'dtm';
}

/**
 * What a mesh is standing on, carried on every mesh this engine builds.
 *
 * `notice` is non-null exactly when `bareEarth` is false, so "is this claim
 * safe to show unqualified?" is one field, not an inference.
 */
export type SurfaceDisclosure = {
  readonly model: SurfaceModel;
  readonly sourceId: string;
  readonly bareEarth: boolean;
  /** null iff `bareEarth`; otherwise the sentence a viewer is expected to show. */
  readonly notice: string | null;
};

/**
 * A terrain sample that knows what it measured.
 *
 * Deliberately an object and not a function: the old signature took
 * `(x, z) => number`, so making the tagged form structurally incompatible is
 * what forces every existing call site to be revisited rather than silently
 * keeping the old behaviour.
 */
export type GroundSampler = {
  /** Elevation in the local metric frame, in whatever vertical scale the mesh uses. */
  readonly sample: (x: number, z: number) => number;
  readonly model: SurfaceModel;
  /** Elevation source id, e.g. `mapzen-terrarium` — named in errors and notices. */
  readonly sourceId: string;
  readonly surface: SurfaceDisclosure;
};

export type GroundSamplerInput = {
  readonly sample: (x: number, z: number) => number;
  readonly model: SurfaceModel;
  readonly sourceId: string;
  /**
   * Required whenever `model` is not `'dtm'`; ignored on a DTM.
   *
   * One legal value, and it is the commitment being made: the geometry will be
   * presented as indicative and `surface.notice` will be shown with it. Passing
   * it unconditionally is fine — the disclosure is computed from the model, not
   * from this field, so a source that turns out to be bare earth is still
   * reported as bare earth.
   */
  readonly onNonBareEarth?: 'render-indicative';
};

function noticeFor(model: SurfaceModel, sourceId: string): string {
  if (model === 'unknown') {
    return (
      `Elevation source ${sourceId} did not report whether it measures bare earth. ` +
      'Buildings, roads and land cover are placed on it unverified and are indicative only.'
    );
  }
  const what = model === 'dsm' ? 'a surface model' : 'a mixed surface/terrain mosaic';
  return (
    `Elevation source ${sourceId} is ${what}, not bare earth: it measures rooftops and ` +
    'canopy. Buildings extruded from it stand too tall — measured at +5.54 m in built-up ' +
    'areas — and roads and land cover drape at roof height. Indicative only.'
  );
}

/**
 * Build a ground sampler, refusing anything that would place geometry on a
 * surface the caller has not acknowledged.
 *
 * Fails closed with a named error rather than returning a sampler that renders
 * a DSM as though it were bare earth: the two are indistinguishable downstream,
 * which is exactly how the double-count survived this long.
 */
export function createGroundSampler(input: GroundSamplerInput): GroundSampler {
  if (typeof input?.sample !== 'function') {
    throw new SurfaceModelError(
      'GROUND_SAMPLER_REQUIRED',
      'a ground sampler needs a sample function',
    );
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim() === '') {
    throw new SurfaceModelError(
      'GROUND_SAMPLER_REQUIRED',
      'a ground sampler must name the elevation source it samples',
    );
  }
  if (!SURFACE_MODELS.includes(input.model)) {
    throw new SurfaceModelError(
      'SURFACE_MODEL_UNRECOGNISED',
      `${input.sourceId} declares surface model ${String(input.model)}`,
    );
  }

  const bareEarth = isBareEarth(input.model);
  if (!bareEarth && input.onNonBareEarth !== 'render-indicative') {
    throw new SurfaceModelError(
      'BARE_EARTH_REQUIRED',
      `${input.sourceId} is ${input.model}, not bare earth — geometry placed on it is ` +
        "wrong by the height of whatever it measured. Pass onNonBareEarth: 'render-indicative' " +
        'to render it anyway and show surface.notice with the result.',
    );
  }

  return {
    sample: input.sample,
    model: input.model,
    sourceId: input.sourceId,
    surface: {
      model: input.model,
      sourceId: input.sourceId,
      bareEarth,
      notice: bareEarth ? null : noticeFor(input.model, input.sourceId),
    },
  };
}

/**
 * Guard at the door of every geometry builder.
 *
 * A bare `(x, z) => number` is the pre-fix signature; accepting one would let a
 * JavaScript caller (or an un-migrated test) go on placing buildings on
 * rooftops with no diagnosis at all. TypeScript already rejects it at compile
 * time — this is the same refusal at runtime, with the migration in the message.
 */
export function assertGroundSampler(candidate: unknown, context: string): GroundSampler {
  if (typeof candidate === 'function') {
    throw new SurfaceModelError(
      'GROUND_SAMPLER_REQUIRED',
      `${context} needs a GroundSampler, not a bare (x, z) => number — a plain sample ` +
        'cannot say whether it measured bare earth. Build one with createGroundSampler().',
    );
  }
  const sampler = candidate as GroundSampler | null;
  if (
    !sampler ||
    typeof sampler.sample !== 'function' ||
    typeof sampler.surface !== 'object' ||
    sampler.surface === null
  ) {
    throw new SurfaceModelError(
      'GROUND_SAMPLER_REQUIRED',
      `${context} was given something that is not a GroundSampler`,
    );
  }
  return sampler;
}
