# terrDVM

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

| | Tests | Coverage |
|---|---|---|
| `apps/napplet` | 133 | 94 % statements |
| `services/blossom-gis` | 171 | 92 % |

## Quick start

**Client** — needs a Napplet shell, or the dev shim for a plain browser:

```bash
corepack pnpm install
corepack pnpm --filter @terrdvm/napplet dev
```

Then open `http://localhost:5173/?region=south-tyrol` to switch regions.

**Server** — collection, storage and source qualification:

```bash
cd services/blossom-gis
uv venv --python 3.12 && uv pip install -e ".[dev]"
uv run uvicorn blossom_gis.app:app --port 8787
```

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
opening with a flight from a frontal view 21 m above the terrain up to a
straight-down ortho view.

**Imagery coverage.** The map marks, in orange hatching, where architectural-
resolution imagery does **not** exist. Only gaps are drawn — marking what works
adds nothing, since a user assumes coverage.

## Regions

Regions are data, not code. Adding one is an entry in
[`regions.ts`](apps/napplet/src/config/regions.ts).

| Region | Imagery | Licence |
|---|---|---|
| `europe` (default) | Esri World Imagery | attribution required |
| `south-tyrol` | IRIG regional survey | **CC0** |
| `madeira` | Esri World Imagery | attribution required |

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

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the tile format and its
  measured compression, why tiles rather than bounding boxes, how "no coverage"
  is detected, and what imagery actually exists across Europe.
- **[services/blossom-gis/README.md](services/blossom-gis/README.md)** — Blossom
  endpoints, the crawler, scheduling.
- **[docs/PROJECT-BRIEF.md](docs/PROJECT-BRIEF.md)** — the original brief.

## Deviations from the original plan

Recorded because the code now contradicts `AGENTS.md` in three places, all at
explicit operator request:

1. **The terrain processor runs before the payment loop.** The core invariant
   ordered these the other way round.
2. **The payment gate is skipped.** The placeholder is kept, unwired, in
   [`invoice.ts`](apps/napplet/src/job/invoice.ts).
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
