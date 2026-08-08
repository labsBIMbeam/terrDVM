# terrCVM architecture

Two halves that never share a process:

| | What it is | Why |
|---|---|---|
| `apps/terrain`, `apps/player`, `apps/field-measurement` | Sandboxed browser clients — one napplet, one job | Terrain: selection, generation, 3D preview. Player: presence, placement, the walkable world. Field-measurement: the measurement-protocol field sheet and ingest |
| `packages/napplet-kit` | Shared client modules | The shell adapter (sole privileged boundary), verification, the generation pipeline, the map view |
| `services/blossom-gis` | Python collection server | Crawling, content-addressed storage, source qualification |

The split is forced by the sandbox, not chosen for taste. A napplet runs in an
iframe with no ambient network, no persistence beyond a 512 KB quota, and no
keys. One Funchal feature tile is 51 kB, so the client structurally cannot cache
a region — collection has to live server-side.

`resource.bytes()` is also read-only, so the napplet cannot upload. The server
is the collector; the client is a reader. That is the whole role split.

---

## Data model

### Feature tiles (TFT2)

Buildings, roads and land use in one binary tile, keyed by slippy tile `z/x/y`.

Measured on tile **14/7422/6618** (Funchal), fetched with no `out` cap —
8,830 ways, yielding 4,668 buildings + 3,826 roads + 139 land-use areas
(8,633 features):

| Format | Size | Ratio |
|---|---|---|
| GeoJSON | 2,272.4 kB | 1× |
| GeoJSON + gzip | 337.3 kB | 6.7× |
| **TFT2** | **139.7 kB** | **16.3×** |

**16 bytes per feature.** Three things do the work: coordinates quantised to a
tile-local 4096 grid, points delta-encoded against their predecessor, deltas
written as zigzag varints.

> **Corrected 2026-08.** This table previously read "1,457 buildings + 1,541
> roads → 51.3 kB, 15.3×". That figure understated the tile: the crawler asked
> Overpass for `out geom 5000`, a silent hard cap, so 43% of the tile was never
> seen. The *ratio* barely moved — both columns scale with feature count — but
> the absolute size was wrong by 2.7×, and anything sized against 51.3 kB
> (bundle budgets, cache math, per-tile transfer estimates) was wrong with it.
> The cap is now checked and refused; see
> [`crawl.py`](../services/blossom-gis/src/blossom_gis/crawl.py) `fetch_tile`.

Two implementations exist — [`codec.ts`](../packages/terrain-engine/src/features/codec.ts)
and [`featuretile.py`](../services/blossom-gis/src/blossom_gis/featuretile.py) —
pinned together by a **byte-for-byte conformance test** against golden bytes
emitted by the TypeScript encoder. This is not pedantry: the tile hash *is* the
storage key, so a one-byte disagreement would split one logical tile into two
blobs and silently stop deduplication.

### Why tiles, not bounding boxes

Content addressing only pays off when chunk boundaries are deterministic. A blob
shaped like one user's bounding box is unique to that request and will never be
requested again. A tile sits on a globally agreed grid, so every overlapping job
hits the same hash.

Measured: 168 Madeira DEM tiles collapsed to **32 unique blobs**, because every
ocean tile is byte-identical. The saving is in requests avoided, not disk.

### Do not store GLB as the corpus

GLB is a *baked* artifact — fixed LOD, materials and origin. Two GLBs do not
compose into a larger scene, and nothing can be re-styled. Store source tiles;
bake GLB per delivery.

Do not compress before hashing either. The same tile at a different zlib level
yields a different hash and therefore no deduplication. gzip only saves 21 % on
TFT2 (139.7 → 111.0 kB), so store raw and let HTTP handle transport.

---

## Imagery: what is actually available

Every source is qualified with **one request** by
[`source_check.py`](../services/blossom-gis/src/blossom_gis/source_check.py).
Nine European services qualified at ≤0.30 m/px with genuine detail:

| Source | Country | Licence |
|---|---|---|
| swisstopo SWISSIMAGE | CH | swisstopo open |
| Luxembourg Ortho | LU | CC0 |
| PDOK Luchtfoto HR | NL | CC-BY-4.0 |
| Esri World Imagery | global | Esri terms + attribution |
| DGT OrtoSat 2023 | PT | CC-BY-4.0 |
| IGN PNOA | ES | CC-BY-4.0 |
| IGN BD ORTHO | FR | Licence Ouverte |
| Geobasis NRW DOP | DE-NW | dl-de/zero |
| **IRIG Südtirol** | IT-BZ | **CC0** |

### There is no pan-European adapter

INSPIRE mandates harmonised layer names, but only ES and IT-BZ actually use
`OI.OrthoimageCoverage`. Everyone else is local-language: `pand`, `batiment`,
`GebaeudeBauwerk`, `DOP`, `OrtoSat2023`. Each country needs a mapping entry —
endpoint, layer, CRS, licence. That is clerical work, not architecture, which is
why [`regions.ts`](../packages/terrain-engine/src/config/regions.ts) carries a `services[]`
array with a **mandatory `license` field**.

### Detecting "no coverage"

A service will not tell you it has no imagery — it returns a picture anyway.
Two independent gates catch this:

1. **Detail score.** Edge energy against the same image downsampled and blown
   back up. Real imagery loses high-frequency energy; upsampled mush does not.
2. **Payload density.** A compressor cannot invent detail it was not given.

Both are needed. Esri's no-coverage tile scores **1.17** on edge energy alone —
above a naive threshold — but sits at **38 kB/MP** against 176–333 for real
imagery. Either gate alone produces false passes.

Proof the placeholder is real: the z19 tile over Porto Santo and the tile over
open Atlantic 3,000 km away share the SHA-256 `9eafd300d613…`, identical to what
z20 returns worldwide.

### Known gaps

- **Esri stops at z19** (~0.25 m/px). z20 is a placeholder everywhere.
- **Porto Santo has no architectural imagery** from any qualified source.
- **DGT covers mainland Portugal only** — not Madeira.
- **Esri z19 is city-centric.** A continental z7 sweep (525 cells, ~200 km
  grid) found 43 of 218 land cells qualifying (19.7 %); rural Europe does not
  get 0.25 m/px from Esri.

### Resolution has a price

South Tyrol, same area:

| Zoom | Tiles | Storage | m/px |
|---|---|---|---|
| z12 | 360 | 5 MB | 26.3 |
| z16 | 92,160 | 1.4 GB | 1.64 |
| z19 | 5,898,240 | 88 GB | 0.21 |

For one province. Blanket-crawling a continent at architectural resolution is
not a storage problem, it is impossible. **Crawl coarse, fetch fine on demand** —
which is what a data vending machine does anyway.

---

## Provenance

`created_at` is not proof of anything, but under NIP-01 it *is* load-bearing:
replaceable events resolve by highest `created_at`. A worker with a skewed clock
publishes a head that can never be superseded. Derive it monotonically per
`(source, d)` from the publisher clock, never from the upstream record.

For history, use **immutable records plus a replaceable head**. Replaceable-only
discards prior state at the relay; anything crawled before you switch is gone.
The cost is two events per *change*, not per crawl.

---

## Boundaries that must not move

- Every external byte goes through the shell resource capability. Enforced by
  `scripts/verify-shell-boundary.mjs`.
- Every source declares a licence. OSM is ODbL — share-alike is infectious for
  derived geometry.
- Fail closed. A denied capability produces a named error, never a fabricated
  result or a silently black texture.
