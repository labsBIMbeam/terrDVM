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
from .db import BlobIndex
from .geo import BBox
from .source_check import CANDIDATES
from .store import BlobStore

#: Mirrors apps/napplet/src/config/regions.ts. Kept minimal on purpose: the
#: crawler only needs where to look, not how to draw it.
REGIONS: dict[str, BBox] = {
    "madeira": BBox(west=-17.32, south=32.35, east=-16.24, north=33.15),
    "south-tyrol": BBox(west=10.38, south=46.21, east=12.48, north=47.10),
    # A rectangle cannot exclude a country; this clips most of European Russia.
    "europe": BBox(west=-25.0, south=34.0, east=32.0, north=71.5),
}

DEFAULT_ZOOM = 13

#: Which imagery services are worth probing for each region, best first.
REGION_CANDIDATES = {
    "madeira": [c for c in CANDIDATES if c.id in ("dgt-pt-ortosat", "esri-world-imagery")],
    "south-tyrol": [c for c in CANDIDATES if c.id in ("irig-south-tyrol", "esri-world-imagery")],
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
