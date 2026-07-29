"""Orthophoto textures for terrain draping.

Two backends, because the best available imagery differs by region:

* **XYZ tile mosaic** — stitches a slippy-tile pyramid into one image. Works
  anywhere Esri World Imagery reaches, which is the global fallback.
* **WMS GetMap** — asks a national or regional service for exactly the extent
  and pixel size wanted, in one request. Where a country publishes its own
  aerial survey this is both sharper and far cheaper: one call instead of
  hundreds of tiles.

Every texture carries its provenance. A drapeable image whose licence and
source are unknown is a liability, not an asset.
"""

from __future__ import annotations

import io
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from .geo import BBox

USER_AGENT = "terrDVM-texture/0.1 (+https://github.com/labsBIMbeam/terrDVM)"
EARTH_CIRCUMFERENCE_M = 40_075_016.686
TILE_PX = 256

#: Esri serves a placeholder above this; verified by identical bytes returned
#: for tiles 3,000 km apart.
ESRI_MAX_ZOOM = 19


@dataclass(frozen=True)
class TextureSource:
    """Where a texture came from, and what may be done with it."""

    id: str
    name: str
    kind: str  # "xyz" | "wms"
    url: str
    license: str
    attribution: str
    layer: str | None = None
    max_zoom: int | None = None
    notes: str = ""


ESRI_WORLD_IMAGERY = TextureSource(
    id="esri-world-imagery",
    name="Esri World Imagery",
    kind="xyz",
    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    license="Esri Terms of Use — display with attribution",
    attribution="Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    max_zoom=ESRI_MAX_ZOOM,
    notes="Global fallback. Resolution varies by locality; z20 returns a placeholder.",
)

IRIG_SOUTH_TYROL = TextureSource(
    id="irig-south-tyrol-ortho",
    name="IRIG Südtirol Orthoimagery",
    kind="wms",
    url="https://geoservices8.civis.bz.it/geoserver/p_bz-Inspire/ows",
    layer="p_bz-Inspire:OI.OrthoimageCoverage",
    license="CC0-1.0",
    attribution="Autonome Provinz Bozen — Südtirol / Provincia autonoma di Bolzano",
    notes="Regional aerial survey, INSPIRE-conformant. Public-domain, no attribution burden.",
)

DROTE_MADEIRA = TextureSource(
    id="drote-madeira-ortho",
    name="DROTe Ortofotocartografia RAM 2023",
    kind="wms",
    url="https://geoportal-irig.madeira.gov.pt/mapproxy/base/service",
    layer="drote_ortos2023_ortos_2023",
    license="Free use with attribution (non-CC; redistribution terms unconfirmed)",
    attribution="© DROTe — Região Autónoma da Madeira",
    notes=(
        "10 cm regional survey covering Madeira, Porto Santo, Desertas and "
        "Selvagens — the only qualified source with architectural resolution "
        "over Porto Santo. Verified live 2026-07-29: Funchal and Porto Santo "
        "GetMap samples both return genuine detail at 0.25 m/px."
    ),
)

BASEMAP_AT = TextureSource(
    id="basemap-at-ortho",
    name="basemap.at Orthofoto",
    kind="xyz",
    # ArcGIS-style {z}/{y}/{x} order; named placeholders keep format() honest.
    url="https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
    license="CC-BY-4.0 (Open Government Data Österreich)",
    attribution="Grundkarte: basemap.at",
    max_zoom=19,
    notes=(
        "Nationwide Austrian orthophoto, 29 cm general / 15 cm urban. "
        "Verified live 2026-07-29: z19 over Innsbruck and central Vienna "
        "both show genuine architectural detail."
    ),
)

SOURCES = {
    source.id: source
    for source in (ESRI_WORLD_IMAGERY, IRIG_SOUTH_TYROL, DROTE_MADEIRA, BASEMAP_AT)
}

#: Preferred texture source per region, best-quality first.
REGION_SOURCES: dict[str, list[str]] = {
    "madeira": ["drote-madeira-ortho", "esri-world-imagery"],
    "south-tyrol": ["irig-south-tyrol-ortho", "esri-world-imagery"],
    "vienna": ["basemap-at-ortho", "esri-world-imagery"],
    "europe": ["esri-world-imagery"],
}


@dataclass
class Texture:
    image: Image.Image
    source: TextureSource
    bbox: BBox
    metres_per_pixel: float
    requests: int
    warnings: list[str] = field(default_factory=list)

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size


def metres_per_pixel(zoom: int, latitude: float) -> float:
    return EARTH_CIRCUMFERENCE_M * math.cos(math.radians(latitude)) / (2**zoom * TILE_PX)


def zoom_for_resolution(bbox: BBox, target_m_per_px: float) -> int:
    """Shallowest zoom that meets the target resolution at the bbox centre."""
    if target_m_per_px <= 0:
        raise ValueError("target resolution must be positive")
    latitude, _ = bbox.center
    for zoom in range(0, 24):
        if metres_per_pixel(zoom, latitude) <= target_m_per_px:
            return zoom
    return 23


def _tile_xy(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def _fetch(url: str, timeout_s: float) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        return response.read()


def fetch_xyz_texture(
    bbox: BBox,
    source: TextureSource,
    target_m_per_px: float,
    *,
    max_tiles: int = 400,
    timeout_s: float = 30,
    fetcher=_fetch,
) -> Texture:
    """Stitch a slippy-tile mosaic covering `bbox`, then crop to the exact extent."""
    warnings: list[str] = []
    zoom = zoom_for_resolution(bbox, target_m_per_px)
    if source.max_zoom is not None and zoom > source.max_zoom:
        warnings.append(
            f"requested {target_m_per_px:.2f} m/px needs z{zoom}; "
            f"{source.name} stops at z{source.max_zoom}"
        )
        zoom = source.max_zoom

    # Shrink the zoom until the mosaic fits the tile budget.
    while zoom > 0:
        min_x, min_y = _tile_xy(bbox.north, bbox.west, zoom)
        max_x, max_y = _tile_xy(bbox.south, bbox.east, zoom)
        count = (max_x - min_x + 1) * (max_y - min_y + 1)
        if count <= max_tiles:
            break
        zoom -= 1
        warnings.append(f"reduced to z{zoom} to stay within {max_tiles} tiles")

    min_x, min_y = _tile_xy(bbox.north, bbox.west, zoom)
    max_x, max_y = _tile_xy(bbox.south, bbox.east, zoom)
    columns = max_x - min_x + 1
    rows = max_y - min_y + 1

    mosaic = Image.new("RGB", (columns * TILE_PX, rows * TILE_PX))
    requests = 0
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            url = source.url.format(z=zoom, x=x, y=y)
            try:
                payload = fetcher(url, timeout_s)
                tile = Image.open(io.BytesIO(payload)).convert("RGB")
            except Exception as error:  # noqa: BLE001 — one bad tile must not lose the mosaic
                warnings.append(f"z{zoom}/{x}/{y}: {type(error).__name__}")
                continue
            requests += 1
            mosaic.paste(tile, ((x - min_x) * TILE_PX, (y - min_y) * TILE_PX))

    # Tolerating a few missing tiles is right; tolerating all of them is not.
    # A silently black texture draped on terrain reads as a rendering bug
    # rather than the data failure it actually is.
    if requests == 0:
        raise RuntimeError(
            f"{source.name}: no tile in the requested extent could be fetched"
        )

    # Crop the mosaic down to the requested extent.
    n = 2**zoom
    def _fx(lon: float) -> float:
        return (lon + 180.0) / 360.0 * n

    def _fy(lat: float) -> float:
        return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

    left = (_fx(bbox.west) - min_x) * TILE_PX
    right = (_fx(bbox.east) - min_x) * TILE_PX
    top = (_fy(bbox.north) - min_y) * TILE_PX
    bottom = (_fy(bbox.south) - min_y) * TILE_PX
    cropped = mosaic.crop(
        (max(0, int(left)), max(0, int(top)), int(math.ceil(right)), int(math.ceil(bottom)))
    )

    latitude, _ = bbox.center
    return Texture(
        image=cropped,
        source=source,
        bbox=bbox,
        metres_per_pixel=metres_per_pixel(zoom, latitude),
        requests=requests,
        warnings=warnings,
    )


def fetch_wms_texture(
    bbox: BBox,
    source: TextureSource,
    target_m_per_px: float,
    *,
    max_side_px: int = 4096,
    timeout_s: float = 90,
    fetcher=_fetch,
) -> Texture:
    """Ask a WMS for exactly the extent and pixel size wanted — one request."""
    if source.layer is None:
        raise ValueError(f"{source.id} has no WMS layer configured")

    latitude, _ = bbox.center
    metres_per_degree_lat = 111_320.0
    width_m = (bbox.east - bbox.west) * metres_per_degree_lat * math.cos(math.radians(latitude))
    height_m = (bbox.north - bbox.south) * metres_per_degree_lat

    warnings: list[str] = []
    width_px = max(1, round(width_m / target_m_per_px))
    height_px = max(1, round(height_m / target_m_per_px))
    if max(width_px, height_px) > max_side_px:
        scale = max_side_px / max(width_px, height_px)
        width_px = max(1, int(width_px * scale))
        height_px = max(1, int(height_px * scale))
        warnings.append(f"clamped to {max_side_px}px on the long side")

    query = urllib.parse.urlencode(
        {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": source.layer,
            "STYLES": "",
            # WMS 1.3.0 with EPSG:4326 is lat,lon ordered.
            "CRS": "EPSG:4326",
            "BBOX": f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}",
            "WIDTH": width_px,
            "HEIGHT": height_px,
            "FORMAT": "image/jpeg",
        }
    )
    payload = fetcher(f"{source.url}?{query}", timeout_s)
    image = Image.open(io.BytesIO(payload)).convert("RGB")

    return Texture(
        image=image,
        source=source,
        bbox=bbox,
        metres_per_pixel=width_m / image.size[0] if image.size[0] else 0.0,
        requests=1,
        warnings=warnings,
    )


def fetch_texture(
    bbox: BBox,
    region: str,
    target_m_per_px: float = 0.25,
    *,
    max_tiles: int = 400,
    max_side_px: int = 4096,
    timeout_s: float | None = None,
    fetcher=_fetch,
) -> Texture:
    """Fetch the best available texture for a region, honouring its source order.

    Backend options are named explicitly rather than forwarded as **kwargs: the
    two backends take different parameters, and blind forwarding meant an
    XYZ-only option raised TypeError inside the WMS path, silently demoting a
    region to its fallback source.
    """
    ids = REGION_SOURCES.get(region) or ["esri-world-imagery"]
    errors: list[str] = []
    for source_id in ids:
        source = SOURCES[source_id]
        try:
            if source.kind == "wms":
                return fetch_wms_texture(
                    bbox, source, target_m_per_px,
                    max_side_px=max_side_px,
                    timeout_s=90 if timeout_s is None else timeout_s,
                    fetcher=fetcher,
                )
            return fetch_xyz_texture(
                bbox, source, target_m_per_px,
                max_tiles=max_tiles,
                timeout_s=30 if timeout_s is None else timeout_s,
                fetcher=fetcher,
            )
        except Exception as error:  # noqa: BLE001 — fall through to the next source
            errors.append(f"{source_id}: {type(error).__name__}: {error}")
    raise RuntimeError("no texture source succeeded — " + "; ".join(errors))


def write_texture(texture: Texture, directory: Path, stem: str) -> tuple[Path, Path]:
    """Write the image plus a sidecar recording where it came from."""
    directory.mkdir(parents=True, exist_ok=True)
    image_path = directory / f"{stem}.jpg"
    texture.image.save(image_path, "JPEG", quality=90)

    sidecar = directory / f"{stem}.txt"
    sidecar.write_text(
        "\n".join(
            [
                f"source      : {texture.source.name} ({texture.source.id})",
                f"endpoint    : {texture.source.url}",
                f"layer       : {texture.source.layer or '-'}",
                f"license     : {texture.source.license}",
                f"attribution : {texture.source.attribution}",
                f"bbox        : {texture.bbox.west},{texture.bbox.south},"
                f"{texture.bbox.east},{texture.bbox.north}",
                f"pixels      : {texture.image.size[0]}x{texture.image.size[1]}",
                f"resolution  : {texture.metres_per_pixel:.3f} m/px",
                f"requests    : {texture.requests}",
                f"warnings    : {'; '.join(texture.warnings) or 'none'}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return image_path, sidecar
