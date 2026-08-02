# terrCVM geo protocol — normative contract

**Status:** normative. **Version:** 3. **Conformance suite:**
`packages/geo-protocol/tests/fixtures/geo-vectors.json`.

Two independent implementations exist — TypeScript in `packages/geo-protocol/src/` and
Python in `services/blossom-gis/src/blossom_gis/geo_protocol.py` — and they must emit
**byte-identical events for identical input**. `content` is hashed into the event id, so
a one-character difference is a different event for one addressable address, which is a
silent split-brain, not a visible error.

Version 1 of this layer had no contract. It had one sample fixture, and eleven
cross-language divergences lived comfortably outside it. Every rule below exists because
one of those divergences was proven by execution, and every rule below is pinned by
explicit vectors. Where the two implementations disagreed, this document picks **one**
answer and states why.

Version 2 fixed the eleven divergences it could see and left a whole family it could not.
An adversarial differential probe found 4 critical and 14 major further divergences, and
they were **all one shape: two regexes, or two validators, where the contract has one
rule.** Nearly every finding ended *"mutating this leaves BOTH suites green, so nothing
pins it"* — because a suite that pins **values** cannot see a rule spelled two ways, since
both spellings agree on every good input. Version 3 therefore states the *grammar* itself:
the character sets (§7.3), the order of checks (§14.1, §7.4, §10.2), the meaning of an
absent value (§7.5), and a `grammar` section in the vector file that pins each of them
(§15.1).

Rule of construction, applied throughout: **prefer the behaviour that makes a bad event
inexpressible.** A publisher that cannot say something wrong is strictly better than two
clients that disagree about what was said.

Corollary added in version 3: **a rule whose meaning depends on which language's standard
library you ask is not a rule.** `\d`, `\s`, `\S`, `trim`, `strip` and an implicit
numeric coercion are all in that category, and all of them are banned here by name.

---

## 1. Shape

The layer is deliberately minimal: **one global event, one local event, one global
spatial tag, one local spatial tag.** It maps onto STAC — the global event is a
Collection (a dataset, which has an *extent*), the local event is an Item (a tile, which
has a *location*).

| | kind | role | spatial tags |
|---|---|---|---|
| Collection | `30550` | one per dataset | `["bbox", w, s, e, n]`, **no geohash** |
| Item | `30551` | one per tile | `["d", "<dataset>:<z>/<x>/<y>"]` + `["g", <geohash p4>]` |

A dataset has an extent, not a location, so the collection carries no `g`. `bbox` is not
a single-letter tag, so relays do not index it; clients fetch `{kinds:[30550]}` wholesale
and filter locally. Collections are few, so that is cheap — and under NIP-01 it is the
only strategy available.

The item's exact bbox, its acquisition datetime and its per-tile properties travel in
`content`, not in tags. Relays do not index content; moving them there is precisely what
holds the spatial tag count at one.

### 1.1 Kind numbers — 30550 / 30551

Changed from the originally sketched 30450/30451. Both pairs are unclaimed today across
the NIPs README, fiatjaf's registry-of-kinds, nostrability/schemata, nostrbook,
nostr-tools and NDK. But Marmot (MLS-over-nostr) holds seven consecutive **low** kinds
443–449, and its MIP-00 established a `30000 + N` addressable-mirror convention (low 443
→ 30443, real and deployed). Marmot's next free low slot is **450**, which mirrors to
exactly 30450. 30550/30551 sits mid-run in 30516–30616 — the largest fully empty stretch
of the addressable space — and low kinds 550/551 are themselves unclaimed, so no future
mirror can land on them either.

### 1.2 Why the item `d` carries the dataset prefix

NIP-01 defines addressable identity as exactly `(kind, pubkey, d)`. The `a` tag is **no
part of it** — NIP-01 defines `a` purely as a pointer, and it appears nowhere in the
replacement rule. Without the prefix, a terrain item and an imagery item for the same
tile from the same publisher are the same addressable event and silently annihilate each
other, with a successful `OK` returned on every publish. The prefix is not decoration.

Vector: `buildItem/second-dataset-same-tile`.

---

## 2. Constants

| Name | Value |
|---|---|
| `KIND_GEO_COLLECTION` | `30550` |
| `KIND_GEO_ITEM` | `30551` |
| `GEOHASH_PRECISION` | `4` |
| `MAX_TILE_ZOOM` | `22` |
| `COORDINATE_DECIMALS` | `6` |
| `DATASET_SEPARATOR` | `":"` |
| `MAX_DATASET_LENGTH` | `64` |
| `DEFAULT_FILTER_LIMIT` | `500` |
| `MAX_FILTER_LIMIT` | `500` |
| `MAX_COVER_CELLS` | `128` |
| `MAX_CREATED_AT` | `2147483647` |
| `MAX_SAFE_INTEGER` | `9007199254740991` |
| `MAX_MERCATOR_LATITUDE` | `85.05112878` |

Both implementations MUST export these names (snake_case in Python). The Python names
`GLOBAL_GEOHASH_PRECISION` and `MAX_ITEM_FILTER_CELLS` are renamed to
`GEOHASH_PRECISION` and `MAX_COVER_CELLS`; two names for one constant is how the two
sides drift apart in the first place.

### 2.1 Ruling — `MAX_TILE_ZOOM = 22`

TypeScript said 22, Python said 30, and **both test suites asserted the disagreement and
both passed** (`item.test.ts:86` rejected z23; `test_geo_protocol.py:213` rejected only
z31). 22 wins:

- A z22 tile is 360/2²² = 8.583 × 10⁻⁵ ° ≈ **9.55 m** at the equator. No DEM, no
  orthophoto and no TFT2 heightfield this protocol will ever carry resolves finer.
- The coordinate grid is 10⁻⁶ ° (§4). A z22 tile is **86 grid steps** wide, so adjacent
  tiles still serialise to distinct bboxes. That stops being true at z ≈ 28.4: by z29 a
  tile is narrower than one grid step and two neighbouring items would carry an
  identical `content.bbox`. A ceiling of 30 published events that cannot be told apart.
- z22 keeps `2^z` and every tile index far inside exact-double range and keeps the `d`
  string short.

Vectors: `parseItemD` (`terrain:22/4194303/4194303` accepted, `terrain:23/0/0` and
`terrain:31/0/0` rejected), `validation` cases `zoom-22-max`, `zoom-23`, `zoom-25`,
`zoom-31`.

### 2.2 `GEOHASH_PRECISION = 4` — for the DATASET layer only

Chosen by **events per cell**, not by cell area. A p4 cell is 20 bits (10 lon + 10 lat) =
0.3515625° × 0.17578125° — 39 × 19 km at the equator, 28 × 19.5 km at 45 N. That holds
~128 z14 tiles at the equator and ~200–290 across the 45–60 N band this project targets,
which fits inside strfry's default `maxFilterLimit = 500` with room to spare. p3 (the odd
split: 8 lon / 7 lat, square 1.40625° cells) would hold ~3300–4100 z14 tiles per cell and
be **silently clamped** to 500 by the relay, punching holes in the map with no error. p5
would multiply every viewport query's cell count by 32 for no gain.

**This precision applies to kinds 30550/30551 and to nothing else.** See §11.

---

## 3. Dataset names

### 3.1 Ruling — the grammar

```
dataset := ALNUM ( [a-z0-9._-]{0,62} ALNUM )?      ALNUM := [a-z0-9]
```

That is: 1–64 characters, lowercase ASCII alphanumerics plus `.`, `_`, `-`, and it must
begin and end alphanumeric.

TypeScript required non-empty, trimmed, no whitespace, no `:`. Python required only
non-empty and no `:`. **Neither Unicode-normalised**, so `terräin` spelled NFC and the
same name spelled NFD were two different collections with two different `a` addresses,
indistinguishable on screen.

The ruling resolves normalisation by removing the question: **non-ASCII is rejected
outright, so NFC and NFD are both invalid and no normalisation step exists anywhere.**
Implementations MUST NOT call `normalize()` / `unicodedata.normalize()` — a normalising
implementation would accept input a non-normalising one rejects, which is the same class
of bug one level down.

Rationale: `d` is a machine identity key. It appears inside `a` addresses, inside item
`d` values, inside relay filter strings and inside URLs. Human-facing text belongs in
`title`, which is unrestricted (vector `buildCollection/unicode-title`). Lowercase-only
removes case-collision ambiguity; the 64-character ceiling bounds the `a` address.

Error code: `DATASET_GRAMMAR`.

Vectors: `validation` cases `dataset-*` (13 of them, including `dataset-nfc` and
`dataset-nfd` as distinct inputs with the same verdict).

### 3.2 Ruling — `:` is illegal in a dataset name, and `d` must contain exactly one

This is the split-direction question. `parse_item_d` partitioned on the **first** `:`;
`parseItemD` used `lastIndexOf`, the **last**. They disagreed on 6 of 14 probe inputs —
`"a:b:14/1/1"` gave `{dataset:'a:b', …}` in TypeScript and `None` in Python.

Ruling: **a well-formed item `d` contains exactly one `:`. Any other count is rejected.**
The split direction then has no observable consequence, which is the point — a rule whose
correctness depends on which end you count from is a rule waiting to diverge again.

Both `"a:b:14/1/1"` and `"terrain:v2:14/1/1"` are now `null` in both languages. A
publisher who wants a versioned name uses `terrain-v2` or `terrain.v2`, both of which are
legal (vectors `parseItemD` rows 4–5).

---

## 4. Canonical number serialisation

This is the rule that broke version 1 hardest, so it is specified as an algorithm rather
than as a reference to either language's printer.

**The failure it replaces:** Python `repr` switches to exponent notation below 1e-4;
JavaScript `String()` switches below 1e-6. Tile z22/2097152/2097151 produced
`{"bbox":[0,0,0.000086,…]}` in TypeScript and `{"bbox":[0,0,8.6e-05,…]}` in Python —
different content strings, therefore **different event ids for one addressable event**.
Below 1e-6 the TypeScript `canonicalJson` *threw* while Python happily emitted `1e-07`.
The window `1e-6 ≤ |x| < 1e-4` was silently wrong in both directions and is reachable
from arbitrary caller data in `properties`.

### 4.1 `canonicalNumber(v) -> string`

Defined for every finite IEEE-754 double.

1. If `v` is not a finite number → **reject** `NUMBER_NOT_FINITE`. (NaN, +∞, −∞ have no
   JSON form. `JSON.stringify` would write `null`; `json.dumps` would write `NaN`. Both
   are wrong.)
2. Obtain the **shortest round-trip decimal** of `v`: the digit string that reparses to
   the identical double and has no shorter equivalent. JavaScript `String(v)` and Python
   `repr(v)` both produce exactly these digits — they agree on *digits* and disagree only
   on *notation*. This step is therefore free in both languages.
3. Decompose that literal into `(sign, digits, exp)` such that
   `|v| = 0.digits × 10^exp`, with leading and trailing zeros of `digits` stripped.
4. Render **positionally**, never in exponent notation:
   - `exp ≤ 0` → `"0." + "0"×(−exp) + digits`
   - `exp ≥ len(digits)` → `digits + "0"×(exp − len(digits))`
   - otherwise → `digits[:exp] + "." + digits[exp:]`
5. Strip trailing fractional zeros and a trailing `.`. Normalise `"-0"` and `"0"` to
   `"0"`.

Python one-liner: `format(Decimal(repr(v)), 'f')` plus step 5. JavaScript: string surgery
on `String(v)`, no library — see `canonicalNumber` in the vector generator's Node twin.

Consequences, all pinned as vectors:

- `1e300` → `1` followed by 300 zeros. `1e-300` → `0.` + 299 zeros + `1`. `5e-324` (the
  smallest subnormal) → 324 fractional digits. Long, deterministic, and JSON-legal.
- Note that step 2 uses the *shortest* digits, **not** the exact binary value. The double
  `1e300` is exactly a 301-digit integer that is not `1` followed by 300 zeros; the
  shortest round-trip rule is what makes both languages produce the same one of those.
- `412.0` and `412` are indistinguishable — no `_jsonable` integral-narrowing pass is
  needed, the rule subsumes it.
- `-0.0` → `"0"`.

Verified by differential fuzz: 17,602 values — 4,000 uniform random 64-bit patterns plus
dyadic tie families plus geographic-scale samples — Python and JavaScript agreed on every
one.

### 4.2 `canonicalCoordinate(v) -> string`

Coordinates carry an extra quantisation step. 10⁻⁶ ° ≈ 11 cm, far finer than any DEM
here, and it keeps bbox strings short and stable against float drift.

1. Reject non-finite → `NUMBER_NOT_FINITE`.
2. Take the shortest round-trip decimal (§4.1 step 2) and interpret it **exactly**.
3. Quantise to 6 fractional digits with **ROUND_HALF_EVEN**.
4. Render positionally, strip trailing zeros, normalise `-0` → `0`.

**Ruling — round-half-even, and `Number.prototype.toFixed` MUST NOT be used.** This is a
real divergence, not a theoretical one. ECMAScript specifies `toFixed` as: pick the `n`
minimising `|n/10^f − x|`, and *on a tie pick the larger n* — round-half-up. Python's
`round()` and `Decimal.quantize` default to half-even. Exact 6-dp ties are reachable:
any double whose exact value is `(2k+1)/(2·10⁶)` in lowest terms, e.g. `0.0078125`
(= 7812.5 × 10⁻⁶). `(0.0078125).toFixed(6)` gives `"0.007813"`; `round(0.0078125, 6)`
gives `0.007812`. Half-even wins because it is the IEEE-754 default, it is what every
decimal library does without being asked, and it is unbiased.

Quantising the *shortest decimal* rather than the *exact binary value* is deliberate: it
means neither side needs exact binary expansion, and it is what `Decimal(repr(v))` does
natively in Python and what BigInt string arithmetic does trivially in JavaScript.

Vectors: `numberFormat.canonicalCoordinate` — four exact ties rounding down, up, down, up
(`0.0078125`, `0.0234375`, `0.0390625`, `0.0546875`), plus `1.5e-6`, `±5e-7`,
`5.000001e-7`, and the two z22 window values.

**Sub-1e-6 coordinates.** At `MAX_TILE_ZOOM = 22` the narrowest tile spans 8.583 × 10⁻⁵ °,
so a *bbox* coordinate can never land strictly between 0 and 10⁻⁶ — it either lands in
the 1e-6…1e-4 window (vector `buildItem/z22-equator-north-of-prime-meridian`) or is
exactly 0. The sub-1e-6 regime is reachable only through `properties`, which are **not**
quantised, and is pinned by `buildItem/sub-micro-properties` — every value in it made the
old TypeScript `canonicalJson` throw.

### 4.3 Ruling — the number domain of `properties`

`canonicalNumber` is total over finite doubles, but the **property gate** is narrower: a
number appearing in `properties` MUST satisfy `|v| ≤ 2^53 − 1` (`MAX_SAFE_INTEGER`).
Error `PROPERTY_NUMBER_RANGE`.

Magnitude, not integrality, is the test — `1e-300` is fine, `1e300` and
`9007199254740992` are not. Rationale: values beyond the safe-integer range do not
round-trip through every JSON consumer in the chain (a Python `int` of 2^60 cannot be
represented in JavaScript at all), and no per-tile fact needs them. `canonicalNumber`
still *defines* an output for `1e300` so that the serialiser is total and testable; the
gate is what stops it reaching the wire.

---

## 5. Canonical JSON — the `content` of an item

```
content = canonicalJson({ bbox, datetime, properties })
```

- **Key order: sorted ascending.** Top level is therefore always `bbox`, `datetime`,
  `properties`, and nested objects sort the same way.
- Separators are `,` and `:` with no whitespace.
- Strings use minimal JSON escaping: `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, and
  `\u00XX` for the remaining C0 controls. Everything else is emitted raw as UTF-8.
  This is exactly what `JSON.stringify` and `json.dumps(…, ensure_ascii=False)` both do
  — including leaving U+2028 and U+2029 unescaped. Pinned by the `escapes` and
  `separators` properties of `buildItem/sub-micro-properties`.
- Numbers use `canonicalNumber` (§4.1); `bbox` entries use `canonicalCoordinate` (§4.2)
  and appear as JSON numbers whose text is that exact string. The bbox tag on a
  collection and the bbox numbers in an item's content therefore share one formatter.

### 5.1 Ruling — `properties` keys are ASCII

```
propertyKey := [A-Za-z0-9_] [A-Za-z0-9_.-]*
```

Error `PROPERTY_KEY_GRAMMAR`. JavaScript sorts strings by **UTF-16 code unit** and Python
by **code point**; these orders differ for astral-plane characters, because surrogates
(U+D800–DFFF) sort *below* U+E000–FFFF as code units but *above* them as code points. A
single emoji key would reorder the object and change the event id. Restricting keys to
ASCII makes the two orders provably identical, which is cheaper and more honest than
mandating a UTF-8-byte comparator neither language provides natively.

Vectors: `properties-key-non-ascii`, `properties-key-astral`, `properties-key-with-space`,
`properties-key-empty`.

### 5.2 Ruling — strings must be well-formed Unicode, in `content` **and in tags**

Lone surrogates are rejected (`STRING_NOT_SCALAR`). JavaScript would escape them as
`\udXXX`; Python cannot hold them without `surrogatepass` and cannot encode them to UTF-8
at all.

**This is not only a `content` rule.** Version 2 gated `content` and `properties` in both
languages and gated **tag values in neither**, so the two implementations *agreed* on
producing an event that cannot be UTF-8 encoded: `json.dumps(event).encode("utf-8")`
raises `UnicodeEncodeError`, so Python could build such an event and never send it, while
TypeScript sent one and every Python consumer choked on receipt. Two implementations
agreeing on an unsendable event is not convergence — it is one bug written twice, and no
differential comparison can see it. See §7.4 and the invariant in §15.

---

## 6. Tag order

Tag order is part of the event id. It is **fixed**, and both events carry exactly seven
tags.

**Collection (30550):**

```
["d", <dataset>]
["title", <title>]
["bbox", <w>, <s>, <e>, <n>]        # canonicalCoordinate, 4 values
["m", <mimeType>]
["license", <license>]
["source", <source>]
["server", <server>]
```

**Item (30551):**

```
["d", "<dataset>:<z>/<x>/<y>"]
["g", <geohash at GEOHASH_PRECISION, of the tile CENTRE>]
["a", "<KIND_GEO_COLLECTION>:<pubkey>:<dataset>"]
["x", <sha256>]
["url", <url>]
["m", <mimeType>]
["size", <decimal integer as a string>]
```

`content` for a collection is the description **verbatim** — a raw string, never JSON.
`content` for an item is §5.

### 6.1 The `g` tag is the tile CENTRE, always

A tile's west edge lands exactly on a p4 geohash boundary every 16 tiles — both grids are
power-of-two subdivisions of [−180, 180] anchored at −180. Geohash cells are half-open
`[min, max)`, so a corner or an edge sits exactly on the encoder's boundary for one tile
in sixteen, systematically and reproducibly. A centre never can: `x + 0.5` is never a
multiple of 16, and the latitude centre is a transcendental function of the row index.

---

## 7. Field validation

Both implementations MUST accept and reject identically. Python's `build_item` performed
**no validation at all** in version 1: `sha256='nothex'`, `size=0`, `size=-5`,
`size=1.5`, `datetime='yesterday'`, `url=''`, `created_at=-1`, `z=25`, `pubkey='short'`
and whitespace datasets were all accepted by Python and all threw in TypeScript.

| Field | Rule | Code |
|---|---|---|
| `dataset` | §3.1 | `DATASET_GRAMMAR` |
| `pubkey`, `sha256` | `^[0-9a-f]{64}$` — lowercase hex only, never bech32 | `HEX64` |
| `title` | non-empty, no leading/trailing protocol whitespace (§7.3) | `TEXT_EMPTY` |
| `license`, `source`, `server` | non-empty, no leading/trailing protocol whitespace (§7.3) | `TEXT_EMPTY` |
| `description` | any Unicode, possibly empty; absent means `""` (§7.5) | `TEXT_EMPTY` |
| every tag value and `content` | well-formed Unicode (§5.2, §7.4) | `STRING_NOT_SCALAR` |
| `mimeType` | `^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$` — bare `type/subtype`, no parameters | `MIME_GRAMMAR` |
| `url` | `http://` or `https://`, a non-empty remainder, and no protocol whitespace anywhere (§7.3) | `URL_GRAMMAR` |
| `size` | integer-valued, `1 ≤ size ≤ 2^53 − 1` | `SIZE_RANGE` |
| `tile.z` | integer-valued, `0 ≤ z ≤ 22` | `TILE_ZOOM_RANGE` |
| `tile.x`, `tile.y` | integer-valued, `0 ≤ v < 2^z` | `TILE_XY_RANGE` |
| `datetime` | §8 | `DATETIME_*` |
| `createdAt` | §9 | `CREATED_AT_RANGE` |
| `properties` | §5.1, §5.2, §4.3 | `PROPERTY_*` |
| `bbox` (collection) | §10 | `BBOX_*` |

### 7.1 Ruling — integrality is a test on the VALUE, not on the type

`{z: 14.0, x: 8593.0, y: 5677.0}` MUST produce the same event as `{z: 14, x: 8593, y:
5677}`. JavaScript cannot tell the two apart at all (`Number.isInteger(14.0) === true`),
so any rule that rejects the float form is unimplementable there. Python MUST coerce to
`int` before formatting — naive f-string interpolation writes
`"terrain:14.0/8593.0/5677.0"`, which is a different `d`, a different address and a
different event.

This is not hypothetical: the reference generator for this contract made exactly that
mistake, and the vector caught it. Vector `buildItem/integral-float-tile`.

### 7.2 Ruling — `buildItem` DERIVES the bbox; there is no `bbox` parameter

Python's `build_item` took a caller-supplied `bbox` while TypeScript's `buildItem`
derived it from the tile via `tileBBox`. Python could therefore publish an item whose
`content.bbox` contradicted its own `d` and `g` tags, with no error.

The conformance test that was supposed to catch this was **circular**: it read the
expected bbox out of the fixture (`test_geo_protocol.py:339`) and passed it straight back
into `build_item` (`:346`), asserting the fixture equalled itself.

**The `bbox` parameter is removed from `build_item`.** The bbox is a function of the
tile; accepting it as input is accepting a contradiction as input.

### 7.3 Ruling — the whitespace set is stated as codepoints, and it is a UNION

**No rule in this contract may be written with `\s`, `\S`, `\d`, `\w` or any other
character class whose membership differs between JavaScript and Python, and no rule may
be expressed as `trim` / `strip`.** Those five constructs are one bug family, and it is
the family that produced 18 verified divergences.

The two disagreements, both verified by execution:

- **`\d`.** JavaScript's is **ASCII-only**; Python's is **Unicode-aware** (category Nd).
  So Python accepted `٢٠٢٦-٠١-٠١T٠٠:٠٠:٠٠Z` (Arabic-Indic), `२०२६-०१-०१T००:००:००Z`
  (Devanagari), fullwidth digits and mixed-script forms, echoed them **verbatim into
  `content`**, and passed its own calendar checks too because `int()` parses them — while
  TypeScript threw `DATETIME_GRAMMAR`. **Every `\d` in this protocol is written `[0-9]`.**
- **`\s`.** JavaScript's contains **U+FEFF** and *not* U+0085 or U+001C–U+001F; Python's
  is the exact opposite. Acceptance therefore **reversed per character**: `https://x/﻿`
  was rejected by TypeScript and accepted by Python, `https://x/…U+0085` the other way
  round. `String.prototype.trim` and `str.strip` inherit exactly the same disagreement.

The protocol whitespace set is the **union** of both languages' sets:

```
U+0009 U+000A U+000B U+000C U+000D
U+001C U+001D U+001E U+001F
U+0020 U+0085 U+00A0 U+1680
U+2000 U+2001 U+2002 U+2003 U+2004 U+2005 U+2006 U+2007 U+2008 U+2009 U+200A
U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
```

Thirty codepoints, every one of them BMP and none of them a surrogate — so scanning
UTF-16 code units in JavaScript and scanning characters in Python examine the same set.
Both implementations MUST export it (`PROTOCOL_WHITESPACE`), and the vector file states
it independently so neither export can drift from the contract.

**Union, not intersection**, by the rule of construction: a character that is whitespace
to *either* reader makes a value that looks trimmed to one and untrimmed to the other,
which is exactly the input worth refusing. U+200B (zero-width space) and U+180E are
whitespace to *neither* language and are therefore **accepted** — the boundary is pinned
in both directions (`title-leading-zero-width-space`,
`title-trailing-mongolian-vowel-separator`, `url-interior-zero-width-space`).

Where the set applies:

- `title`, `license`, `source`, `server` — the **first** and **last** codepoint MUST NOT
  be in the set. This is an EDGE rule only; the interior is unrestricted
  (`title-interior-bom`).
- `url` — **no** codepoint may be in the set, anywhere.

### 7.4 Ruling — the order of checks *within* one string field

Every string field is checked in exactly this order:

1. **type** — not a string → that field's own code (`TEXT_EMPTY` for text and
   `description`, `URL_GRAMMAR` for `url`, and so on).
2. **well-formedness** — a lone surrogate → `STRING_NOT_SCALAR` (§5.2).
3. **grammar** — emptiness, whitespace edges, scheme, pattern.

Well-formedness precedes everything after the type check because it is a precondition of
the event **existing**: a value that cannot be UTF-8 encoded is not a tag value at all.
So `" \ud800"` as a title is `STRING_NOT_SCALAR`, not `TEXT_EMPTY`, and
`"ftp://…\ud800"` is `STRING_NOT_SCALAR`, not `URL_GRAMMAR`. Vectors
`order-scalar-before-trim`, `order-url-scalar-before-grammar`.

Fields whose grammar is **ASCII-only** — `dataset`, `mimeType`, `pubkey`, `sha256`,
property keys — enforce well-formedness implicitly and report their **own** grammar code;
a surrogate cannot pass an ASCII pattern. Vector `dataset-lone-surrogate` →
`DATASET_GRAMMAR`.

Non-string `description` is `TEXT_EMPTY`, never `STRING_NOT_SCALAR`. Python used to raise
the latter, which made one code mean two things depending on which language you asked.
`STRING_NOT_SCALAR` means *this string is not Unicode*, and nothing else.

### 7.5 Ruling — `undefined`, `null` and `None` are all ABSENT, and absent is the empty value

| field | absent means | required? |
|---|---|---|
| `properties` | `{}` | optional |
| `description` | `""` | optional |
| `datetime` | — | **required**, absent → `DATETIME_REQUIRED` (§8.1) |

TypeScript defaulted `properties` only on `undefined`, so an explicit `null` fell through
to `assertProperties` and was **rejected**, while Python mapped `None` to `{}` and built
the event. This is the most reachable divergence in the whole family: `None` is the
ordinary Python sentinel for an absent bag, so the crawler hits it on the first tile with
no per-tile facts. Symmetrically, `description` was optional in Python (`str = ""`) and
required in TypeScript, so the same call was valid there and a type error here.

The ruling is that **the protocol does not depend on a distinction Python cannot
express.** A keyword default of `None` is the Python idiom for "not supplied"; there is
no third state. This is the same reasoning as §7.1 — integrality is a test on the value,
not the type, because JavaScript cannot tell `14` from `14.0` — applied one level up.

`datetime` is the deliberate exception and stays required, because defaulting it would
fabricate provenance rather than supply an empty value (§8.1). An explicit `null`
datetime is `DATETIME_REQUIRED` in both languages.

Vectors: `properties-explicit-null`, `description-explicit-null`, `description-absent`,
`datetime-explicit-null`, `properties-array`, `description-not-a-string`.

---

## 8. `datetime`

### 8.1 Ruling — REQUIRED, in both languages. No default.

TypeScript required it. Python defaulted to `iso_datetime(created_at)`. The fixture
masked the difference by coincidence: `createdAt = 1767225600` renders to exactly the
declared `"2026-01-01T00:00:00Z"`.

`datetime` is the **acquisition / survey instant** — a property of the data. `created_at`
is the **publish instant** — a property of the act of publishing. Silently equating them
fabricates provenance: a 2019 DEM republished today would claim to have been surveyed
today, and nothing downstream could tell.

### 8.2 Grammar

```
^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$   -> DATETIME_GRAMMAR
```

`[0-9]`, **never `\d`** — see §7.3. Vectors `datetime-arabic-indic-digits`,
`datetime-devanagari-digits`, `datetime-fullwidth-digits`,
`datetime-mixed-script-digits`, `datetime-arabic-indic-fraction`,
`datetime-arabic-indic-year`, `datetime-superscript-digits`.

UTC `Z` only — no numeric offsets, so the string sorts lexicographically and needs no
timezone library to compare. Fractional seconds, 1–9 digits, are preserved **verbatim**;
the value is echoed into `content`, never reformatted.

The components MUST additionally be a real calendar instant (`DATETIME_CALENDAR`): month
01–12, day valid for that month with the full Gregorian leap rule, hour 00–23, minute and
second 00–59. Second 60 is rejected — no unix second maps to a leap second, so accepting
one would guarantee a lossy round-trip.

Vectors: 12 `datetime-*` cases, including `2024-02-29` accepted, `2100-02-29` rejected,
`2026-02-30` rejected, `2016-12-31T23:59:60Z` rejected.

---

## 9. `created_at` and monotonicity

### 9.1 Range

Integer-valued, `0 ≤ created_at ≤ 2147483647` (`MAX_CREATED_AT`).

The upper bound is a **deliberate millisecond trap**. Passing `Date.now()` unscaled is
the single most common timestamp bug, and `1767225600000` is comfortably over 2³¹−1, so
it fails loudly instead of publishing an event dated year 57 000 that no later event can
ever supersede. Vector `created-at-milliseconds`.

### 9.2 Ruling — monotonicity is enforced in the publisher, via one mandated helper

`docs/ARCHITECTURE.md:138` already mandates: *derive it monotonically per (source, d)
from the publisher clock, never from the upstream record.* Version 1 had no guard at all.
A clock that skews forward once writes a head that can never be superseded, and the
publisher still sees `OK` from the relay.

Builders are pure functions and hold no clock, so they cannot enforce this. Instead both
implementations MUST expose:

```
nextCreatedAt(lastPublished | null, nowSeconds) = max(nowSeconds, lastPublished + 1)
```

and publishers MUST derive `created_at` for an addressable event from it, keeping a
per-`(kind, pubkey, d)` high-water mark. If the result exceeds `MAX_CREATED_AT`, reject
`CREATED_AT_RANGE` rather than wrap. Vectors: `createdAtMonotonicity.cases`.

### 9.3 Supersession and the tie-break

The head of an address is the event with the **highest `created_at`**; on a tie, the one
with the **lowest event id**. NIP-01 leaves the tie unspecified, which means two clients
can legitimately disagree about which of two same-second events is current. This protocol
does not leave it unspecified. Vectors: `supersession.cases`.

---

## 10. Bounding boxes

### 10.1 Ruling — the degenerate case splits by role

`west == east` was accepted by TypeScript's `buildCollection` and rejected by Python's
`BBox` dataclass. Neither blanket answer is right, because the two uses are different:

- **Collection extent** — `west < east` **and** `south < north`, checked **after**
  quantisation to 6 dp. Error `BBOX_DEGENERATE`. A dataset with zero width holds no
  tiles and cannot be covered; it is an input bug every time. Checking after quantisation
  guarantees the emitted tag is itself valid on read-back — an extent narrower than
  11 cm collapses to a point and is refused rather than published as `["bbox","0","0","0","0"]`.
  Vectors `bbox-degenerate-width`, `bbox-degenerate-height`,
  `bbox-degenerate-after-rounding`; `minimum-extent` is the narrowest accepted case.
- **Viewport / covering** — `west ≤ east` and `south ≤ north`. A degenerate viewport is a
  legitimate **point query** and returns the single cell containing the point. Vectors
  `geohash.cover/point`, `filters.nearby/degenerate-point-viewport`.

Consequence: the covering functions take a plain `(west, south, east, north)` tuple, not
Python's `BBox` dataclass, whose constructor forbids degenerate boxes. Coupling the
protocol layer to that dataclass is what made the point query inexpressible in Python.

### 10.2 Antimeridian and range

`west > east` is **rejected** everywhere (`BBOX_ANTIMERIDIAN`), never wrapped. A silent
wrap enumerates the entire globe *minus* the viewport. The caller splits into
`[170,-10,180,10]` and `[-180,-10,-170,10]`; the two halves share no cell, so their union
is an exact cover of the seam (vectors `antimeridian-west-half`, `antimeridian-east-half`).

`south > north` → `BBOX_INVERTED`. Coordinates outside `[-180,180] × [-90,90]` →
`BBOX_OUT_OF_RANGE`. Non-finite, or **not a number at all**, → `BBOX_NOT_FINITE`: a
coordinate must already *be* a number, because `float(True)` is `1.0` and `float("9.5")`
is `9.5` in Python while `Number.isFinite` refuses both. Vectors
`bbox-boolean-coordinate`, `bbox-string-coordinate`.

**Ruling — each coordinate's own domain is checked before any relation between
coordinates.** Order: `BBOX_NOT_FINITE` → `BBOX_OUT_OF_RANGE` → `BBOX_ANTIMERIDIAN` →
`BBOX_INVERTED` → `BBOX_DEGENERATE`. A value outside `[-180,180]` is not a longitude, so
`west > east` says nothing about it: `[200,0,100,10]` is `BBOX_OUT_OF_RANGE` and never
`BBOX_ANTIMERIDIAN`. TypeScript answered the latter and Python the former, and §14 makes
the code normative, so that was a contract violation rather than a cosmetic difference.
Vectors `order-bbox-finite-before-range`, `order-bbox-range-before-antimeridian`,
`order-bbox-range-before-inverted`, `order-bbox-antimeridian-before-inverted`.

**Ruling — reject, do not clamp.** Version 1 clamped out-of-range coordinates into the
grid, which turns a caller bug into a plausible-looking wrong answer. Clamping survives
only *inside* the range check, for the exact-boundary case `lon = 180` / `lat = 90`,
which must land in the last cell because half-open cells have nothing above them.

---

## 11. Geohash

### 11.1 Encoder

Standard base-32 geohash over `0123456789bcdefghjkmnpqrstuvwxyz`, longitude bit first,
cells **half-open** `[min, max)` — a coordinate exactly on a division belongs to the cell
*above* it (`>=`, not `>`). Precision must be an integer in 1…12
(`GEOHASH_PRECISION_RANGE`); lat/lon must be in range (`LATLON_RANGE`).

Reference vector: `encode(57.64911, 10.40744, 11) === "u4pruydqqvj"`.

### 11.2 Covering is exact, and its order is normative

At a fixed precision the geohash grid is a perfectly regular lon/lat lattice (1024 × 1024
at p4), so a cover is integer index arithmetic: floor the bbox edges into indices and
enumerate the closed range. It is a **complete cover, not a sample**. Corner sampling —
the shape this replaces — misses ~92 % of the cells a multi-degree viewport needs,
because every interior column is invisible to it, with no error anywhere. Vector
`geohash.cover/wider-than-one-cell` is 30 cells that corner sampling would report as 4.

**Order: longitude outer (west → east), latitude inner (south → north).** The order is
part of the contract because the filter built from it is compared as a whole.

Clamping is to the **geohash** domain (±180 / ±90), *not* to the Mercator cut-off:
presence and geo-notes exist above 85.05 ° even though tiles do not, and the extra rows
simply return empty. Vector `geohash.cover/polar-above-mercator`.

Reference counts (p4): Austria 352, the Alps 864, continental Europe **43 617**, the
Mercator band 991 232, the full ±90 world 1 048 576.

---

## 12. Filters

### 12.1 Ruling — one limit constant, `DEFAULT_FILTER_LIMIT = 500`, everywhere

Version 1 had three different defaults: TypeScript `catalog()` 500, Python
`collection_filter` 200, TypeScript `exactTile()` 1. All three become 500.

500 is strfry's default `maxFilterLimit`. Asking for more is **silently clamped**, so a
full page is a truncation signal rather than a complete answer — which is why
`limit > 500` is **rejected** (`FILTER_LIMIT_RANGE`) rather than clamped. Valid range is
`1 ≤ limit ≤ 500`, integer.

`exactTile` gets 500 rather than 1 for a concrete reason: addressable identity is
`(kind, pubkey, d)`, so several publishers can legitimately hold the same `d`. NIP-01
only says a relay SHOULD return the most recent events, and "most recent" across several
pubkeys is not "the most recent from each" — `limit: 1` silently hides every publisher
but one. Callers who want a single publisher pass `authors`.

### 12.2 The three builders

```
catalog({ authors?, limit? })      -> { kinds:[30550], authors?, limit }
nearby(bbox, { collection?, maxCells?, limit? })
                                   -> { kinds:[30551], "#g":[…], "#a"?:[…], limit } | null
exactTile(dataset, tile, { authors?, limit? })
                                   -> { kinds:[30551], authors?, "#d":[…], limit }
```

Key order as shown: `kinds`, `authors`, `#d`, `#g`, `#a`, `limit`. (Not significant on the
wire; fixed so vectors and diffs are stable.)

`nearby` returns **`null`, not an error**, when the cover exceeds `maxCells`
(`MAX_COVER_CELLS = 128`). That is a **routing signal**: the caller falls back to
`catalog()` and renders from the collection layer, rather than sending a filter the relay
will drop. 128 p4 cells is a 2.81 ° square — about 210 km east–west at 48 N.

Tag-key budget: `#g` plus an optional `#a` is two keys, and strfry's default
`maxTagsPerFilter` is 3. There is room for exactly one more dimension before relays start
refusing outright.

**`exactTile` MUST exist in Python too** — version 1 had no counterpart, which is how a
TypeScript-only code path stops being tested at all. The bbox-or-cell-list overload of
`nearby` is **removed**: one signature, one behaviour, no per-language convenience.

---

## 13. The social geohash ladder — NOT this precision rule

**Scope note.** Everything above governs kinds 30550 and 30551. The social kinds —
**1** (notes), **1063** (NIP-94 file metadata), **30315** (NIP-38 presence), **31923**
(NIP-52 calendar) — are governed by the opposite rule and MUST carry a **ladder** of `g`
tags: every prefix of the precision-6 geohash, shortest first, precisions 1…6.

Version 1 collapsed *every* event to a single precision-4 `g` tag. That broke live
presence and the geo-note feed outright, because nostr tag filters are **exact string
matches** and `apps/napplet/src/nostr/presence.ts` queries precision 5 (line 175) and
precisions 2/3/4 by viewport span (`cellsFor`, lines 205–214). A 5-character query can
never match a 4-character tag. `presence.ts` has no test file anywhere in
`apps/napplet/tests`, which is why it shipped green.

The arithmetic, for the record:

```
p4 cell = 20 bits = 10 lon + 10 lat = 0.3515625 x 0.17578125 deg
        = 39.1 x 19.4 km at the equator, 27.7 x 19.5 km at 45N, 19.6 x 19.6 km at 60N
cells to cover continental Europe (-25,34,45,72) = 201 x 217 = 43,617
cells to cover the world                          = 1,048,576
cellsFor() caps at 48 cells                       -> 0.1% coverage, silently
```

A single p4 tag cannot serve a continental view, and it is not supposed to: sparse global
proximity search is exactly what NIP-CC's multi-precision convention exists for. The
dataset layer gets one tag because a survey-zoom viewport is a handful of cells and
~208 z14 tiles per cell at 48 N is one workable relay page; the social layer gets the
ladder because its queries span continents.

Also normative for `build_announcement` (kind 1063) in `nostr_geo.py`, which currently
violates two rules: it emits `["bbox", str(...)]` with bare `str()` — exponent notation
in a nostr tag — and a `["tile","z/x/y"]` tag that the item `d` subsumes. Coordinates
MUST use `canonicalCoordinate`; the `tile` tag MUST go.

Vector: `socialGeohashLadder.example`.

---

## 14. Error codes

The **code** is normative; the message is free.

```
NUMBER_NOT_FINITE      PROPERTY_NUMBER_RANGE   PROPERTY_KEY_GRAMMAR   STRING_NOT_SCALAR
DATASET_GRAMMAR        TEXT_EMPTY              MIME_GRAMMAR           URL_GRAMMAR
HEX64                  SIZE_RANGE              CREATED_AT_RANGE
TILE_ZOOM_RANGE        TILE_XY_RANGE           TILE_NOT_INTEGER
DATETIME_REQUIRED      DATETIME_GRAMMAR        DATETIME_CALENDAR
BBOX_NOT_FINITE        BBOX_ANTIMERIDIAN       BBOX_INVERTED
BBOX_OUT_OF_RANGE      BBOX_DEGENERATE
GEOHASH_PRECISION_RANGE  LATLON_RANGE          FILTER_LIMIT_RANGE
```

### 14.1 Ruling — the ORDER of validation is normative too

If the code is normative, then for an input with **two** defects the order in which fields
are checked decides which normative code the caller sees. Leaving it unspecified means a
publisher fixing the field its own language named is still rejected by the other, one
field at a time, with no way to tell how many rounds are left. Two implementations that
reject the same inputs but *name different fields* are not interoperable.

**Fields are validated in the order they are EMITTED:** `created_at`, then the tags in the
fixed tag order of §6, then `content`.

**Collection (30550):**

```
createdAt -> dataset -> title -> bbox -> mimeType -> license -> source -> server -> description
```

**Item (30551):**

```
createdAt -> dataset -> tile -> pubkey -> sha256 -> url -> mimeType -> size -> datetime -> properties
```

The item's `d` tag is `<dataset>:<z>/<x>/<y>`, which is why the dataset and the tile
precede the pubkey — the pubkey first appears in the `a` tag. Inside `content` the keys
sort `bbox`, `datetime`, `properties`, and `bbox` is derived, so `datetime` precedes
`properties`.

What this replaces: Python validated the extent **third** and TypeScript **last**; Python
validated the dataset before the pubkey and TypeScript the pubkey first, because it called
`collectionAddress` before anything else. Within one string field the order is §7.4;
within a bbox it is §10.2.

Every step of both sequences is pinned by an `order-*` vector carrying exactly two
defects. Reordering any two adjacent checks in either language turns one of them red.

---

## 15. Conformance

`packages/geo-protocol/tests/fixtures/geo-vectors.json` is the conformance suite. It
replaces `geo-protocol.json`, which pinned one sample — and a single sample fixes one
point in the input space and nothing else. All eleven drift findings of the last review
lived outside that one point, and the test that consumed it asserted the fixture equalled
itself.

Both suites MUST load the same file and MUST implement every section:

| Section | Vectors |
|---|---|
| `numberFormat.canonicalNumber` | 29 |
| `numberFormat.canonicalCoordinate` | 27 |
| `buildCollection` | 29 (5 events + 24 rejects) |
| `buildItem` | 9 events |
| `parseItemD` | 41 |
| `validation.cases` | 84 |
| `grammar.cases` | 67 |
| `grammar.whitespace` | 30 |
| `filters` | 20 |
| `geohash` | 52 |
| `supersession`, `createdAtMonotonicity` | 7 |

Conventions: `expect` is the exact expected output; `reject` is a §14 code.
`{"__number__": "<token>"}` denotes a numeric literal JSON cannot carry (`NaN`,
`Infinity`, `-Infinity`, `-0`) and MUST be substituted before use.
`validation.cases[].patch` overlays `validation.baseInput`; a patch value of `null` means
the key is **absent**, not null-valued. `{"__json__": "NULL"}` is the **explicit** null
§7.5 rules equivalent to it — the token exists so a vector can assert that rather than
assume it. `content` is compared as a **string**.

Lone surrogates travel as `{"__string__": "<token>"}` and **never** as a raw `\udXXX`
escape. The escape is legal JSON that both `JSON.parse` and `json.loads` decode, but the
bundler that inlines this file for the TypeScript suite refuses it outright, and a vector
one side cannot load pins nothing at all.

### 15.1 `grammar` — pinning the GRAMMAR, not the values

The rest of the suite pins **values**: given a good input, this exact event. That is
necessary and it is not sufficient, and the second review proved it — 4 critical and 14
major divergences, and nearly every one ended *"mutating this leaves BOTH suites green,
so nothing pins it."* A value suite cannot see a rule spelled with two different character
classes, because both spellings agree on every good input.

`grammar.cases` therefore pins the rules themselves, each case naming the builder it
patches (`validation.baseInput` for `item`, `grammar.collectionBaseInput` for
`collection`):

- **boundary characters** for every validator: U+FEFF, U+0085, U+001C–U+001F, U+00A0,
  U+3000, U+2028, the non-whitespace neighbours U+200B and U+180E, Arabic-Indic,
  Devanagari, fullwidth and superscript digits, combining marks, lone surrogates and a
  well-formed astral pair;
- **`order-*` cases**, each carrying exactly **two** defects, pinning which §14 code wins
  (§14.1, §10.2, §7.4);
- **absent / null / `None`** for `properties`, `description` and `datetime` (§7.5).

### 15.2 The encodability invariant

Both suites MUST assert, over **every** accepted vector, that the built event can be
UTF-8 encoded — in Python `json.dumps(event).encode("utf-8")`, in TypeScript a
pair-aware surrogate scan (`TextEncoder` is not usable as the oracle: it substitutes
U+FFFD instead of throwing, so it reports every event encodable).

This must be an invariant on the output rather than a differential comparison, because
the failure it guards against is one the two languages **agreed** on (§5.2). Nothing that
compares the two implementations to each other can ever see it.

### 15.1 CI

Version 1 had **no CI at all** — no `.github/` anywhere, and no script invoking pytest.
Nothing forced both toolchains to run together, which is exactly the latency that let the
TFT2 pin stay one-directional for months, and exactly why two suites could assert
`MAX_TILE_ZOOM = 22` and `MAX_TILE_ZOOM = 30` and both stay green.

A single CI job MUST run `pnpm -F @terrcvm/geo-protocol test:unit` **and**
`uv run pytest services/blossom-gis` on every push, and MUST fail if either side fails to
reproduce a vector. Two green suites that never run together are not evidence of
agreement.
