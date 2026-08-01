/**
 * The cases the vector suite structurally cannot express.
 *
 * Every other assertion in this package is driven by `geo-vectors.json`, which
 * the Python side reads too — that shared file is what stops the two
 * implementations drifting. But a vector file is JSON, and JSON has no `Date`,
 * no `Map`, no class instance and no `undefined`. Those inputs are reachable
 * from any JavaScript caller, so they need a test here even though it cannot be
 * mirrored in Python.
 *
 * That asymmetry is the point of this file's existence and is worth stating
 * plainly: these assertions are NOT cross-language pinned. They exist because
 * the TypeScript side had a hole the shared mechanism could not see.
 *
 * The hole: `typeof x === 'object'` is true for Date, Map, Set, class instances
 * and typed arrays, none of which carry enumerable own keys. They therefore
 * passed the key loop untouched and `canonicalJson` rendered each as `{}` — the
 * value silently vanished from `content`, which is hashed into the event id, and
 * no error was raised anywhere. Python rejected all of them, so this was also a
 * cross-language accept/reject split.
 */

import { describe, expect, it } from 'vitest';

import { buildItem } from '../../src/item';

const VALID = {
  dataset: 'terrain',
  pubkey: 'a'.repeat(64),
  tile: { z: 14, x: 8593, y: 5677 },
  sha256: 'b'.repeat(64),
  url: 'https://blossom.example/x.png',
  mimeType: 'image/png',
  size: 1024,
  datetime: '2026-01-01T00:00:00Z',
  createdAt: 1767225600,
} as const;

class Point {
  constructor(readonly x = 1) {}
}

describe('properties reject values JSON cannot represent', () => {
  const cases: [string, unknown][] = [
    ['Date', new Date(Date.UTC(2026, 0, 1))],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1, 2])],
    ['class instance', new Point()],
    ['typed array', new Uint8Array([1, 2, 3])],
    ['RegExp', /x/],
  ];

  // The casts are deliberate and are part of what is being tested. `properties`
  // is typed `JsonValue`, so a well-typed TypeScript caller cannot pass a Date
  // at all — the compiler catches it first. The runtime guard exists for the
  // callers the compiler does not see: plain JavaScript, `as any`, and anything
  // parsed off the network. Casting here reproduces exactly those callers.
  const asJson = (v: unknown) => v as never;

  for (const [name, value] of cases) {
    it(`rejects a ${name} instead of silently emitting {}`, () => {
      expect(() => buildItem({ ...VALID, properties: { a: asJson(value) } })).toThrow(
        /plain JSON objects/,
      );
    });

    it(`rejects a ${name} nested inside an array`, () => {
      expect(() => buildItem({ ...VALID, properties: { a: [asJson(value)] } })).toThrow(
        /plain JSON objects/,
      );
    });
  }

  it('still accepts a plain object and a null-prototype object', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.b = 2;
    expect(() =>
      buildItem({ ...VALID, properties: { a: { b: 1 }, c: asJson(bare) } }),
    ).not.toThrow();
  });
});
