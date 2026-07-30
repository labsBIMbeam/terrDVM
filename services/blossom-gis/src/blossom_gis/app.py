"""GIS-grade Blossom server.

Blossom endpoints (BUD-01/BUD-02 subset):
    GET    /<sha256>[.ext]   retrieve a blob
    HEAD   /<sha256>[.ext]   metadata only
    PUT    /upload           store a blob (kind-24242 authorization)
    GET    /list/<pubkey>    list a pubkey's blobs
    DELETE /<sha256>         remove a blob (kind-24242 authorization)

GIS extensions:
    GET /geo?bbox=w,s,e,n    blobs whose footprint overlaps a bounding box
    GET /tile/<z>/<x>/<y>    blobs bound to a slippy tile

Geo metadata is supplied at upload time via the `X-Geo-BBox` and optional
`X-Geo-Tile` headers, and is validated before it is indexed.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from . import texture as texture_module
from .cli import REGIONS as SURVEY_REGIONS
from .db import BlobIndex, BlobRecord, geo_fields
from .geo import BBox, tile_bbox, tile_for_point
from .nostr import authorize, parse_auth_header
from .source_check import CANDIDATES
from .store import BlobStore, is_valid_sha256

DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024


def _settings() -> tuple[Path, str, int]:
    data_dir = Path(os.environ.get("BLOSSOM_GIS_DATA", "./.local/blossom-gis"))
    base_url = os.environ.get("BLOSSOM_GIS_BASE_URL", "http://127.0.0.1:8787")
    max_upload = int(
        os.environ.get("BLOSSOM_GIS_MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))
    )
    return data_dir, base_url, max_upload


DATA_DIR, BASE_URL, MAX_UPLOAD_BYTES = _settings()

app = FastAPI(title="blossom-gis", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Geo-BBox", "X-Geo-Tile"],
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
)

_store = BlobStore(DATA_DIR / "blobs")
_index = BlobIndex(DATA_DIR / "index.sqlite")


def store() -> BlobStore:
    return _store


def index() -> BlobIndex:
    return _index


def _parse_bbox_header(raw: str | None) -> BBox | None:
    if raw is None or not raw.strip():
        return None
    parts = raw.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "X-Geo-BBox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(400, "X-Geo-BBox values must be numbers") from exc
    try:
        return BBox(west=west, south=south, east=east, north=north)
    except ValueError as exc:
        raise HTTPException(400, f"invalid bounding box: {exc}") from exc


def _parse_tile_header(raw: str | None) -> tuple[int, int, int] | None:
    if raw is None or not raw.strip():
        return None
    parts = raw.split("/")
    if len(parts) != 3:
        raise HTTPException(400, "X-Geo-Tile must be 'z/x/y'")
    try:
        z, x, y = (int(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(400, "X-Geo-Tile values must be integers") from exc
    try:
        tile_bbox(z, x, y)
    except ValueError as exc:
        raise HTTPException(400, f"invalid tile: {exc}") from exc
    return (z, x, y)


def _strip_extension(descriptor: str) -> str:
    return descriptor.split(".", 1)[0]


@app.get("/")
def server_info() -> dict[str, object]:
    return {
        "name": "blossom-gis",
        "version": "0.1.0",
        "buds": ["BUD-01", "BUD-02"],
        "extensions": ["geo-bbox", "geo-tile", "range"],
        "max_upload_bytes": MAX_UPLOAD_BYTES,
    }


@app.get("/geo")
def query_geo(
    bbox: str,
    limit: int = 100,
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "bbox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(p) for p in parts)
        box = BBox(west=west, south=south, east=east, north=north)
    except ValueError as exc:
        raise HTTPException(400, f"invalid bbox: {exc}") from exc

    limit = max(1, min(limit, 1000))
    records = db.query_bbox(box, limit=limit)
    return JSONResponse([r.to_descriptor(BASE_URL) for r in records])


@app.get("/tile/{z}/{x}/{y}")
def query_tile(
    z: int,
    x: int,
    y: int,
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    try:
        tile_bbox(z, x, y)
    except ValueError as exc:
        raise HTTPException(400, f"invalid tile: {exc}") from exc
    return JSONResponse([r.to_descriptor(BASE_URL) for r in db.query_tile(z, x, y)])


@app.get("/list/{pubkey}")
def list_blobs(
    pubkey: str,
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    if len(pubkey) != 64 or not all(c in "0123456789abcdef" for c in pubkey.lower()):
        raise HTTPException(400, "pubkey must be 64 hex characters")
    records = db.list_by_pubkey(pubkey.lower())
    return JSONResponse([r.to_descriptor(BASE_URL) for r in records])


@app.put("/upload")
async def upload(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_geo_bbox: Annotated[str | None, Header()] = None,
    x_geo_tile: Annotated[str | None, Header()] = None,
    blobs: Annotated[BlobStore, Depends(store)] = None,  # type: ignore[assignment]
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    body = await request.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"upload exceeds {MAX_UPLOAD_BYTES} bytes")

    import hashlib

    digest = hashlib.sha256(body).hexdigest()

    event = parse_auth_header(authorization)
    result = authorize(event, verb="upload", now=int(time.time()), blob_sha256=digest)
    if not result.ok:
        raise HTTPException(401, result.reason or "unauthorized")

    box = _parse_bbox_header(x_geo_bbox)
    tile = _parse_tile_header(x_geo_tile)
    if tile is not None and box is None:
        box = tile_bbox(*tile)
    if tile is None and box is not None:
        # Bind to the zoom-14 tile containing the footprint centre, so tile
        # lookups work even when the client only supplied a bounding box.
        lat, lon = box.center
        tile = (14, *tile_for_point(lat, lon, 14))

    stored = blobs.put(body)
    record = BlobRecord(
        sha256=stored.sha256,
        size=stored.size,
        media_type=request.headers.get("content-type", "application/octet-stream"),
        uploaded_by=result.pubkey or "",
        uploaded_at=int(time.time()),
        tile_z=tile[0] if tile else None,
        tile_x=tile[1] if tile else None,
        tile_y=tile[2] if tile else None,
        **geo_fields(box),
    )
    db.upsert(record)
    return JSONResponse(record.to_descriptor(BASE_URL), status_code=201)


@app.delete("/{descriptor}")
def delete_blob(
    descriptor: str,
    authorization: Annotated[str | None, Header()] = None,
    blobs: Annotated[BlobStore, Depends(store)] = None,  # type: ignore[assignment]
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> Response:
    sha256 = _strip_extension(descriptor)
    if not is_valid_sha256(sha256):
        raise HTTPException(400, "not a valid blob hash")

    event = parse_auth_header(authorization)
    result = authorize(event, verb="delete", now=int(time.time()), blob_sha256=sha256)
    if not result.ok:
        raise HTTPException(401, result.reason or "unauthorized")

    record = db.get(sha256)
    if record is None:
        raise HTTPException(404, "blob not found")
    if record.uploaded_by != result.pubkey:
        raise HTTPException(403, "only the uploader may delete this blob")

    blobs.delete(sha256)
    db.delete(sha256)
    return Response(status_code=204)


# --- Upstream request cache --------------------------------------------------
#
# Demo speed and upstream courtesy: every DEM tile and Overpass answer is
# stored on first fetch and served from disk afterwards. Overpass throttles
# repeated identical queries within minutes — observed live as buildings
# silently vanishing from reruns — so the cache is correctness, not just speed.

OVERPASS_UPSTREAM = "https://overpass-api.de/api/interpreter"
TERRARIUM_UPSTREAM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def cache_dir() -> Path:
    return DATA_DIR / "cache"


def upstream_fetch():
    """Upstream HTTP fetch dependency — overridden in tests."""

    def fetch(url: str, timeout_s: float) -> bytes:
        import urllib.request

        request = urllib.request.Request(
            url, headers={"User-Agent": "terrDVM-cache/0.1 (+https://github.com/labsBIMbeam/terrDVM)"}
        )
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return response.read()

    return fetch


def _cache_write(path: Path, payload: bytes) -> None:
    """Atomic write: a crash must never leave a truncated entry served forever."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


@app.get("/osm")
def osm_cached(
    data: str,
    directory: Annotated[Path, Depends(cache_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(upstream_fetch)] = None,  # type: ignore[assignment]
) -> Response:
    """Caching proxy pinned to the Overpass interpreter — not an open proxy.

    The query travels verbatim so the client and server never need to agree on
    query-building logic. OSM data is ODbL; the cache stores it unmodified and
    the client keeps carrying the attribution.
    """
    import hashlib
    import urllib.parse

    if not data.strip() or len(data) > 8_000:
        raise HTTPException(400, "data must be a non-empty Overpass query under 8000 chars")

    key = hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]
    path = directory / "osm" / f"{key}.json"
    if not path.exists():
        url = f"{OVERPASS_UPSTREAM}?{urllib.parse.urlencode({'data': data})}"
        try:
            payload = fetch(url, 30)
        except Exception as exc:  # noqa: BLE001 — surface as a named upstream failure
            raise HTTPException(502, f"overpass fetch failed: {exc}") from exc
        _cache_write(path, payload)
    return Response(
        content=path.read_bytes(),
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=86400", "X-Cache-Key": key},
    )


@app.get("/dem/{z}/{x}/{y}.png")
def dem_cached(
    z: int,
    x: int,
    y: int,
    directory: Annotated[Path, Depends(cache_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(upstream_fetch)] = None,  # type: ignore[assignment]
) -> Response:
    """Caching proxy for Mapzen Terrarium DEM tiles (AWS Open Data)."""
    try:
        tile_bbox(z, x, y)
    except ValueError as exc:
        raise HTTPException(400, f"invalid tile: {exc}") from exc

    path = directory / "dem" / str(z) / str(x) / f"{y}.png"
    if not path.exists():
        try:
            payload = fetch(TERRARIUM_UPSTREAM.format(z=z, x=x, y=y), 30)
        except Exception as exc:  # noqa: BLE001 — surface as a named upstream failure
            raise HTTPException(502, f"dem fetch failed: {exc}") from exc
        _cache_write(path, payload)
    return Response(
        content=path.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# --- Dashboard ---------------------------------------------------------------


def _directory_stats(path: Path, pattern: str = "**/*") -> tuple[int, int]:
    """(file count, total bytes) under a directory; zeros when absent."""
    if not path.is_dir():
        return 0, 0
    files = [p for p in path.glob(pattern) if p.is_file()]
    return len(files), sum(p.stat().st_size for p in files)


def _format_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "kB", "MB", "GB"):
        if value < 1000 or unit == "GB":
            return f"{value:,.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1000
    return f"{value:,.1f} GB"


#: Who runs each source — a state mapping agency, a company, or a community.
#: Display metadata only; licences remain the binding facts.
SOURCE_OPERATORS: dict[str, str] = {
    "esri-world-imagery": "commercial — Esri Inc.",
    "irig-south-tyrol": "state — Autonome Provinz Bozen / Südtirol",
    "irig-south-tyrol-ortho": "state — Autonome Provinz Bozen / Südtirol",
    "swisstopo-swissimage": "state — swisstopo (Swiss federal office)",
    "nrw-dop": "state — Geobasis NRW (German Land)",
    "pdok-luchtfoto": "state — PDOK / Kadaster (Netherlands)",
    "ign-fr-ortho": "state — IGN France",
    "ign-es-pnoa": "state — IGN Spain",
    "dgt-pt-ortosat": "state — DGT Portugal",
    "lu-ortho": "state — ACT Luxembourg",
    "drote-madeira-ortho": "state — DROTe, Região Autónoma da Madeira",
    "basemap-at-ortho": "state — basemap.at (Austrian Länder cooperative)",
}


def _operator(source_id: str) -> str:
    return SOURCE_OPERATORS.get(source_id, "—")


def _coverage_svg(survey: dict) -> str:
    """The continental sweep as a schematic map — where imagery exists.

    Equirectangular on purpose: this is a status chart on a lon/lat grid,
    not a navigation map, and the survey cells are axis-aligned in exactly
    this projection.
    """
    cells: list[str] = []
    for feature in survey.get("features", []):
        try:
            ring = feature["geometry"]["coordinates"][0]
        except (KeyError, IndexError, TypeError):
            continue
        xs = [point[0] for point in ring]
        ys = [point[1] for point in ring]
        west, east, south, north = min(xs), max(xs), min(ys), max(ys)
        status = feature.get("properties", {}).get("status", "unknown")
        fill = {"covered": "#F7931A", "gap": "#33230e", "sea": "#141920"}.get(status, "#2a2a2a")
        stroke = ' stroke="#F7931A" stroke-width="0.5"' if status == "gap" else ""
        cells.append(
            f'<rect x="{(west + 25.0) * 10:.1f}" y="{(71.5 - north) * 10:.1f}" '
            f'width="{(east - west) * 10:.1f}" height="{(north - south) * 10:.1f}" '
            f'fill="{fill}"{stroke}/>'
        )
    return (
        '<svg viewBox="0 0 570 375" role="img" '
        'style="max-width:640px;width:100%;background:#0d1013;border:1px solid #3a342c">'
        + "".join(cells)
        + "</svg>"
    )


@app.get("/dashboard")
def dashboard() -> HTMLResponse:
    """Where every byte comes from, and what already lives on this disk.

    Server-rendered on purpose: the page states what the collection server
    knows at request time, with no client fetches to go stale or fail.
    """
    import html
    import json

    rows: list[str] = []
    for region, source_ids in sorted(texture_module.REGION_SOURCES.items()):
        for rank, source_id in enumerate(source_ids):
            source = texture_module.SOURCES[source_id]
            host = source.url.split("/")[2]
            badge = " <span class=badge>fallback</span>" if rank else ""
            rows.append(
                f"<tr><td>{html.escape(region) if rank == 0 else ''}</td>"
                f"<td>{html.escape(source.name)}{badge}</td>"
                f"<td>{html.escape(source.kind.upper())}</td>"
                f"<td>{html.escape(host)}</td>"
                f"<td>{html.escape(_operator(source_id))}</td>"
                f"<td>{html.escape(source.license)}</td></tr>"
            )

    # The full qualified pool: every service that passed its one-request
    # probe, whether a region chain uses it yet or not.
    pool_rows: list[str] = []
    for candidate in CANDIDATES:
        host = candidate.url.split("/")[2]
        wired = sorted(
            r
            for r, ids in texture_module.REGION_SOURCES.items()
            if any(texture_module.SOURCES[i].url.split("/")[2] == host for i in ids)
        )
        wired_label = ", ".join(wired) if wired else "qualified — not wired yet"
        pool_rows.append(
            f"<tr><td>{html.escape(candidate.name)}</td>"
            f"<td>{html.escape(candidate.country)}</td>"
            f"<td>{html.escape(candidate.kind.upper())}</td>"
            f"<td>{html.escape(_operator(candidate.id))}</td>"
            f"<td>{html.escape(candidate.license)}</td>"
            f"<td>{html.escape(wired_label)}</td></tr>"
        )

    # Coverage surveys: stats for every survey on disk, the continental map
    # for europe.
    coverage_rows: list[str] = []
    europe_svg = ""
    coverage_dir = DATA_DIR / "coverage"
    if coverage_dir.is_dir():
        for survey_path in sorted(coverage_dir.glob("*.geojson")):
            try:
                survey = json.loads(survey_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            props = survey.get("properties", {})
            land = (props.get("covered") or 0) + (props.get("gaps") or 0)
            share = f"{100 * (props.get('covered') or 0) / land:.1f}%" if land else "—"
            coverage_rows.append(
                f"<tr><td>{html.escape(str(props.get('region', '?')))}</td>"
                f"<td>z{props.get('zoom', '?')}</td><td>{props.get('cells', '?')}</td>"
                f"<td>{props.get('covered', '?')}</td><td>{props.get('gaps', '?')}</td>"
                f"<td>{props.get('sea', '?')}</td><td>{share}</td></tr>"
            )
            if props.get("region") == "europe":
                europe_svg = _coverage_svg(survey)

    dem_count, dem_bytes = _directory_stats(DATA_DIR / "cache" / "dem")
    osm_count, osm_bytes = _directory_stats(DATA_DIR / "cache" / "osm")
    blob_count, blob_bytes = _directory_stats(DATA_DIR / "blobs")

    bakes: list[str] = []
    texture_root = DATA_DIR / "textures"
    if texture_root.is_dir():
        for meta_path in sorted(texture_root.glob("*.json")):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            image = meta_path.with_suffix(".jpg")
            size = image.stat().st_size if image.exists() else 0
            bbox = ",".join(f"{v:.3f}" for v in meta.get("bbox", []))
            bakes.append(
                f"<tr><td>{html.escape(str(meta.get('region', '?')))}</td>"
                f"<td>{html.escape(str(meta.get('source', {}).get('name', '?')))}</td>"
                f"<td>{bbox}</td>"
                f"<td>{meta.get('m_per_px', '?')} m/px</td>"
                f"<td>{_format_bytes(size)}</td></tr>"
            )

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<title>terrDVM — data flows</title>
<style>
  body {{ background: #111; color: #e8e2d6; font: 14px/1.5 system-ui, sans-serif;
         margin: 0; padding: 2rem; }}
  h1, h2 {{ color: #F7931A; font-weight: 600; letter-spacing: .04em; }}
  h1 {{ border-block-end: 2px solid #F7931A; padding-block-end: .5rem; }}
  table {{ border-collapse: collapse; margin-block: 1rem 2rem; width: 100%; }}
  th, td {{ border-block-end: 1px solid #3a342c; padding: .4rem .8rem;
            text-align: left; vertical-align: top; }}
  th {{ color: #9a927f; font-size: .8rem; text-transform: uppercase; }}
  .badge {{ background: #2a2419; border: 1px solid #F7931A; border-radius: 4px;
            color: #F7931A; font-size: .7rem; padding: 0 .4rem; }}
  .stat {{ display: inline-block; margin-inline-end: 2.5rem; }}
  .stat b {{ color: #F7931A; display: block; font-size: 1.6rem; }}
  footer {{ color: #9a927f; font-size: .8rem; }}
</style></head><body>
<h1>terrDVM — data flows</h1>
<p>Every external byte, its source and its licence. Refreshes every 15&nbsp;s.</p>

<h2>Imagery sources by region</h2>
<table><tr><th>Region</th><th>Source</th><th>Kind</th><th>Endpoint</th><th>Operator</th>
<th>Licence</th></tr>
{''.join(rows)}</table>

<h2>Qualified source pool</h2>
<p>Every service that passed its one-request qualification probe
(detail score + payload density, see ARCHITECTURE.md) — wired into a region
chain or waiting.</p>
<table><tr><th>Source</th><th>Country</th><th>Kind</th><th>Operator</th><th>Licence</th>
<th>Wired into</th></tr>
{''.join(pool_rows)}</table>

<h2>Fixed upstreams</h2>
<table><tr><th>Layer</th><th>Endpoint</th><th>Operator</th><th>Licence</th></tr>
<tr><td>Elevation (DEM)</td><td>s3.amazonaws.com — Mapzen Terrarium</td>
<td>open data — AWS Open Data, from state DEMs (NASA SRTM, USGS GMTED/NED)</td>
<td>public data, attribution</td></tr>
<tr><td>Buildings, roads, land use</td><td>overpass-api.de</td>
<td>community — OpenStreetMap contributors</td>
<td>ODbL-1.0 — share-alike is infectious for derived geometry</td></tr>
<tr><td>Basemap (map view)</td><td>tile.openstreetmap.org</td>
<td>community — OpenStreetMap Foundation</td>
<td>ODbL, visible attribution</td></tr>
</table>

<h2>Europe coverage — z7 sweep</h2>
{europe_svg or '<p>no continental survey on this data root — run the coverage command</p>'}
<p>Solid orange: architectural resolution verified at the cell centre.
Outlined: land with no qualified imagery — the gap the map warns about.
Dark: sea. Schematic lon/lat grid, one probe per ~200 km cell.</p>
<table><tr><th>Survey</th><th>Grid</th><th>Cells</th><th>Covered</th><th>Gaps</th>
<th>Sea</th><th>Land covered</th></tr>
{''.join(coverage_rows) or '<tr><td colspan=7>no surveys on this data root</td></tr>'}</table>

<h2>Local holdings</h2>
<p>
<span class="stat"><b>{dem_count}</b>DEM tiles · {_format_bytes(dem_bytes)}</span>
<span class="stat"><b>{osm_count}</b>Overpass answers · {_format_bytes(osm_bytes)}</span>
<span class="stat"><b>{len(bakes)}</b>texture bakes</span>
<span class="stat"><b>{blob_count}</b>blobs · {_format_bytes(blob_bytes)}</span>
</p>

<h2>Texture bakes on disk</h2>
<table><tr><th>Region</th><th>Source</th><th>BBox (W,S,E,N)</th><th>Resolution</th>
<th>Size</th></tr>
{''.join(bakes) or '<tr><td colspan=5>none yet — generate a selection</td></tr>'}</table>

<footer>Data root: {html.escape(str(DATA_DIR.resolve()))} · attribution travels with
every bake as a sidecar file.</footer>
</body></html>"""
    return HTMLResponse(page)


# --- Avatar placements --------------------------------------------------------


def placements_path() -> Path:
    return DATA_DIR / "placements.json"


@app.get("/placements/event")
def placement_event(
    character: str,
    at: str,
    heading: float = 0.0,
) -> JSONResponse:
    """Build the unsigned nostr announcement for a placement.

    NIP-94 (kind 1063): the blob's hash, its URL, mime and size, plus the
    exact position as a bbox tag and one `g` tag per geohash precision so
    generic relays can serve coarse geo queries. The caller signs with their
    own signer — this server never holds a key.
    """
    import json
    import time

    from .geo import geohash_encode

    manifest_path = DATA_DIR / "characters.json"
    if not manifest_path.is_file():
        raise HTTPException(404, "no characters mirrored yet")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = manifest.get(character)
    if not entry:
        raise HTTPException(404, f"unknown character: {character}")
    parts = at.split(",")
    if len(parts) != 2:
        raise HTTPException(400, "at must be 'lon,lat'")
    try:
        lon, lat = float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise HTTPException(400, "at values must be numbers") from exc
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise HTTPException(400, "at is outside the world")

    sha = entry["sha256"]
    tags = [
        ["x", sha],
        ["url", f"{BASE_URL}/{sha}.glb"],
        ["m", "model/gltf-binary"],
        ["size", str(entry.get("size", 0))],
        ["bbox", f"{lon:.6f},{lat:.6f},{lon:.6f},{lat:.6f}"],
        ["heading", f"{heading:.1f}"],
        ["t", "terrdvm-avatar"],
        ["name", character],
    ]
    for precision in range(1, 9):
        tags.append(["g", geohash_encode(lat, lon, precision)])
    return JSONResponse(
        {
            "kind": 1063,
            "created_at": int(time.time()),
            "content": f"{character} standing at {lat:.5f}, {lon:.5f} — "
            f"fetch the model by hash from any blossom mirror.",
            "tags": tags,
        }
    )


@app.post("/placements")
async def add_placement(
    request: Request,
    path: Annotated[Path, Depends(placements_path)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    """Record a placement locally so the demo map stays in sync.

    The nostr event is the network's source of truth; this file is only the
    local mirror the map reads.
    """
    import json

    try:
        body = json.loads(await request.body())
    except ValueError as exc:
        raise HTTPException(400, "body must be JSON") from exc
    name = body.get("name")
    sha = str(body.get("sha256", ""))
    lon = body.get("lon")
    lat = body.get("lat")
    if (
        not isinstance(name, str)
        or not is_valid_sha256(sha)
        or not isinstance(lon, (int, float))
        or not isinstance(lat, (int, float))
        or not (-180 <= lon <= 180 and -90 <= lat <= 90)
    ):
        raise HTTPException(400, "placement needs name, sha256, lon, lat")

    entries = []
    if path.is_file():
        entries = json.loads(path.read_text(encoding="utf-8"))
    entries = [e for e in entries if e.get("name") != name]
    entries.append(
        {
            "name": name,
            "sha256": sha,
            "lon": float(lon),
            "lat": float(lat),
            "heading": float(body.get("heading", 0.0)),
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, indent=1), encoding="utf-8")
    return JSONResponse({"ok": True, "count": len(entries)})


@app.get("/placements")
def placements(
    bbox: str | None = None,
    path: Annotated[Path, Depends(placements_path)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    """Models placed in the terrain: content hash plus a geo anchor.

    This is the whole interop story in one endpoint — any app that can read
    this list and fetch a blob by hash can stand the avatar in its own scene.
    """
    import json

    if not path.is_file():
        return JSONResponse([])
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return JSONResponse([])
    if not isinstance(entries, list):
        return JSONResponse([])

    if bbox:
        parts = bbox.split(",")
        if len(parts) != 4:
            raise HTTPException(400, "bbox must be 'west,south,east,north'")
        try:
            west, south, east, north = (float(p) for p in parts)
        except ValueError as exc:
            raise HTTPException(400, "bbox values must be numbers") from exc
        entries = [
            e
            for e in entries
            if west <= e.get("lon", 999) <= east and south <= e.get("lat", 999) <= north
        ]
    return JSONResponse(entries)


# --- Cached WFS proxy ---------------------------------------------------------

#: Registered WFS sources — pinned, never an open proxy. Vienna's building-body
#: model carries measured top/terrain elevations per building part, which is a
#: different league from OSM's storey guesses.
WFS_SOURCES: dict[str, dict[str, str]] = {
    "vienna-bkm": {
        "url": "https://data.wien.gv.at/daten/geo",
        "typename": "ogdwien:FMZKBKMOGD",
        "license": "CC-BY-4.0 (Open Government Data Wien)",
        # ASCII only: this string travels as an HTTP header (latin-1).
        "attribution": "Datenquelle: Stadt Wien - data.wien.gv.at",
    },
}


@app.get("/wfs")
def wfs_cached(
    src: str,
    bbox: str,
    directory: Annotated[Path, Depends(cache_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(upstream_fetch)] = None,  # type: ignore[assignment]
) -> Response:
    """Cached GetFeature for a registered WFS source, EPSG:4326 in and out."""
    import hashlib
    import urllib.parse

    source = WFS_SOURCES.get(src)
    if source is None:
        raise HTTPException(404, f"unknown wfs source: {src}")
    box = _parse_texture_request("europe", bbox, 0.25)  # reuse bbox + area validation

    key = hashlib.sha256(f"{src}|{bbox}".encode()).hexdigest()[:16]
    path = directory / "wfs" / f"{key}.json"
    if not path.exists():
        query = urllib.parse.urlencode(
            {
                "service": "WFS",
                "request": "GetFeature",
                "version": "2.0.0",
                "typeNames": source["typename"],
                "outputFormat": "application/json",
                "srsName": "urn:ogc:def:crs:EPSG::4326",
                "bbox": f"{box.south},{box.west},{box.north},{box.east},"
                "urn:ogc:def:crs:EPSG::4326",
                "count": "20000",
            }
        )
        try:
            payload = fetch(f"{source['url']}?{query}", 60)
        except Exception as exc:  # noqa: BLE001 — surface as a named upstream failure
            raise HTTPException(502, f"wfs fetch failed: {exc}") from exc
        _cache_write(path, payload)
    return Response(
        content=path.read_bytes(),
        media_type="application/json",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Wfs-Attribution": source["attribution"],
        },
    )


# --- Character manifest -------------------------------------------------------


def characters_manifest_path() -> Path:
    return DATA_DIR / "characters.json"


@app.get("/characters")
def characters(
    manifest_path: Annotated[Path, Depends(characters_manifest_path)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    """Named avatars in the local store: name → content hash.

    The blobs are ordinary content-addressed entries (mirrored with the
    `mirror` CLI command); this manifest is the only name→hash mapping.
    """
    import json

    if not manifest_path.is_file():
        return JSONResponse([])
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return JSONResponse([])
    entries = []
    for name, entry in sorted(manifest.items()):
        if not isinstance(entry, dict) or not is_valid_sha256(str(entry.get("sha256", ""))):
            continue
        record: dict[str, object] = {
            "name": name,
            "sha256": entry["sha256"],
            "size": entry.get("size", 0),
        }
        frames = entry.get("frames")
        if isinstance(frames, list) and all(is_valid_sha256(str(f)) for f in frames):
            record["frames"] = frames
        entries.append(record)
    return JSONResponse(entries)


# --- Orthophoto textures -----------------------------------------------------
#
# The corpus stays tile-shaped for deduplication; a texture is a per-delivery
# bake over the requested extent, like GLB. Regional services answer an exact
# bbox in one WMS request, which is why the API takes borders, not tiles.

#: Slightly above the client's 100 km² selection cap, so a valid client
#: request never fails here on rounding.
TEXTURE_MAX_AREA_KM2 = 120.0


def texture_dir() -> Path:
    return DATA_DIR / "textures"


def texture_fetch():
    """Fetch function dependency — overridden in tests with a stub."""
    return texture_module.fetch_texture


def _texture_area_km2(box: BBox) -> float:
    import math

    mid = math.radians((box.south + box.north) / 2)
    return (
        (box.east - box.west) * 111.32 * math.cos(mid) * (box.north - box.south) * 110.57
    )


def _parse_texture_request(region: str, bbox: str, target: float) -> BBox:
    if region not in texture_module.REGION_SOURCES:
        raise HTTPException(404, f"no texture sources configured for region: {region}")
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(400, "bbox must be 'west,south,east,north'")
    try:
        west, south, east, north = (float(p) for p in parts)
        box = BBox(west=west, south=south, east=east, north=north)
    except ValueError as exc:
        raise HTTPException(400, f"invalid bbox: {exc}") from exc
    if not 0.05 <= target <= 10.0:
        raise HTTPException(400, "target must be between 0.05 and 10 m/px")
    area = _texture_area_km2(box)
    if area > TEXTURE_MAX_AREA_KM2:
        raise HTTPException(
            413, f"bbox is {area:.0f} km2, above the {TEXTURE_MAX_AREA_KM2:.0f} km2 cap"
        )
    return box


def _resolve_texture_region(region: str, box: BBox) -> str:
    """A bbox inside a regional survey gets that survey's source chain.

    The DVM promises the best qualified source for the *place*, not for the
    URL parameter: a Funchal selection made from the continental view must
    still reach DROTe's 10 cm survey, not the Esri fallback. Observed live —
    the same selection came back at 2.0 m/px instead of 0.54 m/px purely
    because the client sat in the europe region.
    """
    if region != "europe":
        return region
    for candidate, bounds in SURVEY_REGIONS.items():
        if candidate == "europe" or candidate not in texture_module.REGION_SOURCES:
            continue
        if (
            bounds.west <= box.west
            and box.east <= bounds.east
            and bounds.south <= box.south
            and box.north <= bounds.north
        ):
            return candidate
    return region


def _ensure_texture(
    region: str, box: BBox, target: float, directory: Path, fetch
) -> tuple[Path, dict]:
    """Return the cached texture for this extent, fetching and storing on miss."""
    import hashlib
    import json

    key = (
        f"{region}|{box.west:.6f},{box.south:.6f},{box.east:.6f},{box.north:.6f}"
        f"|{target:.3f}"
    )
    stem = f"{region}-{hashlib.sha256(key.encode()).hexdigest()[:16]}"
    image_path = directory / f"{stem}.jpg"
    meta_path = directory / f"{stem}.json"
    if image_path.exists() and meta_path.exists():
        return image_path, json.loads(meta_path.read_text(encoding="utf-8"))

    try:
        # 256 tiles keeps a cold XYZ mosaic inside the client's deadline; the
        # WMS backends ignore the option and answer in a single request.
        fetched = fetch(box, region, target, max_tiles=256)
    except Exception as exc:  # noqa: BLE001 — surface as a named upstream failure
        raise HTTPException(502, f"texture fetch failed: {exc}") from exc

    texture_module.write_texture(fetched, directory, stem)
    meta = {
        "region": region,
        "bbox": [box.west, box.south, box.east, box.north],
        "target_m_per_px": target,
        "m_per_px": round(fetched.metres_per_pixel, 3),
        "width_px": fetched.size[0],
        "height_px": fetched.size[1],
        "source": {
            "id": fetched.source.id,
            "name": fetched.source.name,
            "license": fetched.source.license,
            "attribution": fetched.source.attribution,
        },
        "requests": fetched.requests,
        "warnings": fetched.warnings,
    }
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return image_path, meta


@app.get("/texture/plan")
def texture_plan(
    region: str,
    bbox: str,
    target: float = 0.25,
) -> JSONResponse:
    """What a bake for this extent would deliver — computed, never fetched."""
    box = _parse_texture_request(region, bbox, target)
    resolved = _resolve_texture_region(region, box)
    return JSONResponse(texture_module.plan_texture(box, resolved, target, max_tiles=256))


@app.get("/texture/meta")
def texture_meta(
    region: str,
    bbox: str,
    target: float = 0.25,
    directory: Annotated[Path, Depends(texture_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(texture_fetch)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    box = _parse_texture_request(region, bbox, target)
    region = _resolve_texture_region(region, box)
    _, meta = _ensure_texture(region, box, target, directory, fetch)
    return JSONResponse(meta)


@app.get("/texture")
def texture_image(
    region: str,
    bbox: str,
    target: float = 0.25,
    directory: Annotated[Path, Depends(texture_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(texture_fetch)] = None,  # type: ignore[assignment]
) -> Response:
    box = _parse_texture_request(region, bbox, target)
    region = _resolve_texture_region(region, box)
    image_path, meta = _ensure_texture(region, box, target, directory, fetch)
    return Response(
        content=image_path.read_bytes(),
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Texture-Source": meta["source"]["id"],
            "X-Texture-M-Per-Px": str(meta["m_per_px"]),
        },
    )


def _blob_response(
    sha256: str,
    record: BlobRecord,
    data: bytes,
    range_header: str | None,
    include_body: bool,
) -> Response:
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": f'"{sha256}"',
    }
    if record.geohash:
        headers["X-Geo-Geohash"] = record.geohash
    if record.west is not None:
        headers["X-Geo-BBox"] = f"{record.west},{record.south},{record.east},{record.north}"

    total = len(data)
    start, end = 0, total - 1
    status = 200

    if range_header and range_header.startswith("bytes="):
        spec = range_header[6:].split(",", 1)[0].strip()
        try:
            raw_start, raw_end = spec.split("-", 1)
            if raw_start:
                start = int(raw_start)
                end = int(raw_end) if raw_end else total - 1
            else:
                start = max(0, total - int(raw_end))
                end = total - 1
        except ValueError:
            raise HTTPException(416, "malformed Range header") from None
        if start > end or start >= total:
            raise HTTPException(416, "requested range not satisfiable")
        end = min(end, total - 1)
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"

    payload = data[start : end + 1] if include_body else b""
    headers["Content-Length"] = str(end - start + 1)
    return Response(
        content=payload,
        status_code=status,
        media_type=record.media_type,
        headers=headers,
    )


@app.head("/{descriptor}")
@app.get("/{descriptor}")
def get_blob(
    descriptor: str,
    request: Request,
    blobs: Annotated[BlobStore, Depends(store)] = None,  # type: ignore[assignment]
    db: Annotated[BlobIndex, Depends(index)] = None,  # type: ignore[assignment]
) -> Response:
    sha256 = _strip_extension(descriptor)
    if not is_valid_sha256(sha256):
        raise HTTPException(400, "not a valid blob hash")

    data = blobs.read(sha256)
    record = db.get(sha256)
    if data is None or record is None:
        raise HTTPException(404, "blob not found")

    return _blob_response(
        sha256,
        record,
        data,
        request.headers.get("range"),
        include_body=request.method != "HEAD",
    )
