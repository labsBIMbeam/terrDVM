"""Corpus announcements: assembly from crawl results, signing, and the publish
frame exchange — the latter against a real in-process websocket server so the
wire frames are observed, not assumed."""

from __future__ import annotations

import json
import socket
import threading

import pytest
from websockets.sync.server import serve

from blossom_gis.announce import assemble, publish, rfc3339
from blossom_gis.crawl import CrawlQueue
from blossom_gis.geo import BBox
from blossom_gis.geo_protocol import validate_datetime
from blossom_gis.nostr import verify_event
from blossom_gis.signer import public_key_from_secret, sign_event

NOW = 1754130000
SECRET = 3
PUBKEY = public_key_from_secret(SECRET).hex()
SHA = "c0" * 32
MADEIRA = BBox(west=-17.32, south=32.35, east=-16.24, north=33.15)


def _tags(event: dict, name: str) -> list[list[str]]:
    return [t for t in event["tags"] if t and t[0] == name]


class TestAssembly:
    def _pair(self, dataset: str = "features", z: int = 14, x: int = 7422, y: int = 6618):
        return assemble(
            dataset=dataset,
            region_bbox=MADEIRA,
            z=z,
            x=x,
            y=y,
            sha256=SHA,
            size=139_699,
            acquired_at=1754120000,
            server="http://127.0.0.1:3000",
            pubkey=PUBKEY,
            now=NOW,
        )

    def test_collection_carries_licence_server_and_extent(self) -> None:
        collection, _ = self._pair()
        assert collection["kind"] == 30550
        assert _tags(collection, "d") == [["d", "features"]]
        assert "ODbL" in _tags(collection, "license")[0][1]
        assert _tags(collection, "server")[0][1] == "http://127.0.0.1:3000"
        assert len(_tags(collection, "bbox")[0]) == 5
        assert _tags(collection, "g") == []  # a dataset has an extent, not a location

    def test_item_identity_hash_and_url(self) -> None:
        _, item = self._pair()
        assert item["kind"] == 30551
        assert _tags(item, "d") == [["d", "features:14/7422/6618"]]
        assert _tags(item, "g") == [["g", "etgc"]]
        assert _tags(item, "x") == [["x", SHA]]
        assert _tags(item, "url")[0][1] == f"http://127.0.0.1:3000/{SHA}"
        assert _tags(item, "size")[0][1] == "139699"
        assert json.loads(item["content"])["datetime"] == rfc3339(1754120000)

    def test_dem_dataset_announces_the_z13_parent(self) -> None:
        collection, item = self._pair(dataset="dem", z=13, x=3711, y=3309)
        assert _tags(collection, "m")[0][1] == "image/png"
        assert _tags(item, "d") == [["d", "dem:13/3711/3309"]]
        assert _tags(item, "g") == [["g", "etgc"]]  # same p4 cell as the features tile

    def test_assembled_events_sign_and_verify_as_is(self) -> None:
        collection, item = self._pair()
        assert verify_event(sign_event(collection, SECRET))
        assert verify_event(sign_event(item, SECRET))

    def test_unknown_dataset_is_refused(self) -> None:
        with pytest.raises(KeyError):
            self._pair(dataset="basement")


def test_rfc3339_is_utc_zulu_and_protocol_valid() -> None:
    assert rfc3339(0) == "1970-01-01T00:00:00Z"
    assert validate_datetime(rfc3339(1754120000)) == rfc3339(1754120000)


class TestQueueResult:
    def test_returns_the_crawl_result_row(self, tmp_path) -> None:
        queue = CrawlQueue(tmp_path / "crawl.sqlite")
        try:
            queue.seed_tile("madeira", 14, 7422, 6618, ("features",))
            tile = queue.claim("madeira", 1)[0]
            queue.mark_done(tile, sha256=SHA, size=139_699, counts={})
            row = queue.result("madeira", "features", 14, 7422, 6618)
            assert row is not None
            assert row["sha256"] == SHA and row["status"] == "done"
            assert queue.result("madeira", "dem", 14, 7422, 6618) is None
        finally:
            queue.close()


@pytest.fixture
def relay():
    accepted: list[dict] = []
    verdicts: dict[str, tuple[bool, str]] = {}

    def handler(ws) -> None:
        for frame in ws:
            message = json.loads(frame)
            if message[0] == "EVENT":
                event = message[1]
                accepted.append(event)
                ok, msg = verdicts.get(event["id"], (True, ""))
                ws.send(json.dumps(["OK", event["id"], ok, msg]))

    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    server = serve(handler, "127.0.0.1", port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"ws://127.0.0.1:{port}", accepted, verdicts
    finally:
        server.shutdown()
        thread.join(timeout=5)


class TestPublish:
    def test_publishes_and_collects_ok_frames(self, relay) -> None:
        url, accepted, _ = relay
        events = [
            sign_event({"created_at": NOW, "kind": 1, "tags": [], "content": "a"}, SECRET),
            sign_event({"created_at": NOW, "kind": 1, "tags": [], "content": "b"}, SECRET),
        ]
        results = publish(url, events)
        assert [(event["id"], True, "") for event in events] == results
        assert [e["id"] for e in accepted] == [e["id"] for e in events]

    def test_a_rejection_is_reported_not_hidden(self, relay) -> None:
        url, _, verdicts = relay
        event = sign_event({"created_at": NOW, "kind": 1, "tags": [], "content": "x"}, SECRET)
        verdicts[event["id"]] = (False, "blocked: not the crawler")
        results = publish(url, [event])
        assert results == [(event["id"], False, "blocked: not the crawler")]
