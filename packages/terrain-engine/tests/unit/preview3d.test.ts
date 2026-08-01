import { describe, expect, it } from 'vitest';

import { orthographic } from '../../src/render/preview3d';

describe('orthographic projection', () => {
  it('maps the half extents onto clip space with no perspective term', () => {
    const m = orthographic(2, 1.5, -10, 100);
    expect(m[0]).toBeCloseTo(1 / 3); // 1 / (halfHeight * aspect)
    expect(m[5]).toBeCloseTo(1 / 2); // 1 / halfHeight
    expect(m[11]).toBe(0); // no w-divide: parallel lines stay parallel
    expect(m[15]).toBe(1);
  });

  it('compresses the depth range linearly', () => {
    const near = -10;
    const far = 100;
    const m = orthographic(1, 1, near, far);
    expect(m[10]).toBeCloseTo(-2 / (far - near));
    expect(m[14]).toBeCloseTo(-(far + near) / (far - near));
  });
});
