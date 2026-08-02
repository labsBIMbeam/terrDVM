"""The terrCVM geo protocol: one collection event, one item event, one spatial tag each.

This is the Python half of a two-language protocol. The other half is the
TypeScript in `packages/geo-protocol/src`. Both are governed by
`packages/geo-protocol/CONTRACT.md` and both must reproduce every vector in
`packages/geo-protocol/tests/fixtures/geo-vectors.json`. `content` is hashed
into the event id, so a one-character disagreement is a different event for one
addressable address — a silent split-brain, not a visible error.

The design maps onto STAC: the **collection** is the dataset (a Collection,
which has an *extent*), the **item** is one tile (an Item, which has a
*location*).

* The collection carries a `bbox` tag and *no* geohash. Collections are few, so
  clients fetch them wholesale and filter locally — which they must anyway,
  because `bbox` is not a single-letter tag and therefore is not indexed.
* The item carries exactly one `d` tag (the local spatial tag) and exactly one
  `g` tag (the global spatial tag). The exact bbox, the acquisition datetime and
  the per-tile properties travel in `content`, because relays do not index
  content and keeping it out of tags is what holds the spatial tag count at one.

Scope note: the single-`g`-tag rule governs kinds 30550/30551 and nothing else.
The social kinds (1, 1063, 30315, 31923) carry the multi-precision ladder — see
`nostr_geo.build_announcement` and CONTRACT.md section 13.

Events are returned **unsigned**. This service holds no private key; the caller
signs with their own signer (NIP-07/NIP-46) and publishes. That invariant does
not move.
"""

from __future__ import annotations

import json
import math
import re
from decimal import ROUND_HALF_EVEN, Context, Decimal
from typing import Any

from .geo import GEOHASH_ALPHABET
from .geo import geohash_encode as _bisect_geohash

# --- constants (CONTRACT.md section 2) -------------------------------------

#: The global event: one per dataset, addressable, replaceable head.
#:
#: 30550/30551 rather than the originally sketched 30450/30451. Nothing claims
#: either pair today, but 30450 sits directly on Marmot's growth path: it holds
#: consecutive low kinds 443-449 and MIP-00 established a 30000+N addressable
#: mirror (443 -> 30443), so its next free low slot, 450, would mirror to exactly
#: 30450. 30550/30551 sits mid-run in 30516..30616 — the largest empty stretch in
#: the addressable space — and low kinds 550/551 are themselves unclaimed, so no
#: 30000+N mirror can land on them either.
KIND_GEO_COLLECTION = 30550

#: The local event: one per tile, addressable.
KIND_GEO_ITEM = 30551

#: The single precision used for the item's `g` tag — the DATASET layer only.
#:
#: Chosen by EVENTS PER CELL, not by cell area. A precision-4 cell is 20 bits
#: (10 lon, 10 lat) = 0.3515625 x 0.17578125 degrees, ~39x19 km at the equator
#: and ~28x19.5 km at 45N. That holds ~128 z14 tiles at the equator and ~200-290
#: across Europe — one workable relay page. Precision 3 (1.40625 deg square)
#: would hold ~3300-4100 z14 tiles and silently truncate against strfry's
#: maxFilterLimit of 500.
GEOHASH_PRECISION = 4

#: A z22 tile is 9.55 m at the equator and still 86 coordinate-grid steps wide.
#: By z29 a tile is narrower than one 1e-6 step and two neighbouring items would
#: serialise an identical bbox, so the old Python ceiling of 30 could publish
#: events that cannot be told apart.
MAX_TILE_ZOOM = 22

#: Coordinates are quantised to six decimals (~11 cm) before serialisation.
COORDINATE_DECIMALS = 6

#: Separates the dataset from the tile inside an item `d`. Illegal in a dataset
#: name, and an item `d` must contain exactly one — which makes the split
#: direction unobservable rather than a thing the two languages can disagree on.
DATASET_SEPARATOR = ":"

#: Bounds the `a` address a dataset name ends up inside.
MAX_DATASET_LENGTH = 64

#: strfry's default `maxFilterLimit`. Asking for more is silently CLAMPED, so a
#: full page would be indistinguishable from a truncated one — which is why a
#: larger limit is rejected rather than clamped.
DEFAULT_FILTER_LIMIT = 500
MAX_FILTER_LIMIT = 500

#: Above this many cells the `#g` item query is refused and the caller falls back
#: to the collection layer. 128 cells is a 2.81-degree square viewport (~210 km
#: E-W at 48N). A Europe-wide viewport needs 43,617 cells; no relay accepts that.
MAX_COVER_CELLS = 128

#: 2^31-1, and a deliberate millisecond trap: `time.time() * 1000` lands far
#: above it and fails loudly instead of publishing a head no later event can
#: supersede.
MAX_CREATED_AT = 2147483647

#: 2^53-1. Beyond this a number does not round-trip through every JSON consumer
#: in the chain, so `properties` refuses it.
MAX_SAFE_INTEGER = 9007199254740991

#: Web Mercator latitude cut-off. Tiles stop here; presence and geo-notes do not.
MAX_MERCATOR_LATITUDE = 85.05112878


# --- errors (CONTRACT.md section 14) ----------------------------------------


class GeoProtocolError(ValueError):
    """A contract violation. The `code` is normative; the message is free."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


# --- canonical number serialisation (CONTRACT.md section 4) -----------------

#: Wide enough for the full double range (1e308 needs 309 integer digits plus
#: six fractional ones); `quantize` raises InvalidOperation without it.
_DECIMAL_CONTEXT = Context(prec=500)

#: One micro-degree, the coordinate quantum.
_COORDINATE_QUANTUM = Decimal(1).scaleb(-COORDINATE_DECIMALS)


def _strip(text: str) -> str:
    """Trim trailing fractional zeros and normalise '-0' to '0'."""
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def canonical_number(value: float) -> str:
    """Serialise a finite double positionally, never in exponent notation.

    Python `repr` switches to exponents below 1e-4 and JavaScript `String()`
    below 1e-6, so neither language's printer is usable directly. Both agree on
    the shortest round-trip *digits*; this renders those digits positionally, so
    1e-5 is `0.00001` and 1e300 is 1 followed by 300 zeros in both languages.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        return _strip(str(value))
    number = float(value)
    if not math.isfinite(number):
        raise GeoProtocolError("NUMBER_NOT_FINITE", f"{number!r} has no JSON form")
    return _strip(format(Decimal(repr(number)), "f"))


def canonical_coordinate(value: float) -> str:
    """Serialise a coordinate: six decimals, ROUND_HALF_EVEN, positional.

    `toFixed` is banned on the TypeScript side because ECMAScript specifies it
    as round-half-*up* while Python is half-even, and exact 6-dp ties such as
    0.0078125 are reachable. Half-even is the IEEE-754 default and unbiased.
    """
    number = float(value)
    if not math.isfinite(number):
        raise GeoProtocolError("NUMBER_NOT_FINITE", f"{number!r} has no JSON form")
    quantised = Decimal(repr(number)).quantize(
        _COORDINATE_QUANTUM, rounding=ROUND_HALF_EVEN, context=_DECIMAL_CONTEXT
    )
    return _strip(format(quantised, "f"))


def quantise_coordinate(value: float) -> float:
    """The quantised coordinate as a float, for the post-rounding degeneracy test."""
    return float(canonical_coordinate(value))


# --- canonical JSON (CONTRACT.md section 5) ---------------------------------

_PROPERTY_KEY = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*")


def assert_scalar_string(value: str, field: str = "string") -> None:
    """Raise unless `value` is a well-formed Unicode scalar sequence.

    CONTRACT.md sections 5.2 and 7.4. This is *not* only a `content` rule: it
    governs every string that reaches a TAG value too. Both languages used to
    gate content and neither gated tags, so both agreed on building an event
    that cannot be UTF-8 encoded — `json.dumps(event).encode("utf-8")` raises
    UnicodeEncodeError, so Python could build one and never send it while
    TypeScript sent one every Python consumer chokes on. Agreement on an
    unsendable event is not convergence.

    A Python `str` holds astral characters as single code points, so any code
    point in D800..DFFF is by definition an unpaired surrogate — the same set
    the TypeScript pair-aware scan rejects.
    """
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in value):
        raise GeoProtocolError("STRING_NOT_SCALAR", f"lone surrogate in {field}")


def _canonical_string(value: str) -> str:
    """JSON-escape a string exactly as both `JSON.stringify` and `json.dumps` do."""
    assert_scalar_string(value)
    return json.dumps(value, ensure_ascii=False)


def canonical_json(value: Any) -> str:
    """Serialise a JSON value with sorted keys, no whitespace and canonical numbers.

    Object keys sort ascending by code point, which is identical to JavaScript's
    UTF-16 code-unit order only because property keys are restricted to ASCII.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        _check_property_number(value)
        return canonical_number(value)
    if isinstance(value, str):
        return _canonical_string(value)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value):
            if not isinstance(key, str) or not _PROPERTY_KEY.fullmatch(key):
                raise GeoProtocolError("PROPERTY_KEY_GRAMMAR", f"illegal property key: {key!r}")
            parts.append(f"{_canonical_string(key)}:{canonical_json(value[key])}")
        return "{" + ",".join(parts) + "}"
    raise GeoProtocolError("PROPERTY_KEY_GRAMMAR", f"unserialisable value: {value!r}")


def _check_property_number(value: float) -> None:
    """Gate a number bound for `properties`: finite and inside the safe-integer range."""
    if isinstance(value, float) and not math.isfinite(value):
        raise GeoProtocolError("NUMBER_NOT_FINITE", f"{value!r} has no JSON form")
    if abs(value) > MAX_SAFE_INTEGER:
        raise GeoProtocolError(
            "PROPERTY_NUMBER_RANGE", "property numbers must satisfy |v| <= 2^53-1"
        )


# --- field validation (CONTRACT.md section 7) -------------------------------

#: The protocol whitespace set, CONTRACT.md section 7.3 — stated as code points
#: because neither language's ``\s`` nor either language's trim/strip is the
#: same set.
#:
#: Python's ``\s`` contains U+0085 and U+001C..U+001F and NOT U+FEFF;
#: JavaScript's ``\s`` is the exact opposite. So ``https://example/﻿`` was
#: accepted here and rejected there, and ``https://example/\x85`` was rejected
#: here and accepted there — acceptance reversed *per character*.
#: ``str.strip`` and ``String.prototype.trim`` inherit the same disagreement,
#: which is why `_validate_text` below does not call `strip`.
#:
#: The ruling is the UNION of both languages' sets: a character that is
#: whitespace to *either* language is whitespace to the protocol. Union rather
#: than intersection because the rule of construction is to make a bad event
#: inexpressible — a name that looks trimmed to one reader and untrimmed to the
#: other is exactly the input worth refusing.
PROTOCOL_WHITESPACE = frozenset(
    (
        0x0009,
        0x000A,
        0x000B,
        0x000C,
        0x000D,
        0x001C,
        0x001D,
        0x001E,
        0x001F,
        0x0020,
        0x0085,
        0x00A0,
        0x1680,
        0x2000,
        0x2001,
        0x2002,
        0x2003,
        0x2004,
        0x2005,
        0x2006,
        0x2007,
        0x2008,
        0x2009,
        0x200A,
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
        0xFEFF,
    )
)

#: Built from MAX_DATASET_LENGTH so the ceiling cannot drift from the grammar.
_DATASET = re.compile(rf"[a-z0-9](?:[a-z0-9._\-]{{0,{MAX_DATASET_LENGTH - 2}}}[a-z0-9])?")
_HEX64 = re.compile(r"[0-9a-f]{64}")
_MIME = re.compile(r"[a-z0-9][a-z0-9!#$&^_.+\-]*/[a-z0-9][a-z0-9!#$&^_.+\-]*")

#: RFC 3339, UTC `Z` only, 1..9 fractional digits.
#:
#: ``[0-9]``, never ``\d``: Python's ``\d`` is UNICODE-AWARE while JavaScript's
#: is ASCII-only, so this side used to accept ``٢٠٢٦-٠١-٠١T٠٠:٠٠:٠٠Z``
#: (Arabic-Indic), ``२०२६-०१-०१T००:००:००Z`` (Devanagari), fullwidth digits and
#: mixed-script forms, echo them verbatim into `content`, and pass the calendar
#: checks too because `int()` parses them — while TypeScript threw
#: DATETIME_GRAMMAR. An explicit class is the same regex in both languages.
_DATETIME = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?Z"
)
_UNSIGNED_INT = re.compile(r"0|[1-9][0-9]*")

_DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def is_protocol_whitespace(ch: str) -> bool:
    """True when `ch` is a member of the protocol whitespace set."""
    return ord(ch) in PROTOCOL_WHITESPACE


def validate_dataset(dataset: Any) -> str:
    """Check a dataset name against the grammar: 1-64 lowercase ASCII, no ':'.

    Non-ASCII is rejected outright, which is what removes the Unicode
    normalisation question: NFC and NFD spellings are both invalid, so no
    implementation may call `normalize()` and none can drift by not calling it.
    """
    if not isinstance(dataset, str) or not _DATASET.fullmatch(dataset):
        raise GeoProtocolError("DATASET_GRAMMAR", f"illegal dataset name: {dataset!r}")
    return dataset


def _validate_text(value: Any, field: str) -> str:
    """Check a free-text tag value: a string, well-formed, non-empty, no edge space.

    Three checks in a FIXED order (CONTRACT.md section 7.4): type, then Unicode
    well-formedness, then emptiness/slack. Well-formedness comes first because
    it is a precondition of the event existing at all — a lone surrogate cannot
    be UTF-8 encoded, so ``" \\ud800"`` is STRING_NOT_SCALAR, not TEXT_EMPTY.

    The slack test is *first or last code point is protocol whitespace*, not
    ``value.strip() != value``: `str.strip` and `String.prototype.trim` strip
    different sets (24 divergent inputs in the probe, across every text field
    and every position), so neither is usable as the rule.
    """
    if not isinstance(value, str):
        raise GeoProtocolError("TEXT_EMPTY", f"{field} must be a non-empty trimmed string")
    assert_scalar_string(value, field)
    if not value or is_protocol_whitespace(value[0]) or is_protocol_whitespace(value[-1]):
        raise GeoProtocolError(
            "TEXT_EMPTY", f"{field} must be non-empty with no leading or trailing space"
        )
    return value


def _validate_description(value: Any, field: str = "description") -> str:
    """Check a collection `content` string: any Unicode, possibly empty, encodable.

    Free text with *no* grammar, so the only checks left are that it is a string
    and that it can be encoded. The type failure reuses TEXT_EMPTY because
    section 14 defines no separate code; this side used to raise
    STRING_NOT_SCALAR, which then meant two different things depending on which
    language you asked.
    """
    if not isinstance(value, str):
        raise GeoProtocolError("TEXT_EMPTY", f"{field} must be a string")
    assert_scalar_string(value, field)
    return value


def _validate_hex64(value: Any, field: str) -> str:
    """Check a 64-character lowercase hex string (pubkey or sha256), never bech32."""
    if not isinstance(value, str) or not _HEX64.fullmatch(value):
        raise GeoProtocolError("HEX64", f"{field} must be 64 lowercase hex characters")
    return value


def _validate_mime(value: Any) -> str:
    """Check a bare `type/subtype` media type, no parameters."""
    if not isinstance(value, str) or not _MIME.fullmatch(value):
        raise GeoProtocolError("MIME_GRAMMAR", f"illegal media type: {value!r}")
    return value


def _validate_url(value: Any) -> str:
    """Check that the blob URL is fetchable by a browser client.

    Written structurally rather than as ``https?://\\S+`` because ``\\S`` is the
    character class the two languages disagree about (see PROTOCOL_WHITESPACE).
    Order, as everywhere: type, then well-formedness, then grammar — so
    ``ftp://...\\ud800`` is STRING_NOT_SCALAR, not URL_GRAMMAR.
    """
    if not isinstance(value, str):
        raise GeoProtocolError("URL_GRAMMAR", f"illegal url: {value!r}")
    assert_scalar_string(value, "url")
    scheme = 8 if value.startswith("https://") else 7 if value.startswith("http://") else -1
    if scheme < 0 or len(value) == scheme or any(is_protocol_whitespace(c) for c in value):
        raise GeoProtocolError("URL_GRAMMAR", f"illegal url: {value!r}")
    return value


def _as_integer(value: Any) -> int | None:
    """Coerce an integral number to `int`, or None if it is not integral.

    Integrality is a test on the VALUE, not on the type: 14.0 IS the integer 14,
    and JavaScript cannot tell the two apart, so rejecting the float form would
    be unimplementable there. Coercing is also what stops an f-string writing
    `terrain:14.0/8593.0/5677.0`.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return None


def _validate_size(value: Any) -> int:
    """Check the blob size: an integer in 1..2^53-1."""
    size = _as_integer(value)
    if size is None or not 1 <= size <= MAX_SAFE_INTEGER:
        raise GeoProtocolError("SIZE_RANGE", f"size must be an integer in 1..2^53-1: {value!r}")
    return size


def validate_created_at(value: Any) -> int:
    """Check a publish instant: an integer in 0..2^31-1."""
    created_at = _as_integer(value)
    if created_at is None or not 0 <= created_at <= MAX_CREATED_AT:
        raise GeoProtocolError(
            "CREATED_AT_RANGE", f"created_at must be an integer in 0..{MAX_CREATED_AT}"
        )
    return created_at


def validate_tile(z: Any, x: Any, y: Any) -> tuple[int, int, int]:
    """Check a slippy tile: integral z in 0..22 and x, y in 0..2^z-1."""
    zoom = _as_integer(z)
    if zoom is None or not 0 <= zoom <= MAX_TILE_ZOOM:
        raise GeoProtocolError("TILE_ZOOM_RANGE", f"zoom must be an integer in 0..{MAX_TILE_ZOOM}")
    span = 2**zoom
    column, row = _as_integer(x), _as_integer(y)
    if column is None or row is None or not (0 <= column < span and 0 <= row < span):
        raise GeoProtocolError("TILE_XY_RANGE", f"tile x/y out of range for z{zoom}")
    return (zoom, column, row)


def validate_datetime(value: Any) -> str:
    """Check an RFC 3339 UTC acquisition instant, and echo it back verbatim.

    Required, never defaulted from `created_at`: `datetime` is when the data was
    acquired and `created_at` is when it was published. Equating them fabricates
    provenance — a 2019 DEM republished today would claim to be surveyed today.
    """
    if value is None:
        raise GeoProtocolError("DATETIME_REQUIRED", "datetime is required")
    if not isinstance(value, str):
        raise GeoProtocolError("DATETIME_GRAMMAR", f"illegal datetime: {value!r}")
    match = _DATETIME.fullmatch(value)
    if match is None:
        raise GeoProtocolError("DATETIME_GRAMMAR", f"illegal datetime: {value!r}")
    year, month, day, hour, minute, second = (int(g) for g in match.groups()[:6])
    if not 1 <= month <= 12:
        raise GeoProtocolError("DATETIME_CALENDAR", f"month out of range: {value!r}")
    days = _DAYS_IN_MONTH[month - 1]
    if month == 2 and (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)):
        days = 29
    if not 1 <= day <= days:
        raise GeoProtocolError("DATETIME_CALENDAR", f"day out of range: {value!r}")
    if hour > 23 or minute > 59 or second > 59:
        raise GeoProtocolError("DATETIME_CALENDAR", f"time out of range: {value!r}")
    return value


def _validate_properties(properties: Any) -> dict[str, Any]:
    """Check the per-tile property bag, and default an absent one to empty.

    `None`, `undefined` and a missing key all mean ABSENT, and absent means
    ``{}`` (CONTRACT.md section 7.5). TypeScript used to default only on
    `undefined`, so an explicit `null` fell through to its `assertProperties`
    and was rejected while this side built the event — and `None` is the
    ordinary Python sentinel for an absent bag, so the crawler reaches it on the
    first tile with no per-tile facts. The distinction between "absent" and
    "null" is unrepresentable here (a keyword default of `None` is the idiom),
    so, exactly as section 7.1 rules for integrality, the protocol declines to
    depend on a difference one language cannot express.

    Keys, strings and number magnitudes are checked by `canonical_json` as it
    serialises, so there is exactly one traversal and no second rule to drift.
    """
    if properties is None:
        return {}
    if not isinstance(properties, dict):
        raise GeoProtocolError("PROPERTY_KEY_GRAMMAR", "properties must be an object")
    return properties


def _validate_limit(limit: Any) -> int:
    """Check a filter limit: an integer in 1..500, refused rather than clamped."""
    value = _as_integer(limit)
    if value is None or not 1 <= value <= MAX_FILTER_LIMIT:
        raise GeoProtocolError(
            "FILTER_LIMIT_RANGE", f"limit must be an integer in 1..{MAX_FILTER_LIMIT}"
        )
    return value


# --- bounding boxes (CONTRACT.md section 10) --------------------------------

Bounds = tuple[float, float, float, float]


def _validate_bounds(bbox: Any) -> Bounds:
    """Check a (west, south, east, north) tuple: finite, in range, not wrapped.

    A plain tuple, not `geo.BBox`, on purpose: that dataclass forbids degenerate
    boxes in its constructor, which makes a point query inexpressible.
    """
    try:
        values = tuple(bbox)
    except TypeError:
        raise GeoProtocolError(
            "BBOX_NOT_FINITE", "bbox must be (west, south, east, north)"
        ) from None
    if len(values) != 4:
        raise GeoProtocolError("BBOX_NOT_FINITE", "bbox must be (west, south, east, north)")
    # A coordinate must already BE a number. `float()` would happily coerce
    # `True` to 1.0 and `"8"` to 8.0, both of which TypeScript rejects outright
    # (`Number.isFinite` is false for a boolean and for a string), so coercing
    # here is a second grammar.
    for value in values:
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise GeoProtocolError(
                "BBOX_NOT_FINITE", f"bbox coordinates must be numbers: {value!r}"
            )
    try:
        west, south, east, north = (float(v) for v in values)
    except OverflowError:  # an int beyond the double range is `Infinity` in JS
        raise GeoProtocolError("BBOX_NOT_FINITE", "bbox coordinates must be finite") from None
    if not all(math.isfinite(v) for v in (west, south, east, north)):
        raise GeoProtocolError("BBOX_NOT_FINITE", "bbox coordinates must be finite")
    # ORDER IS NORMATIVE (CONTRACT.md section 14.1): each coordinate's own
    # domain is checked before any relation BETWEEN coordinates. A value outside
    # [-180,180] is not a longitude at all, so `west > east` says nothing about
    # it. `[200,0,100,10]` is therefore BBOX_OUT_OF_RANGE and never
    # BBOX_ANTIMERIDIAN — TypeScript used to answer the latter, and section 14
    # makes the code normative, so that was a contract violation rather than a
    # cosmetic difference.
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise GeoProtocolError("BBOX_OUT_OF_RANGE", "longitude out of range")
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise GeoProtocolError("BBOX_OUT_OF_RANGE", "latitude out of range")
    if west > east:
        raise GeoProtocolError(
            "BBOX_ANTIMERIDIAN",
            "a wrapped bbox would enumerate the globe MINUS the viewport; split it",
        )
    if south > north:
        raise GeoProtocolError("BBOX_INVERTED", "south must not exceed north")
    return (west, south, east, north)


def _validate_extent(bbox: Any) -> Bounds:
    """Check a collection extent: a viewport that is still non-degenerate at 6 dp.

    Checked *after* quantisation so the emitted tag is valid on read-back: an
    extent narrower than 11 cm collapses to a point and is refused rather than
    published as `["bbox","0","0","0","0"]`.
    """
    west, south, east, north = _validate_bounds(bbox)
    if quantise_coordinate(west) >= quantise_coordinate(east):
        raise GeoProtocolError("BBOX_DEGENERATE", "extent must have west < east after rounding")
    if quantise_coordinate(south) >= quantise_coordinate(north):
        raise GeoProtocolError("BBOX_DEGENERATE", "extent must have south < north after rounding")
    return (west, south, east, north)


def tile_bbox(z: int, x: int, y: int) -> Bounds:
    """The (west, south, east, north) footprint of a slippy tile, in degrees."""
    zoom, column, row = validate_tile(z, x, y)
    span = 2**zoom
    west = column / span * 360.0 - 180.0
    east = (column + 1) / span * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / span))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (row + 1) / span))))
    return (west, south, east, north)


def tile_center(z: int, x: int, y: int) -> tuple[float, float]:
    """(lat, lon) of a slippy tile's centre, in the Web Mercator sense.

    The item's `g` tag always encodes the centre. A tile's west edge lands
    exactly on a precision-4 geohash boundary every sixteen tiles, so encoding an
    edge would sit on the encoder's half-open boundary systematically; a centre
    never can.
    """
    zoom, column, row = validate_tile(z, x, y)
    span = 2**zoom
    lon = (column + 0.5) / span * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (row + 0.5) / span))))
    return (lat, lon)


# --- geohash (CONTRACT.md section 11) ---------------------------------------


def grid_size(precision: int) -> tuple[int, int]:
    """(longitude cells, latitude cells) of the geohash lattice at a precision."""
    bits = 5 * _validate_precision(precision)
    return (2 ** ((bits + 1) // 2), 2 ** (bits // 2))


def _validate_precision(precision: Any) -> int:
    """Check a geohash precision: an integer in 1..12."""
    value = _as_integer(precision)
    if value is None or not 1 <= value <= 12:
        raise GeoProtocolError("GEOHASH_PRECISION_RANGE", "precision must be an integer in 1..12")
    return value


def geohash(lat: float, lon: float, precision: int = GEOHASH_PRECISION) -> str:
    """Encode a point as a geohash, cells half-open `[min, max)`.

    A coordinate exactly on a division belongs to the cell above it, which is
    what `>=` in the encoder means. That case is not rare: precision-4 longitude
    boundaries coincide with z14 tile boundaries every sixteen tiles.
    """
    depth = _validate_precision(precision)
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise GeoProtocolError("LATLON_RANGE", "latitude/longitude out of range")
    return _bisect_geohash(lat, lon, depth)


def cell_to_geohash(ix: int, iy: int, precision: int = GEOHASH_PRECISION) -> str:
    """Encode a lattice cell index pair as its geohash, longitude bit first."""
    depth = _validate_precision(precision)
    lon_cells, lat_cells = grid_size(depth)
    lon_bits, lat_bits = lon_cells.bit_length() - 1, lat_cells.bit_length() - 1
    if not (0 <= ix < lon_cells and 0 <= iy < lat_cells):
        raise GeoProtocolError("LATLON_RANGE", "cell index outside the grid")
    bits = 0
    for k in range(5 * depth):
        if k % 2 == 0:
            bits = (bits << 1) | ((ix >> (lon_bits - 1 - k // 2)) & 1)
        else:
            bits = (bits << 1) | ((iy >> (lat_bits - 1 - k // 2)) & 1)
    return "".join(GEOHASH_ALPHABET[(bits >> (5 * (depth - 1 - i))) & 31] for i in range(depth))


def _cell_index(value: float, origin: float, cells: int, span: float) -> int:
    """Floor a coordinate into a lattice index, keeping the top edge in the last cell."""
    return max(0, min(cells - 1, int(math.floor((value - origin) / (span / cells)))))


def _cover_indices(bbox: Bounds, precision: int) -> tuple[int, int, int, int]:
    """The lattice index rectangle (ix0, ix1, iy0, iy1) a bounding box occupies."""
    west, south, east, north = _validate_bounds(bbox)
    lon_cells, lat_cells = grid_size(precision)
    return (
        _cell_index(west, -180.0, lon_cells, 360.0),
        _cell_index(east, -180.0, lon_cells, 360.0),
        _cell_index(south, -90.0, lat_cells, 180.0),
        _cell_index(north, -90.0, lat_cells, 180.0),
    )


def cover_count(bbox: Bounds, precision: int = GEOHASH_PRECISION) -> int:
    """How many cells `cover` would return, without building any of them.

    A world-wide viewport is 1,048,576 precision-4 cells; the gate in `nearby`
    asks this first so a refused viewport costs four divisions, not a million
    string builds.
    """
    depth = _validate_precision(precision)
    ix0, ix1, iy0, iy1 = _cover_indices(bbox, depth)
    return (ix1 - ix0 + 1) * (iy1 - iy0 + 1)


def cover(bbox: Bounds, precision: int = GEOHASH_PRECISION) -> list[str]:
    """Every geohash cell a bounding box touches: longitude outer, latitude inner.

    Exact, not a sample. At a fixed precision the grid is a regular lon/lat
    lattice, so the cover is integer index arithmetic. Corner sampling — the
    shape this replaces — misses every interior column, ~92% of the cells a
    multi-degree viewport needs, with no error anywhere.

    Clamping is to the geohash domain (+/-90), not the Mercator cut-off:
    presence and geo-notes exist above 85 degrees even though tiles do not.
    """
    depth = _validate_precision(precision)
    ix0, ix1, iy0, iy1 = _cover_indices(bbox, depth)
    return [
        cell_to_geohash(ix, iy, depth) for ix in range(ix0, ix1 + 1) for iy in range(iy0, iy1 + 1)
    ]


def item_geohash(z: int, x: int, y: int) -> str:
    """The single global spatial tag value for a tile: its centre at precision 4."""
    lat, lon = tile_center(z, x, y)
    return geohash(lat, lon, GEOHASH_PRECISION)


# --- addresses and the item `d` (CONTRACT.md sections 1.2 and 3.2) -----------


def collection_address(pubkey: str, dataset: str) -> str:
    """The NIP-01 `a` pointer at a collection: kind:pubkey:d."""
    author = _validate_hex64(pubkey, "pubkey")
    name = validate_dataset(dataset)
    return f"{KIND_GEO_COLLECTION}:{author}:{name}"


def item_d(dataset: str, z: int, x: int, y: int) -> str:
    """The item's local spatial tag: dataset-prefixed tile coordinates.

    The prefix is load-bearing. NIP-01 addressable identity is (kind, pubkey, d)
    and the `a` tag is *not* part of it, so without the prefix a terrain item and
    an imagery item for the same tile from the same publisher would be the same
    addressable event and would silently overwrite each other.
    """
    name = validate_dataset(dataset)
    zoom, column, row = validate_tile(z, x, y)
    return f"{name}{DATASET_SEPARATOR}{zoom}/{column}/{row}"


def parse_item_d(value: str) -> tuple[str, int, int, int] | None:
    """Split an item `d` back into (dataset, z, x, y), or None if malformed.

    A well-formed `d` contains exactly one ':'. Any other count is rejected,
    which makes the split direction unobservable — the previous round had Python
    partitioning on the first and TypeScript on the last, and they disagreed on
    six of fourteen probes.
    """
    if not isinstance(value, str) or value.count(DATASET_SEPARATOR) != 1:
        return None
    dataset, tile = value.split(DATASET_SEPARATOR)
    if not _DATASET.fullmatch(dataset):
        return None
    parts = tile.split("/")
    if len(parts) != 3 or not all(_UNSIGNED_INT.fullmatch(p) for p in parts):
        return None
    try:
        return (dataset, *validate_tile(*(int(p) for p in parts)))
    except GeoProtocolError:
        return None


# --- builders ---------------------------------------------------------------


def build_collection(
    *,
    dataset: str,
    title: str,
    bbox: Bounds,
    mime_type: str,
    license: str,
    source: str,
    server: str,
    created_at: int,
    description: str | None = "",
) -> dict[str, Any]:
    """Build the *unsigned* collection event (kind 30550, one per dataset).

    No geohash tag: a dataset has an extent, not a location. `content` is the
    description verbatim — a raw string, never JSON. `description` is optional
    in both languages and an absent one (missing, `None`, `undefined`) is the
    empty string — the same rule `properties` follows, CONTRACT.md section 7.5.
    """
    # VALIDATION ORDER IS NORMATIVE — CONTRACT.md section 14.1: fields are
    # checked in the order they are EMITTED, `created_at` then the tags in tag
    # order then `content`. Section 14 makes the code normative, so an input
    # with two defects must name the same field in both languages; otherwise a
    # publisher fixing what its own language named is still rejected by the
    # other. TypeScript checked the extent last and this side checked it third.
    when = validate_created_at(created_at)
    name = validate_dataset(dataset)
    heading = _validate_text(title, "title")
    west, south, east, north = _validate_extent(bbox)
    media = _validate_mime(mime_type)
    licence = _validate_text(license, "license")
    origin = _validate_text(source, "source")
    host = _validate_text(server, "server")
    body = _validate_description("" if description is None else description)
    return {
        "kind": KIND_GEO_COLLECTION,
        "created_at": when,
        "tags": [
            ["d", name],
            ["title", heading],
            [
                "bbox",
                canonical_coordinate(west),
                canonical_coordinate(south),
                canonical_coordinate(east),
                canonical_coordinate(north),
            ],
            ["m", media],
            ["license", licence],
            ["source", origin],
            ["server", host],
        ],
        "content": body,
    }


def build_item(
    *,
    dataset: str,
    pubkey: str,
    z: int,
    x: int,
    y: int,
    sha256: str,
    url: str,
    mime_type: str,
    size: int,
    datetime: str,
    created_at: int,
    properties: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the *unsigned* item event (kind 30551, one per tile).

    The bbox is DERIVED from the tile — there is deliberately no `bbox`
    parameter. It is a function of z/x/y, so accepting it as input is accepting
    a contradiction as input: the previous round could publish an item whose
    `content.bbox` disagreed with its own `d` and `g` tags, and the test meant to
    catch that read the expected bbox out of the fixture and fed it back in.
    """
    # VALIDATION ORDER IS NORMATIVE — CONTRACT.md section 14.1: `created_at`,
    # then the tags in tag order (`d` carries the dataset and the tile, `a`
    # carries the pubkey), then `content` (bbox is derived, so `datetime` then
    # `properties`). TypeScript used to validate the pubkey first, because it
    # called `collectionAddress` first.
    when = validate_created_at(created_at)
    name = validate_dataset(dataset)
    zoom, column, row = validate_tile(z, x, y)
    author = _validate_hex64(pubkey, "pubkey")
    digest = _validate_hex64(sha256, "sha256")
    href = _validate_url(url)
    media = _validate_mime(mime_type)
    length = _validate_size(size)
    acquired = validate_datetime(datetime)
    bag = _validate_properties(properties)

    west, south, east, north = tile_bbox(zoom, column, row)
    bounds = ",".join(canonical_coordinate(v) for v in (west, south, east, north))
    content = (
        f'{{"bbox":[{bounds}],'
        f'"datetime":{_canonical_string(acquired)},'
        f'"properties":{canonical_json(bag)}}}'
    )
    return {
        "kind": KIND_GEO_ITEM,
        "created_at": when,
        "tags": [
            ["d", f"{name}{DATASET_SEPARATOR}{zoom}/{column}/{row}"],
            ["g", item_geohash(zoom, column, row)],
            ["a", collection_address(author, name)],
            ["x", digest],
            ["url", href],
            ["m", media],
            ["size", str(length)],
        ],
        "content": content,
    }


# --- filters (CONTRACT.md section 12) ---------------------------------------


def catalog(
    *, authors: list[str] | None = None, limit: int = DEFAULT_FILTER_LIMIT
) -> dict[str, Any]:
    """A NIP-01 filter for every collection, to be narrowed client-side.

    There is deliberately no spatial term: the collection's `bbox` tag is not
    single-letter and so is not indexed. Collections are few; fetching them
    wholesale and filtering on the returned tag is the only possible strategy,
    and it is also the cheap one.
    """
    count = _validate_limit(limit)
    flt: dict[str, Any] = {"kinds": [KIND_GEO_COLLECTION]}
    if authors is not None:
        flt["authors"] = [_validate_hex64(a, "author") for a in authors]
    flt["limit"] = count
    return flt


def nearby(
    bbox: Bounds,
    *,
    collection: tuple[str, str] | None = None,
    max_cells: int = MAX_COVER_CELLS,
    limit: int = DEFAULT_FILTER_LIMIT,
) -> dict[str, Any] | None:
    """A filter for the items covering a viewport, or None if it is too wide.

    None is a routing signal, not an error: above `max_cells` the caller falls
    back to `catalog()` and renders from the collection layer rather than sending
    a filter the relay will silently drop. `collection` is (pubkey, dataset).
    """
    count = _validate_limit(limit)
    if cover_count(bbox) > max_cells:
        return None
    flt: dict[str, Any] = {"kinds": [KIND_GEO_ITEM], "#g": cover(bbox)}
    if collection is not None:
        flt["#a"] = [collection_address(*collection)]
    flt["limit"] = count
    return flt


def exact_tile(
    dataset: str,
    z: int,
    x: int,
    y: int,
    *,
    authors: list[str] | None = None,
    limit: int = DEFAULT_FILTER_LIMIT,
) -> dict[str, Any]:
    """A filter for one tile of one dataset, across every publisher.

    The limit is 500 rather than 1 on purpose: addressable identity is
    (kind, pubkey, d), so several publishers can legitimately hold the same `d`,
    and `limit: 1` would silently hide all but one. Callers who want a single
    publisher pass `authors`.
    """
    count = _validate_limit(limit)
    value = item_d(dataset, z, x, y)
    flt: dict[str, Any] = {"kinds": [KIND_GEO_ITEM]}
    if authors is not None:
        flt["authors"] = [_validate_hex64(a, "author") for a in authors]
    flt["#d"] = [value]
    flt["limit"] = count
    return flt


# --- supersession (CONTRACT.md section 9) -----------------------------------


def next_created_at(last_published: int | None, now_seconds: int) -> int:
    """The only place a publisher may derive `created_at` for an addressable event.

    A clock that skews forward once, or rewinds, otherwise writes a head that can
    never be superseded — and the relay still answers OK. Overflow is rejected
    rather than wrapped.
    """
    now = validate_created_at(now_seconds)
    if last_published is None:
        return now
    candidate = max(now, validate_created_at(last_published) + 1)
    if candidate > MAX_CREATED_AT:
        raise GeoProtocolError("CREATED_AT_RANGE", "monotonic successor exceeds 2^31-1")
    return candidate


def select_head(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The current event of an address: highest `created_at`, then LOWEST id.

    NIP-01 leaves the tie unspecified, which lets two clients legitimately
    disagree about which of two same-second events is current. This protocol does
    not leave it unspecified.
    """
    if not events:
        return None
    return min(events, key=lambda e: (-int(e["created_at"]), str(e["id"])))
