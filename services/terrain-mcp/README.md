# terrain-mcp

An MCP server, over stdio, with two tools: `generate_terrain`, which produces
the tiles, and `quote_terrain`, which prices a request without producing it.

It returns a **manifest of Blossom descriptors** — Terrarium DEM tiles, TFT2
feature tiles and an optional orthophoto baked to the requested extent — all
stored content-addressed. It does **not** return a mesh or a GLB.

## Why source tiles and not a GLB

* The mesher is TypeScript (`packages/terrain-engine/src/terrain/`). A Python
  port would be a third implementation of one algorithm, needing its own
  cross-language conformance suite. This repo has already paid that bill twice —
  the TFT2 codec pin and the geo-protocol.
* `docs/ARCHITECTURE.md` rules on the artifact: GLB is a *baked* delivery with a
  fixed LOD, materials and origin, and two GLBs do not compose into a larger
  scene. Store source tiles; bake GLB per delivery.
* What this service actually sells is what a sandboxed browser cannot do:
  orthophoto sharper and wider than a 512 KB single-file bundle can carry, and
  DEM at zooms the client will not fetch itself. That is all source-tile
  production, which Python already does here.

## LOD mapping

`lod` is a named tier, so a caller never guesses a slippy zoom. Pinned by
`tests/test_plan.py`.

| lod        | DEM zoom | feature zoom | default texture |
| ---------- | -------- | ------------ | --------------- |
| `overview` | z11      | z12          | 2.0 m/px        |
| `standard` | z12      | z13          | 0.5 m/px        |
| `detail`   | z13      | z14          | 0.25 m/px       |

DEM stops at z13 because Terrarium carries no new elevation above it — the
derivation lives in `packages/terrain-engine/src/terrain/dem.ts`. Feature tiles
sit one zoom deeper because a smaller vector tile is what keeps an Overpass
answer inside the upstream's element cap.

## Ceilings

Refused with a named error **before anything is fetched**. There is no payment
gate in front of this yet, so it fails closed rather than quietly coarsening.

| limit                | value  | error               |
| -------------------- | ------ | ------------------- |
| ground area          | 120 km² | `AreaCeilingError`  |
| DEM tiles            | 64      | `TileCeilingError`  |
| feature tiles        | 16      | `TileCeilingError`  |

The area ceiling binds at mid latitudes; the tile ceilings bind near the poles
and at fine LODs, where a Mercator tile covers far less ground.

## Texture resolution is the delivered one

`texture_m_per_px` in the manifest is what the bake **produced**, never what was
asked for. Three caps can coarsen it, all of them decided during planning:

| cap                  | applies to | effect                                    |
| -------------------- | ---------- | ----------------------------------------- |
| source max zoom      | XYZ        | Esri stops at z19                         |
| mosaic tile budget   | XYZ        | one zoom dropped per doubling over 256 tiles |
| 4096 px side clamp   | WMS        | wide extents lose pixels, not extent      |

The forecast is `blossom_gis.texture.plan_texture` — the same module that
performs the bake, so there is no second copy of the rule to drift. The manifest
carries `texture_m_per_px_requested`, `texture_m_per_px` and
`texture_downgraded`, and the ortho descriptor carries the `m_per_px` of its own
bytes. A bake that returns any other resolution raises
`TextureResolutionMismatchError` rather than being described.

This matters beyond correctness: the CEP-8 price is computed from this field.
Measured before the fix, over real stdio, a 0.1 m/px request answered
`texture_m_per_px: 0.1` against a blob baked at 2.0 m/px — a 20x overstatement,
pinned now by `TWENTY_X` in the tests.

## Price (CEP-8)

```
work_units = megapixels + 8 x dem_tiles + 40 x feature_tiles
price_sats = max(1_000, 21 x work_units)
megapixels = area_m2 / achieved_m_per_px²          # achieved, never requested
```

The weights are cost-shaped:

| term          | weight | why |
| ------------- | ------ | --- |
| feature tile  | 40     | Overpass is the bottleneck — rate-limited upstream, a 4 s politeness floor per tile, someone else's scarce query slots |
| DEM tile      | 8      | CDN-cached and heavily deduplicated: 168 Madeira tiles collapsed to 32 unique blobs, because ocean tiles are byte-identical |
| megapixel     | 1      | bake CPU and delivered bytes — real, and cheap next to the two above |

| request                    | megapixels | work units | sats   |
| -------------------------- | ---------- | ---------- | ------ |
| 1 km² overview (2.0 m/px)  | 0.25       | 48         | 1,013  |
| 1 km² standard (0.5 m/px)  | 4          | 52         | 1,092  |
| 1 km² detail (0.25 m/px)   | 16         | 64         | 1,344  |
| 25 km² detail              | 400        | 744        | 15,624 |
| 120 km² detail (ceiling)   | 1,920      | 3,072      | 64,512 |

The 1,000 sat floor is not decoration. Lightning's dust limit is ~354-546 sats;
below it an HTLC is *trimmed* — no on-chain output, unenforceable on a
force-close — and routing fees run 2-14%. A bare work unit at 21 sats is not a
payment, it is a rounding error, so every price clears the dust limit.

Two rules the arithmetic exists to enforce:

* **Priced on the delivered resolution.** The input is `texture_m_per_px`, what
  the plan says a bake can achieve — never the requested value. A 0.1 m/px
  request the tile budget answers at 2.0 m/px is 400x fewer pixels, and it is
  priced as such. Coarsen the plan and the price falls with it.
* **Priced on output, not on marginal cost.** A cached tile is free to serve,
  and discounting it would make the price an oracle for the store: quote an
  extent, watch the number, learn what has already been produced. Two identical
  requests quote identically on a warm store and a cold one.

`quote_terrain` returns that number plus the resolved request it was computed
from, and reaches no upstream at all — it is registered without a
`ServiceContext`, so it has no store, no index and no fetcher to reach for. A
request that would be refused on a ceiling is refused at quote time, with the
same named error.

The advertised range for the gateway's `cap` tag on kind 11317 is derived from
the floor and the ceiling request, never written down, so moving a ceiling
cannot silently desync the announcement:

```python
>>> from terrain_mcp.plan import cep8_cap_tag
>>> cep8_cap_tag()
['cap', 'tool:generate_terrain', '1000-64512', 'sats']
```

Payment itself — invoices, settlement, `payment_required` — belongs to the
future gateway. This service produces a number and a range, and stays keyless.

## One wall-clock budget

`TERRAIN_MCP_BUDGET_S` (default 120) bounds a whole call, shared across DEM,
features and texture rather than applied per tile — a per-tile timeout cannot
bound a sequential mosaic that swallows its own failures. Measured before the
fix: one default call on a 1.036 km² bbox made 321 outbound connect attempts and
could block roughly two hours against a black-holing upstream.

The budget is checked between tiles, and every individual call is additionally
capped at whatever is left. Exhaustion raises `TerrainBudgetError`; a mosaic left
incomplete by the clock is never described as finished. The tool also takes an
MCP `Context` and emits `notifications/progress` — one unit per source tile — so
a long call is visibly alive without relying on the client's read timeout.

## Keyless

This service signs nothing and never loads a private key — blossom-gis is
keyless by design and that property is kept. Announcing and signing belong to the
future gateway.

## Running

Blobs are written into the store the blossom-gis server reads, so a manifest's
URLs resolve with no extra configuration. Both services honour the same two
variables:

```
BLOSSOM_GIS_DATA        blob root and index   (default ./.local/blossom-gis)
BLOSSOM_GIS_BASE_URL    URL prefix            (default http://127.0.0.1:8787)
```

One further variable is this service's own:

```
TERRAIN_MCP_BUDGET_S    wall-clock seconds per call (default 120)
```

```bash
uv sync --extra dev
uv run terrain-mcp          # stdio
uv run ruff check . && uv run pytest -q
```

MCP client entry:

```json
{
  "mcpServers": {
    "terrain": {
      "command": "uv",
      "args": ["run", "--directory", "services/terrain-mcp", "terrain-mcp"]
    }
  }
}
```
