"""The geo protocol, driven by the shared cross-language vector suite.

`packages/geo-protocol/tests/fixtures/geo-vectors.json` is the conformance suite
and `packages/geo-protocol/CONTRACT.md` is the normative spec. The TypeScript
builders in `packages/geo-protocol/src` are checked against the same file, and
both sides must reproduce every vector exactly: `content` is hashed into the
event id, so a one-character disagreement is a different event for one
addressable address — a silent split-brain, not a visible error.

The suite this replaces pinned ONE sample, and all eleven cross-language
divergences of the last review lived outside it. Worse, the test that consumed
it read the expected bbox out of the fixture and fed it back into the builder,
asserting the fixture equalled itself.
"""

from __future__ import annotations

import inspect
import json
import math
import re
from pathlib import Path
from typing import Any

import pytest

from blossom_gis import geo_protocol as gp
from blossom_gis.geo_protocol import (
    GEOHASH_PRECISION,
    KIND_GEO_COLLECTION,
    KIND_GEO_ITEM,
    MAX_COVER_CELLS,
    GeoProtocolError,
    build_collection,
    build_item,
    catalog,
    cell_to_geohash,
    collection_address,
    cover,
    cover_count,
    exact_tile,
    geohash,
    grid_size,
    item_d,
    item_geohash,
    nearby,
    next_created_at,
    parse_item_d,
    select_head,
    tile_bbox,
    tile_center,
)

#: Relative to the workspace root, so the two languages load the same bytes.
VECTOR_RELPATH = Path("packages/geo-protocol/tests/fixtures/geo-vectors.json")

#: Every error code CONTRACT.md section 14 defines. A reject vector naming
#: anything else is a contract change, not a test failure to paper over.
ERROR_CODES = {
    "NUMBER_NOT_FINITE",
    "PROPERTY_NUMBER_RANGE",
    "PROPERTY_KEY_GRAMMAR",
    "STRING_NOT_SCALAR",
    "DATASET_GRAMMAR",
    "TEXT_EMPTY",
    "MIME_GRAMMAR",
    "URL_GRAMMAR",
    "HEX64",
    "SIZE_RANGE",
    "CREATED_AT_RANGE",
    "TILE_ZOOM_RANGE",
    "TILE_XY_RANGE",
    "TILE_NOT_INTEGER",
    "DATETIME_REQUIRED",
    "DATETIME_GRAMMAR",
    "DATETIME_CALENDAR",
    "BBOX_NOT_FINITE",
    "BBOX_ANTIMERIDIAN",
    "BBOX_INVERTED",
    "BBOX_OUT_OF_RANGE",
    "BBOX_DEGENERATE",
    "GEOHASH_PRECISION_RANGE",
    "LATLON_RANGE",
    "FILTER_LIMIT_RANGE",
}

_NUMBER_TOKENS = {
    "NaN": float("nan"),
    "Infinity": math.inf,
    "-Infinity": -math.inf,
    "-0": -0.0,
}

#: Strings JSON can technically carry but the vector file must not: a raw
#: `\ud800` escape is legal JSON and `json.loads` decodes it, but the bundler
#: that inlines the file for the TypeScript suite refuses it outright, and a
#: vector one side cannot load pins nothing at all.
_STRING_TOKENS = {
    "LONE_SURROGATE_D800": "\ud800",
    "TEXT_WITH_LONE_SURROGATE": "terr\ud800ain",
    "TEXT_LEADING_SPACE_LONE_SURROGATE": " \ud800",
    "URL_WITH_LONE_SURROGATE": "https://blossom.example/\ud800",
    "URL_BAD_SCHEME_WITH_LONE_SURROGATE": "ftp://blossom.example/\ud800",
}

#: An EXPLICIT null, as opposed to the absent-key spelling a bare `null` patch
#: value means. CONTRACT.md section 7.5 rules the two equivalent; the token is
#: what lets a vector assert that rather than assume it.
_JSON_TOKENS = {"NULL": None}


def repo_root() -> Path:
    """Walk up from this file to the workspace root that holds packages/ and services/."""
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "packages").is_dir() and (candidate / "services").is_dir():
            return candidate
    raise AssertionError("could not locate the terrCVM workspace root from " + __file__)


def load_vectors() -> dict[str, Any]:
    """Load the shared vector suite, failing loudly (never skipping) when absent."""
    path = repo_root() / VECTOR_RELPATH
    if not path.is_file():
        raise AssertionError(
            f"cross-language conformance vectors missing: {path}\n"
            "They are the normative conformance suite for packages/geo-protocol/CONTRACT.md "
            "and are loaded by both the TypeScript and the Python implementation. Without "
            "them neither side is verified against the other. This fails on purpose rather "
            "than skipping."
        )
    return json.loads(path.read_text(encoding="utf-8"))


VECTORS = load_vectors()


def materialise(value: Any) -> Any:
    """Substitute the `__number__` / `__string__` / `__json__` tokens."""
    if isinstance(value, dict):
        if set(value) == {"__number__"}:
            return _NUMBER_TOKENS[value["__number__"]]
        if set(value) == {"__string__"}:
            return _STRING_TOKENS[value["__string__"]]
        if set(value) == {"__json__"}:
            return _JSON_TOKENS[value["__json__"]]
        return {k: materialise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [materialise(v) for v in value]
    return value


def patched(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """`base` with `patch` overlaid, then token-substituted.

    A patch value of `None` deletes the key — that is the file's spelling of
    ABSENT. An EXPLICIT null is ``{"__json__": "NULL"}``, which survives this
    step and reaches the builder as `None`. Substitution runs *after* the delete
    pass for exactly that reason, which is also what the TypeScript harness
    does; materialising first would collapse the two spellings back together and
    the section 7.5 vectors would assert nothing.
    """
    spec = dict(base)
    for key, value in patch.items():
        if value is None:
            spec.pop(key, None)
        else:
            spec[key] = materialise(value)
    return spec


def is_encodable(event: dict[str, Any]) -> bool:
    """True when the built event can actually be UTF-8 encoded and sent.

    This is the invariant the grammar suite exists to protect. Both languages
    used to gate lone surrogates in `content` and in `properties` and neither
    gated them in tag values, so both agreed on producing an event that cannot
    be encoded: this side could build one and never send it, TypeScript sent one
    and every Python consumer choked on receipt.
    """
    try:
        json.dumps(event, ensure_ascii=False).encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def named(vectors: list[dict[str, Any]], key: str = "name") -> list[Any]:
    """pytest ids for a vector list, so a failure names the case it came from."""
    return [str(v.get(key, v.get("note", i))) for i, v in enumerate(vectors)]


def collection_from(spec: dict[str, Any]) -> dict[str, Any]:
    """Feed a vector's declared collection input through the Python builder."""
    return build_collection(
        dataset=spec.get("dataset"),
        title=spec.get("title"),
        bbox=materialise(spec["bbox"]),
        mime_type=spec.get("mimeType"),
        license=spec.get("license"),
        source=spec.get("source"),
        server=spec.get("server"),
        created_at=spec.get("createdAt"),
        description=spec.get("description", ""),
    )


def item_from(spec: dict[str, Any]) -> dict[str, Any]:
    """Feed a vector's declared item input through the Python builder.

    The bbox is not passed and cannot be: `build_item` derives it from the tile.
    """
    tile = spec.get("tile") or {}
    return build_item(
        dataset=spec.get("dataset"),
        pubkey=spec.get("pubkey"),
        z=tile.get("z"),
        x=tile.get("x"),
        y=tile.get("y"),
        sha256=spec.get("sha256"),
        url=spec.get("url"),
        mime_type=spec.get("mimeType"),
        size=spec.get("size"),
        datetime=spec.get("datetime"),
        created_at=spec.get("createdAt"),
        properties=spec.get("properties"),
    )


def expect_code(code: str):
    """Assert the next block raises exactly the contract's error code."""
    assert code in ERROR_CODES, f"{code} is not a CONTRACT.md section 14 error code"
    return pytest.raises(GeoProtocolError)


class TestConstants:
    def test_every_constant_matches_the_suite(self) -> None:
        """One name per constant, both languages. Two names is how sides drift."""
        for name, value in VECTORS["constants"].items():
            if name == "GEOHASH_ALPHABET":
                from blossom_gis.geo import GEOHASH_ALPHABET

                assert value == GEOHASH_ALPHABET
                continue
            assert getattr(gp, name) == value, name

    def test_the_suite_holds_the_case_counts_the_contract_declares(self) -> None:
        """A truncated or half-merged vector file must fail loudly, not run the rest."""
        assert VECTORS["version"] == 3
        assert len(VECTORS["validation"]["cases"]) == 84
        assert len(VECTORS["grammar"]["cases"]) == 67
        assert len(VECTORS["grammar"]["whitespace"]) == 30

    def test_the_kinds_avoid_marmots_growth_path(self) -> None:
        """30450 would collide with Marmot's 30000+N mirror of its next low slot."""
        assert KIND_GEO_ITEM == KIND_GEO_COLLECTION + 1
        assert KIND_GEO_COLLECTION not in (30443, 30450, 30451)


class TestCanonicalNumber:
    @pytest.mark.parametrize(
        "vector",
        VECTORS["numberFormat"]["canonicalNumber"],
        ids=named(VECTORS["numberFormat"]["canonicalNumber"], "note"),
    )
    def test_matches_the_vector(self, vector: dict[str, Any]) -> None:
        value = materialise(vector["value"])
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                gp.canonical_number(value)
            assert caught.value.code == vector["reject"]
        else:
            assert gp.canonical_number(value) == vector["expected"]

    @pytest.mark.parametrize(
        "vector",
        VECTORS["numberFormat"]["canonicalCoordinate"],
        ids=named(VECTORS["numberFormat"]["canonicalCoordinate"], "note"),
    )
    def test_coordinates_match_the_vector(self, vector: dict[str, Any]) -> None:
        value = materialise(vector["value"])
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                gp.canonical_coordinate(value)
            assert caught.value.code == vector["reject"]
        else:
            assert gp.canonical_coordinate(value) == vector["expected"]

    def test_never_uses_exponent_notation(self) -> None:
        """The window 1e-6 <= |x| < 1e-4 was silently wrong in both languages."""
        for value in (1e-5, 1e-7, 1e16, 1e21, 5e-324):
            assert "e" not in gp.canonical_number(value)


class TestBuildCollection:
    @pytest.mark.parametrize(
        "vector", VECTORS["buildCollection"], ids=named(VECTORS["buildCollection"])
    )
    def test_matches_the_vector(self, vector: dict[str, Any]) -> None:
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                collection_from(vector["input"])
            assert caught.value.code == vector["reject"]
        else:
            assert collection_from(vector["input"]) == vector["expect"]

    def test_has_one_d_tag_and_no_geohash(self) -> None:
        """A dataset has an extent, not a location."""
        event = collection_from(VECTORS["buildCollection"][0]["input"])
        assert [t[0] for t in event["tags"]] == [
            "d",
            "title",
            "bbox",
            "m",
            "license",
            "source",
            "server",
        ]
        assert not [t for t in event["tags"] if t[0] == "g"]

    def test_is_unsigned_so_the_service_never_holds_a_key(self) -> None:
        event = collection_from(VECTORS["buildCollection"][0]["input"])
        assert "sig" not in event and "pubkey" not in event and "id" not in event


class TestBuildItem:
    @pytest.mark.parametrize("vector", VECTORS["buildItem"], ids=named(VECTORS["buildItem"]))
    def test_matches_the_vector(self, vector: dict[str, Any]) -> None:
        rebuilt = item_from(materialise(vector["input"]))
        # Byte for byte on content first: that string is what gets hashed.
        assert rebuilt["content"] == vector["expect"]["content"]
        assert rebuilt == vector["expect"]

    def test_takes_no_bbox_parameter(self) -> None:
        """Critical finding 1: a caller-supplied bbox can contradict its own d and g."""
        assert "bbox" not in inspect.signature(build_item).parameters
        spec = dict(VECTORS["buildItem"][0]["input"])
        tile = spec["tile"]
        with pytest.raises(TypeError):
            build_item(  # type: ignore[call-arg]
                dataset=spec["dataset"],
                pubkey=spec["pubkey"],
                z=tile["z"],
                x=tile["x"],
                y=tile["y"],
                bbox=(0.0, 0.0, 1.0, 1.0),
                sha256=spec["sha256"],
                url=spec["url"],
                mime_type=spec["mimeType"],
                size=spec["size"],
                datetime=spec["datetime"],
                created_at=spec["createdAt"],
            )

    def test_the_content_bbox_is_the_tile_the_d_tag_names(self) -> None:
        """Derived, never restated — the old conformance test was circular."""
        for vector in VECTORS["buildItem"]:
            flat = {t[0]: t[1] for t in vector["expect"]["tags"]}
            parsed = parse_item_d(flat["d"])
            assert parsed is not None
            _, z, x, y = parsed
            west, south, east, north = tile_bbox(z, x, y)
            assert json.loads(vector["expect"]["content"])["bbox"] == [
                float(gp.canonical_coordinate(v)) for v in (west, south, east, north)
            ]

    def test_the_global_tag_is_the_tile_centre_at_precision_4(self) -> None:
        for vector in VECTORS["buildItem"]:
            flat = {t[0]: t[1] for t in vector["expect"]["tags"]}
            _, z, x, y = parse_item_d(flat["d"])  # type: ignore[misc]
            lat, lon = tile_center(z, x, y)
            assert flat["g"] == geohash(lat, lon, GEOHASH_PRECISION)
            assert len(flat["g"]) == GEOHASH_PRECISION

    def test_two_datasets_for_one_tile_do_not_collide(self) -> None:
        """NIP-01 identity is (kind, pubkey, d); `a` is no part of it."""
        assert item_d("terrain", 14, 8593, 5677) != item_d("imagery", 14, 8593, 5677)

    def test_the_exact_footprint_lives_in_content_not_in_tags(self) -> None:
        event = item_from(VECTORS["buildItem"][0]["input"])
        assert [t[0] for t in event["tags"]] == ["d", "g", "a", "x", "url", "m", "size"]
        assert not [t for t in event["tags"] if t[0] in ("bbox", "tile")]

    def test_is_unsigned_so_the_service_never_holds_a_key(self) -> None:
        event = item_from(VECTORS["buildItem"][0]["input"])
        assert "sig" not in event and "pubkey" not in event and "id" not in event


class TestValidation:
    @pytest.mark.parametrize(
        "case", VECTORS["validation"]["cases"], ids=named(VECTORS["validation"]["cases"])
    )
    def test_accepts_and_rejects_exactly_as_the_contract_says(self, case: dict[str, Any]) -> None:
        spec = patched(VECTORS["validation"]["baseInput"], case["patch"])
        if case["accepted"]:
            event = item_from(spec)
            assert event["kind"] == KIND_GEO_ITEM
        else:
            code = case["reason"].split(" ", 1)[0]
            with expect_code(code) as caught:
                item_from(spec)
            assert caught.value.code == code, case["reason"]


class TestGrammar:
    """The GRAMMAR suite: the character classes, the whitespace set, the ORDER.

    The rest of this file pins VALUES. Every finding this class exists for was
    of one shape: two regexes, or two validators, where the contract has one
    rule. ``\\d`` is Unicode-aware here and ASCII-only in JavaScript; ``\\s``
    contains U+0085 and U+001C..U+001F here and U+FEFF there; `strip` and `trim`
    strip different sets; `None` defaulted here and threw there; and the two
    sides checked the same fields in different orders, so the same bad input
    named a different field. None of it was visible to a suite that pins outputs
    for good inputs.
    """

    def test_the_whitespace_set_is_the_contract_set_exactly(self) -> None:
        declared = [int(h, 16) for h in VECTORS["grammar"]["whitespace"]]
        assert sorted(gp.PROTOCOL_WHITESPACE) == declared

    def test_it_is_a_strict_superset_of_this_language_s_own_whitespace(self) -> None:
        """A UNION is only a ruling if each side really contributes members."""
        declared = {int(h, 16) for h in VECTORS["grammar"]["whitespace"]}
        native = {c for c in range(0x10000) if re.fullmatch(r"\s", chr(c))}
        assert not native - declared
        # U+FEFF is whitespace to JavaScript and not to Python; that gap is the
        # other half of the divergence and the reason the set is a union.
        assert declared - native == {0xFEFF}

    @pytest.mark.parametrize(
        "case", VECTORS["grammar"]["cases"], ids=named(VECTORS["grammar"]["cases"])
    )
    def test_accepts_and_rejects_exactly_as_the_contract_says(self, case: dict[str, Any]) -> None:
        if case["builder"] == "collection":
            build = collection_from
            spec = patched(VECTORS["grammar"]["collectionBaseInput"], case["patch"])
        else:
            build = item_from
            spec = patched(VECTORS["validation"]["baseInput"], case["patch"])

        if case["accepted"]:
            # An accepted grammar case must also be SENDABLE, not merely built.
            assert is_encodable(build(spec)), case["name"]
        else:
            code = case["reason"].split(" ", 1)[0]
            with expect_code(code) as caught:
                build(spec)
            assert caught.value.code == code, case["reason"]


class TestEveryBuiltEventIsUtf8Encodable:
    """The invariant the grammar suite protects, asserted over every vector.

    Spot-checking would not have caught this: the two languages AGREED on
    emitting an unencodable event, so no differential comparison could see it
    either. Only an invariant on the output can.
    """

    def test_holds_for_every_accepted_collection_vector(self) -> None:
        for vector in VECTORS["buildCollection"]:
            if "reject" in vector:
                continue
            assert is_encodable(collection_from(materialise(vector["input"]))), vector["name"]

    def test_holds_for_every_accepted_item_vector(self) -> None:
        for vector in VECTORS["buildItem"]:
            assert is_encodable(item_from(materialise(vector["input"]))), vector["name"]
        for case in VECTORS["validation"]["cases"]:
            if not case["accepted"]:
                continue
            spec = patched(VECTORS["validation"]["baseInput"], case["patch"])
            assert is_encodable(item_from(spec)), case["name"]

    def test_is_enforced_not_merely_observed_on_every_tag_value(self) -> None:
        for field in ("title", "license", "source", "server", "description"):
            spec = patched(
                VECTORS["grammar"]["collectionBaseInput"], {field: "lone \ud800 surrogate"}
            )
            with pytest.raises(GeoProtocolError) as caught:
                collection_from(spec)
            assert caught.value.code == "STRING_NOT_SCALAR", field


class TestParseItemD:
    @pytest.mark.parametrize(
        "vector", VECTORS["parseItemD"], ids=[v["note"] for v in VECTORS["parseItemD"]]
    )
    def test_matches_the_vector(self, vector: dict[str, Any]) -> None:
        parsed = parse_item_d(vector["input"])
        expected = vector["expected"]
        if expected is None:
            assert parsed is None
        else:
            tile = expected["tile"]
            assert parsed == (expected["dataset"], tile["z"], tile["x"], tile["y"])

    def test_round_trips_the_builder(self) -> None:
        assert parse_item_d(item_d("terrain", 14, 8593, 5677)) == ("terrain", 14, 8593, 5677)

    def test_the_split_direction_is_unobservable(self) -> None:
        """Exactly one ':' — the previous round split on first vs last and diverged."""
        assert parse_item_d("a:b:14/1/1") is None
        with pytest.raises(GeoProtocolError):
            item_d("a:b", 14, 1, 1)


class TestGeohash:
    @pytest.mark.parametrize(
        "vector",
        VECTORS["geohash"]["encode"],
        ids=named(VECTORS["geohash"]["encode"], "note"),
    )
    def test_encode_matches_the_vector(self, vector: dict[str, Any]) -> None:
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                geohash(vector["lat"], vector["lon"], vector["precision"])
            assert caught.value.code == vector["reject"]
        else:
            assert geohash(vector["lat"], vector["lon"], vector["precision"]) == vector["expected"]

    @pytest.mark.parametrize(
        "vector", VECTORS["geohash"]["gridSize"], ids=lambda v: f"p{v['precision']}"
    )
    def test_grid_size_matches_the_vector(self, vector: dict[str, Any]) -> None:
        assert grid_size(vector["precision"]) == (vector["lonCells"], vector["latCells"])

    @pytest.mark.parametrize(
        "vector", VECTORS["geohash"]["cellToGeohash"], ids=lambda v: f"{v['ix']}-{v['iy']}"
    )
    def test_cell_to_geohash_matches_the_vector(self, vector: dict[str, Any]) -> None:
        assert (
            cell_to_geohash(vector["ix"], vector["iy"], vector["precision"]) == vector["expected"]
        )

    @pytest.mark.parametrize(
        "vector", VECTORS["geohash"]["cover"], ids=named(VECTORS["geohash"]["cover"])
    )
    def test_cover_matches_the_vector(self, vector: dict[str, Any]) -> None:
        bbox = materialise(vector["bbox"])
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                cover_count(bbox)
            assert caught.value.code == vector["reject"]
            return
        assert cover_count(bbox) == vector["expectedCellCount"]
        if not vector.get("cellsOmitted"):
            assert cover(bbox) == vector["expectedCells"]

    def test_the_encoder_and_the_cover_agree_everywhere_in_a_box(self) -> None:
        """Two code paths, one grid: index arithmetic must match the bisector."""
        box = (-2.0, 46.0, 1.0, 47.0)
        cells = set(cover(box))
        for i in range(11):
            for j in range(11):
                lon = box[0] + (box[2] - box[0]) * i / 10
                lat = box[1] + (box[3] - box[1]) * j / 10
                assert geohash(lat, lon, GEOHASH_PRECISION) in cells


class TestFilters:
    @pytest.mark.parametrize(
        "vector", VECTORS["filters"]["catalog"], ids=named(VECTORS["filters"]["catalog"])
    )
    def test_catalog_matches_the_vector(self, vector: dict[str, Any]) -> None:
        spec = vector["input"]
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                catalog(**{k: v for k, v in _snake(spec).items()})
            assert caught.value.code == vector["reject"]
        else:
            flt = catalog(**_snake(spec))
            assert flt == vector["expect"]
            assert list(flt) == list(vector["expect"])

    @pytest.mark.parametrize(
        "vector", VECTORS["filters"]["nearby"], ids=named(VECTORS["filters"]["nearby"])
    )
    def test_nearby_matches_the_vector(self, vector: dict[str, Any]) -> None:
        spec = dict(vector["input"])
        bbox = materialise(spec.pop("bbox"))
        kwargs: dict[str, Any] = {}
        if "collection" in spec:
            kwargs["collection"] = (spec["collection"]["pubkey"], spec["collection"]["dataset"])
        if "maxCells" in spec:
            kwargs["max_cells"] = spec["maxCells"]
        if "limit" in spec:
            kwargs["limit"] = spec["limit"]
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                nearby(bbox, **kwargs)
            assert caught.value.code == vector["reject"]
            return
        flt = nearby(bbox, **kwargs)
        assert flt == vector["expect"]
        if flt is not None:
            assert list(flt) == list(vector["expect"])
            assert len([k for k in flt if k.startswith("#")]) <= 3

    @pytest.mark.parametrize(
        "vector", VECTORS["filters"]["exactTile"], ids=named(VECTORS["filters"]["exactTile"])
    )
    def test_exact_tile_matches_the_vector(self, vector: dict[str, Any]) -> None:
        spec = vector["input"]
        tile = spec["tile"]
        kwargs: dict[str, Any] = {}
        if "authors" in spec:
            kwargs["authors"] = spec["authors"]
        if "limit" in spec:
            kwargs["limit"] = spec["limit"]
        if "reject" in vector:
            with expect_code(vector["reject"]) as caught:
                exact_tile(spec["dataset"], tile["z"], tile["x"], tile["y"], **kwargs)
            assert caught.value.code == vector["reject"]
        else:
            flt = exact_tile(spec["dataset"], tile["z"], tile["x"], tile["y"], **kwargs)
            assert flt == vector["expect"]
            assert list(flt) == list(vector["expect"])

    def test_the_catalog_filter_has_no_spatial_term(self) -> None:
        """The bbox tag is not single-letter, so no relay indexes it."""
        assert not any(k.startswith("#") for k in catalog())

    def test_a_viewport_too_wide_for_one_filter_is_refused_not_truncated(self) -> None:
        europe = (-25.0, 34.0, 45.0, 72.0)
        assert nearby(europe) is None
        assert cover_count(europe) > MAX_COVER_CELLS

    def test_an_item_matches_a_filter_for_its_own_viewport(self) -> None:
        """Publish and discovery must agree, or nothing is findable."""
        event = item_from(VECTORS["buildItem"][0]["input"])
        published = next(t[1] for t in event["tags"] if t[0] == "g")
        flt = nearby((8.80, 48.25, 8.84, 48.27))
        assert flt is not None
        assert published in flt["#g"]


def _snake(spec: dict[str, Any]) -> dict[str, Any]:
    """Rename a vector's camelCase filter options to the Python keywords."""
    mapping = {"maxCells": "max_cells"}
    return {mapping.get(k, k): v for k, v in spec.items()}


class TestSupersession:
    @pytest.mark.parametrize(
        "case", VECTORS["supersession"]["cases"], ids=named(VECTORS["supersession"]["cases"])
    )
    def test_head_selection_matches_the_vector(self, case: dict[str, Any]) -> None:
        head = select_head(case["events"])
        assert head is not None
        assert head["id"] == case["expectedHeadId"]

    @pytest.mark.parametrize(
        "case",
        VECTORS["createdAtMonotonicity"]["cases"],
        ids=lambda c: f"{c['last']}-{c['now']}",
    )
    def test_next_created_at_matches_the_vector(self, case: dict[str, Any]) -> None:
        if "reject" in case:
            with expect_code(case["reject"]) as caught:
                next_created_at(case["last"], case["now"])
            assert caught.value.code == case["reject"]
        else:
            assert next_created_at(case["last"], case["now"]) == case["expected"]

    def test_a_rewound_clock_cannot_write_an_unsupersedable_head(self) -> None:
        head = 1767225600
        assert next_created_at(head, head - 86400) == head + 1


class TestScope:
    def test_only_the_dataset_kinds_carry_the_single_precision_tag(self) -> None:
        """The social kinds keep the ladder; see nostr_geo and CONTRACT.md 13."""
        ladder_kinds = set(VECTORS["socialGeohashLadder"]["kinds"])
        assert KIND_GEO_COLLECTION not in ladder_kinds
        assert KIND_GEO_ITEM not in ladder_kinds

    def test_the_address_is_the_collection_kind_not_the_item_kind(self) -> None:
        pubkey = "0123456789abcdef" * 4
        assert collection_address(pubkey, "terrain") == f"{KIND_GEO_COLLECTION}:{pubkey}:terrain"

    def test_the_item_geohash_is_the_centre_not_an_edge(self) -> None:
        """A tile's west edge lands on a p4 boundary every 16 tiles; a centre never does."""
        for x in range(16):
            assert item_geohash(14, 8580 + x, 5677) == geohash(*tile_center(14, 8580 + x, 5677))
