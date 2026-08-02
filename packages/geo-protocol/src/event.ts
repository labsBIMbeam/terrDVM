/**
 * The event template both builders return, plus the canonical JSON that makes
 * `content` byte-identical across languages.
 *
 * A Python publisher and this TypeScript one must produce the same event for
 * the same inputs — `packages/geo-protocol/tests/fixtures/geo-vectors.json` is
 * the conformance suite and `CONTRACT.md` is the spec. `content` is hashed
 * into the event id, so a one-character difference is a different event for
 * one addressable address.
 */

import { reject } from './errors';
import { canonicalNumber } from './number';

/** An event with no `id`, `pubkey` or `sig` — signing is the caller's job. */
export type UnsignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * True when every surrogate in `value` is half of a well-formed pair.
 *
 * Lone surrogates are rejected rather than escaped (CONTRACT.md §5.2):
 * JavaScript would write `\udXXX`, Python cannot hold one without
 * `surrogatepass` and cannot encode it to UTF-8 at all. There is no output
 * both languages could agree on, so there is no input either.
 */
function isWellFormed(value: string): boolean {
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
}

/**
 * Throws unless `value` is a well-formed Unicode scalar sequence.
 *
 * CONTRACT.md §5.2 and §7.4. Exported because this is NOT only a `content`
 * rule: it governs every string that reaches a TAG value too. Both languages
 * used to gate `content` and neither gated tags, so both agreed on building an
 * event that cannot be UTF-8 encoded — `json.dumps(event).encode('utf-8')`
 * raises `UnicodeEncodeError`, so Python could build one and never send it
 * while TypeScript sent one every Python consumer chokes on. Agreement on an
 * unsendable event is not convergence.
 */
export function assertScalarString(value: string, label: string): void {
  if (!isWellFormed(value)) {
    reject('STRING_NOT_SCALAR', `${label} must contain no lone surrogates`);
  }
}

/**
 * A JSON string literal with minimal escaping.
 *
 * `JSON.stringify` and `json.dumps(..., ensure_ascii=False)` already agree
 * exactly here — `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t` and `\u00XX` for the
 * remaining C0 controls, everything else raw as UTF-8, INCLUDING U+2028 and
 * U+2029. The only divergence was lone surrogates, and those are refused
 * before we get here.
 */
export function canonicalString(value: string): string {
  assertScalarString(value, 'string');
  return JSON.stringify(value);
}

/**
 * JSON with every object key sorted ascending and no insignificant
 * whitespace. CONTRACT.md §5.
 *
 * Numbers go through `canonicalNumber`, so exponent notation can never reach
 * the wire from either side. The Python mirror is
 * `json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
 * with the same number hook.
 *
 * Keys are compared as UTF-16 code units here and as code points in Python;
 * the two orders differ for astral-plane characters, which is why property
 * keys are restricted to ASCII (CONTRACT.md §5.1) rather than trusting a
 * comparator neither language provides natively.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return canonicalString(value);

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }

  const record = value as { readonly [key: string]: JsonValue };
  const body = Object.keys(record)
    .sort()
    .map((key) => `${canonicalString(key)}:${canonicalJson(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * An object literal assembled from ALREADY-SERIALISED members, sorted by key.
 *
 * `buildItem` needs this because its `bbox` entries are rendered by
 * `canonicalCoordinate` (quantised) while everything under `properties` is
 * rendered by `canonicalNumber` (not quantised) — two formatters inside one
 * object. Sorting here rather than trusting the caller to write the keys in
 * order is deliberate: key order is part of the event id, and "the author
 * happened to type them alphabetically" is not a guarantee.
 */
export function canonicalObject(members: ReadonlyArray<readonly [string, string]>): string {
  const body = [...members]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, serialised]) => `${canonicalString(key)}:${serialised}`)
    .join(',');
  return `{${body}}`;
}
