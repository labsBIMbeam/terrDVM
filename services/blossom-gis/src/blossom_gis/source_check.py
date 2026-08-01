"""Qualify an imagery source with a single request.

Adding a country means answering four questions about its imagery service:
does it answer, does it return a real picture, how sharp is it, and what is the
licence. This module answers all four from **one** probe per source, so a
candidate can be qualified without crawling anything.

The sharpness check is the part that needs care. A service will happily
upsample: ask for 5 cm pixels and it returns a blurry 5 cm image rather than an
error. So the probe measures high-frequency detail in the returned image and
compares it against the same image downsampled and blown back up. Real detail
survives that comparison; upsampled mush does not.
"""

from __future__ import annotations

import io
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass

from PIL import Image, ImageFilter

USER_AGENT = "terrCVM-source-check/0.1 (+https://github.com/labsBIMbeam/terrCVM)"

#: Two independent gates, because either alone produces false passes.
#:
#: Esri's "no coverage" tile scored 1.17 on edge energy — a near-uniform image
#: still has *some* structure, so a loose edge threshold waves it through.
#: Real orthophotos in the probe set scored 1.47 and above.
MIN_DETAIL_SCORE = 1.35

#: The same placeholder was 2,521 bytes for 256x256 (~38 kB/MP). Genuine
#: imagery in the probe set ran 220 kB/MP and up. A compressor cannot make
#: detail that is not there, so payload density is the second gate.
MIN_BYTES_PER_MEGAPIXEL = 120_000


@dataclass(frozen=True)
class Candidate:
    """An imagery service plus a point known to lie inside its coverage."""

    id: str
    country: str
    name: str
    kind: str  # "xyz" | "wms"
    url: str
    license: str
    test_lat: float
    test_lon: float
    layer: str | None = None
    max_zoom: int = 19
    axis_order: str = "latlon"  # WMS 1.3.0 + EPSG:4326 is lat,lon
    wms_version: str = "1.3.0"
    image_format: str = "image/jpeg"


@dataclass
class CheckResult:
    candidate: Candidate
    ok: bool
    status: str
    bytes_returned: int = 0
    pixels: tuple[int, int] | None = None
    metres_per_pixel: float | None = None
    detail_score: float | None = None
    verdict: str = ""

    bytes_per_megapixel: float | None = None

    @property
    def usable_for_architecture(self) -> bool:
        return bool(
            self.ok
            and self.metres_per_pixel is not None
            and self.metres_per_pixel <= 0.30
            and (self.detail_score or 0) >= MIN_DETAIL_SCORE
            and (self.bytes_per_megapixel or 0) >= MIN_BYTES_PER_MEGAPIXEL
        )


#: Every candidate carries a probe point inside its own coverage — probing a
#: national service outside its country proves nothing.
CANDIDATES: tuple[Candidate, ...] = (
    Candidate(
        id="esri-world-imagery", country="global", name="Esri World Imagery",
        kind="xyz",
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        license="Esri terms — display with attribution",
        test_lat=32.6490, test_lon=-16.9080, max_zoom=19,
    ),
    Candidate(
        id="irig-south-tyrol", country="IT-BZ", name="IRIG Südtirol Ortho",
        kind="wms", url="https://geoservices8.civis.bz.it/geoserver/p_bz-Inspire/ows",
        layer="p_bz-Inspire:OI.OrthoimageCoverage", license="CC0-1.0",
        test_lat=46.4983, test_lon=11.3548,
    ),
    Candidate(
        id="swisstopo-swissimage", country="CH", name="swisstopo SWISSIMAGE",
        kind="wms", url="https://wms.geo.admin.ch/",
        layer="ch.swisstopo.swissimage", license="swisstopo open data",
        test_lat=47.3769, test_lon=8.5417,
    ),
    Candidate(
        id="nrw-dop", country="DE-NW", name="Geobasis NRW DOP",
        kind="wms", url="https://www.wms.nrw.de/geobasis/wms_nw_dop",
        layer="nw_dop_rgb", license="dl-de/zero-2-0",
        test_lat=50.9413, test_lon=6.9583,
    ),
    Candidate(
        id="pdok-luchtfoto", country="NL", name="PDOK Luchtfoto Actueel HR",
        kind="wms", url="https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0",
        layer="Actueel_orthoHR", license="CC-BY-4.0",
        test_lat=52.3676, test_lon=4.9041,
    ),
    Candidate(
        id="ign-fr-ortho", country="FR", name="IGN BD ORTHO",
        kind="wms", url="https://data.geopf.fr/wms-r/wms",
        layer="ORTHOIMAGERY.ORTHOPHOTOS", license="Licence Ouverte / etalab",
        test_lat=48.8566, test_lon=2.3522,
    ),
    Candidate(
        id="ign-es-pnoa", country="ES", name="IGN PNOA máxima actualidad",
        kind="wms", url="https://www.ign.es/wms-inspire/pnoa-ma",
        layer="OI.OrthoimageCoverage", license="CC-BY-4.0 (IGN)",
        test_lat=40.4168, test_lon=-3.7038,
    ),
    Candidate(
        id="dgt-pt-ortosat", country="PT", name="DGT OrtoSat 2023",
        kind="wms", url="https://ortos.dgterritorio.gov.pt/wms/ortosat2023",
        layer="ortoSat2023", license="CC-BY-4.0 (DGT)",
        test_lat=38.7223, test_lon=-9.1393,
    ),
    Candidate(
        id="lu-ortho", country="LU", name="Luxembourg Ortho",
        kind="wms", url="https://wms.geoportail.lu/opendata/service",
        layer="ortho_latest", license="CC0 (Open Data LU)",
        test_lat=49.6116, test_lon=6.1319,
    ),
)


def metres_per_pixel_at(zoom: int, latitude: float) -> float:
    return 40_075_016.686 * math.cos(math.radians(latitude)) / (2**zoom * 256)


def _tile_xy(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    n = 2**zoom
    return (
        int((lon + 180.0) / 360.0 * n),
        int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n),
    )


def _fetch(url: str, timeout_s: float) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        return response.read()


def detail_score(image: Image.Image) -> float:
    """How much real detail survives a downsample/upsample round trip.

    Genuine imagery loses high-frequency energy when halved and restored;
    upsampled or synthetic tiles barely change. A ratio near 1.0 means the
    service is inventing pixels it does not have.
    """
    grey = image.convert("L")
    if min(grey.size) < 16:
        return 0.0

    def edge_energy(img: Image.Image) -> float:
        edges = img.filter(ImageFilter.FIND_EDGES)
        histogram = edges.histogram()
        total = sum(histogram) or 1
        return sum(value * count for value, count in enumerate(histogram)) / total

    half = grey.resize((grey.width // 2, grey.height // 2), Image.LANCZOS)
    blurred = half.resize(grey.size, Image.LANCZOS)
    reference = edge_energy(blurred) or 1e-6
    return edge_energy(grey) / reference


def probe(
    candidate: Candidate,
    *,
    target_m_per_px: float = 0.25,
    timeout_s: float = 45,
    fetcher=_fetch,
) -> CheckResult:
    """One request. Answers: alive, real, how sharp, under what licence."""
    try:
        if candidate.kind == "xyz":
            zoom = min(candidate.max_zoom, 19)
            x, y = _tile_xy(candidate.test_lat, candidate.test_lon, zoom)
            url = candidate.url.format(z=zoom, x=x, y=y)
            expected = metres_per_pixel_at(zoom, candidate.test_lat)
        else:
            # A 128 m square at the target resolution.
            span_m = 128.0
            side_px = max(64, int(span_m / target_m_per_px))
            d_lat = span_m / 111_320.0
            d_lon = d_lat / max(0.2, math.cos(math.radians(candidate.test_lat)))
            south, north = candidate.test_lat - d_lat / 2, candidate.test_lat + d_lat / 2
            west, east = candidate.test_lon - d_lon / 2, candidate.test_lon + d_lon / 2
            bbox = (
                f"{south},{west},{north},{east}"
                if candidate.axis_order == "latlon"
                else f"{west},{south},{east},{north}"
            )
            crs_key = "CRS" if candidate.wms_version == "1.3.0" else "SRS"
            query = urllib.parse.urlencode(
                {
                    "SERVICE": "WMS", "VERSION": candidate.wms_version, "REQUEST": "GetMap",
                    "LAYERS": candidate.layer or "", "STYLES": "",
                    crs_key: "EPSG:4326", "BBOX": bbox,
                    "WIDTH": side_px, "HEIGHT": side_px,
                    "FORMAT": candidate.image_format,
                }
            )
            url = f"{candidate.url}?{query}"
            expected = span_m / side_px

        payload = fetcher(url, timeout_s)
    except Exception as error:  # noqa: BLE001 — a dead source is a result, not a crash
        return CheckResult(
            candidate=candidate, ok=False,
            status=f"{type(error).__name__}: {str(error)[:80]}",
            verdict="unreachable",
        )

    if not payload:
        return CheckResult(
            candidate=candidate, ok=False, status="empty response", verdict="no data"
        )

    try:
        image = Image.open(io.BytesIO(payload))
        image.load()
    except Exception:  # noqa: BLE001 — most often an XML ServiceException
        head = payload[:200].decode("utf-8", "replace").strip().replace("\n", " ")
        return CheckResult(
            candidate=candidate, ok=False, bytes_returned=len(payload),
            status=f"not an image: {head[:80]}", verdict="service error",
        )

    score = detail_score(image)
    megapixels = (image.size[0] * image.size[1]) / 1e6 or 1e-9
    density = len(payload) / megapixels
    result = CheckResult(
        candidate=candidate, ok=True, status="ok",
        bytes_returned=len(payload), pixels=image.size,
        metres_per_pixel=expected, detail_score=score,
        bytes_per_megapixel=density,
    )
    if score < MIN_DETAIL_SCORE or density < MIN_BYTES_PER_MEGAPIXEL:
        result.verdict = "no coverage here — placeholder/upsampled"
    elif expected <= 0.30:
        result.verdict = "architectural resolution"
    elif expected <= 1.0:
        result.verdict = "site-plan resolution"
    else:
        result.verdict = "context only"
    return result


def check_all(candidates=CANDIDATES, **kwargs) -> list[CheckResult]:
    return [probe(candidate, **kwargs) for candidate in candidates]
