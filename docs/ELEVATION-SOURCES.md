# Bare-earth elevation sources

Survey of free, redistributable national DTMs, researched and probed live
2026-08-01, extended with a global bare-earth base and a composite mosaic
2026-08-02. Companion to `IMAGERY-SOURCES.md`, same conventions: `[V]` means
confirmed against a live request or official documentation in this pass, `[S]`
means secondary sources only.

## Why this exists

Mapzen Terrarium — the DEM this project shipped with — is SRTM/GMTED-derived at
~30 m posting, and it is a **DSM**: it measures rooftops and canopy, not bare
earth. Measured against the free CC0 0.5 m South Tyrol LiDAR DTM on this
project's own 192-grid:

| bbox           | RMS error | max error | sub-30 m detail |
|----------------|-----------|-----------|-----------------|
| Bolzano valley |    3.33 m |   12.67 m | 6.4x more       |
| steep slope    |   14.31 m |   65.60 m | 6.3x more       |
| old town       |    6.01 m |   10.90 m | 4.9x more       |

On the steep bbox Terrarium loses 64 m of relief on a 1 km model. That is not
an accuracy problem, it is the wrong mountain. The DSM surface also sits a
measured +5.54 m above bare earth in built-up areas — a building baked into
the ground, which then has buildings extruded on top of it.

Below about 190 m of selection width the 192-grid saturates a 1 m DTM, so
**1–2 m is the target and finer buys nothing.** Nothing here needs to chase
0.1 m products.

## Sources in the registry

All of these are in `packages/terrain-engine/src/terrain/elevation-sources.ts`,
each with a mandatory licence and attribution.

| Source | Region | Res. | DTM? | Licence | Upstream access | Redistribution |
|---|---|---|---|---|---|---|
| Südtirol DGM 0,5 m | IT-BZ (settled areas) | 0.5 m | DTM `[V]` | **CC0-1.0** | WCS 2.0.1 `geoservices9.civis.bz.it/geoserver/ows`, `p_bz-Elevation__DigitalTerrainModel-0.5m`, EPSG:25832 | unrestricted |
| Südtirol DGM 2,5 m | IT-BZ (province-wide) | 2.5 m | DTM `[V]` | **CC0-1.0** | same endpoint, `…DigitalTerrainModel-2.5m` | unrestricted |
| BEV ALS DGM 1 m | AT | 1 m | DTM `[V]` | **CC-BY-4.0** | bulk COG, `data.bev.gv.at/download/ALS/`, EPSG:3035 | yes, with attribution |
| swissALTI3D | CH + LI | 0.5 m | DTM `[V]` | swisstopo OGD terms (free incl. commercial, must cite source) | STAC → COG, `data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d`, EPSG:2056 | yes, with "© swisstopo" |
| AHN maaiveld 0,5 m | NL | 0.5 m | DTM `[V]` | **CC0-1.0** | WCS 2.0.1 `service.pdok.nl/rws/ahn/wcs/v1_0`, `dtm_05m`, EPSG:28992 | unrestricted |
| IGN RGE ALTI 1 m | FR (metropolitan) | 1 m | DTM `[V]` | **etalab-2.0** | WMTS BIL32 `data.geopf.fr/wmts`, `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` | yes, with attribution |
| Geobasis NRW DGM1 | DE-NW | 1 m | DTM `[V]` | **dl-de/zero-2-0** | WCS 2.0.1 `www.wcs.nrw.de/geobasis/wcs_nw_dgm`, `nw_dgm`, EPSG:25832 | unrestricted |
| ČÚZK DMR 5G | CZ | 5 m | DTM `[V]` | **CC-BY-4.0** (open since 2023-07-01) | ArcGIS ImageServer / ATOM bulk, EPSG:5514 | yes, with attribution |
| **GEDTM30** | global | 30 m | **DTM** `[V]` | **CC-BY-4.0** | single 432 GB BigTIFF COG, `s3.opengeohub.org`, EPSG:4326 / EGM2008 | yes, with attribution |
| Mapterhorn | global (sparse above z12) | 30 m guaranteed, 0.25 m best | **mixed** `[V]` | composite audit of 134 datasets | XYZ lossless WebP 512², already Terrarium-encoded | yes, with attribution |
| Mapzen Terrarium | global | ~30 m | **mixed / DSM** | public domain per contributing source | XYZ PNG, already Terrarium-encoded | yes |

### What was verified live in this pass

* South Tyrol — WCS 2.0.1 `GetCapabilities` listed both the DTM and its DSM
  twin at 0.5 m and 2.5 m, plus a 0.2 m Etsch/Adige 2024 coverage. Licence CC0
  stated verbatim on `data.civis.bz.it`.
* AHN — `GetCapabilities` listed `dtm_05m` and `dsm_05m`, and its
  `AccessConstraints` read verbatim `otherRestrictions; Geen beperkingen;
  http://creativecommons.org/publicdomain/zero/1.0/deed.nl`. **CC0, not
  CC-BY** as widely repeated.
* swissALTI3D — STAC collection live, `eo:gsd [0.5, 2.0]`, description states
  the model is "without vegetation and development". Its WMS publishes **only**
  `ch.swisstopo.swissalti3d-reliefschattierung`: a hillshade image, no value
  raster. STAC/COG is the only way to the numbers.
* IGN — WMTS layer title is "Modèle Numérique de Terrain issu du RGEALTI",
  format `image/x-bil;bits=32`, zooms 6–14 on TileMatrixSet `WGS84G_6_14`.
* NRW — WCS 2.0.1 live, `CoverageId nw_dgm`, `AccessConstraints NONE`.
* BEV — metadata record states verbatim "Für dieses Produkt gilt die
  Standardlizenz CC-BY-4.0"; COG in EPSG:3035, 55 tiles cover Austria.

### One coverage box drawn deliberately tight

IGN declares its elevation coverage as `-62.95,-24,58,51.11` — an envelope
around the overseas départements. That box also contains Madeira, the Canaries
and most of West Africa, none of which RGE ALTI covers. The registry uses
metropolitan France instead. Over-claiming coverage answers with the wrong
country's terrain; under-claiming costs the DOM a fallback to Terrarium. The
unit test that caught this is `never leaves a national source in the chain
outside its coverage`.

## The ordering, and what changed on 2026-08-02

```
national DTM (8 coverages)  →  GEDTM30  →  Mapzen Terrarium
                                  ▲
                          Mapterhorn sits beside this chain, never in it
```

`selectElevationSources` appends **GEDTM30 then Terrarium** to every chain.

* **GEDTM30 is promoted to the global base, not a fallback.** It is the only
  globally complete, redistributable bare-earth DEM there is. Before this,
  every bbox outside the eight national coverages — including Madeira, the
  demo's own home region — got a 30 m rooftop-and-canopy radar surface. Now the
  worst case anywhere on earth is a 30 m *terrain* model at 10.69 m σ.
* **Terrarium is demoted, not retired.** It stays as the terminal link for one
  reason: it is the only **direct** global source. GEDTM30 has to be transcoded
  by the collection server, so with no server running Terrarium is the only
  thing between the app and no terrain at all. Retiring it would trade 14 m of
  error for a blank screen.
* **Mapterhorn is in the registry but in no chain.** `getElevationSource`
  reaches it, `selectElevationSources` never returns it, and there is a test
  pinning that. The reasons are below.

## GEDTM30 — the global bare-earth base

Copernicus DEM, ALOS World3D and object-height models fused by a global-to-local
random forest trained on ~30 billion ICESat-2 and GEDI returns. That training
signal is what makes it a terrain model everywhere rather than a surface model
with corrections: it reduces Copernicus RMSE by 25.4% in built-up areas and
27.3% under >50% tree cover — exactly the two places Terrarium's +5.54 m
built-up offset comes from. `[published: PeerJ 19673]`

| | |
|---|---|
| Licence | **CC-BY-4.0** `[V]` |
| Accuracy vs GNSS stations | mean 7.34 m, std 7.77 m, **RMSE 10.69 m** `[published]` |
| Horizontal CRS | EPSG:4326 |
| Vertical datum | EPSG:3855 / EGM2008 |
| Citation | Ho, Parente, Hengl et al., OpenGeoHub — `doi:10.7717/peerj.19673` |

FABDEM, FABDEM+ and FathomDEM are the obvious alternatives and all three are
CC BY-**NC**. Ruled out by the same rule that excluded them from imagery.

### Distribution status: no tile service exists. Stated, not papered over.

Probed live 2026-08-02:

```
HEAD https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif
→ 200, image/tiff, Content-Length: 432405638563, Accept-Ranges: bytes,
  Access-Control-Allow-Origin: *
range 0-31 → 49 49 2b 00 …   ("II+\0", BigTIFF, GDAL_STRUCTURAL_METADATA)
```

One 432 GB COG. **There is no XYZ endpoint** — not on `s3.opengeohub.org`, not
behind the OpenLandMap STAC browser, not in the project repository, which
publishes `metadata/cog_list.csv` and nothing tiled. So the registry entry is
`delivery: 'transcoded'` and addresses this repo's own documented route,
`/dem/gedtm30/{z}/{x}/{y}.png`, exactly as the eight national DTMs do — and
exactly as with them, **the transcoder is not built, so today this link demotes
to Terrarium.** No URL is invented. `elevationTileUrl(GEDTM30, …)` without a
collection origin raises `TRANSCODE_ORIGIN_REQUIRED` rather than returning a
link to nowhere, and the registry `notes` field begins `AWAITING THE
SERVER-SIDE PATH`.

**One thing makes GEDTM30 materially cheaper to transcode than any national
DTM, and it moves it to the front of the queue.** The COG is already in
EPSG:4326, so the reprojection to WebMercator is closed-form — no proj datum
grids, no sub-metre datum shift to get wrong. The single largest argument in
"The format decision" below, that a reprojection engine would be quietly wrong
rather than loudly broken, simply does not apply. GEDTM30 needs a COG reader
and arithmetic. It is also the only entry whose transcode benefits *every*
bbox on earth rather than one country.

## Mapterhorn — an opt-in resolution upgrade, and why it is not the base

`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`. 134 open national and global
elevation datasets mosaicked into one pyramid. Everything below was probed live
2026-08-02.

* **Already Terrarium-encoded**, declared by its own `tiles.json`
  (`"encoding":"terrarium","tileSize":512`), so `decodeTerrarium` applies
  unchanged and no transcoder is involved. `delivery: 'direct'`.
* **512², lossless.** A z16 Vienna tile is 47,844 B of `RIFF…WEBP` whose first
  chunk is **`VP8L` — lossless — at 512×512.** This was checked rather than
  assumed, and it is the check that mattered: Terrarium packs the ¹⁄₂₅₆ m
  fraction into the blue channel, so a lossy WebP would have quantised
  elevation into steps of metres while still decoding perfectly cleanly.
* `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=604800`,
  Cloudflare in front. One volunteer's infrastructure, no SLA.

### The zoom ceiling is per-tile, and 16 is not it

The pyramid is **sparse**. Probed at fourteen points spanning six continents:

| | z12 | z13 | z14 | z15 | z16 | z17 | z18 |
|---|---|---|---|---|---|---|---|
| Zurich | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vienna, Paris, London, Tokyo, Brussels, New York | ✓ | ✓ | ✓ | ✓ | ✓ | 404 | 404 |
| Bolzano, Amsterdam, Sydney, Tromsø | ✓ | ✓ | ✓ | 404 | 404 | 404 | 404 |
| Madeira | ✓ | ✓ | 404 | 404 | 404 | 404 | 404 |
| Nairobi, Amazon, Sahara, central Siberia | ✓ | 404 | 404 | 404 | 404 | 404 | 404 |

**z12 answers everywhere on earth. Above z12 a tile exists only where a
contributing source is finer than the `glo30` filler.** A single `maxZoom: 16`
would have been wrong in both directions: too low for Switzerland, too high for
most of the planet, and a source that 404s outside the good footprints is the
exact defect this document already records against the eight national DTMs.

The registry therefore carries a second zoom field, `denseMaxZoom`, meaning
"highest zoom present everywhere inside `coverage`". Mapterhorn declares
`maxZoom: 18, denseMaxZoom: 12`, and `elevationEndpoint(source)` hands out the
clamped contract unless a caller passes `{ allowSparse: true }`. That function
*is* "opt-in resolution upgrade", rather than a convention somebody has to
remember.

**And note what the reliable part is worth.** A 512² tile at z12 has exactly the
ground sampling of a 256² tile at z13 — 12.7 m/px over Vienna either way. So
Mapterhorn's *dense* layer is no sharper than what already ships, and the
entire upgrade (0.80 m/px at z16 over Vienna, a 16× improvement) lives in the
sparse tail. That asymmetry is the strongest practical argument for opt-in: the
default gains nothing and risks a 404, the opt-in gains everything and accepts
one.

### Why it is not the global base, and must not become one

Its per-source metadata carries `name, website, license, producer, resolution,
access_year` — **and no DTM/DSM field.** The surface model is recoverable only
by parsing product names in four languages. Its global filler is `glo30`, which
the manifest names `"COPERNICUS GLO-30"`: a surface model, with nothing in the
record saying so. Per-tile provenance is not published at all.

So the registry declares `model: 'mixed'`, `requireBareEarthReference()`
rejects it with a named `NOT_BARE_EARTH`, and `.planning/MESH-CALCULATOR.md`
§2.2 keeps it to classified-DTM footprints only. Its `verticalUncertaintyM` is
**14.31 m** with basis `inherited-worst-case`: with no per-tile provenance it
could be the 30 m Copernicus DSM anywhere, and 14.31 m is this project's own
measured figure for a 30 m mixed surface on this grid. The consequence is
deliberate — **Mapterhorn buys resolution, never accuracy**, and can never win
a σ comparison until somebody builds the §2.5 classification table.

## The composite-licence decision

**Mapterhorn is 134 licences and `defineElevationSource` takes one.** That is a
real conflict with this repo's rule that every source declares its terms, and
it is resolved here rather than by writing "various" — which the constructor
now rejects outright, alongside "multiple", "see website", "TBD" and "unknown".

### What is actually in the set

`https://download.mapterhorn.com/attribution.json`, fetched 2026-08-02,
84,819 bytes, `sha256 d2f6a2a1…31376`, 134 entries, **28 distinct licence
strings** grouping to:

| Licence family | Datasets |
|---|---:|
| CC BY 4.0 family (8 spellings) | 51 |
| Public domain (US Government Work / ASTER GDEM) | 35 |
| Licence Ouverte / Open Licence 2.0 | 14 |
| National open-government terms (JP, EE, CA, UK, PL, RO, …) | 11 |
| dl-de/by-2.0 | 8 |
| GSI Japan terms of use | 6 |
| CC0 / public-domain dedication | 4 |
| dl-de/zero-2.0 | 3 |
| Copernicus full, free and open | 1 |
| CC BY 2.5 | 1 |

Nothing in the set declares non-commercial, share-alike or no-derivatives
terms. **Nine of the 28 strings, covering 17 datasets, were read as declared
names rather than as full legal texts**, and the registry records that as
`termsReadByNameOnly: 17` rather than glossing it.

### The four options, and why three were rejected

| Option | Verdict |
|---|---|
| **Per-tile attribution** from whichever national source covers the tile | Legally the correct answer and **not implementable**: Mapterhorn does not publish per-tile provenance; `pipelines/attribution.py` emits one flat global list. |
| **Fetch `attribution.json` at runtime and cache it** | Rejected. The napplet has no ambient network — every byte goes through the shell `resource` capability — so a denied capability or an offline run would render a CC BY tile with **no credit at all**. That is fail-*open* on a licence obligation, which this repo refuses on principle. |
| **Name the strictest term in the set** | Rejected as a misstatement. There is no single strictest term: the set mixes public-domain dedications with attribution licences with bespoke national terms, and elevating one would misdescribe the other 27. |
| **Refuse Mapterhorn outright** | Rejected as over-caution. The obligations are knowable and dischargeable — the audit below discharges them — and refusing would throw away a verified 16× resolution win for a paperwork problem that has a correct answer. |

### What was implemented

**One composite audit, pinned and offline, plus one self-sufficient credit
line.** A new `composite` field on `ElevationSource` records the manifest URL,
the fetch date, the SHA-256 of the audited bytes, the dataset count, the
distinct-term count, the family census, the binding obligation and how much of
the audit was name-only. `defineElevationSource` enforces its internal
consistency — the census must sum to the dataset count, the hash must be a real
hash, and the attribution string must lead to the per-dataset credits — and
throws `COMPOSITE_LICENCE_UNRESOLVED` otherwise.

The `license` field then names *that audit* instead of pretending to be an
SPDX id:

> Composite of 134 open datasets audited 2026-08-02 — see `composite`; binding
> obligation across the whole set is attribution; no non-commercial,
> share-alike or no-derivatives terms declared

### What the UI prints under a rendered tile, and why it is sufficient

```
Elevation: © Mapterhorn — 134 open national and global elevation datasets,
each credited at mapterhorn.com/attribution
(CC BY 4.0, Licence Ouverte 2.0, dl-de/by-2.0, GSI Japan and public-domain terms)
```

That is `elevationCredit(MAPTERHORN)`, and it is what the app renders. It is
legally sufficient for the two families that bind hardest:

* **CC BY 4.0 §3(a)(2)** expressly permits satisfying the attribution
  conditions "in any reasonable manner based on the medium, means, and context",
  and gives *providing a URI or hyperlink to a resource that includes the
  required information* as its own worked example. The line names the licensor,
  names the licence and carries the URI.
* **Licence Ouverte / Open Licence 2.0** requires mention of the source
  ("paternité") and accepts a link to it. Same discharge.

**No network is involved in producing that line.** It is a constant in the
registry; it prints identically with the shell capability denied, on a plane,
or from a cached artifact. The `composite` audit travels with it through
`elevationProvenance()`, so a caller that wants the census has it without a
fetch either. If the full 134-row list is ever wanted *inside* the artifact
rather than behind the URI, the reduced manifest is ~16 KB against a
1.50 MB bundle — affordable, but not spent today, because Mapterhorn is opt-in
and the default path would carry bytes it never reads.

**The one thing this does not do** is credit the specific national agency whose
data produced a given tile. That is not a shortcut; it is unavailable upstream,
and the credit line says so by crediting all 134 rather than implying one. If
Mapterhorn ever publishes per-tile provenance, `composite` is the field that
should grow a resolver.

## Rejected, and why

* **Copernicus DEM GLO-30** — free and global, but a **DSM**. It is the same
  kind of surface as Terrarium at the same 30 m posting, so it fixes nothing
  this task is about. `[V]`
* **Copernicus DEM EEA-10** — 10 m over Europe, but restricted to eligible
  users and not publicly available; redistribution is out of the question. `[V]`
* **FABDEM, FABDEM+, FathomDEM** — genuinely useful bare-earth corrections of
  Copernicus, and all three CC-BY-**NC**. Non-commercial excludes them from
  this repo, which is precisely why GEDTM30 matters: it is the only
  globally-complete bare-earth DEM that is also redistributable. `[V]`
* **Slovenia (ARSO LiDAR DMR 1 m)** — technically excellent, 1 m bare earth,
  bulk ASCII per 1 km tile. Described as free for commercial and
  non-commercial use with attribution "requested but not legally required",
  which is a description and not a licence. No named or SPDX licence could be
  confirmed, so under this repo's rule it does not go in. Worth one more
  attempt against ARSO directly. `[S]`
* **Madeira** — the demo's own home region. A DGT/RAM Modelo Digital do
  Terreno exists at 5 m (and 10 m regionally), apparently CC-BY-4.0 and flagged
  as EU High-Value Data, but the catalogue host `catalogo-irig.madeira.gov.pt`
  did not resolve during this pass, so neither the endpoint nor the licence
  could be confirmed live. Madeira therefore has no *national* entry, which is
  stated by its absence from `REGION_ELEVATION_SOURCES` rather than hidden —
  but since 2026-08-02 it is no longer on 30 m rooftop radar either: the global
  tail's first link is GEDTM30, a bare-earth model. A 5 m regional MDT is still
  worth 6x more, so this remains a follow-up; it is no longer an emergency.
* **Germany beyond NRW** — every Land publishes DGM1, licences run CC-BY /
  dl-de/by-2-0 / dl-de/zero. BKG's federal service is paid for third parties
  despite the open-data framing. Adding a Land is one registry entry plus one
  `elevation_check.probe`; NRW is done because its orthophoto service was
  already qualified. `[V]`
* **Italy beyond Südtirol** — same trap as the imagery: regional licences are
  inconsistent, and Piemonte's records say all rights reserved. Only add a
  region with an explicit CC-BY record. `[V]`

## The format decision, and what it costs

**Only two of these publishers serve elevation in a shape a sandboxed browser
can consume**, and both are already Terrarium-encoded: Mapzen Terrarium
(RGB-PNG, 256²) and Mapterhorn (lossless WebP, 512²) on WebMercatorQuad.
Everything else is GeoTIFF/COG — the eight national coverages in a national
projected CRS (EPSG:2056, 3035, 25832, 28992, 5514), and GEDTM30 as one global
COG in EPSG:4326. IGN is the near-miss: its WMTS serves BIL32 (a raw float
array, trivially decodable) and its WMS offers `STYLES=terrainrgb`, but the
WMTS is on a non-WebMercator grid and stops at z14 (≈25 m/px, throwing the 1 m
data away), and the WMS is a query-string GET that every allowlist in this app
refuses.

Consuming the rest client-side would need two things the napplet cannot have:

1. **A GeoTIFF reader** — tiled and striped layouts, LZW/Deflate with the
   float horizontal-differencing predictor, float32 sample format.
2. **A reprojection engine** — a proj implementation plus the datum grids to
   get from EPSG:2056 or 28992 to WGS84 at sub-metre accuracy. Getting this
   wrong shifts terrain under the buildings, which is worse than coarse terrain.

`artifactMode` is single-file and this repo does not take runtime dependencies
without justifying the bundle cost. Both libraries are large, and the second is
the one that would be quietly wrong rather than loudly broken.

**GEDTM30 is the exception to reason (2), and it is worth naming.** Its COG is
already in EPSG:4326, so the step to WebMercator is closed-form arithmetic — no
proj implementation, no datum grids, nothing that can silently shift terrain
under the buildings. It still needs the GeoTIFF reader, so it still transcodes
server-side, but it is by a distance the cheapest and highest-value transcode
in this document: one reader, no reprojection risk, and it improves *every*
bbox on earth rather than one country's.

### Decision: server-side transcode to Terrarium-encoded tiles

blossom-gis reprojects and re-encodes each national coverage into
Terrarium-encoded PNG on the standard WebMercatorQuad grid, served at:

```
GET /dem/{source_id}/{z}/{x}/{y}.png     →  image/png, Terrarium-encoded
```

where `source_id` is the registry key (`it-bz-dtm-05m`, `at-bev-dtm-1m`,
`gedtm30`, …). This sits beside the existing `GET /dem/{z}/{x}/{y}.png`
Terrarium proxy and has the same cache semantics.

**`gedtm30` is the one to build first.** It is one reader against one global
file with no reprojection risk, and it lifts the floor for every bbox on earth
instead of one country's. Every other entry in this table is a refinement on
top of it.

**The client half is implemented and tested; the transcoder itself is not.**
`generateTerrain` resolves the chain, builds and allowlists these URLs, fetches
them cache-first, and — when the route is absent — demotes to the next source
and finally to Terrarium. That failover is covered by
`packages/napplet-kit/tests/unit/terrain-source-chain.test.ts`. Nothing fabricates a
surface, and no code pretends the transcode exists.

**Why Terrarium out and not a new encoding.** `decodeTerrarium` and
`sampleHeightfield` stay single-implementation, `MAX_DEM_TILES` and the tile
budget keep meaning what they meant, and the collection cache keeps one shape.
Terrarium's ¹⁄₂₅₆ m step is 3.9 mm — two orders of magnitude under the ±0.5 m
vertical accuracy of the ALS products — so the re-encode is lossless in
practice.

### What it costs, stated plainly

* **A GDAL-class dependency on the server.** `rasterio` + `pyproj`, neither
  currently in `blossom-gis`. This is a server dependency, not a client one,
  which is the whole point — but it is real, and it makes the service harder to
  install than `pillow` + `numpy`.
* **Storage.** Austria and Czechia publish bulk COG with no coverage service,
  so the transcoder must hold the tiles it needs rather than range-request per
  request. Recorded on those registry entries.
* **First-request latency.** A cold tile means fetch + reproject + resample +
  encode, not proxy. The transcoded sources carry `timeoutMs: 45_000` against
  Terrarium's 15 000 for that reason.
* **Licence obligations travel.** A transcoded tile is a derived work of the
  national coverage. CC-BY, dl-de/by and the swisstopo terms are infectious, so
  attribution has to reach whatever displays or stores the tile —
  `elevationProvenance()` returns the whole chain's licences, not just the one
  source that answered. See "Attribution has to reach the UI" below: it does
  not yet, and that is a licence bug, not a cosmetic one.
* **The napplet gets no new bytes.** No new runtime dependency, no new decoder,
  no bundle growth.

## The decode path is size- and format-agnostic already

Adding a 512² lossless-WebP source required no decoder work, which is worth
recording so the next person does not go looking for the switch that isn't
there:

* `chooseDemZoom` divides by `endpoint.tileSize`, so a 512² source resolves one
  zoom lower for the same target pixel count. `demTilesForBBox`, `demTilePath`
  and `isApprovedDemUrl` never touch pixel dimensions at all.
* `sampleHeightfield` reads `size` off each decoded `DemTileRaster` rather than
  off the endpoint, so the bilinear maths follows the bitmap.
* `decodeRaster` in `packages/napplet-kit/src/terrain/generate.ts` calls
  `createImageBitmap(blob)`, which sniffs the container bytes. PNG and WebP go
  down the same line; the `format` field is documentation and allowlist
  material, not a decoder switch.

Two changes were needed, both declarative: `TileEndpoint` grew a `format` field
(`image/png | image/webp`) so a source's wire format is part of the contract
rather than an implicit assumption, and `isApprovedDemUrl` already compiled its
pattern from the path template, so `/{z}/{x}/{y}.webp` allowlists correctly and
the `.png` spelling of the same path is refused.

**`image/webp` is admissible only when lossless.** Terrarium packs the ¹⁄₂₅₆ m
fraction into the blue channel, so lossy chroma subsampling would quantise
elevation into steps of metres while still decoding perfectly cleanly — a
silent, plausible-looking corruption. Mapterhorn's tiles were checked byte-wise
and carry a `VP8L` chunk. Any future WebP source must be checked the same way.

**One hardcode remains, and it is app-side.**
`cachedDemTileUrl(z, x, y)` in `packages/napplet-kit/src/job/collection.ts` returns
`/dem/{z}/{x}/{y}.png` and is used as the collection-cache URL for *any* direct
source. With Terrarium as the only direct source that was fine. With a second
one it is a cache-namespace collision: a Mapterhorn tile request would be
served from — or would populate — Terrarium's cache slot at the same z/x/y,
which is a different tile at a different size. Before Mapterhorn is ever wired
into a chain, that URL must become `/dem/{source_id}/{z}/{x}/{y}.{ext}` (with
`mapzen-terrarium` keeping the legacy shape for cache compatibility) or direct
sources other than Terrarium must skip the cache entirely.

## Attribution has to reach the UI, and today it does not

`elevationProvenance()` has **no production caller.** The napplet hardcodes

```ts
demAttribution: 'Elevation: Mapzen Terrain Tiles via AWS Open Data'
```

in `packages/napplet-kit/src/ui/copy.ts`. That string was true when Terrarium was the
only source. It is now false whenever any other link answers, and rendering a
CC BY source under someone else's credit is a licence breach rather than a
cosmetic slip — the same class of defect this whole document exists to prevent
on the data side.

The registry side of the fix is done. `elevationProvenance()` now returns, per
row, a ready-to-print `credit` string alongside the licence, model, resolution
and vertical uncertainty, and `elevationCredit(source)` / `elevationCreditLine(chain)`
give the one-source and whole-chain forms. Nothing about licences needs to be
known by the caller.

**What the app still has to do**, in three steps:

1. `generateTerrain` must report **which** source answered. It walks the chain
   and returns a `TerrainMesh`; the identity of the link that succeeded is
   discarded. Return it (or accept an `onSource` callback) — crediting the
   whole chain would credit sources that never contributed.
2. `copy.ts` must turn `demAttribution` from a constant into
   `(credit: string) => credit`, fed from `elevationCredit(answeringSource)`.
3. The same credit must travel onto the exported artifact, not just the
   viewport. A GLB derived from a CC BY coverage carries the obligation with it.

## Vertical uncertainty is now a mandatory field

`.planning/MESH-CALCULATOR.md` §4.1 requires every source to declare a 1σ
vertical uncertainty: a Fresnel-clearance verdict carries information only when
σ is smaller than the clearance being tested, so a source that cannot state σ
cannot answer the question at all. `defineElevationSource` now throws
`VERTICAL_UNCERTAINTY_UNDECLARED` without one, and each figure carries the
basis of the claim:

| Source | σ | Basis |
|---|---:|---|
| Mapzen Terrarium | 14.31 m | `measured` — this project, against 0.5 m LiDAR on this grid |
| Mapterhorn | 14.31 m | `inherited-worst-case` — no per-tile provenance, so the worst it could be |
| GEDTM30 | 10.69 m | `published` — PeerJ 19673, vs GNSS stations |
| the eight national DTMs | = native posting, floored at 0.3 m | `assumed-from-posting` |

**The national figures are assumptions and are labelled as such.** §4.1 asks for
vendor numbers; none of the eight publishers' accuracy statements was read in
this pass, and writing one from memory would be exactly the fabrication this
registry refuses. The rule is one line of code (`postingSigmaM`), is
deliberately pessimistic — an ALS DTM's real σ is normally well under its
posting, so this never makes a refusal look more answerable than it is — and is
a unit-tested invariant. Replacing each with a confirmed vendor figure is a
follow-up, and it will *widen* the answerable envelope rather than narrow it.

Mapterhorn inheriting Terrarium's measured figure has a deliberate consequence:
**it buys resolution, never accuracy.** It can never win a σ comparison, which
is the correct behaviour for a mosaic that cannot say whether a given tile is
bare earth.

## Qualification

`blossom_gis/elevation_check.py` is the elevation twin of `source_check.py`:
one request per source (two where a DSM twin exists), answering whether the
data is real. Four ways a DTM source lies, and the gate for each:

| Failure | Gate | Threshold |
|---|---|---|
| Returns nodata outside coverage | `nodata_fraction` | ≤ 5%, with valid elevations bounded to −500…9000 m |
| Returns a constant fill | `relief_m` (p2–p98) | per-candidate, against a probe point in known relief |
| Returns upsampled coarse data | `detail_score` | ≥ 1.70 |
| Returns upsampled coarse data | `linear_fraction` | ≤ 0.05 |
| Serves the DSM as the DTM | `surface_offset_m` | ≥ 1.0 m, where a DSM twin is published |

`detail_score` is the same downsample/restore survival ratio `source_check`
uses on images, applied to curvature energy instead of edge energy.
`linear_fraction` is the share of samples lying on a straight line between
their neighbours — the residue interpolation leaves behind.

Thresholds are calibrated on synthetic fractal surfaces spanning the roughness
real terrain shows (Hurst 0.5–0.9) against bilinear stretches of 4x–32x coarser
data. Measured: native scored **1.87–2.35** on detail and **0.0000–0.0002** on
linearity; upsampled scored **1.24–1.47** and **0.29–0.91**; nearest-neighbour
blocks **0.57**; a constant plane **1.00**. The calibration is synthetic and
says so — the gates want re-checking against a real coverage the first time one
is fetched.

The elevation bound is asymmetric on purpose. A symmetric magnitude wide enough
to allow the ocean floor lets `-9999` through, and `-9999` is exactly the value
that turns an out-of-coverage answer into a flat plate 10 km below the model.

## Next steps, by value

1. **The GEDTM30 transcode.** `/dem/gedtm30/{z}/{x}/{y}.png` from the global
   COG. One reader, no reprojection risk, and it lifts the floor for every bbox
   on earth from a 14.31 m rooftop surface to a 10.69 m bare-earth model.
   Everything else in this list is a refinement on top of it. Until it exists,
   the GEDTM30 link demotes to Terrarium on every job.
2. **Attribution to the UI.** Three steps, listed above. This is a licence
   obligation, not a feature, and it is unblocked today.
3. **The national transcodes.** `rasterio` + `pyproj` behind the same route.
   The client half and its interface are already in place.
4. **Vendor σ figures** for the eight national DTMs, replacing
   `assumed-from-posting`. Widens the answerable envelope in MESH-CALCULATOR
   §4.3 rather than narrowing it.
5. **Run `elevation_check.check_all()` against the live services** and record
   the evidence, the way the imagery candidates were recorded. GEDTM30 has no
   DSM twin, so its bare-earth claim rests on the published validation rather
   than on a `surface_offset_m` gate — worth noting when the gate is run.
6. **Madeira.** Confirm the DGT/RAM MDT endpoint and licence — 5 m regional
   bare earth against 30 m global.
7. **Mapterhorn's surface classification** (MESH-CALCULATOR §2.5): ~134 manual
   rows keyed by source id declaring `dtm | dsm | mixed`, plus per-source
   coverage polygons. Until that exists Mapterhorn stays opt-in, `mixed`, and
   pinned at the worst-case σ. This is the one piece of work that would turn it
   from a resolution upgrade into an accuracy one.
8. **Slovenia**, if ARSO will name a licence.
9. **German Länder**, one registry entry and one probe each.
10. **Re-audit `attribution.json`** when Mapterhorn adds sources. The pinned
    `sha256 d2f6a2a1…31376` is how you tell that it changed; the census in
    `composite` has to be re-derived, not patched.
