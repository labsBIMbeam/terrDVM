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
from .db import BlobIndex, BlobRecord, geo_fields
from .geo import BBox, tile_bbox, tile_for_point
from .nostr import authorize, parse_auth_header
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
    allow_methods=["GET", "HEAD", "PUT", "DELETE", "OPTIONS"],
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
                f"<td>{html.escape(source.license)}</td></tr>"
            )

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
<table><tr><th>Region</th><th>Source</th><th>Kind</th><th>Endpoint</th><th>Licence</th></tr>
{''.join(rows)}</table>

<h2>Fixed upstreams</h2>
<table><tr><th>Layer</th><th>Endpoint</th><th>Licence</th></tr>
<tr><td>Elevation (DEM)</td><td>s3.amazonaws.com — Mapzen Terrarium via AWS Open Data</td>
<td>SRTM/GMTED/NED public data, attribution</td></tr>
<tr><td>Buildings, roads, land use</td><td>overpass-api.de — OpenStreetMap</td>
<td>ODbL-1.0 — share-alike is infectious for derived geometry</td></tr>
<tr><td>Basemap (map view)</td><td>tile.openstreetmap.org</td>
<td>ODbL, visible attribution</td></tr>
</table>

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


@app.get("/texture/meta")
def texture_meta(
    region: str,
    bbox: str,
    target: float = 0.25,
    directory: Annotated[Path, Depends(texture_dir)] = None,  # type: ignore[assignment]
    fetch: Annotated[object, Depends(texture_fetch)] = None,  # type: ignore[assignment]
) -> JSONResponse:
    box = _parse_texture_request(region, bbox, target)
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
