"""Corpus announcements: build, sign-ready, and publish the 30550/30551 events.

The dataset table below is the authoritative licence registry for announced
corpus layers — licences are mandatory house policy and travel in the
collection event, so a client learns attribution from the relay, never from
config. The events themselves come from geo_protocol's validated builders;
this module only feeds them crawl results and moves the frames.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from .geo import BBox
from .geo_protocol import build_collection, build_item, next_created_at

#: Licence and identity constants per announced dataset. `source` names where
#: the bytes came from; the collection's `server` tag names where they live now.
DATASETS: dict[str, dict[str, str]] = {
    "dem": {
        "title": "Terrarium elevation tiles",
        "mime": "image/png",
        "license": (
            "Terrain Tiles on AWS Open Data (Mapzen terrarium). Attribution required: "
            "DEMs composited from public sources — see "
            "https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
        ),
        "source": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
    },
    "features": {
        "title": "OpenStreetMap feature tiles (TFT2)",
        "mime": "application/vnd.terrcvm.tft",
        "license": (
            "ODbL-1.0 — (c) OpenStreetMap contributors; "
            "share-alike applies to derived geometry"
        ),
        "source": "https://www.openstreetmap.org (via Overpass API)",
    },
}


def rfc3339(epoch_seconds: int) -> str:
    """RFC 3339 UTC instant, second precision, Zulu suffix."""
    return datetime.fromtimestamp(epoch_seconds, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def assemble(
    *,
    dataset: str,
    region_bbox: BBox,
    z: int,
    x: int,
    y: int,
    sha256: str,
    size: int,
    acquired_at: int,
    server: str,
    pubkey: str,
    now: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """One crawled tile → its unsigned (collection, item) event pair.

    `acquired_at` is the crawl instant, not the publish instant — equating them
    fabricates provenance (geo_protocol.validate_datetime's rule).
    """
    meta = DATASETS[dataset]
    created_at = next_created_at(None, now)
    host = server.rstrip("/")
    collection = build_collection(
        dataset=dataset,
        title=meta["title"],
        bbox=(region_bbox.west, region_bbox.south, region_bbox.east, region_bbox.north),
        mime_type=meta["mime"],
        license=meta["license"],
        source=meta["source"],
        server=host,
        created_at=created_at,
    )
    item = build_item(
        dataset=dataset,
        pubkey=pubkey,
        z=z,
        x=x,
        y=y,
        sha256=sha256,
        url=f"{host}/{sha256}",
        mime_type=meta["mime"],
        size=size,
        datetime=rfc3339(acquired_at),
        created_at=created_at,
    )
    return collection, item


def publish(
    relay_url: str,
    events: list[dict[str, Any]],
    timeout_s: float = 10.0,
) -> list[tuple[str, bool, str]]:
    """Send signed events, await each OK frame; (id, accepted, message) per event.

    Serial on purpose: one in flight at a time keeps the OK attribution
    unambiguous, and the corpus announces a handful of events, not a stream.
    """
    from websockets.sync.client import connect

    results: list[tuple[str, bool, str]] = []
    with connect(relay_url, open_timeout=timeout_s, close_timeout=timeout_s) as ws:
        for event in events:
            ws.send(json.dumps(["EVENT", event], separators=(",", ":")))
            while True:
                frame = json.loads(ws.recv(timeout=timeout_s))
                if frame[0] == "OK" and frame[1] == event["id"]:
                    accepted = frame[2] is True
                    message = str(frame[3]) if len(frame) > 3 else ""
                    results.append((event["id"], accepted, message))
                    break
    return results
