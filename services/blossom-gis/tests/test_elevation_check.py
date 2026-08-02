"""Elevation-source qualification. No network: every grid here is synthetic.

The synthetic surfaces are the calibration the thresholds were set from — a
fractal field with Hurst exponent 0.5-0.9 spans the roughness real terrain
shows, and a bilinear stretch of a coarser field is exactly what a service
does when asked for posts it does not have.
"""

from __future__ import annotations

import numpy as np
import pytest

from blossom_gis.elevation_check import (
    CANDIDATES,
    MAX_LINEAR_FRACTION,
    MAX_NODATA_FRACTION,
    MIN_DETAIL_SCORE,
    ElevationCandidate,
    _bilinear,
    clean_grid,
    coverage_url,
    detail_score,
    evaluate,
    linear_fraction,
    probe,
    relief_m,
)

N = 128


def fractal(size: int, hurst: float = 0.7, seed: int = 1, relief: float = 40.0) -> np.ndarray:
    """A synthetic terrain: 1/f noise with a controllable roughness."""
    rng = np.random.default_rng(seed)
    frequency = np.fft.fftfreq(size)
    kx, ky = np.meshgrid(frequency, frequency)
    k = np.hypot(kx, ky)
    k[0, 0] = 1e-6
    phase = rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))
    grid = np.real(np.fft.ifft2(k ** (-(hurst + 1)) * phase))
    # The k[0,0] fudge puts an enormous DC term in; remove it, or the "terrain"
    # sits at 136 km and every sample reads as a nodata sentinel.
    grid -= grid.mean()
    return grid / np.std(grid) * relief + 250.0


def upsampled(factor: int, seed: int = 4) -> np.ndarray:
    """What a coarse DEM looks like after being stretched to a fine grid."""
    return _bilinear(fractal(N // factor, 0.7, seed), N, N)


def candidate(**overrides) -> ElevationCandidate:
    base = {
        "id": "probe", "country": "XX", "name": "Probe", "kind": "wcs20",
        "url": "https://example.test/ows", "license": "CC0-1.0",
        "coverage_id": "dtm", "crs": "EPSG:25832",
        "test_lat": 46.5, "test_lon": 11.35, "native_resolution_m": 0.5,
    }
    return ElevationCandidate(**{**base, **overrides})


class TestStatistics:
    @pytest.mark.parametrize("hurst", [0.5, 0.7, 0.9])
    def test_native_terrain_clears_the_detail_gate(self, hurst: float) -> None:
        assert detail_score(fractal(N, hurst, int(hurst * 10))) > MIN_DETAIL_SCORE

    @pytest.mark.parametrize("factor", [4, 8, 16])
    def test_upsampled_terrain_fails_the_detail_gate(self, factor: int) -> None:
        assert detail_score(upsampled(factor)) < MIN_DETAIL_SCORE

    @pytest.mark.parametrize("hurst", [0.5, 0.7, 0.9])
    def test_native_terrain_is_not_piecewise_linear(self, hurst: float) -> None:
        assert linear_fraction(fractal(N, hurst, int(hurst * 10))) <= MAX_LINEAR_FRACTION

    @pytest.mark.parametrize("factor", [4, 8, 16])
    def test_upsampled_terrain_is_mostly_straight_lines(self, factor: int) -> None:
        assert linear_fraction(upsampled(factor)) > MAX_LINEAR_FRACTION

    def test_centimetre_quantisation_does_not_look_like_interpolation(self) -> None:
        quantised = np.round(fractal(N) * 100) / 100
        assert linear_fraction(quantised) <= MAX_LINEAR_FRACTION
        assert detail_score(quantised) > MIN_DETAIL_SCORE

    def test_a_constant_plane_is_entirely_linear(self) -> None:
        assert linear_fraction(np.full((N, N), 412.0)) == 1.0
        assert relief_m(np.full((N, N), 412.0)) == 0.0

    def test_nearest_neighbour_blocks_are_caught_too(self) -> None:
        blocky = np.kron(fractal(N // 8, 0.7, 4), np.ones((8, 8)))
        assert linear_fraction(blocky) > MAX_LINEAR_FRACTION

    def test_relief_ignores_a_single_spike(self) -> None:
        grid = np.full((N, N), 300.0)
        grid[0, 0] = 3000.0
        assert relief_m(grid) < 1.0


class TestNodata:
    def test_sentinels_are_counted_and_replaced(self) -> None:
        grid = fractal(N)
        grid[:, :16] = -9999.0
        cleaned, fraction = clean_grid(grid)
        assert fraction == pytest.approx(0.125, abs=1e-6)
        assert cleaned.min() >= -500.0 and cleaned.max() <= 9_000.0

    def test_nan_and_float_max_are_nodata(self) -> None:
        grid = fractal(N)
        grid[0, 0] = np.nan
        grid[0, 1] = 3.4e38
        _, fraction = clean_grid(grid)
        assert fraction == pytest.approx(2 / grid.size)

    def test_an_all_nodata_coverage_is_wholly_bad(self) -> None:
        _, fraction = clean_grid(np.full((N, N), -9999.0))
        assert fraction == 1.0


class TestGate:
    def test_genuine_bare_earth_qualifies(self) -> None:
        result = evaluate(candidate(), fractal(N))
        assert result.usable_as_terrain
        assert result.failures == []
        assert result.verdict == "bare-earth terrain at architectural resolution"

    def test_upsampled_coarse_data_is_refused(self) -> None:
        result = evaluate(candidate(), upsampled(16))
        assert not result.usable_as_terrain
        assert any("detail score" in failure for failure in result.failures)
        assert any("linear fraction" in failure for failure in result.failures)

    def test_a_constant_fill_is_refused(self) -> None:
        result = evaluate(candidate(), np.full((N, N), 412.0))
        assert not result.usable_as_terrain
        assert any("relief" in failure for failure in result.failures)

    def test_a_nodata_hole_is_refused(self) -> None:
        grid = fractal(N)
        grid[: N // 2] = -9999.0
        result = evaluate(candidate(), grid)
        assert not result.usable_as_terrain
        assert result.nodata_fraction is not None
        assert result.nodata_fraction > MAX_NODATA_FRACTION
        assert any("nodata" in failure for failure in result.failures)

    def test_a_grid_too_small_to_judge_is_refused_not_waved_through(self) -> None:
        result = evaluate(candidate(), np.zeros((4, 4)))
        assert not result.usable_as_terrain
        assert result.failures == ["shape"]

    def test_flat_coverage_may_disable_the_relief_gate_explicitly(self) -> None:
        polder = fractal(N, 0.7, 2, relief=0.4)
        assert not evaluate(candidate(), polder).usable_as_terrain
        assert evaluate(candidate(min_relief_m=0.0), polder).usable_as_terrain


class TestBareEarthProof:
    def test_a_dsm_above_the_dtm_proves_bare_earth(self) -> None:
        ground = fractal(N)
        roofs = ground.copy()
        roofs[32:96, 32:96] += 12.0
        result = evaluate(candidate(dsm_coverage_id="dsm"), ground, roofs)
        assert result.usable_as_terrain
        assert result.surface_offset_m is not None
        assert result.surface_offset_m > 1.0

    def test_a_dsm_served_as_a_dtm_is_refused(self) -> None:
        surface = fractal(N)
        result = evaluate(candidate(dsm_coverage_id="dsm"), surface, surface)
        assert not result.usable_as_terrain
        assert any("not bare earth" in failure for failure in result.failures)

    def test_a_mismatched_dsm_cannot_be_compared_and_fails_closed(self) -> None:
        result = evaluate(candidate(dsm_coverage_id="dsm"), fractal(N), fractal(N // 2))
        assert not result.usable_as_terrain
        assert any("different grid shape" in failure for failure in result.failures)


class TestRequestBuilding:
    def test_a_wcs20_request_subsets_both_axes(self) -> None:
        url = coverage_url(candidate(), "dtm")
        assert "REQUEST=GetCoverage" in url
        assert "COVERAGEID=dtm" in url
        assert url.count("SUBSET=") == 2
        assert "Lat" in url and "Long" in url

    def test_a_wcs10_request_uses_bbox_and_a_pixel_count(self) -> None:
        url = coverage_url(candidate(kind="wcs10", probe_span_m=256.0), "dtm")
        assert "VERSION=1.0.0" in url
        assert "BBOX=" in url
        assert "WIDTH=512" in url

    def test_the_probe_window_is_square_on_the_ground(self) -> None:
        from blossom_gis.elevation_check import probe_window

        south, west, north, east = probe_window(candidate())
        import math

        height_m = (north - south) * 111_320.0
        width_m = (east - west) * 111_320.0 * math.cos(math.radians(46.5))
        assert height_m == pytest.approx(256.0, rel=1e-6)
        assert width_m == pytest.approx(256.0, rel=1e-3)


class TestProbe:
    def test_an_unreachable_source_is_a_result_not_a_crash(self) -> None:
        def dead(url: str, timeout_s: float) -> bytes:
            raise TimeoutError("no route to host")

        result = probe(candidate(), fetcher=dead)
        assert not result.usable_as_terrain
        assert result.verdict == "unreachable"
        assert "TimeoutError" in result.status

    def test_a_service_exception_is_named_not_decoded_as_terrain(self) -> None:
        def xml(url: str, timeout_s: float) -> bytes:
            return b'<?xml version="1.0"?><ows:ExceptionReport>no coverage</ows:ExceptionReport>'

        result = probe(candidate(), fetcher=xml)
        assert not result.usable_as_terrain
        assert result.verdict == "service error"

    def test_an_empty_response_is_refused(self) -> None:
        result = probe(candidate(), fetcher=lambda url, timeout_s: b"")
        assert not result.usable_as_terrain
        assert result.verdict == "no data"

    def test_a_declared_dsm_twin_that_never_answers_leaves_bare_earth_unproven(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import blossom_gis.elevation_check as module

        def fetch(url: str, timeout_s: float) -> bytes:
            if "dsm" in url:
                raise TimeoutError("twin down")
            return b"tiff"

        monkeypatch.setattr(module, "read_coverage", lambda payload: fractal(N))
        result = probe(candidate(dsm_coverage_id="dsm"), fetcher=fetch)
        assert not result.usable_as_terrain
        assert any("bare earth unproven" in failure for failure in result.failures)


class TestCandidates:
    def test_every_candidate_declares_a_licence(self) -> None:
        for entry in CANDIDATES:
            assert entry.license.strip(), entry.id

    def test_every_candidate_claims_bare_earth(self) -> None:
        for entry in CANDIDATES:
            assert entry.model == "dtm", entry.id

    def test_every_candidate_probes_at_one_to_two_metres_or_better(self) -> None:
        for entry in CANDIDATES:
            assert entry.native_resolution_m <= 2.5, entry.id

    def test_candidate_ids_match_the_client_registry(self) -> None:
        # The TypeScript registry keys its transcode routes on these ids; a
        # rename on one side and not the other would 404 every tile.
        from pathlib import Path

        registry = (
            Path(__file__).resolve().parents[3]
            / "packages"
            / "terrain-engine"
            / "src"
            / "terrain"
            / "elevation-sources.ts"
        ).read_text(encoding="utf-8")
        for entry in CANDIDATES:
            assert f"'{entry.id}'" in registry, entry.id
