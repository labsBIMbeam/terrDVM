"""Qualify an elevation source before its data is allowed to shape a model.

`source_check.py` answers four questions about an *imagery* service from one
request: does it answer, is it a real picture, how sharp, under what licence.
This module is the same idea for *elevation*, and it exists for the same
reason: services do not refuse impossible requests, they satisfy them badly.

Three specific ways a DTM source lies, and the gate for each:

* **Nodata.** A coverage request outside the flown area returns a full grid of
  the nodata sentinel. Meshed, that is a flat plate at -9999 m. Gate:
  `nodata_fraction`.

* **A constant.** Some services answer out-of-coverage with a single fill
  value, which is not detectable as nodata at all. Gate: `relief_m` against a
  probe point deliberately placed in known relief.

* **Upsampled coarse data.** Ask a 30 m DEM for a 1 m grid and it returns a
  1 m grid — bilinearly stretched, with no information added. This is the
  dangerous one, because it looks completely normal. Gates: `detail_score`,
  the same downsample/upsample survival ratio `source_check` uses on images,
  and `linear_fraction`, the share of samples lying on a straight line between
  their neighbours, which is what interpolation leaves behind.

There is also a fourth question no imagery source has to answer: **is this
actually bare earth?** A DSM sold as a DTM is worthless here — 30 m rooftop
radar is exactly what this work exists to replace. Where a publisher offers
the DSM twin on the same endpoint (South Tyrol and AHN both do), the two are
probed together and required to differ over built-up ground.

No network in tests: `fetcher` is injected, and every gate operates on a plain
`numpy` array, so a synthetic grid exercises the same code path as a live one.
"""

from __future__ import annotations

import io
import math
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

import numpy as np

USER_AGENT = "terrCVM-elevation-check/0.1 (+https://github.com/labsBIMbeam/terrCVM)"

#: Above this share of nodata the answer is a hole, not a terrain.
MAX_NODATA_FRACTION = 0.05

#: What a *terrestrial* elevation can be. The lowest dry land is the Dead Sea
#: shore at -430 m and the highest is 8 849 m, so this band holds every real
#: sample these services can return while excluding the sentinels they use:
#: -9999 (much the commonest), -32768, -3.4e38 and 3.4e38.
#:
#: Asymmetric on purpose. A symmetric magnitude bound wide enough to allow the
#: ocean floor lets -9999 through, and -9999 is exactly the value that turns an
#: out-of-coverage answer into a flat plate 10 km below the model.
MIN_VALID_ELEVATION_M = -500.0
MAX_VALID_ELEVATION_M = 9_000.0

#: Detail survival, measured exactly as `source_check.detail_score` measures it
#: for images: fine-scale energy over the same after a decimate/restore round
#: trip. Calibrated on synthetic fractal surfaces (H = 0.5/0.7/0.9, the range
#: real terrain spans) against bilinear upsamples of 4x to 32x coarser data:
#: native scored 1.87-2.35, upsampled 1.24-1.47. 1.70 sits in that gap.
MIN_DETAIL_SCORE = 1.70

#: Share of samples whose second difference is ~zero on both axes — the
#: signature of interpolation, which leaves straight lines between real posts.
#: Same calibration: native terrain scored 0.0000-0.0002 (0.0001 after 1 cm
#: quantisation), bilinear upsamples 0.29 (4x) to 0.91 (32x), nearest-neighbour
#: 0.57, a constant plane 1.00. Two orders of magnitude of headroom at 0.05.
MAX_LINEAR_FRACTION = 0.05

#: A DSM sits above bare earth wherever there are roofs or canopy; this project
#: measured +5.54 m over built-up South Tyrol. Requiring only 1.0 m leaves room
#: for a probe point that turns out to be more open than expected, while still
#: refusing the case that matters: DTM and DSM being the same raster.
MIN_SURFACE_OFFSET_M = 1.0


@dataclass(frozen=True)
class ElevationCandidate:
    """An elevation service plus a probe point inside its coverage.

    The probe point is load-bearing twice over: probing a national service
    outside its country proves nothing, and the relief and bare-earth gates
    both need ground that actually has relief and buildings on it.
    """

    id: str
    country: str
    name: str
    kind: str  # "wcs20" | "wcs10"
    url: str
    license: str
    coverage_id: str
    crs: str
    test_lat: float
    test_lon: float
    native_resolution_m: float
    model: str = "dtm"
    #: Minimum relief expected across the probe window. Zero disables the gate,
    #: which is the honest setting for genuinely flat coverage.
    min_relief_m: float = 5.0
    #: The DSM twin on the same endpoint, when the publisher offers one. Its
    #: presence is what turns "declared bare earth" into "measured bare earth".
    dsm_coverage_id: str | None = None
    #: Probe window side, in metres. 256 m at 1 m posting is a 256² grid.
    probe_span_m: float = 256.0


@dataclass
class ElevationCheckResult:
    candidate: ElevationCandidate
    ok: bool
    status: str
    verdict: str = ""
    samples: tuple[int, int] | None = None
    nodata_fraction: float | None = None
    relief_m: float | None = None
    detail_score: float | None = None
    linear_fraction: float | None = None
    surface_offset_m: float | None = None
    failures: list[str] = field(default_factory=list)

    @property
    def usable_as_terrain(self) -> bool:
        """Fail closed: unknown is not the same as fine."""
        return self.ok and not self.failures


def _fetch(url: str, timeout_s: float) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        return response.read()


def clean_grid(grid: np.ndarray) -> tuple[np.ndarray, float]:
    """Split a raw coverage into (real elevations, nodata fraction).

    Returns the finite in-range samples with sentinels replaced by the grid
    median, so the shape statistics below are not dominated by -9999 cliffs
    that are not terrain.
    """
    values = np.asarray(grid, dtype=np.float64)
    bad = (
        ~np.isfinite(values)
        | (values < MIN_VALID_ELEVATION_M)
        | (values > MAX_VALID_ELEVATION_M)
    )
    fraction = float(np.mean(bad)) if values.size else 1.0
    if fraction >= 1.0:
        return np.zeros_like(values), 1.0
    filled = values.copy()
    if bad.any():
        filled[bad] = float(np.median(values[~bad]))
    return filled, fraction


def _roughness(grid: np.ndarray) -> float:
    """RMS second difference — fine-scale curvature energy, both axes."""
    if min(grid.shape) < 3:
        return 0.0
    rows = grid[:, :-2] - 2 * grid[:, 1:-1] + grid[:, 2:]
    columns = grid[:-2, :] - 2 * grid[1:-1, :] + grid[2:, :]
    return float(math.sqrt((np.mean(rows**2) + np.mean(columns**2)) / 2))


def _bilinear(small: np.ndarray, rows: int, columns: int) -> np.ndarray:
    """Stretch a grid back to (rows, columns) — the interpolation being tested for."""
    ys = np.linspace(0, small.shape[0] - 1, rows)
    xs = np.linspace(0, small.shape[1] - 1, columns)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.clip(y0 + 1, 0, small.shape[0] - 1)
    x1 = np.clip(x0 + 1, 0, small.shape[1] - 1)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    top = small[np.ix_(y0, x0)] * (1 - fx) + small[np.ix_(y0, x1)] * fx
    bottom = small[np.ix_(y1, x0)] * (1 - fx) + small[np.ix_(y1, x1)] * fx
    return top * (1 - fy) + bottom * fy


def detail_score(grid: np.ndarray) -> float:
    """How much fine relief survives a decimate/restore round trip.

    The elevation twin of `source_check.detail_score`. Genuine LiDAR loses real
    roughness when halved and stretched back; data that was already upsampled
    barely changes, because there was nothing at that scale to lose. A ratio
    near 1.0 means the service is interpolating posts it does not have.
    """
    if min(grid.shape) < 8:
        return 0.0
    fine = _roughness(grid)
    restored = _bilinear(grid[::2, ::2], grid.shape[0], grid.shape[1])
    coarse = _roughness(restored)
    if coarse <= 0.0:
        return 0.0
    return fine / coarse


def linear_fraction(grid: np.ndarray) -> float:
    """Share of samples sitting on a straight line between their neighbours.

    Interpolation is piecewise linear, so an upsampled grid is mostly straight
    lines with kinks only at the real posts. Real terrain is essentially never
    exactly straight at 1 m.
    """
    if min(grid.shape) < 3:
        return 1.0
    centre = grid[1:-1, 1:-1]
    rows = np.abs(grid[1:-1, :-2] - 2 * centre + grid[1:-1, 2:])
    columns = np.abs(grid[:-2, 1:-1] - 2 * centre + grid[2:, 1:-1])
    scale = float(np.median(np.abs(np.diff(grid, axis=1))))
    if scale <= 0.0:
        # No horizontal variation at all: the grid is a constant plane.
        return 1.0
    epsilon = 0.02 * scale
    return float(np.mean((rows <= epsilon) & (columns <= epsilon)))


def relief_m(grid: np.ndarray) -> float:
    """Robust vertical range — 2nd to 98th percentile, so one spike is not relief."""
    if grid.size == 0:
        return 0.0
    low, high = np.percentile(grid, [2, 98])
    return float(high - low)


def probe_window(candidate: ElevationCandidate) -> tuple[float, float, float, float]:
    """(south, west, north, east) of the probe square, in EPSG:4326."""
    half_lat = candidate.probe_span_m / 111_320.0 / 2
    half_lon = half_lat / max(0.2, math.cos(math.radians(candidate.test_lat)))
    return (
        candidate.test_lat - half_lat,
        candidate.test_lon - half_lon,
        candidate.test_lat + half_lat,
        candidate.test_lon + half_lon,
    )


def coverage_url(candidate: ElevationCandidate, coverage_id: str) -> str:
    """A WCS GetCoverage request for the probe window, as GeoTIFF."""
    south, west, north, east = probe_window(candidate)
    if candidate.kind == "wcs20":
        query = urllib.parse.urlencode(
            {
                "SERVICE": "WCS",
                "VERSION": "2.0.1",
                "REQUEST": "GetCoverage",
                "COVERAGEID": coverage_id,
                # WCS 2.0 subsets are named by the CRS axis labels; Lat/Long is
                # what a 4326 subsettingCrs exposes.
                "SUBSET": f"Lat({south},{north})",
                "SUBSETTINGCRS": "http://www.opengis.net/def/crs/EPSG/0/4326",
                "FORMAT": "image/tiff",
            }
        )
        # A second SUBSET needs its own key, which urlencode cannot express.
        query += f"&SUBSET={urllib.parse.quote(f'Long({west},{east})')}"
    else:
        side = max(16, int(candidate.probe_span_m / candidate.native_resolution_m))
        query = urllib.parse.urlencode(
            {
                "SERVICE": "WCS",
                "VERSION": "1.0.0",
                "REQUEST": "GetCoverage",
                "COVERAGE": coverage_id,
                "CRS": "EPSG:4326",
                "BBOX": f"{west},{south},{east},{north}",
                "WIDTH": side,
                "HEIGHT": side,
                "FORMAT": "GeoTIFF",
            }
        )
    return f"{candidate.url}?{query}"


def read_coverage(payload: bytes) -> np.ndarray:
    """Decode a single-band GeoTIFF into a float array.

    Pillow, not rasterio: Pillow is already a hard dependency here and handles
    the uncompressed/LZW/Deflate float32 single-band TIFFs these services emit.
    A coverage Pillow cannot open is a named failure, not a silent zero grid —
    which is the whole point of this module.
    """
    from PIL import Image

    with Image.open(io.BytesIO(payload)) as image:
        image.load()
        return np.asarray(image, dtype=np.float64)


def evaluate(
    candidate: ElevationCandidate,
    grid: np.ndarray,
    dsm_grid: np.ndarray | None = None,
) -> ElevationCheckResult:
    """Run every gate over an already-fetched grid. No I/O — this is the logic."""
    raw = np.asarray(grid, dtype=np.float64)
    if raw.ndim != 2 or min(raw.shape) < 8:
        return ElevationCheckResult(
            candidate=candidate,
            ok=False,
            status=f"coverage is {raw.shape}, need a 2-D grid of at least 8x8",
            verdict="unusable response",
            failures=["shape"],
        )

    values, nodata = clean_grid(raw)
    result = ElevationCheckResult(
        candidate=candidate,
        ok=True,
        status="ok",
        samples=(int(raw.shape[1]), int(raw.shape[0])),
        nodata_fraction=nodata,
        relief_m=relief_m(values),
        detail_score=detail_score(values),
        linear_fraction=linear_fraction(values),
    )

    # Every comparison below reads the measured value explicitly. `value or
    # default` is wrong here: a linear fraction of exactly 0.0 is the best
    # possible result, and `0.0 or 1.0` would turn it into the worst.
    if nodata > MAX_NODATA_FRACTION:
        result.failures.append(f"nodata {nodata:.0%} over {MAX_NODATA_FRACTION:.0%}")
    if candidate.min_relief_m > 0 and result.relief_m < candidate.min_relief_m:
        result.failures.append(
            f"relief {result.relief_m:.2f} m under the expected {candidate.min_relief_m:.2f} m"
        )
    if result.detail_score < MIN_DETAIL_SCORE:
        result.failures.append(f"detail score {result.detail_score:.2f} under {MIN_DETAIL_SCORE}")
    if result.linear_fraction > MAX_LINEAR_FRACTION:
        result.failures.append(
            f"linear fraction {result.linear_fraction:.2f} over {MAX_LINEAR_FRACTION}"
        )

    if dsm_grid is not None:
        surface, _ = clean_grid(np.asarray(dsm_grid, dtype=np.float64))
        if surface.shape == values.shape:
            result.surface_offset_m = float(np.mean(surface - values))
            if result.surface_offset_m < MIN_SURFACE_OFFSET_M:
                result.failures.append(
                    f"DSM sits only {result.surface_offset_m:.2f} m above this "
                    f"'DTM' — it is not bare earth"
                )
        else:
            result.failures.append("DSM twin returned a different grid shape; cannot compare")

    if result.failures:
        result.verdict = "; ".join(result.failures)
    elif candidate.native_resolution_m <= 2.0:
        result.verdict = "bare-earth terrain at architectural resolution"
    elif candidate.native_resolution_m <= 10.0:
        result.verdict = "bare-earth terrain at site resolution"
    else:
        result.verdict = "context only"
    return result


def probe(
    candidate: ElevationCandidate,
    *,
    timeout_s: float = 90,
    fetcher=_fetch,
) -> ElevationCheckResult:
    """One request — two when a DSM twin is declared. A dead source is a result."""
    try:
        payload = fetcher(coverage_url(candidate, candidate.coverage_id), timeout_s)
    except Exception as error:  # noqa: BLE001 — a dead source is a result, not a crash
        return ElevationCheckResult(
            candidate=candidate,
            ok=False,
            status=f"{type(error).__name__}: {str(error)[:80]}",
            verdict="unreachable",
            failures=["unreachable"],
        )
    if not payload:
        return ElevationCheckResult(
            candidate=candidate, ok=False, status="empty response",
            verdict="no data", failures=["empty"],
        )

    try:
        grid = read_coverage(payload)
    except Exception:  # noqa: BLE001 — most often an XML ServiceException
        head = payload[:200].decode("utf-8", "replace").strip().replace("\n", " ")
        return ElevationCheckResult(
            candidate=candidate, ok=False, status=f"not a coverage: {head[:80]}",
            verdict="service error", failures=["not a coverage"],
        )

    dsm_grid = None
    if candidate.dsm_coverage_id:
        try:
            dsm_grid = read_coverage(
                fetcher(coverage_url(candidate, candidate.dsm_coverage_id), timeout_s)
            )
        except Exception:  # noqa: BLE001 — the DSM gate degrades, it does not crash
            dsm_grid = None

    result = evaluate(candidate, grid, dsm_grid)
    if candidate.dsm_coverage_id and dsm_grid is None:
        result.failures.append("DSM twin declared but unreachable; bare earth unproven")
        result.verdict = "; ".join(result.failures)
    return result


#: Every candidate carries a probe point inside its own coverage, on ground with
#: relief and buildings — the gates need both.
CANDIDATES: tuple[ElevationCandidate, ...] = (
    ElevationCandidate(
        id="it-bz-dtm-05m", country="IT-BZ", name="Südtirol DGM 0,5 m", kind="wcs20",
        url="https://geoservices9.civis.bz.it/geoserver/ows",
        coverage_id="p_bz-Elevation__DigitalTerrainModel-0.5m",
        dsm_coverage_id="p_bz-Elevation__DigitalElevationModel-0.5m",
        license="CC0-1.0", crs="EPSG:25832",
        test_lat=46.4983, test_lon=11.3548, native_resolution_m=0.5, min_relief_m=8.0,
    ),
    ElevationCandidate(
        id="it-bz-dtm-25m", country="IT-BZ", name="Südtirol DGM 2,5 m", kind="wcs20",
        url="https://geoservices9.civis.bz.it/geoserver/ows",
        coverage_id="p_bz-Elevation__DigitalTerrainModel-2.5m",
        license="CC0-1.0", crs="EPSG:25832",
        test_lat=46.4983, test_lon=11.3548, native_resolution_m=2.5, min_relief_m=8.0,
        probe_span_m=1_280.0,
    ),
    ElevationCandidate(
        id="nl-ahn-dtm-05m", country="NL", name="AHN maaiveld 0,5 m", kind="wcs20",
        url="https://service.pdok.nl/rws/ahn/wcs/v1_0",
        coverage_id="dtm_05m", dsm_coverage_id="dsm_05m",
        license="CC0-1.0", crs="EPSG:28992",
        # Nijmegen: about the only Dutch relief there is, and built up.
        test_lat=51.8426, test_lon=5.8546, native_resolution_m=0.5, min_relief_m=4.0,
    ),
    ElevationCandidate(
        id="de-nw-dgm1", country="DE-NW", name="Geobasis NRW DGM1", kind="wcs20",
        url="https://www.wcs.nrw.de/geobasis/wcs_nw_dgm",
        coverage_id="nw_dgm", license="dl-de/zero-2-0", crs="EPSG:25832",
        # Wuppertal: steep valley sides inside a city.
        test_lat=51.2562, test_lon=7.1508, native_resolution_m=1.0, min_relief_m=15.0,
    ),
)


def check_all(candidates=CANDIDATES, **kwargs) -> list[ElevationCheckResult]:
    return [probe(candidate, **kwargs) for candidate in candidates]
