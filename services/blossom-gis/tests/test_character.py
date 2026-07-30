"""The demo character: deterministic bytes, valid GLB container."""

from __future__ import annotations

import hashlib
import struct

from blossom_gis.character import build_character_glb


class TestCharacter:
    def test_bytes_are_deterministic(self) -> None:
        first = build_character_glb()
        second = build_character_glb()
        assert first == second
        # Content addressing depends on this hash being machine-independent.
        assert hashlib.sha256(first).hexdigest() == hashlib.sha256(second).hexdigest()

    def test_is_a_valid_glb_container(self) -> None:
        payload = build_character_glb()
        magic, version, total = struct.unpack_from("<III", payload, 0)
        assert magic == 0x46546C67
        assert version == 2
        assert total == len(payload)
        json_length, json_type = struct.unpack_from("<II", payload, 12)
        assert json_type == 0x4E4F534A
        assert b'"POSITION":0' in payload[20 : 20 + json_length]
