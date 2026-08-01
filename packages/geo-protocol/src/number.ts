/**
 * Canonical number serialisation — the rule that broke version 1 hardest.
 *
 * THE FAILURE THIS REPLACES. Python `repr` switches to exponent notation below
 * 1e-4; JavaScript `String()` switches below 1e-6. Tile z22/2097152/2097151
 * produced `{"bbox":[0,0,0.000086,...]}` here and `{"bbox":[0,0,8.6e-05,...]}`
 * in Python — different content strings, therefore DIFFERENT EVENT IDS for one
 * addressable event, which is a silent split-brain and not a visible error.
 * Below 1e-6 the old `canonicalJson` THREW while Python happily emitted
 * `1e-07`. The window `1e-6 <= |x| < 1e-4` was silently wrong in both
 * directions and is reachable from arbitrary caller data in `properties`.
 *
 * The fix is specified in CONTRACT.md §4 as an ALGORITHM rather than as a
 * reference to either language's printer, and is implemented here by string
 * surgery with no library and no dependency on where `String()` happens to
 * switch notation.
 */

import { COORDINATE_DECIMALS } from './kinds';
import { reject } from './errors';

/**
 * A finite double decomposed so that `|v| = 0.<digits> x 10^exp`, with all
 * leading and trailing zeros of `digits` stripped.
 *
 * `digits` is empty exactly when `v` is zero.
 */
type Decimal = { negative: boolean; digits: string; exp: number };

/**
 * Decompose a finite double into its SHORTEST ROUND-TRIP decimal.
 *
 * JavaScript `String(v)` and Python `repr(v)` both produce exactly these
 * digits — they agree on DIGITS and disagree only on NOTATION — so this step
 * is free in both languages and the two sides cannot drift on it. What they
 * must not do is trust the notation, which is what the parsing below removes.
 */
function decompose(value: number): Decimal {
  const negative = value < 0;
  const literal = String(Math.abs(value));

  const eIndex = literal.indexOf('e');
  const mantissa = eIndex === -1 ? literal : literal.slice(0, eIndex);
  const exponent = eIndex === -1 ? 0 : Number(literal.slice(eIndex + 1));

  const dotIndex = mantissa.indexOf('.');
  const integerPart = dotIndex === -1 ? mantissa : mantissa.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? '' : mantissa.slice(dotIndex + 1);

  // |v| = 0.<integerPart><fractionPart> x 10^(integerPart.length + exponent)
  let digits = integerPart + fractionPart;
  let exp = integerPart.length + exponent;

  let lead = 0;
  while (lead < digits.length && digits[lead] === '0') lead += 1;
  digits = digits.slice(lead);
  exp -= lead;

  digits = digits.replace(/0+$/, '');
  if (digits.length === 0) return { negative: false, digits: '', exp: 0 };

  return { negative, digits, exp };
}

/**
 * Render `0.<digits> x 10^exp` POSITIONALLY — never in exponent notation.
 *
 * `1e300` becomes 301 digits and `5e-324` becomes 324 fractional digits. Long,
 * deterministic and JSON-legal, which is the whole point: an exponent literal
 * is legal JSON too, but the two languages do not agree on when to write one.
 */
function render(decimal: Decimal): string {
  const { negative, digits, exp } = decimal;
  if (digits.length === 0) return '0';

  let body: string;
  if (exp <= 0) {
    body = `0.${'0'.repeat(-exp)}${digits}`;
  } else if (exp >= digits.length) {
    body = digits + '0'.repeat(exp - digits.length);
  } else {
    body = `${digits.slice(0, exp)}.${digits.slice(exp)}`;
  }

  return negative ? `-${body}` : body;
}

/**
 * Canonical text of any finite double. CONTRACT.md §4.1.
 *
 * Note that the shortest ROUND-TRIP digits are used, not the exact binary
 * value: the double `1e300` is exactly a 301-digit integer that is NOT a 1
 * followed by 300 zeros, and the shortest-round-trip rule is what makes both
 * languages produce the same one of those. `412.0` and `412` are
 * indistinguishable, which subsumes the old `_jsonable` integral-narrowing
 * pass. `-0` normalises to `0`.
 */
export function canonicalNumber(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject('NUMBER_NOT_FINITE', `number must be finite, got ${String(value)}`);
  }
  return render(decompose(value));
}

/**
 * Canonical text of a coordinate: `canonicalNumber` plus quantisation to
 * `COORDINATE_DECIMALS` with ROUND_HALF_EVEN. CONTRACT.md §4.2.
 *
 * `Number.prototype.toFixed` MUST NOT be used here, and this is a real
 * divergence rather than a theoretical one. ECMAScript specifies `toFixed` as:
 * pick the n minimising |n/10^f - x|, and ON A TIE PICK THE LARGER n — that is
 * round-half-UP. Python's `round()` and `Decimal.quantize` default to
 * half-even. Exact 6-dp ties are reachable by any double whose exact value is
 * (2k+1)/(2 x 10^6) in lowest terms: `(0.0078125).toFixed(6)` gives
 * `"0.007813"` where `round(0.0078125, 6)` gives `0.007812`.
 *
 * Quantising the SHORTEST DECIMAL rather than the exact binary value is
 * deliberate — neither side then needs exact binary expansion, which is what
 * `Decimal(repr(v))` does natively in Python and what BigInt string arithmetic
 * does trivially here.
 */
export function canonicalCoordinate(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject('NUMBER_NOT_FINITE', `coordinate must be finite, got ${String(value)}`);
  }

  const { negative, digits, exp } = decompose(value);
  if (digits.length === 0) return '0';

  // |v| x 10^COORDINATE_DECIMALS = digits x 10^shift, exactly.
  const shift = exp - digits.length + COORDINATE_DECIMALS;
  let units: bigint;

  if (shift >= 0) {
    units = BigInt(digits) * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    const whole = BigInt(digits);
    const quotient = whole / divisor;
    const remainder = whole % divisor;
    const twiceRemainder = remainder * 2n;
    if (twiceRemainder > divisor) {
      units = quotient + 1n;
    } else if (twiceRemainder < divisor) {
      units = quotient;
    } else {
      // Exact tie: round half to EVEN.
      units = quotient % 2n === 0n ? quotient : quotient + 1n;
    }
  }

  if (units === 0n) return '0';

  const scale = 10n ** BigInt(COORDINATE_DECIMALS);
  const integerPart = (units / scale).toString();
  const fraction = (units % scale).toString().padStart(COORDINATE_DECIMALS, '0').replace(/0+$/, '');
  const body = fraction.length === 0 ? integerPart : `${integerPart}.${fraction}`;

  return negative ? `-${body}` : body;
}

/**
 * The coordinate as a number, quantised exactly as `canonicalCoordinate`
 * renders it. Used for the degenerate-extent check, which CONTRACT.md §10.1
 * requires to run AFTER quantisation so the emitted tag is itself valid on
 * read-back.
 */
export function quantizeCoordinate(value: number): number {
  return Number(canonicalCoordinate(value));
}
