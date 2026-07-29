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
from fastapi.responses import JSONResponse

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
