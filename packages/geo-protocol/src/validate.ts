/**
 * Field validation. CONTRACT.md §7.
 *
 * Version 1's Python `build_item` performed NO validation at all:
 * `sha256='nothex'`, `size=0`, `size=-5`, `size=1.5`, `datetime='yesterday'`,
 * `url=''`, `created_at=-1`, `z=25`, `pubkey='short'` and whitespace datasets
 * were every one of them accepted by Python and every one of them thrown by
 * TypeScript. Both implementations must now accept and reject IDENTICALLY, so
 * every rule below is a coded rejection pinned by a vector.
 *
 * Rule of construction throughout: prefer the behaviour that makes a bad event
 * INEXPRESSIBLE. A publisher that cannot say something wrong is strictly
 * better than two clients that disagree about what was said.
 */

import { reject } from './errors';
import {
  MAX_CREATED_AT,
  MAX_DATASET_LENGTH,
  MAX_FILTER_LIMIT,
  MAX_SAFE_INTEGER,
} from './kinds';
import { assertScalarString, canonicalString, type JsonValue } from './event';

/**
 * The protocol whitespace set, CONTRACT.md §7.3 — stated as codepoints because
 * neither language's `\s` nor either language's trim/strip is the same set.
 *
 * `\s` in JavaScript contains U+FEFF and NOT U+0085 or U+001C–U+001F; `\s` in
 * Python is the exact opposite. So `https://example/﻿` was rejected here
 * and accepted there, and `https://example/` was accepted here and
 * rejected there — acceptance reversed per character. `String.prototype.trim`
 * and `str.strip` inherit the same disagreement, which is why `assertText`
 * below does NOT call trim.
 *
 * The ruling is the UNION of both languages' sets: a character that is
 * whitespace to EITHER language is whitespace to the protocol. Union rather
 * than intersection because the rule of construction is to make a bad event
 * inexpressible — a name that looks trimmed to one reader and untrimmed to the
 * other is exactly the input worth refusing.
 *
 * Every member is BMP and none is a surrogate, so scanning UTF-16 code units
 * here and scanning characters in Python examine the same set.
 */
export const PROTOCOL_WHITESPACE: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x001c, 0x001d, 0x001e, 0x001f, 0x0020, 0x0085, 0x00a0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

const WHITESPACE = new Set(PROTOCOL_WHITESPACE);

/** True when `code` is a UTF-16 code unit in the protocol whitespace set. */
export function isProtocolWhitespace(code: number): boolean {
  return WHITESPACE.has(code);
}

/** True when any code unit of `value` is protocol whitespace. */
function containsWhitespace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (WHITESPACE.has(value.charCodeAt(index))) return true;
  }
  return false;
}

/**
 * `[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?` — 1..64 characters, lowercase ASCII
 * alphanumerics plus `.`, `_`, `-`, beginning and ending alphanumeric.
 *
 * NON-ASCII IS REJECTED OUTRIGHT, which is how CONTRACT.md §3.1 resolves
 * Unicode normalisation: NFC and NFD spellings of `terräin` are both invalid,
 * so no normalisation step exists anywhere. Implementations MUST NOT call
 * `normalize()` — a normalising implementation would accept input a
 * non-normalising one rejects, which is the same class of bug one level down.
 *
 * `d` is a machine identity key: it appears inside `a` addresses, inside item
 * `d` values, inside relay filter strings and inside URLs. Human-facing text
 * belongs in `title`, which is unrestricted.
 */
const DATASET_PATTERN = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

/** Lowercase hex only — the `a` tag and the `x` tag carry hex, never bech32. */
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

/** Bare `type/subtype`; parameters such as `; charset=utf-8` are refused. */
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * RFC 3339, UTC `Z` only, 1..9 fractional digits.
 *
 * `[0-9]`, never `\d`: JavaScript's `\d` is ASCII-only while Python's is
 * UNICODE-AWARE, so Python accepted `٢٠٢٦-٠١-٠١T٠٠:٠٠:٠٠Z` (Arabic-Indic),
 * `२०२६-०१-०१T००:००:००Z` (Devanagari), fullwidth digits and mixed-script
 * forms, echoed them verbatim into `content`, and passed its calendar checks
 * too because `int()` parses them — while this side threw DATETIME_GRAMMAR.
 * An explicit class is the same regex in both languages.
 */
const DATETIME_PATTERN =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?Z$/;

/** `[A-Za-z0-9_][A-Za-z0-9_.-]*` — ASCII, so both sort orders coincide. */
const PROPERTY_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * True when `value` is a legal dataset name.
 *
 * Exported so `parseItemD` can reuse the one grammar instead of writing a
 * second copy of the pattern that would drift from this one.
 */
export function isDataset(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_DATASET_LENGTH && DATASET_PATTERN.test(value)
  );
}

/** Throws unless `dataset` is a legal name. CONTRACT.md §3.1. */
export function assertDataset(dataset: string): void {
  if (!isDataset(dataset)) {
    reject(
      'DATASET_GRAMMAR',
      `dataset must match [a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?, got ${JSON.stringify(dataset)}`,
    );
  }
}

/** Throws unless `value` is a 64-character lowercase hex string. */
export function assertHex64(value: string, label: string): void {
  if (typeof value !== 'string' || !HEX64_PATTERN.test(value)) {
    reject('HEX64', `${label} must be 64 lowercase hex characters, got ${String(value)}`);
  }
}

/**
 * Throws unless `value` is a non-empty, scalar, whitespace-bounded tag value.
 *
 * Three checks in a FIXED order (CONTRACT.md §7.4): type, then Unicode
 * well-formedness, then emptiness/slack. Well-formedness comes first because
 * it is a precondition of the event existing at all — a lone surrogate cannot
 * be UTF-8 encoded, so `" \ud800"` is STRING_NOT_SCALAR and not TEXT_EMPTY.
 *
 * The slack test is `first or last codepoint is protocol whitespace`, NOT
 * `trim(v) !== v`: `String.prototype.trim` and Python's `str.strip` strip
 * different sets (24 divergent inputs in the probe, across every text field
 * and every position), so neither is usable as the rule.
 */
export function assertText(value: string, label: string): void {
  if (typeof value !== 'string') {
    reject('TEXT_EMPTY', `${label} must be a non-empty trimmed string`);
  }
  assertScalarString(value, label);
  if (
    value.length === 0 ||
    WHITESPACE.has(value.charCodeAt(0)) ||
    WHITESPACE.has(value.charCodeAt(value.length - 1))
  ) {
    reject('TEXT_EMPTY', `${label} must be a non-empty string with no leading or trailing space`);
  }
}

/**
 * Throws unless `value` is a legal `content` string for a collection.
 *
 * Free text with NO grammar: it may be empty and it may be any Unicode, so the
 * only checks left are that it is a string and that it can be encoded. It
 * reuses TEXT_EMPTY for the type failure because §14 defines no separate code,
 * and inventing one locally is how two error tables drift apart — Python used
 * to raise STRING_NOT_SCALAR here, which then meant two different things.
 */
export function assertDescription(value: string, label: string): void {
  if (typeof value !== 'string') {
    reject('TEXT_EMPTY', `${label} must be a string`);
  }
  assertScalarString(value, label);
}

/** Throws unless `value` is a bare `type/subtype` media type. */
export function assertMimeType(value: string): void {
  if (typeof value !== 'string' || !MIME_PATTERN.test(value)) {
    reject('MIME_GRAMMAR', `mimeType must be a bare type/subtype, got ${String(value)}`);
  }
}

/**
 * Throws unless `value` is an http(s) URL with no protocol whitespace.
 *
 * Written structurally rather than as `^https?://\S+$` because `\S` is the
 * character class the two languages disagree about (see PROTOCOL_WHITESPACE).
 * Order, as everywhere: type, then well-formedness, then grammar — so
 * `ftp://…\ud800` is STRING_NOT_SCALAR, not URL_GRAMMAR.
 */
export function assertUrl(value: string): void {
  if (typeof value !== 'string') {
    reject('URL_GRAMMAR', `url must be http(s) and whitespace-free, got ${String(value)}`);
  }
  assertScalarString(value, 'url');

  const scheme = value.startsWith('https://') ? 8 : value.startsWith('http://') ? 7 : -1;
  if (scheme < 0 || value.length === scheme || containsWhitespace(value)) {
    reject('URL_GRAMMAR', `url must be http(s) and whitespace-free, got ${value}`);
  }
}

/**
 * Throws unless `value` is a whole byte count in `1 .. 2^53-1`.
 *
 * Zero is refused because a zero-byte blob is a publish bug every time, and
 * the ceiling is refused because a size beyond the safe-integer range does not
 * round-trip through every JSON consumer in the chain.
 */
export function assertSize(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SAFE_INTEGER) {
    reject('SIZE_RANGE', `size must be an integer in 1..${MAX_SAFE_INTEGER}, got ${String(value)}`);
  }
}

/** Days in a Gregorian month, leap rule included. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Throws unless `value` is an RFC 3339 UTC instant that really exists.
 *
 * REQUIRED, with no default. TypeScript required it; Python defaulted it to
 * `iso_datetime(created_at)`, and the old single-sample fixture masked the
 * difference by coincidence — `createdAt = 1767225600` renders to exactly the
 * declared `"2026-01-01T00:00:00Z"`. `datetime` is the ACQUISITION instant, a
 * property of the data; `created_at` is the PUBLISH instant, a property of the
 * act of publishing. Silently equating them fabricates provenance: a 2019 DEM
 * republished today would claim to have been surveyed today, and nothing
 * downstream could tell.
 *
 * UTC `Z` only, so the string sorts lexicographically and needs no timezone
 * library to compare. Fractional seconds are preserved VERBATIM — the value is
 * echoed into `content`, never reformatted. Second 60 is rejected: no unix
 * second maps to a leap second, so accepting one would guarantee a lossy
 * round-trip.
 */
export function assertDatetime(value: unknown): void {
  if (value === undefined || value === null) {
    reject('DATETIME_REQUIRED', 'datetime is required; it is the acquisition instant');
  }
  if (typeof value !== 'string') {
    reject('DATETIME_GRAMMAR', `datetime must be a string, got ${String(value)}`);
  }

  const match = DATETIME_PATTERN.exec(value);
  if (!match) {
    reject('DATETIME_GRAMMAR', `datetime must be RFC 3339 UTC ending in 'Z', got ${value}`);
  }

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);

  if (mo < 1 || mo > 12) reject('DATETIME_CALENDAR', `month ${month} does not exist`);
  if (d < 1 || d > daysInMonth(y, mo)) {
    reject('DATETIME_CALENDAR', `${year}-${month}-${day} does not exist`);
  }
  if (h > 23) reject('DATETIME_CALENDAR', `hour ${hour} does not exist`);
  if (mi > 59) reject('DATETIME_CALENDAR', `minute ${minute} does not exist`);
  if (s > 59) reject('DATETIME_CALENDAR', `second ${second} does not exist; leap seconds are not unix seconds`);
}

/**
 * Throws unless `value` is a publish instant in `0 .. MAX_CREATED_AT`.
 *
 * The ceiling is the millisecond trap: `Date.now()` passed unscaled fails
 * loudly here instead of publishing a head no later event can supersede.
 */
export function assertCreatedAt(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CREATED_AT) {
    reject(
      'CREATED_AT_RANGE',
      `createdAt must be an integer in 0..${MAX_CREATED_AT} seconds, got ${String(value)}`,
    );
  }
}

/** Throws unless `value` is an integer in `1 .. MAX_FILTER_LIMIT`. */
export function assertFilterLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILTER_LIMIT) {
    reject(
      'FILTER_LIMIT_RANGE',
      `limit must be an integer in 1..${MAX_FILTER_LIMIT}; strfry clamps above that silently, ` +
        `so a full page would be indistinguishable from a truncated one`,
    );
  }
}

/**
 * Throws unless every key, string and number under `properties` can reach the
 * wire identically from both languages.
 *
 * The number gate is NARROWER than `canonicalNumber`, which is total over
 * finite doubles: a property number must additionally satisfy
 * `|v| <= 2^53-1`. Magnitude, not integrality, is the test — `1e-300` is fine,
 * `1e300` and `9007199254740992` are not. `canonicalNumber` still DEFINES an
 * output for `1e300` so the serialiser stays total and testable; this gate is
 * what stops it reaching the wire.
 */
export function assertProperties(properties: unknown): void {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    reject('PROPERTY_KEY_GRAMMAR', 'properties must be a plain object');
  }
  walkProperties(properties);
}

/**
 * `null`, `undefined` and a missing key all mean ABSENT, and absent means `{}`.
 *
 * CONTRACT.md §7.5. This side used to default only on `undefined`, so an
 * explicit `null` fell through to `assertProperties` and was rejected, while
 * Python mapped `None` to `{}` and built the event — and `None` is the
 * ordinary Python sentinel for an absent bag, so the crawler reaches it on the
 * first tile with no per-tile facts. The distinction between "absent" and
 * "null" is unrepresentable in Python (a keyword default of `None` is the
 * idiom), so, exactly as §7.1 rules for integrality, the protocol declines to
 * depend on a difference one language cannot express.
 */
export function resolveProperties(properties: unknown): Readonly<Record<string, JsonValue>> {
  const bag = properties === undefined || properties === null ? {} : properties;
  assertProperties(bag);
  return bag as Readonly<Record<string, JsonValue>>;
}

function walkProperties(value: unknown): void {
  if (value === null || typeof value === 'boolean') return;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      reject('NUMBER_NOT_FINITE', `property numbers must be finite, got ${String(value)}`);
    }
    if (Math.abs(value) > MAX_SAFE_INTEGER) {
      reject(
        'PROPERTY_NUMBER_RANGE',
        `property numbers must satisfy |v| <= ${MAX_SAFE_INTEGER}, got ${String(value)}`,
      );
    }
    return;
  }

  if (typeof value === 'string') {
    canonicalString(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) walkProperties(entry);
    return;
  }

  if (typeof value !== 'object') {
    reject('PROPERTY_KEY_GRAMMAR', `properties must be JSON, got ${typeof value}`);
  }

  // `typeof x === 'object'` is true for Date, Map, Set, class instances and
  // typed arrays, none of which have enumerable own keys — so without this gate
  // they pass the loop below untouched and canonicalJson renders them as `{}`.
  // The data is then silently gone from `content`, which is hashed into the
  // event id, with no error raised anywhere. Python rejects these, so this was
  // also a cross-language split. Only a plain object or a null-prototype object
  // is JSON.
  const proto = Object.getPrototypeOf(value as object);
  if (proto !== Object.prototype && proto !== null) {
    reject(
      'PROPERTY_KEY_GRAMMAR',
      `properties must be plain JSON objects, got ${(value as object).constructor?.name ?? 'unknown'}`,
    );
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!PROPERTY_KEY_PATTERN.test(key)) {
      reject(
        'PROPERTY_KEY_GRAMMAR',
        `property key must match [A-Za-z0-9_][A-Za-z0-9_.-]*, got ${JSON.stringify(key)}`,
      );
    }
    walkProperties(entry);
  }
}
