# terrCVM

Public, local-first demo of a terrain Data Vending Machine:

```text
select bbox → generate terrain → buildings, roads, land use → 3D preview
```

Pick an area in Europe, and the browser builds a real 3D model of it from public
data — elevation, orthophoto, building footprints, road network and land cover —
and tells you honestly where usable imagery does *not* exist.

## Status

Working demo. The payment stage is deliberately skipped; see
[Deviations](#deviations-from-the-original-plan).

The client is three napplets — one app, one job, per the NAP spec:

| Napplet | One thing |
|---|---|
| `apps/terrain` | Select a bbox, ask what data exists there, generate an honest 3D model, inspect and export it |
| `apps/player` | Be somewhere: presence, geo notes, the globe console, avatar placement, the walkable world |
| `apps/field-measurement` | Record a FIELD-PROTOCOL site visit: field sheet, `rangetest.csv` ingest, window classification |

Shared client modules (the shell adapter, verification, the generation
pipeline, the map view) live in `packages/napplet-kit`.

## Quick start

**Client** — needs a Napplet shell, or the dev shim for a plain browser:

```bash
corepack pnpm install
corepack pnpm --filter @terrcvm/napplet-terrain dev   # or -player / -field-measurement
```

Then open `http://localhost:5173/?region=south-tyrol` to switch regions.

**Server** — collection, storage and source qualification:

```bash
cd services/blossom-gis
uv venv --python 3.12 && uv pip install -e ".[dev]"
uv run uvicorn blossom_gis.app:app --port 8787
```

## Checks

Both halves of the repo — the TypeScript packages and the Python service — share
cross-language vectors, so run them together:

```bash
corepack pnpm test:all   # pnpm -r test:unit, then pytest in services/blossom-gis
```

`test:all` needs `uv` on PATH; it runs Vitest across the workspace, then
`uv run --directory services/blossom-gis --extra dev pytest -q`. No `cd`, so it
behaves the same in bash, cmd and PowerShell. Running only one half hides pin
drift between the two.

The narrower gates, all runnable on their own:

| Script | Checks |
|---|---|
| `corepack pnpm lint` | ESLint over `apps`, `packages`, `scripts` |
| `corepack pnpm -r typecheck` | `tsc --noEmit` in every workspace package |
| `corepack pnpm -r test:unit` | Vitest, TypeScript half only |
| `corepack pnpm verify:shell-boundary` | Napplet shell API boundary |
| `corepack pnpm verify:source-policy` | Data-source licence policy |
| `corepack pnpm verify:map-provenance` | Baked map artefact provenance |
| `corepack pnpm verify:fallback-ledger` | Fallback ledger integrity |
| `corepack pnpm verify:lock-approved` | Lockfile against the approved set |

CI (`.github/workflows/ci.yml`) runs the Node and Python jobs on every push and
pull request, including a build of all three napplet artifacts; each app's build
also runs `scripts/verify-dist.mjs` (single-file, self-contained, no direct
browser network authority). `napplet-conformance` runs locally per app:
`corepack pnpm --filter <app> test:conformance`.

## What it does

**Terrain.** Fetches Mapzen Terrarium DEM tiles for the selection, decodes
elevation from the RGB channels, resamples onto a 192² grid and meshes it.
Verified over Madeira's central massif: 439–1831 m, which matches Pico Ruivo.

**Buildings and roads.** OpenStreetMap footprints extruded onto the terrain
surface — ear-clipping triangulation, walls and roof cap, heights from
`building:levels` or `height` with a documented fallback. Roads are draped as
ribbons, width by class.

**3D preview.** Hand-rolled WebGL2. No Three.js: the napplet ships as a
single-file artifact, so a general-purpose engine would dominate the bundle for
one orbiting mesh.

**Orthophoto drape.** The collection server bakes one image per requested
extent — borders, not tiles, because regional services answer an exact bbox in
a single WMS request — stores it with a provenance sidecar, and the preview
drapes it over the terrain. South Tyrol comes from IRIG (CC0, 0.2 m), Madeira
including Porto Santo from DROTe (10 cm, verified live), everywhere else falls
back to an Esri mosaic. Without a server the preview keeps its elevation ramp
and says so. An **Open viewer** button expands the scene to the full window,
opening with a flight along the terrain's low-to-high line into a
straight-down ortho view. Layers toggle individually, an **isometric
game-map mode** (dimetric angle, chunky pixels, coarse palette) turns the
scene into the classic city-builder view, and **Export map** writes a
2560 px PNG — exactly the whitebox-plus-imagery render an isometric-tile
stylisation pipeline takes as input.

**Imagery coverage.** The map marks, in orange hatching, where architectural-
resolution imagery does **not** exist. Only gaps are drawn — marking what works
adds nothing, since a user assumes coverage.

## Regions

Regions are data, not code. Adding one is an entry in
[`regions.ts`](packages/terrain-engine/src/config/regions.ts).

| Region | Imagery | Licence |
|---|---|---|
| `europe` (default) | Esri World Imagery | attribution required |
| `south-tyrol` | IRIG regional survey | **CC0** |
| `madeira` | DROTe RAM 2023 (10 cm, incl. Porto Santo) | free with attribution |
| `vienna` | basemap.at Orthofoto (15 cm urban) | CC-BY 4.0 |

`europe` is a bounding box, and **a box cannot exclude a country** — the eastern
edge clips most of European Russia but a sliver remains. Excluding it properly
needs a polygon mask.

## Collection

The crawler is bounded by design. It processes at most `--max-tiles` per run,
spaces requests, and checks the upstream slot count before every fetch — if none
is free it stops cleanly rather than queueing into a timeout. Progress is in
SQLite, so it is fully resumable.

```bash
python -m blossom_gis.cli seed     --region madeira --zoom 12
python -m blossom_gis.cli run      --region madeira --max-tiles 5
python -m blossom_gis.cli status   --region madeira
python -m blossom_gis.cli coverage --region europe  --zoom 7
```

Terrain and imagery drain before vector features: they are the demo-critical
layers and the cheap ones to fetch. Schedule `run` on a timer — see
[the service README](services/blossom-gis/README.md).

## Models in the terrain — the interop story

A placed avatar is two records, and nothing else:

1. **The model** — a GLB blob, addressed by its SHA-256, served by any
   Blossom mirror that holds it.
2. **The placement** — where it stands: a signed nostr event (NIP-94,
   kind 1063) carrying the hash (`x`), a fetch URL, the exact position as a
   `bbox` tag, a `heading`, and one `g` tag per geohash precision so any
   generic relay answers coarse geo queries by plain tag filtering.

Any app or napplet that can subscribe to a relay and fetch a blob by hash
can stand the avatar in its own scene — two requests, no accounts, no
custom API. This client places from the map (click) or from inside the
world (walk somewhere, *Place avatar here*); a NIP-07 signer signs, so
neither the app nor the server ever holds a key. Animation travels the
same way: secrab's walk cycle is ten vertex-frames baked in Blender, each
frame its own content-addressed blob — the gait's symmetry deduplicates
them to five.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the tile format and its
  measured compression, why tiles rather than bounding boxes, how "no coverage"
  is detected, and what imagery actually exists across Europe.
- **[docs/IMAGERY-SOURCES.md](docs/IMAGERY-SOURCES.md)** — surveyed European
  orthophoto services: open sources worth adding, commercial fallbacks for the
  rural gap, and the licence traps that rule services out.
- **[services/blossom-gis/README.md](services/blossom-gis/README.md)** — Blossom
  endpoints, the crawler, scheduling.
- **[docs/PROJECT-BRIEF.md](docs/PROJECT-BRIEF.md)** — the original brief.

## Deviations from the original plan

Recorded because the code now contradicts `AGENTS.md` in three places, all at
explicit operator request:

1. **The terrain processor runs before the payment loop.** The core invariant
   ordered these the other way round.
2. **The payment gate is skipped.** The placeholder is kept, unwired, in
   [`invoice.ts`](apps/terrain/src/job/invoice.ts).
3. **A collection server exists.** `AGENTS.md` excludes a custom tile server from
   the initial slice, and Phase 4 planned a Blossom *client* against a
   third-party server.

Phase-01 Paja evidence is stale as a result: it asserts the literal string
`Source: — unavailable`, which is no longer true once imagery goes live.

## Licence and attribution

Every data source carries a licence in the region registry, and it is
**mandatory** — retrofitting licences is expensive. OSM is ODbL: share-alike is
infectious for derived geometry. South Tyrol's IRIG orthophotos are CC0, which
is why that region prefers them over the global fallback.

MIT for the code.
