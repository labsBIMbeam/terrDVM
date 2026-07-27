// This test executes in Node, while the production browser tsconfig
// intentionally does not install or expose the unapproved @types/node package.
// @ts-expect-error -- runtime builtin is available to Vitest's Node process.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  MAX_AREA_KM2,
  OUTPUT_MIME,
  RES_M,
  TIMEOUT_S,
} from '../../src/config/defaults';

type ApprovedDefaults = {
  MAX_AREA_KM2: number;
  OUTPUT_MIME: string;
  RES_M: number;
  TIMEOUT_S: number;
};

const defaultsArtifactUrl = new URL(
  '../../../../.planning/evidence/phase-01/v1-defaults.json',
  import.meta.url,
);
const approved = JSON.parse(
  readFileSync(defaultsArtifactUrl, 'utf8'),
) as ApprovedDefaults;

describe('immutable v1 defaults', () => {
  it('exports the exact approved constants', () => {
    expect(RES_M).toBe(5);
    expect(OUTPUT_MIME).toBe('model/gltf-binary');
    expect(MAX_AREA_KM2).toBe(100);
    expect(TIMEOUT_S).toBe(15);
  });

  it('matches v1-defaults.json field by field', () => {
    expect(RES_M).toBe(approved.RES_M);
    expect(OUTPUT_MIME).toBe(approved.OUTPUT_MIME);
    expect(MAX_AREA_KM2).toBe(approved.MAX_AREA_KM2);
    expect(TIMEOUT_S).toBe(approved.TIMEOUT_S);
  });
});
