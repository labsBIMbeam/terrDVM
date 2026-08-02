"""Crawler CLI — the entry point a scheduler calls.

    python -m blossom_gis.cli seed   --region madeira
    python -m blossom_gis.cli run    --region madeira --max-tiles 5
    python -m blossom_gis.cli status --region madeira

`run` is deliberately bounded: it processes at most `--max-tiles` and returns.
Scheduling it every few minutes crawls a region gradually without ever holding
a long-running process or tripping an upstream rate limit.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .coverage import summarise, survey, write_geojson
from .crawl import KINDS, CrawlQueue, RateLimiter, run
from .db import BlobIndex, BlobRecord, geo_fields
from .geo import BBox
from .source_check import CANDIDATES
from .store import BlobStore

#: Mirrors apps/napplet/src/config/regions.ts. Kept minimal on purpose: the
#: crawler only needs where to look, not how to draw it.
REGIONS: dict[str, BBox] = {
    "madeira": BBox(west=-17.32, south=32.35, east=-16.24, north=33.15),
    "south-tyrol": BBox(west=10.38, south=46.21, east=12.48, north=47.10),
    "vienna": BBox(west=16.18, south=48.11, east=16.58, north=48.33),
    # A rectangle cannot exclude a country; this clips most of European Russia.
    "europe": BBox(west=-25.0, south=34.0, east=32.0, north=71.5),
}

DEFAULT_ZOOM = 13

#: Which imagery services are worth probing for each region, best first.
REGION_CANDIDATES = {
    "madeira": [c for c in CANDIDATES if c.id in ("dgt-pt-ortosat", "esri-world-imagery")],
    "south-tyrol": [c for c in CANDIDATES if c.id in ("irig-south-tyrol", "esri-world-imagery")],
    "vienna": [c for c in CANDIDATES if c.id == "esri-world-imagery"],
    # Continental sweep uses the one source that answers everywhere; national
    # services are upgrades applied per region, not probed 40 times per cell.
    "europe": [c for c in CANDIDATES if c.id == "esri-world-imagery"],
}


def _paths() -> tuple[Path, Path, Path]:
    root = Path(os.environ.get("BLOSSOM_GIS_DATA", "./.local/blossom-gis"))
    return root / "blobs", root / "index.sqlite", root / "crawl.sqlite"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="blossom-gis-crawler")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "character",
        help="store the deterministic demo character in the blob store, print its hash",
    )

    crab = sub.add_parser(
        "crab",
        help="re-transcode secrab with its painted skin and bake the gait frames",
    )
    crab.add_argument("--frames", type=int, default=10)

    prewarm = sub.add_parser(
        "prewarm",
        help="warm every cache the demo selections touch, via the running server",
    )
    prewarm.add_argument(
        "--selection",
        default="all",
        help="named demo selection, or 'all'",
    )
    prewarm.add_argument("--base-url", default="http://127.0.0.1:8787")

    place = sub.add_parser(
        "place",
        help="anchor a named character in the terrain at lon,lat",
    )
    place.add_argument("--character", required=True)
    place.add_argument("--at", required=True, help="lon,lat in EPSG:4326")
    place.add_argument("--heading", type=float, default=0.0, help="degrees clockwise from north")

    mirror = sub.add_parser(
        "mirror",
        help="pull a content-addressed blob from another blossom server, verify its hash",
    )
    mirror.add_argument("--url", required=True, help="blossom URL ending in the sha256")
    mirror.add_argument(
        "--character",
        default="",
        help="also register the blob under this name in characters.json",
    )

    for name in ("seed", "run", "status", "coverage"):
        p = sub.add_parser(name)
        p.add_argument("--region", required=True, choices=sorted(REGIONS))
        if name == "seed":
            p.add_argument("--zoom", type=int, default=DEFAULT_ZOOM)
            p.add_argument(
                "--kinds",
                default=",".join(KINDS),
                help="comma-separated layers to enqueue; terrain and imagery lead",
            )
        if name == "run":
            p.add_argument("--max-tiles", type=int, default=5)
            p.add_argument("--min-interval", type=float, default=4.0)
        if name == "coverage":
            p.add_argument("--zoom", type=int, default=11)
            p.add_argument("--sources", default="", help="comma-separated source ids")

    args = parser.parse_args(argv)
    blob_dir, index_path, queue_path = _paths()

    if args.command == "character":
        import time

        from .character import build_character_glb

        payload = build_character_glb()
        stored = BlobStore(blob_dir).put(payload)
        index = BlobIndex(index_path)
        index.upsert(
            BlobRecord(
                sha256=stored.sha256,
                size=stored.size,
                media_type="model/gltf-binary",
                uploaded_by="cli:character",
                uploaded_at=int(time.time()),
                tile_z=None,
                tile_x=None,
                tile_y=None,
                **geo_fields(None),
            )
        )
        index.close()
        print(f"character blob: {stored.sha256} ({stored.size:,} bytes)")
        print(f"fetch as: /{stored.sha256}.glb")
        return 0

    if args.command == "crab":
        import json
        import time

        from .character import _pack_glb, decode_draco_geometry
        from .gait import bake_gait_frames

        manifest_path = blob_dir.parent / "characters.json"
        if not manifest_path.is_file():
            print("no characters.json — mirror secrab first")
            return 1
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entry = manifest.get("secrab")
        if not entry:
            print("secrab is not in characters.json")
            return 1
        source_sha = entry.get("transcoded_from") or entry["sha256"]
        store = BlobStore(blob_dir)
        payload = store.read(source_sha)
        if payload is None:
            print(f"source blob {source_sha} is not in the store")
            return 1

        print(f"decoding {source_sha[:12]}…")
        positions, normals, uvs, indices, texture = decode_draco_geometry(payload)
        skin = "with skin" if texture and uvs else "UNTEXTURED"
        print(
            f"  {len(positions) // 3:,} vertices, {len(indices) // 3:,} faces, {skin}"
        )

        index = BlobIndex(index_path)

        def register(blob_payload: bytes) -> tuple[str, int]:
            stored = store.put(blob_payload)
            index.upsert(
                BlobRecord(
                    sha256=stored.sha256,
                    size=stored.size,
                    media_type="model/gltf-binary",
                    uploaded_by="cli:crab",
                    uploaded_at=int(time.time()),
                    tile_z=None,
                    tile_x=None,
                    tile_y=None,
                    **geo_fields(None),
                )
            )
            return stored.sha256, stored.size

        rest_sha, rest_size = register(
            _pack_glb(positions, normals, indices, uvs=uvs, texture=texture)
        )
        print(f"rest pose: {rest_sha} ({rest_size:,} bytes)")

        frame_shas: list[str] = []
        for i, frame in enumerate(
            bake_gait_frames(
                positions, normals, indices, uvs=uvs, texture=texture,
                frame_count=args.frames,
            )
        ):
            sha, size = register(frame)
            frame_shas.append(sha)
            print(f"frame {i}: {sha[:12]} ({size:,} bytes)")
        index.close()

        manifest["secrab"] = {
            "sha256": rest_sha,
            "size": rest_size,
            "transcoded_from": source_sha,
            "frames": frame_shas,
        }
        manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        print(f"characters.json updated — secrab now walks with {skin}")
        return 0

    if args.command == "prewarm":
        from .prewarm import DEMO_SELECTIONS, prewarm_selection

        wanted = (
            DEMO_SELECTIONS
            if args.selection == "all"
            else {args.selection: DEMO_SELECTIONS[args.selection]}
        )
        failures = 0
        for name, (region, box) in wanted.items():
            print(f"{name} ({region}):")
            results = prewarm_selection(args.base_url, region, box)
            failures += sum(1 for value in results.values() if value.startswith("FAILED"))
        print("prewarm complete" + (f" — {failures} FAILURES" if failures else " — all warm"))
        return 1 if failures else 0

    if args.command == "place":
        import json

        manifest_path = blob_dir.parent / "characters.json"
        if not manifest_path.is_file():
            print("no characters.json — mirror some characters first")
            return 1
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entry = manifest.get(args.character)
        if not entry:
            print(f"unknown character: {args.character} (have: {', '.join(sorted(manifest))})")
            return 1
        try:
            lon, lat = (float(v) for v in args.at.split(","))
        except ValueError:
            print("--at must be 'lon,lat'")
            return 1

        placements_file = blob_dir.parent / "placements.json"
        placements = []
        if placements_file.is_file():
            placements = json.loads(placements_file.read_text(encoding="utf-8"))
        placements = [p for p in placements if p.get("name") != args.character]
        placements.append(
            {
                "name": args.character,
                "sha256": entry["sha256"],
                "lon": lon,
                "lat": lat,
                "heading": args.heading,
            }
        )
        placements_file.write_text(json.dumps(placements, indent=1), encoding="utf-8")
        print(f"placed {args.character} at {lon},{lat} (heading {args.heading}°)")
        return 0

    if args.command == "mirror":
        import hashlib
        import json
        import time
        import urllib.request

        expected = args.url.rsplit("/", 1)[-1].split(".", 1)[0]
        request = urllib.request.Request(
            args.url, headers={"User-Agent": "terrCVM-mirror/0.1"}
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
        digest = hashlib.sha256(payload).hexdigest()
        if digest != expected:
            print(f"REFUSED: content hash {digest} does not match the URL ({expected})")
            return 1

        is_glb = payload[:4] == b"glTF"
        stored = BlobStore(blob_dir).put(payload)
        index = BlobIndex(index_path)
        index.upsert(
            BlobRecord(
                sha256=stored.sha256,
                size=stored.size,
                media_type="model/gltf-binary" if is_glb else "application/octet-stream",
                uploaded_by="cli:mirror",
                uploaded_at=int(time.time()),
                tile_z=None,
                tile_x=None,
                tile_y=None,
                **geo_fields(None),
            )
        )
        index.close()
        print(f"mirrored {stored.sha256} ({stored.size:,} bytes)")

        if args.character:
            manifest_path = blob_dir.parent / "characters.json"
            manifest = {}
            if manifest_path.is_file():
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest[args.character] = {"sha256": stored.sha256, "size": stored.size}
            manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
            print(f"registered as character: {args.character}")
        return 0

    queue = CrawlQueue(queue_path)

    try:
        if args.command == "seed":
            kinds = tuple(k.strip() for k in args.kinds.split(",") if k.strip())
            count = queue.seed(args.region, REGIONS[args.region], args.zoom, kinds)
            print(
                f"seeded {count} items for {args.region} at z{args.zoom} "
                f"({', '.join(kinds)})"
            )
            return 0

        if args.command == "status":
            summary = queue.progress(args.region)
            if not summary.get("total"):
                print(f"{args.region}: nothing seeded yet")
                return 0
            done = summary.get("done", 0)
            total = summary["total"]
            print(
                f"{args.region}: {done}/{total} done "
                f"({done / total * 100:.1f}%), pending={summary.get('pending', 0)}, "
                f"failed={summary.get('failed', 0)}, exhausted={summary['exhausted']}"
            )
            return 0

        if args.command == "coverage":
            bounds = REGIONS[args.region]
            wanted = [s.strip() for s in args.sources.split(",") if s.strip()]
            by_id = {c.id: c for c in CANDIDATES}
            if wanted:
                candidates = [by_id[i] for i in wanted if i in by_id]
            else:
                candidates = REGION_CANDIDATES.get(args.region, list(CANDIDATES))
            print(
                f"surveying {args.region} at z{args.zoom} "
                f"({', '.join(c.id for c in candidates)})"
            )

            def report(cell):
                flag = {"covered": "OK  ", "gap": "GAP ", "sea": "sea "}.get(cell.status, "??  ")
                print(
                    f"  {flag}z{cell.z}/{cell.x}/{cell.y}  {cell.source_id:<20}"
                    f"{cell.verdict}"
                )

            cells = list(survey(bounds, candidates, args.zoom, on_cell=report))
            out = blob_dir.parent / "coverage" / f"{args.region}-z{args.zoom}.geojson"
            write_geojson(cells, args.region, args.zoom, out)
            stats = summarise(cells)
            print(
                f"\n{args.region}: {stats['covered']}/{stats['cells']} cells covered "
                f"({stats['percent']}%), ~{stats['covered_km2']:,} of "
                f"{stats['total_km2']:,} km2"
            )
            print(f"   states: {stats['states']}")
            if stats["land_cells"]:
                print(
                    f"   on land: {stats['covered']}/{stats['land_cells']} "
                    f"({stats['land_percent']}%)"
                )
            for source_id, count in stats["by_source"].items():
                print(f"   {source_id:<24}{count} cells")
            print(f"wrote {out}")
            return 0

        store = BlobStore(blob_dir)
        index = BlobIndex(index_path)
        limiter = RateLimiter(args.min_interval)
        processed = 0

        for record in run(
            queue=queue,
            store=store,
            index=index,
            region=args.region,
            max_tiles=args.max_tiles,
            limiter=limiter,
        ):
            tile = record["tile"]
            label = f"{tile.kind:<8} z{tile.z}/{tile.x}/{tile.y}"
            if "error" in record:
                print(f"  {label} FAILED {record['error'][:120]}")
            elif "skipped" in record:
                print(f"  {label} skipped: {record['skipped']}")
            else:
                extra = ""
                if "buildings" in record:
                    extra = (
                        f"b={record['buildings']:<5} r={record['roads']:<5} "
                        f"l={record['landuse']:<5} "
                    )
                print(f"  {label} ok {record['bytes']:>8,}B  {extra}{record['sha256'][:12]}")
                processed += 1

        summary = queue.progress(args.region)
        print(
            f"{args.region}: processed {processed} this run; "
            f"{summary.get('done', 0)}/{summary['total']} done"
        )
        index.close()
        return 0
    finally:
        queue.close()


if __name__ == "__main__":
    sys.exit(main())
