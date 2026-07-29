# terrDVM architecture

Two halves that never share a process:

| | What it is | Why |
|---|---|---|
| `apps/napplet` | Sandboxed browser client | Selection, terrain generation, 3D preview |
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

Measured on real Funchal data (1,457 buildings + 1,541 roads):

| Format | Size | Ratio |
|---|---|---|
| GeoJSON | 786.4 kB | 1× |
| GeoJSON + gzip | 135.3 kB | 5.8× |
| **TFT2** | **51.3 kB** | **15.3×** |

**18 bytes per feature.** Three things do the work: coordinates quantised to a
tile-local 4096 grid, points delta-encoded against their predecessor, deltas
written as zigzag varints.

Two implementations exist — [`codec.ts`](../apps/napplet/src/features/codec.ts)
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
yields a different hash and therefore no deduplication. gzip only saves 29 % on
TFT2 (51.3 → 36.2 kB), so store raw and let HTTP handle transport.

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
why [`regions.ts`](../apps/napplet/src/config/regions.ts) carries a `services[]`
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
- **Esri z19 is city-centric.** A continental sweep found only 3 of 18 European
  land cells qualifying; rural Europe does not get 0.25 m/px from Esri.

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
