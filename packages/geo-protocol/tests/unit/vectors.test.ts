/**
 * The conformance suite. Every assertion in this file is driven by
 * `tests/fixtures/geo-vectors.json`, which the Python implementation in
 * `services/blossom-gis` loads too.
 *
 * WHY THIS SHAPE. Version 1 had one sample fixture, and a single sample fixes
 * ONE POINT in the input space and nothing else — it cannot see validation,
 * parsing, filter or number-formatting divergence, and all eleven drift
 * findings of the last review lived outside it. Worse, the test that consumed
 * it read the expected bbox out of the fixture and fed it straight back into
 * the builder, asserting the fixture equalled itself.
 *
 * So: no vector may be edited to match this implementation. If a vector is
 * wrong it is reported, not patched — the other language is reading the same
 * file at the same time, and a locally-convenient edit here is a silent
 * divergence there.
 */

import { describe, expect, it } from 'vitest';

import rawVectors from '../fixtures/geo-vectors.json';

import {
  buildCollection,
  buildItem,
  canonicalCoordinate,
  canonicalNumber,
  catalog,
  cellToGeohash,
  coverCellCount,
  coverCells,
  encode,
  exactTile,
  gridSize,
  isGeoProtocolError,
  itemD,
  nearby,
  nextCreatedAt,
  parseItemD,
  selectHead,
  socialGeohashTags,
  PROTOCOL_WHITESPACE,
  type BBox4326,
  type GeoErrorCode,
  type Tile,
  type UnsignedEvent,
} from '../../src/index';
import {
  DEFAULT_FILTER_LIMIT,
  GEOHASH_ALPHABET,
  GEOHASH_PRECISION,
  KIND_GEO_COLLECTION,
  KIND_GEO_ITEM,
  MAX_COVER_CELLS,
  MAX_CREATED_AT,
  MAX_DATASET_LENGTH,
  MAX_FILTER_LIMIT,
  MAX_MERCATOR_LATITUDE,
  MAX_SAFE_INTEGER,
  MAX_TILE_ZOOM,
  COORDINATE_DECIMALS,
  DATASET_SEPARATOR,
} from '../../src/kinds';

/**
 * Imported statically and WITHOUT a try/catch. A missing or unparseable vector
 * file must abort the run, never skip it: a conformance suite that quietly
 * declines to assert anything is worse than no suite at all, because it
 * reports green. A static import makes that a resolution failure at both
 * typecheck and test time, which is the loudest option available.
 *
 * The `unknown` hop is deliberate — the inferred literal type of a 290-vector
 * file is not the shape being asserted against, and pretending otherwise would
 * make the suite typecheck itself rather than the implementation.
 */
const vectors = rawVectors as unknown as VectorFile;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type VectorFile = {
  version: number;
  constants: Record<string, Json>;
  numberFormat: {
    canonicalNumber: NumberCase[];
    canonicalCoordinate: NumberCase[];
  };
  buildCollection: BuilderCase[];
  buildItem: BuilderCase[];
  parseItemD: ParseCase[];
  grammar: {
    whitespace: string[];
    collectionBaseInput: Record<string, Json>;
    cases: GrammarCase[];
  };
  validation: { baseInput: Record<string, Json>; cases: ValidationCase[] };
  filters: { catalog: FilterCase[]; nearby: FilterCase[]; exactTile: FilterCase[] };
  geohash: {
    cellToGeohash: CellCase[];
    gridSize: GridCase[];
    encode: EncodeCase[];
    cover: CoverCase[];
  };
  supersession: { cases: SupersessionCase[] };
  createdAtMonotonicity: { cases: MonotonicityCase[] };
  socialGeohashLadder: { example: { lat: number; lon: number; expectedTags: string[][] } };
};

type NumberCase = { value: Json; expected?: string; reject?: string; note?: string };
type BuilderCase = { name: string; input: Record<string, Json>; expect?: Json; reject?: string };
type ParseCase = { input: string; expected: { dataset: string; tile: Tile } | null };
type ValidationCase = {
  name: string;
  patch: Record<string, Json>;
  accepted: boolean;
  reason: string;
};
type GrammarCase = ValidationCase & { builder: 'collection' | 'item' };
type FilterCase = {
  name: string;
  input: Record<string, Json>;
  expect?: Json;
  reject?: string;
  coverCellCount?: number;
};
type CellCase = { ix: number; iy: number; precision: number; expected: string };
type GridCase = { precision: number; lonCells: number; latCells: number };
type EncodeCase = {
  lat: number;
  lon: number;
  precision: number;
  expected?: string;
  reject?: string;
};
type CoverCase = {
  name: string;
  bbox: Json;
  expectedCellCount?: number;
  expectedCells?: string[];
  cellsOmitted?: boolean;
  acceptedByNearby?: boolean;
  reject?: string;
};
type SupersessionCase = {
  name: string;
  events: { id: string; created_at: number }[];
  expectedHeadId: string;
};
type MonotonicityCase = {
  last: number | null;
  now: number;
  expected?: number;
  reject?: string;
};

/**
 * `{"__number__": "<token>"}` and `{"__string__": "<token>"}` denote literals
 * JSON cannot carry. They MUST be substituted before use — a test that fed the
 * wrapper object straight to a builder would be asserting the wrong thing and
 * would pass for the wrong reason.
 */
const NUMBER_TOKENS: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
  '-0': -0,
};

/**
 * Strings JSON can technically carry but this file must not.
 *
 * A raw `\ud800` escape is legal JSON and both `JSON.parse` and `json.loads`
 * decode it — but the bundler that inlines this file for the TypeScript suite
 * refuses it outright ("unexpected end of hex escape"), and a vector one side
 * cannot load pins nothing at all. The token indirection is what keeps the
 * lone-surrogate cases readable by both suites.
 */
const STRING_TOKENS: Record<string, string> = {
  LONE_SURROGATE_D800: '\ud800',
  TEXT_WITH_LONE_SURROGATE: 'terr\ud800ain',
  TEXT_LEADING_SPACE_LONE_SURROGATE: ' \ud800',
  URL_WITH_LONE_SURROGATE: 'https://blossom.example/\ud800',
  URL_BAD_SCHEME_WITH_LONE_SURROGATE: 'ftp://blossom.example/\ud800',
};

/**
 * An EXPLICIT null, as opposed to the absent-key spelling a bare `null` patch
 * value means. The two are equivalent under CONTRACT.md §7.5, and the token is
 * what lets a vector assert that rather than assume it.
 */
const JSON_TOKENS: Record<string, Json> = { NULL: null };

function substitute(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(substitute);
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length === 1 && keys[0] === '__number__') {
    const token = String(record.__number__);
    if (!(token in NUMBER_TOKENS)) throw new Error(`unknown __number__ token: ${token}`);
    return NUMBER_TOKENS[token];
  }
  if (keys.length === 1 && keys[0] === '__string__') {
    const token = String(record.__string__);
    if (!(token in STRING_TOKENS)) throw new Error(`unknown __string__ token: ${token}`);
    return STRING_TOKENS[token];
  }
  if (keys.length === 1 && keys[0] === '__json__') {
    const token = String(record.__json__);
    if (!(token in JSON_TOKENS)) throw new Error(`unknown __json__ token: ${token}`);
    return JSON_TOKENS[token];
  }

  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = substitute(record[key]);
  return out;
}

/** Run `action` and return the `GeoProtocolError` code it threw, if any. */
function codeOf(action: () => unknown): GeoErrorCode | { ok: unknown } {
  try {
    return { ok: action() };
  } catch (error) {
    if (isGeoProtocolError(error)) return error.code;
    throw error;
  }
}

function expectRejection(action: () => unknown, code: string, label: string): void {
  const outcome = codeOf(action);
  if (typeof outcome !== 'string') {
    throw new Error(`${label}: expected rejection ${code}, got ${JSON.stringify(outcome.ok)}`);
  }
  expect(outcome, label).toBe(code);
}

function expectAccepted(action: () => unknown, label: string): unknown {
  const outcome = codeOf(action);
  if (typeof outcome === 'string') {
    throw new Error(`${label}: expected acceptance, got rejection ${outcome}`);
  }
  return outcome.ok;
}

/** The error code in a `validation.cases[].reason`, which is `CODE — prose`. */
function reasonCode(reason: string): string {
  return reason.split(/[\s—]/, 1)[0];
}

/**
 * `base` with `patch` overlaid, then token-substituted.
 *
 * A patch value of `null` deletes the key — that is the file's spelling of
 * ABSENT. An EXPLICIT null is `{"__json__": "NULL"}`, which survives this step
 * and reaches the builder as `null`. Substitution runs AFTER the delete pass
 * for exactly that reason.
 */
function patched(base: Record<string, Json>, patch: Record<string, Json>): unknown {
  const input = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete input[key];
    else input[key] = value;
  }
  return substitute(input);
}

/**
 * True when every string in a built event is a well-formed Unicode scalar
 * sequence — i.e. when the event can actually be UTF-8 encoded and sent.
 *
 * `TextEncoder` cannot be used as the oracle here: it silently substitutes
 * U+FFFD for a lone surrogate instead of throwing, so it would report every
 * event encodable. Python's `json.dumps(event).encode("utf-8")` raises, which
 * is the asymmetry that let both languages agree on an event only one of them
 * could put on the wire.
 */
function isEncodable(event: UnsignedEvent): boolean {
  const strings = [event.content, ...event.tags.flat()];
  return strings.every((value) => {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return false;
      }
    }
    return true;
  });
}

describe('vector file', () => {
  it('is the version this suite implements', () => {
    expect(vectors.version).toBe(3);
  });

  /**
   * Counts are pinned so a truncated, half-merged or mangled vector file fails
   * loudly instead of running the handful of cases that survived. CONTRACT.md
   * §15 states each of these numbers.
   */
  it('holds the case counts CONTRACT.md §15 declares', () => {
    expect(vectors.numberFormat.canonicalNumber).toHaveLength(29);
    expect(vectors.numberFormat.canonicalCoordinate).toHaveLength(27);
    expect(vectors.buildCollection).toHaveLength(29);
    expect(vectors.buildItem).toHaveLength(9);
    expect(vectors.parseItemD).toHaveLength(41);
    expect(vectors.validation.cases).toHaveLength(84);
    expect(vectors.grammar.cases).toHaveLength(67);
    expect(vectors.grammar.whitespace).toHaveLength(30);
    expect(
      vectors.filters.catalog.length + vectors.filters.nearby.length + vectors.filters.exactTile.length,
    ).toBe(20);
    expect(
      vectors.geohash.cellToGeohash.length +
        vectors.geohash.gridSize.length +
        vectors.geohash.encode.length +
        vectors.geohash.cover.length,
    ).toBe(52);
    expect(vectors.supersession.cases.length + vectors.createdAtMonotonicity.cases.length).toBe(7);
  });

  it('agrees with the constants this package exports', () => {
    expect(vectors.constants).toEqual({
      KIND_GEO_COLLECTION,
      KIND_GEO_ITEM,
      GEOHASH_PRECISION,
      MAX_TILE_ZOOM,
      COORDINATE_DECIMALS,
      DATASET_SEPARATOR,
      DEFAULT_FILTER_LIMIT,
      MAX_FILTER_LIMIT,
      MAX_COVER_CELLS,
      MAX_MERCATOR_LATITUDE,
      MAX_CREATED_AT,
      MAX_SAFE_INTEGER,
      MAX_DATASET_LENGTH,
      GEOHASH_ALPHABET,
    });
  });
});

describe('canonicalNumber', () => {
  for (const testCase of vectors.numberFormat.canonicalNumber) {
    const value = substitute(testCase.value) as number;
    const label = `canonicalNumber(${testCase.note ?? String(value)})`;

    if (testCase.reject) {
      it(`rejects ${testCase.note ?? String(value)}`, () => {
        expectRejection(() => canonicalNumber(value), testCase.reject as string, label);
      });
    } else {
      it(`renders ${testCase.note ?? String(value)}`, () => {
        expect(canonicalNumber(value), label).toBe(testCase.expected);
        // The rendering must be a JSON number that reparses to the same double.
        expect(JSON.parse(testCase.expected as string)).toBe(value === 0 ? 0 : value);
      });
    }
  }
});

describe('canonicalCoordinate', () => {
  for (const testCase of vectors.numberFormat.canonicalCoordinate) {
    const value = substitute(testCase.value) as number;
    const label = `canonicalCoordinate(${testCase.note ?? String(value)})`;

    if (testCase.reject) {
      it(`rejects ${testCase.note ?? String(value)}`, () => {
        expectRejection(() => canonicalCoordinate(value), testCase.reject as string, label);
      });
    } else {
      it(`quantises ${testCase.note ?? String(value)}`, () => {
        expect(canonicalCoordinate(value), label).toBe(testCase.expected);
      });
    }
  }

  /**
   * The half-even ruling, stated as an inequality rather than as a value.
   * `toFixed` is round-half-UP per ECMAScript ("if there are two such n, pick
   * the larger"); Python's `round` is half-even. Both are reachable, so the
   * two must be shown to actually differ or the ruling is decoration.
   */
  it('does not agree with toFixed on exact ties', () => {
    expect((0.0078125).toFixed(6)).toBe('0.007813');
    expect(canonicalCoordinate(0.0078125)).toBe('0.007812');
  });
});

describe('buildCollection', () => {
  for (const testCase of vectors.buildCollection) {
    const input = substitute(testCase.input) as Parameters<typeof buildCollection>[0];

    if (testCase.reject) {
      it(`rejects ${testCase.name}`, () => {
        expectRejection(() => buildCollection(input), testCase.reject as string, testCase.name);
      });
    } else {
      it(`builds ${testCase.name}`, () => {
        expect(expectAccepted(() => buildCollection(input), testCase.name)).toEqual(
          testCase.expect,
        );
      });
    }
  }
});

describe('buildItem', () => {
  for (const testCase of vectors.buildItem) {
    const input = substitute(testCase.input) as Parameters<typeof buildItem>[0];

    it(`builds ${testCase.name}`, () => {
      const event = expectAccepted(() => buildItem(input), testCase.name) as {
        content: string;
      };
      expect(event).toEqual(testCase.expect);
      // `content` is hashed into the event id, so it is compared as a STRING,
      // byte for byte, not as a parsed object.
      expect(event.content).toBe((testCase.expect as { content: string }).content);
    });
  }

  it('has no bbox parameter to contradict the tile with', () => {
    // CONTRACT.md §7.2. The signature takes the tile and nothing else spatial;
    // an extra key is inert rather than authoritative.
    const base = substitute(vectors.buildItem[0].input) as Parameters<typeof buildItem>[0];
    const withBogusBBox = { ...base, bbox: [0, 0, 1, 1] } as Parameters<typeof buildItem>[0];
    expect(buildItem(withBogusBBox)).toEqual(buildItem(base));
  });
});

describe('parseItemD', () => {
  for (const testCase of vectors.parseItemD) {
    it(`parses ${JSON.stringify(testCase.input)}`, () => {
      expect(parseItemD(testCase.input)).toEqual(testCase.expected);
    });
  }

  it('round-trips every accepted d through itemD', () => {
    for (const testCase of vectors.parseItemD) {
      if (!testCase.expected) continue;
      expect(itemD(testCase.expected.dataset, testCase.expected.tile)).toBe(testCase.input);
    }
  });
});

describe('validation', () => {
  for (const testCase of vectors.validation.cases) {
    it(`${testCase.accepted ? 'accepts' : 'rejects'} ${testCase.name}`, () => {
      const built = patched(vectors.validation.baseInput, testCase.patch) as Parameters<
        typeof buildItem
      >[0];

      if (testCase.accepted) {
        expectAccepted(() => buildItem(built), testCase.name);
      } else {
        expectRejection(() => buildItem(built), reasonCode(testCase.reason), testCase.name);
      }
    });
  }
});

/**
 * The GRAMMAR suite. The rest of this file pins VALUES; this block pins the
 * grammar that produces them.
 *
 * Every finding it exists for was of one shape: two regexes, or two
 * validators, where the contract has one rule. `\d` is ASCII here and
 * Unicode-aware in Python; `\s` contains U+FEFF here and U+0085 and
 * U+001C–U+001F there; `trim` and `strip` strip different sets; `null`
 * defaulted in one language and threw in the other; and the two sides checked
 * the same fields in different orders, so the same bad input named a different
 * field. None of it was visible to a suite that pins outputs for good inputs.
 */
describe('grammar', () => {
  it('implements the contract whitespace set exactly, and by codepoint', () => {
    const declared = vectors.grammar.whitespace.map((hex) => Number.parseInt(hex, 16));
    expect([...PROTOCOL_WHITESPACE].sort((a, b) => a - b)).toEqual(declared);
  });

  /**
   * The set is a UNION, so it must be a STRICT superset of what this language
   * calls whitespace — and the members Python contributes must be ones
   * JavaScript does not, or the union is decoration rather than a ruling.
   */
  it('is a strict superset of this language`s own whitespace', () => {
    const declared = new Set(vectors.grammar.whitespace.map((hex) => Number.parseInt(hex, 16)));
    const nativeOnly: number[] = [];
    const foreignOnly: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const native = /\s/.test(String.fromCharCode(code));
      if (native && !declared.has(code)) nativeOnly.push(code);
      if (!native && declared.has(code)) foreignOnly.push(code);
    }
    expect(nativeOnly).toEqual([]);
    // U+0085 and U+001C..U+001F are whitespace to Python and not to JavaScript.
    expect(foreignOnly).toEqual([0x001c, 0x001d, 0x001e, 0x001f, 0x0085]);
    // ...and U+FEFF is whitespace here and not there, which is the other half.
    expect(/\s/.test('﻿')).toBe(true);
  });

  for (const testCase of vectors.grammar.cases) {
    const label = `${testCase.builder}/${testCase.name}`;
    it(`${testCase.accepted ? 'accepts' : 'rejects'} ${label}`, () => {
      const build =
        testCase.builder === 'collection'
          ? () =>
              buildCollection(
                patched(vectors.grammar.collectionBaseInput, testCase.patch) as Parameters<
                  typeof buildCollection
                >[0],
              )
          : () =>
              buildItem(
                patched(vectors.validation.baseInput, testCase.patch) as Parameters<
                  typeof buildItem
                >[0],
              );

      if (testCase.accepted) {
        // An accepted grammar case must also be SENDABLE, not merely built.
        expect(isEncodable(expectAccepted(build, label) as UnsignedEvent), label).toBe(true);
      } else {
        expectRejection(build, reasonCode(testCase.reason), label);
      }
    });
  }
});

/**
 * THE INVARIANT the grammar suite exists to protect: a built event is always
 * UTF-8 encodable.
 *
 * Both languages used to gate lone surrogates in `content` and in `properties`
 * and NEITHER gated them in tag values, so both agreed on producing an event
 * that cannot be encoded — Python could build one and never send it, this side
 * sent one and every Python consumer choked on receipt. Two implementations
 * agreeing on an unsendable event is not convergence, which is why this is
 * asserted over every accepted vector rather than spot-checked.
 */
describe('every built event is UTF-8 encodable', () => {
  it('holds for every accepted collection vector', () => {
    for (const testCase of vectors.buildCollection) {
      if (testCase.reject) continue;
      const input = substitute(testCase.input) as Parameters<typeof buildCollection>[0];
      expect(isEncodable(buildCollection(input)), testCase.name).toBe(true);
    }
  });

  it('holds for every accepted item vector', () => {
    for (const testCase of vectors.buildItem) {
      const input = substitute(testCase.input) as Parameters<typeof buildItem>[0];
      expect(isEncodable(buildItem(input)), testCase.name).toBe(true);
    }
    for (const testCase of vectors.validation.cases) {
      if (!testCase.accepted) continue;
      const input = patched(vectors.validation.baseInput, testCase.patch) as Parameters<
        typeof buildItem
      >[0];
      expect(isEncodable(buildItem(input)), testCase.name).toBe(true);
    }
  });

  it('is enforced, not merely observed, on every tag value', () => {
    const base = vectors.grammar.collectionBaseInput as unknown as Parameters<
      typeof buildCollection
    >[0];
    for (const field of ['title', 'license', 'source', 'server', 'description'] as const) {
      expectRejection(
        () => buildCollection({ ...base, [field]: `lone \ud800 surrogate` }),
        'STRING_NOT_SCALAR',
        field,
      );
    }
  });
});

describe('filters.catalog', () => {
  for (const testCase of vectors.filters.catalog) {
    it(testCase.name, () => {
      const input = substitute(testCase.input) as Parameters<typeof catalog>[0];
      if (testCase.reject) {
        expectRejection(() => catalog(input), testCase.reject, testCase.name);
      } else {
        expect(catalog(input)).toEqual(testCase.expect);
      }
    });
  }
});

describe('filters.nearby', () => {
  for (const testCase of vectors.filters.nearby) {
    it(testCase.name, () => {
      const input = substitute(testCase.input) as {
        bbox: BBox4326;
        collection?: { pubkey: string; dataset: string };
        maxCells?: number;
        limit?: number;
      };
      const { bbox, ...options } = input;

      if (testCase.reject) {
        expectRejection(() => nearby(bbox, options), testCase.reject, testCase.name);
        return;
      }

      expect(nearby(bbox, options)).toEqual(testCase.expect ?? null);
      if (typeof testCase.coverCellCount === 'number') {
        expect(coverCellCount(bbox)).toBe(testCase.coverCellCount);
      }
    });
  }
});

describe('filters.exactTile', () => {
  for (const testCase of vectors.filters.exactTile) {
    it(testCase.name, () => {
      const input = substitute(testCase.input) as {
        dataset: string;
        tile: Tile;
        authors?: string[];
        limit?: number;
      };
      const { dataset, tile, ...options } = input;

      if (testCase.reject) {
        expectRejection(() => exactTile(dataset, tile, options), testCase.reject, testCase.name);
      } else {
        expect(exactTile(dataset, tile, options)).toEqual(testCase.expect);
      }
    });
  }
});

describe('geohash.gridSize', () => {
  for (const testCase of vectors.geohash.gridSize) {
    it(`p${testCase.precision}`, () => {
      expect(gridSize(testCase.precision)).toEqual({
        lonCells: testCase.lonCells,
        latCells: testCase.latCells,
      });
    });
  }
});

describe('geohash.cellToGeohash', () => {
  for (const testCase of vectors.geohash.cellToGeohash) {
    it(`(${testCase.ix},${testCase.iy}) at p${testCase.precision}`, () => {
      expect(cellToGeohash(testCase.ix, testCase.iy, testCase.precision)).toBe(testCase.expected);
    });
  }
});

describe('geohash.encode', () => {
  for (const testCase of vectors.geohash.encode) {
    const label = `encode(${testCase.lat}, ${testCase.lon}, ${testCase.precision})`;
    it(label, () => {
      if (testCase.reject) {
        expectRejection(
          () => encode(testCase.lat, testCase.lon, testCase.precision),
          testCase.reject,
          label,
        );
      } else {
        expect(encode(testCase.lat, testCase.lon, testCase.precision)).toBe(testCase.expected);
      }
    });
  }
});

describe('geohash.cover', () => {
  for (const testCase of vectors.geohash.cover) {
    it(testCase.name, () => {
      const bbox = substitute(testCase.bbox) as BBox4326;

      if (testCase.reject) {
        expectRejection(() => coverCells(bbox), testCase.reject, testCase.name);
        expectRejection(() => coverCellCount(bbox), testCase.reject, testCase.name);
        return;
      }

      expect(coverCellCount(bbox), `${testCase.name} count`).toBe(testCase.expectedCellCount);

      if (testCase.cellsOmitted) {
        // Too large to pin, and too large for any relay: the only assertion
        // left is that `nearby` refuses to build a filter from it.
        expect(nearby(bbox)).toBeNull();
        return;
      }

      const cells = coverCells(bbox);
      // ORDER IS NORMATIVE: longitude outer, latitude inner.
      expect(cells, `${testCase.name} cells`).toEqual(testCase.expectedCells);
      expect(cells).toHaveLength(testCase.expectedCellCount as number);
    });
  }
});

describe('supersession', () => {
  for (const testCase of vectors.supersession.cases) {
    it(testCase.name, () => {
      expect(selectHead(testCase.events)?.id).toBe(testCase.expectedHeadId);
      // The rule must not depend on arrival order.
      expect(selectHead([...testCase.events].reverse())?.id).toBe(testCase.expectedHeadId);
    });
  }
});

describe('createdAtMonotonicity', () => {
  for (const testCase of vectors.createdAtMonotonicity.cases) {
    const label = `nextCreatedAt(${String(testCase.last)}, ${testCase.now})`;
    it(label, () => {
      if (testCase.reject) {
        expectRejection(() => nextCreatedAt(testCase.last, testCase.now), testCase.reject, label);
      } else {
        expect(nextCreatedAt(testCase.last, testCase.now)).toBe(testCase.expected);
      }
    });
  }
});

describe('socialGeohashLadder', () => {
  /**
   * The OPPOSITE rule to the dataset layer's single p4 tag, and normative.
   * Collapsing these to one p4 tag is what silently killed live presence and
   * the geo-note feed: nostr tag filters are exact string matches, so a
   * precision-5 query can never match a precision-4 tag.
   */
  it('emits every prefix, precisions 1..6, shortest first', () => {
    const { lat, lon, expectedTags } = vectors.socialGeohashLadder.example;
    expect(socialGeohashTags(lat, lon)).toEqual(expectedTags);
  });

  it('is not what the dataset layer emits', () => {
    const { lat, lon } = vectors.socialGeohashLadder.example;
    expect(socialGeohashTags(lat, lon)).toHaveLength(6);
    expect(encode(lat, lon, GEOHASH_PRECISION)).toHaveLength(4);
  });
});
