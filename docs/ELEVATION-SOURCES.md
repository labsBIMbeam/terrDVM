# Bare-earth elevation sources

Survey of free, redistributable national DTMs, researched and probed live
2026-08-01. Companion to `IMAGERY-SOURCES.md`, same conventions: `[V]` means
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

## Rejected, and why

* **Copernicus DEM GLO-30** — free and global, but a **DSM**. It is the same
  kind of surface as Terrarium at the same 30 m posting, so it fixes nothing
  this task is about. `[V]`
* **Copernicus DEM EEA-10** — 10 m over Europe, but restricted to eligible
  users and not publicly available; redistribution is out of the question. `[V]`
* **FABDEM** — a genuinely useful bare-earth correction of Copernicus, but
  CC-BY-**NC**-SA. Non-commercial excludes it from this repo. `[V]`
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
  could be confirmed live. **Madeira therefore still gets 30 m Terrarium**,
  which is stated in `REGION_ELEVATION_SOURCES` rather than hidden. This is the
  most valuable single follow-up in this document.
* **Germany beyond NRW** — every Land publishes DGM1, licences run CC-BY /
  dl-de/by-2-0 / dl-de/zero. BKG's federal service is paid for third parties
  despite the open-data framing. Adding a Land is one registry entry plus one
  `elevation_check.probe`; NRW is done because its orthophoto service was
  already qualified. `[V]`
* **Italy beyond Südtirol** — same trap as the imagery: regional licences are
  inconsistent, and Piemonte's records say all rights reserved. Only add a
  region with an explicit CC-BY record. `[V]`

## The format decision, and what it costs

**Only one of these publishers serves elevation in a shape a sandboxed browser
can consume.** Terrarium is RGB-PNG on WebMercatorQuad. Everything else is
GeoTIFF/COG in a national projected CRS — EPSG:2056, 3035, 25832, 28992, 5514.
IGN is the near-miss: its WMTS serves BIL32 (a raw float array, trivially
decodable) and its WMS offers `STYLES=terrainrgb`, but the WMTS is on a
non-WebMercator grid and stops at z14 (≈25 m/px, throwing the 1 m data away),
and the WMS is a query-string GET that every allowlist in this app refuses.

Consuming the rest client-side would need two things the napplet cannot have:

1. **A GeoTIFF reader** — tiled and striped layouts, LZW/Deflate with the
   float horizontal-differencing predictor, float32 sample format.
2. **A reprojection engine** — a proj implementation plus the datum grids to
   get from EPSG:2056 or 28992 to WGS84 at sub-metre accuracy. Getting this
   wrong shifts terrain under the buildings, which is worse than coarse terrain.

`artifactMode` is single-file and this repo does not take runtime dependencies
without justifying the bundle cost. Both libraries are large, and the second is
the one that would be quietly wrong rather than loudly broken.

### Decision: server-side transcode to Terrarium-encoded tiles

blossom-gis reprojects and re-encodes each national coverage into
Terrarium-encoded PNG on the standard WebMercatorQuad grid, served at:

```
GET /dem/{source_id}/{z}/{x}/{y}.png     →  image/png, Terrarium-encoded
```

where `source_id` is the registry key (`it-bz-dtm-05m`, `at-bev-dtm-1m`, …).
This sits beside the existing `GET /dem/{z}/{x}/{y}.png` Terrarium proxy and
has the same cache semantics.

**The client half is implemented and tested; the transcoder itself is not.**
`generateTerrain` resolves the chain, builds and allowlists these URLs, fetches
them cache-first, and — when the route is absent — demotes to the next source
and finally to Terrarium. That failover is covered by
`apps/napplet/tests/unit/terrain-source-chain.test.ts`. Nothing fabricates a
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
  source that answered.
* **The napplet gets no new bytes.** No new runtime dependency, no new decoder,
  no bundle growth.

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

1. **Madeira.** Confirm the DGT/RAM MDT endpoint and licence. The demo's home
   region is the one place still on 30 m rooftop radar.
2. **The transcoder.** `rasterio` + `pyproj` behind
   `/dem/{source_id}/{z}/{x}/{y}.png`. The client half and its interface are
   already in place.
3. **Run `elevation_check.check_all()` against the live services** and record
   the evidence, the way the imagery candidates were recorded.
4. **Slovenia**, if ARSO will name a licence.
5. **German Länder**, one registry entry and one probe each.
