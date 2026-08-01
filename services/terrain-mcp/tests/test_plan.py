from __future__ import annotations

import pytest
from blossom_gis.geo import BBox
from blossom_gis.texture import plan_texture

from terrain_mcp.plan import (
    LOD_TIERS,
    MAX_AREA_KM2,
    MAX_DEM_TILES,
    MAX_FEATURE_TILES,
    TEXTURE_MAX_TILES,
    AreaCeilingError,
    BoundingBoxError,
    TerrainRequestError,
    TextureResolutionError,
    TileCeilingError,
    area_km2,
    parse_bbox,
    plan_terrain,
    resolve_texture_region,
    resolve_texture_resolution,
)

FUNCHAL = BBox(west=-16.9200, south=32.6450, east=-16.9080, north=32.6530)
BOLZANO = BBox(west=11.3480, south=46.4940, east=11.3620, north=46.5030)
EUROPE = BBox(west=-25.0, south=34.0, east=32.0, north=71.5)

#: 8 km square near Bolzano: inside the area ceiling, over the feature ceiling
#: once feature tiles are z14.
EIGHT_KM_SQUARE = BBox(west=11.3000, south=46.4600, east=11.4044, north=46.5323)

#: 10.5 km square at 78°N. Mercator tiles cover far less ground near the pole,
#: so this is inside the area ceiling and over the DEM tile ceiling.
POLAR_SQUARE = BBox(west=15.0, south=78.0, east=15.4537, north=78.09496)

#: 4.8 x 4.4 km near Casablanca. Reproduces the measured 20x overstatement: a
#: 0.1 m/px request the mosaic tile budget can only answer at 2.0 m/px.
TWENTY_X = BBox(west=-7.6000, south=33.1249, east=-7.5520, north=33.1649)


class TestBoundingBoxValidation:
    def test_accepts_four_ordered_degrees(self) -> None:
        assert parse_bbox([-16.92, 32.645, -16.908, 32.653]) == FUNCHAL

    def test_rejects_the_wrong_number_of_values(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.92, 32.645, -16.908])

    def test_rejects_a_reversed_box(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.908, 32.645, -16.920, 32.653])

    def test_rejects_a_zero_width_box(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.92, 32.645, -16.92, 32.653])

    def test_rejects_latitude_out_of_range(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.92, 32.645, -16.908, 95.0])

    def test_rejects_a_non_finite_coordinate(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.92, 32.645, float("nan"), 32.653])

    def test_rejects_a_non_numeric_coordinate(self) -> None:
        with pytest.raises(BoundingBoxError):
            parse_bbox([-16.92, 32.645, "east", 32.653])


class TestLodMapping:
    """The mapping is a contract: a client caches by it and cannot see it change."""

    def test_tiers_are_exactly_these_three(self) -> None:
        assert sorted(LOD_TIERS) == ["detail", "overview", "standard"]

    @pytest.mark.parametrize(
        ("lod", "dem_zoom", "feature_zoom", "target"),
        [
            ("overview", 11, 12, 2.0),
            ("standard", 12, 13, 0.5),
            ("detail", 13, 14, 0.25),
        ],
    )
    def test_each_tier_resolves_to_its_pinned_zooms(
        self, lod: str, dem_zoom: int, feature_zoom: int, target: float
    ) -> None:
        plan = plan_terrain(FUNCHAL, lod)
        assert (plan.dem_zoom, plan.feature_zoom) == (dem_zoom, feature_zoom)
        # The tier decides what is *asked for*; the caps decide what is delivered.
        assert plan.texture_m_per_px_requested == target

    def test_dem_never_exceeds_the_engine_s_z13_cap(self) -> None:
        # Terrarium carries no new elevation above z13; handing a client deeper
        # tiles would be bytes it cannot use.
        assert max(tier.dem_zoom for tier in LOD_TIERS.values()) == 13

    def test_feature_tiles_sit_one_zoom_deeper_than_the_dem(self) -> None:
        for tier in LOD_TIERS.values():
            assert tier.feature_zoom == tier.dem_zoom + 1

    def test_an_unknown_lod_is_refused(self) -> None:
        with pytest.raises(TerrainRequestError, match="unknown lod"):
            plan_terrain(FUNCHAL, "ultra")

    def test_an_explicit_texture_target_overrides_the_tier_default(self) -> None:
        plan = plan_terrain(FUNCHAL, "standard", texture_m_per_px=0.1)
        assert plan.texture_m_per_px_requested == 0.1

    def test_a_texture_target_outside_the_window_is_refused(self) -> None:
        with pytest.raises(TerrainRequestError, match="texture_m_per_px"):
            plan_terrain(FUNCHAL, "standard", texture_m_per_px=50.0)

    def test_no_texture_means_no_region_and_no_target(self) -> None:
        plan = plan_terrain(FUNCHAL, "standard", texture=False)
        assert plan.texture is False
        assert plan.texture_m_per_px is None
        assert plan.texture_m_per_px_requested is None
        assert plan.texture_forecast is None
        assert plan.texture_region is None


class TestAchievableTextureResolution:
    """`texture_m_per_px` is what a bake will deliver, never what was asked for.

    The defect this pins was measured over real stdio: a 0.1 m/px request
    answered `texture_m_per_px: 0.1` while the stored blob was a 2.0 m/px
    mosaic, because `fetch_xyz_texture` drops a zoom for every doubling that
    would breach the tile budget and nothing carried that back.
    """

    def test_the_measured_twenty_fold_case(self) -> None:
        plan = plan_terrain(TWENTY_X, "standard", texture_m_per_px=0.1)
        assert plan.texture_m_per_px_requested == 0.1
        assert plan.texture_m_per_px == 2.0
        assert plan.texture_forecast is not None
        assert plan.texture_forecast.downgraded is True

    @pytest.mark.parametrize(
        ("bbox", "region", "target"),
        [
            (FUNCHAL, "madeira", 0.25),
            (FUNCHAL, "madeira", 0.5),
            (BOLZANO, "south-tyrol", 0.25),
            (TWENTY_X, "europe", 0.1),
            (TWENTY_X, "europe", 2.0),
        ],
    )
    def test_the_forecast_is_blossom_gis_s_own_rather_than_a_second_copy(
        self, bbox: BBox, region: str, target: float
    ) -> None:
        # A local reimplementation of the fallback rule would drift from the
        # module that performs the bake. This asserts there is no local copy.
        expected = plan_texture(bbox, region, target, max_tiles=TEXTURE_MAX_TILES)
        assert resolve_texture_resolution(bbox, region, target).m_per_px == expected["m_per_px"]

    def test_the_tile_budget_handed_to_the_backend_is_the_one_the_forecast_used(self) -> None:
        # A forecast computed against a different budget than the bake uses is
        # the same defect wearing a different number.
        assert TEXTURE_MAX_TILES == 256

    def test_a_mutated_fallback_rule_moves_the_plan_with_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Delegation, proven: change the rule and the plan changes."""
        real = plan_texture

        def coarser(bbox: BBox, region: str, target: float, **kwargs: object) -> dict:
            forecast = dict(real(bbox, region, target, **kwargs))  # type: ignore[arg-type]
            forecast["m_per_px"] = forecast["m_per_px"] * 4
            return forecast

        monkeypatch.setattr("terrain_mcp.plan.forecast_texture", coarser)
        assert plan_terrain(TWENTY_X, "standard", texture_m_per_px=0.1).texture_m_per_px == 8.0

    def test_a_forecast_of_no_resolution_at_all_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "terrain_mcp.plan.forecast_texture",
            lambda *_args, **_kwargs: {
                "m_per_px": 0.0,
                "source": {"id": "x"},
                "kind": "xyz",
                "notes": [],
            },
        )
        with pytest.raises(TextureResolutionError, match="no orthophoto resolution"):
            plan_terrain(FUNCHAL, "standard")

    def test_the_forecast_names_the_source_it_priced(self) -> None:
        forecast = plan_terrain(FUNCHAL, "detail").texture_forecast
        assert forecast is not None
        assert forecast.source_id == "drote-madeira-ortho"
        assert forecast.kind == "wms"

    def test_the_forecast_explains_the_downgrade(self) -> None:
        forecast = plan_terrain(TWENTY_X, "standard", texture_m_per_px=0.1).texture_forecast
        assert forecast is not None
        assert any("tile budget" in note for note in forecast.notes)


class TestCeilings:
    def test_a_continent_is_refused_on_area(self) -> None:
        with pytest.raises(AreaCeilingError, match="km2 ceiling"):
            plan_terrain(EUROPE, "overview")

    def test_the_area_ceiling_is_the_documented_number(self) -> None:
        assert MAX_AREA_KM2 == 120.0

    def test_an_extent_inside_the_area_ceiling_can_still_be_refused_on_feature_tiles(
        self,
    ) -> None:
        assert area_km2(EIGHT_KM_SQUARE) < MAX_AREA_KM2
        with pytest.raises(TileCeilingError, match="feature tiles"):
            plan_terrain(EIGHT_KM_SQUARE, "detail")

    def test_the_same_extent_is_plannable_at_a_coarser_lod(self) -> None:
        plan = plan_terrain(EIGHT_KM_SQUARE, "overview")
        assert len(plan.feature_tiles) <= MAX_FEATURE_TILES

    def test_a_polar_extent_is_refused_on_dem_tiles(self) -> None:
        # Same ground area, far more Mercator tiles — the second ceiling axis.
        assert area_km2(POLAR_SQUARE) < MAX_AREA_KM2
        with pytest.raises(TileCeilingError, match="DEM tiles"):
            plan_terrain(POLAR_SQUARE, "detail")

    def test_the_tile_ceilings_are_the_documented_numbers(self) -> None:
        assert (MAX_DEM_TILES, MAX_FEATURE_TILES) == (64, 16)


class TestAreaEstimate:
    def test_a_ten_kilometre_square_measures_about_a_hundred_square_kilometres(self) -> None:
        box = BBox(west=11.30, south=46.46, east=11.43050, north=46.55044)
        assert area_km2(box) == pytest.approx(100.0, rel=0.02)

    def test_area_grows_with_the_extent(self) -> None:
        wider = BBox(west=FUNCHAL.west, south=FUNCHAL.south, east=-16.90, north=FUNCHAL.north)
        assert area_km2(wider) > area_km2(FUNCHAL)


class TestTextureRegion:
    def test_a_madeira_extent_reaches_the_madeira_survey(self) -> None:
        assert resolve_texture_region(FUNCHAL) == "madeira"

    def test_a_south_tyrol_extent_reaches_its_own_survey(self) -> None:
        assert resolve_texture_region(BOLZANO) == "south-tyrol"

    def test_an_extent_outside_every_survey_falls_back_to_europe(self) -> None:
        lyon = BBox(west=4.80, south=45.73, east=4.86, north=45.78)
        assert resolve_texture_region(lyon) == "europe"


class TestPlanShape:
    def test_the_plan_enumerates_every_tile_it_will_fetch(self) -> None:
        plan = plan_terrain(FUNCHAL, "standard")
        assert len(plan.dem_tiles) >= 1
        assert len(plan.feature_tiles) >= 1
        assert len(set(plan.dem_tiles)) == len(plan.dem_tiles)

    def test_the_plan_records_the_area_it_measured(self) -> None:
        plan = plan_terrain(FUNCHAL, "standard")
        assert plan.area_km2 == pytest.approx(area_km2(FUNCHAL))
