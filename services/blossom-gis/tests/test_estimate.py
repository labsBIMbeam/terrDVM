"""VS-6 corpus estimator: tile math against real bboxes, byte projections from
measured anchors, and a hosting-gate verdict that only passes when even the
conservative high bound fits."""

from __future__ import annotations

import pytest

from blossom_gis.estimate import (
    GATE_BYTES,
    PLANS,
    dem_bytes_per_tile,
    estimate_plan,
    render_report,
)


def test_dem_per_tile_anchors_at_the_measured_z13_tile() -> None:
    assert dem_bytes_per_tile(13) == 43_014
    # One zoom finer: 4x the tiles carry 3.86x the bytes, so each tile shrinks.
    assert dem_bytes_per_tile(14) == pytest.approx(43_014 * 3.86 / 4)
    assert dem_bytes_per_tile(12) == pytest.approx(43_014 * 4 / 3.86)
    assert dem_bytes_per_tile(14) < dem_bytes_per_tile(13) < dem_bytes_per_tile(12)


def test_v1_is_trivial_against_the_gate() -> None:
    result = estimate_plan("v1", 13)
    assert result.tiles_bbox > 500
    assert result.tiles_distinct < result.tiles_bbox  # madeira is mostly ocean
    assert 10e6 < result.dem_bytes < 500e6
    assert result.total_low <= result.total_high
    assert result.passes_gate  # the gate exists for continental ambition only


def test_zoom_scaling_quadruples_tiles_and_grows_bytes() -> None:
    z13 = estimate_plan("v1", 13)
    z14 = estimate_plan("v1", 14)
    assert z14.tiles_bbox == pytest.approx(z13.tiles_bbox * 4, rel=0.05)
    assert z14.dem_bytes == pytest.approx(z13.dem_bytes * 3.86, rel=0.06)


def test_europe_z14_fails_the_gate_on_dem_alone() -> None:
    result = estimate_plan("europe", 14)
    assert result.dem_bytes > GATE_BYTES
    assert not result.passes_gate


def test_gate_verdict_is_conservative() -> None:
    # Whatever the numbers, the verdict must follow the HIGH bound: a plan that
    # fits only under optimistic assumptions does not pass a provisioning gate.
    for name in PLANS:
        for zoom in (12, 13, 14):
            result = estimate_plan(name, zoom)
            assert result.passes_gate == (result.total_high <= GATE_BYTES)


def test_unknown_plan_is_refused() -> None:
    with pytest.raises(KeyError):
        estimate_plan("atlantis", 13)


def test_report_prints_the_one_number_and_the_gate() -> None:
    report = render_report()
    assert "v1" in report and "europe" in report
    assert "40 GB" in report
    assert "139,699" in report or "139699" in report  # the recalibrated anchor
