# Vertical Slice: the public corpus path

**Defined:** 2026-08-01
**Branch context:** follows `refactor: extract the terrain engine into @terrcvm/terrain-engine`; tasks 3/4/5/13 in flight.
**Relation to ROADMAP.md:** ROADMAP.md records the four-phase paid-DVM slice. The repo has since deviated from that plan at explicit operator request (README, "Deviations"). This document scopes the distribution slice the project actually pivoted to. It does not rewrite ROADMAP.md; reconciliation is task 12 plus a later GSD transition.

## The thesis this slice proves

Not the paid-DVM thesis — that is deferred (see Deviations below). The thesis under test is:

**Public geodata, crawled once, is discoverable and renderable by any sandboxed client through commodity nostr + blossom infrastructure — no custom API, no accounts, no privileged client.**

Payment gates per-delivery bakes (GLB, textures), not the tile corpus. ARCHITECTURE.md already states the operating model: crawl coarse, fetch fine on demand — which is what a data vending machine does anyway. This slice builds the corpus half; the paid half composes on top of it later without rework.

---

## 1. The slice

One Funchal tile travels the full public path — crawled once, content-addressed on blossom-server, announced on strfry, discovered and rendered by a sandboxed mapplet from nothing but relay events and blob hashes — while the tile next door honestly reports "no data".

### The path, numbered

1. `docker compose up` on alflx brings up **strfry** (write policy: crawler pubkey only), **hzrd149/blossom-server** (owns bytes), and **blossom-gis** (geo index + crawler + TFT2, demoted from blob owner).
2. The crawler — operator-run, holder of the only signing key — crawls tile **14/7422/6618**: Terrarium DEM PNG and OSM features encoded to TFT2.
3. The crawler writes both blobs through to blossom-server via BUD-02 `PUT /upload` with a kind-24242 authorization it signs itself; blossom-gis keeps the spatial index row.
4. The crawler publishes to strfry: two **kind-30550 collections** (`dem`, `features` — `bbox` tag = Madeira coverage, `license`, `server`, no geohash) and two **kind-30551 items** (`d` = `dem:14/7422/6618` and `features:14/7422/6618`, exactly one `g` tag = `etgc`, `x` = blob sha256).
5. The mapplet (new `apps/mapplet`; manifest declares `resource` + `outbox`, never `upload`) fetches `{kinds:[30550], authors:[<crawler>]}` wholesale and filters bbox locally — collections are few, and `bbox` is deliberately unindexed. It learns the datasets, the blossom server URL, and the mandatory attribution from the events, not from config.
6. Viewport over Funchal → the mapplet queries `{kinds:[30551], authors:[<crawler>], "#g":["etgc"]}` and refines the superset by parsing `d` and the content bbox.
7. For the covered tile it fetches both blobs by hash through the `resource` capability and **recomputes sha256 against the `x` tag before decoding** — fail closed on mismatch.
8. `@terrcvm/terrain-engine` decodes: Terrarium → heightfield → mesh; TFT2 → buildings/roads. The WebGL2 renderer shows the 3D tile with the collection's attribution.
9. **Negative case:** neighbour **14/7423/6618** — same p4 cell, so the `#g` query *returns* items; refinement finds none for that tile; the mapplet shows an explicit "no data for this tile" state, renders nothing, and contacts no upstream.

During the render the network log shows only the relay and the blossom host. No Mapzen, no Overpass, no Esri. That single observable is the thesis.

### Refinements to the working definition (challenged, not accepted)

| Working definition said | Refined to | Reason |
|---|---|---|
| One tile, TFT2 encoded | One tile, **two datasets**: `dem` (Terrarium PNG) + `features` (TFT2) | A TFT2 tile is vectors; 3D terrain structurally requires elevation. Rendering features on a *live-fetched* DEM would leave the render mostly non-corpus and disprove nothing. Same path twice, and it exercises the protocol's one novel identity claim: `dem:14/7422/6618` and `features:14/7422/6618` coexisting from one publisher is exactly the collision the dataset-prefixed `d` was designed for (`kinds.ts` names this scenario verbatim). |
| Discovered via a `#g` query | Collection-first discovery, `authors` pinned, superset refined, hash verified | `#g` alone under-specifies four load-bearing steps: collections carry server + licence and are fetched wholesale (bbox is unindexed by design); the `authors` filter is the entire trust model on a public relay; a `#g` hit is a superset that must be refined against `d`; fetched bytes must hash-match `x` before decode (house rule: nothing is delivered until bytes and hash verify). |
| Negative case: an uncovered tile | Negative case: the **same-cell neighbour** 14/7423/6618 | An empty-cell tile passes trivially (empty query → no data). The neighbour shares `etgc`, so the query returns real items and the client must *still* conclude no data — proving the refine step, not the absence of traffic. |
| "rendered as 3D terrain" | rendered as 3D terrain **with attribution from the collection event** | Licence display is mandatory house policy; the slice must prove attribution travels the protocol, not the config file. |

### Deviations, stated plainly

AGENTS.md's core invariant orders payment before the terrain processor; README records three knowing deviations, all operator-approved. This slice:

- **Extends deviation 1/2** (processor before payment, payment skipped): it builds the distribution and viewer layer — originally Phase 4, ordered after payment — with payment still skipped. That is a **fourth deviation and it must be recorded, not drifted into**: task 12 adds it to README's Deviations list. It is acceptable because the corpus layer is payment-orthogonal (payment gates per-delivery bakes, never the public tile grid) and because every event and blob the slice produces is reused unchanged when the paid loop lands. Condition: `invoice.ts` stays as the unwired placeholder, and the mapplet grows no payment UI in this slice.
- **Partially unwinds deviation 3** (a custom collection server exists): demoting blossom-gis to index + crawler and moving bytes to stock hzrd149/blossom-server is a move *back toward* the brief, which planned a Blossom *client* against a third-party server.
- One internal stance shifts: blossom-gis's "this service never holds a private key" still holds for the **server**; the **crawler CLI** now signs (24242 uploads, 3055x events). The key lives in operator-local env/file, never in the repo — AGENTS.md safety rules apply unchanged.

---

## 2. Deliberately out of the slice

| Excluded | Reason (one line) |
|---|---|
| Crawling at scale | One tile proves the path; scale is a gated decision fed by the VS-6 number, and z19-Europe is 88 GB per province — already ruled impossible. |
| Texture / orthophoto baking | A texture is a per-delivery bake like GLB, not corpus; the elevation-ramp render is the recorded honest fallback. |
| Avatars and placements | Kind-1063 social layer, already demonstrated in the napplet; rides the multi-precision ladder being restored in flight (task 5); untouched here. |
| Payment loop / NIP-90 DVM | Deferred and recorded as deviation 4; the placeholder stays unwired. |
| Public hosting / VPS | Explicitly gated on the VS-6 corpus number (section 7). |
| S3, multi-region, blob mirroring (BUD-04 across hosts) | One host proves the protocol; replication is policy, not thesis. |
| The demo film / any `apps/napplet` change | The napplet is the frozen demo; the mapplet is the product path. |
| Mapplet UX beyond discover / render / no-data | Viewer flight, isometric mode, export all exist in the napplet; porting is polish, not proof. |
| Blob GC / retention budgets | The corpus is one tile; DIST-07-class work returns with scale. |
| Broader NIP standardization | Per the brief: after the slice, never during. |
| CI expansion beyond task 13 | In flight; an entry condition for merging, not slice scope. |

---

## 3. Milestones

Slice milestones are `VS-n` to avoid colliding with ROADMAP phase numbers. In-flight tasks 3, 4, 5, 13 are **entry conditions, not milestones** — nothing below edits the files they own.

### Two lanes plus two independents

```text
Lane A (server):  VS-1 ──► VS-2 ──► VS-3 ─┐
                                          ├─► VS-5 ──► VS-7
Lane B (client):  spikes R1/R2 ──► VS-4 ──┘
Independent:      VS-6 (anytime) · VS-7 closes last
```

Lane A and Lane B are fully parallel. **Critical path: whichever lane is longer, then VS-5.** The R1 spike is the first work to start — it can invalidate Lane B's tool choice entirely (section 6).

| ID | Task | Name | Entry condition | Exit condition | The one observable fact |
|---|---|---|---|---|---|
| VS-1 | 9 | Compose the stack | none — can start today | strfry (with crawler-pubkey write policy), blossom-server, blossom-gis healthy under one `deploy/compose.yaml` on alflx, TLS-fronted (risk R3) | A REQ over the wire returns EOSE, and `HEAD /<64 hex>` on blossom-server returns a well-formed 404 |
| VS-2 | 10 | Write-through | VS-1; Python schnorr signing spiked (R5) | Crawler gains `--tile z/x/y` targeting; both Funchal blobs stored on blossom-server via signed BUD-02 upload; blossom-gis keeps the index row | `curl <server>/<sha> \| sha256sum` equals `<sha>` for both blobs |
| VS-3 | 11 | Announce | VS-2; tasks 3 and 4 landed | Two 30550 + two 30551 on strfry, signed by the crawler key; a publish signed by any other key is rejected by the write policy | `#g=etgc` query returns exactly two items whose `x` tags equal the stored blob hashes |
| VS-4 | 6 | Mapplet scaffold | Spike verdicts R1 and R2 recorded | `apps/mapplet` scaffolded with the `napplet` CLI; manifest declares `resource` + `outbox` and **not** `upload`; conformance passes on `dist`; `verify-shell-boundary.mjs` covers the new root | `napplet-conformance` PASS against `apps/mapplet/dist` |
| VS-5 | 7 | Discover and render | VS-3 **and** VS-4 | Mapplet renders the Funchal tile (terrain + buildings + attribution) from corpus only; neighbour tile shows the explicit no-data state | Request log during render contains only the relay and blossom origins — no Mapzen, Overpass, or Esri |
| VS-6 | 8 | Corpus estimator | none — needs only tile math and measured constants | Estimator prints bytes/tile-count per candidate crawl plan, calibrated on the measured constants (51.3 kB Funchal TFT2, 18 B/feature, 168→32 DEM dedup, 5 MB–88 GB South Tyrol ladder) | One number for the v1 public crawl plan — the input to the hosting gate |
| VS-7 | 12 | Record | VS-5 (wording depends on outcome) | ARCHITECTURE.md upload-capability claim corrected; deviation 4 added to README; this document's ladder results linked | Public diff shows docs matching observed behaviour; secret scan finds no key material |

**Serial:** VS-1 → VS-2 → VS-3 (each consumes the previous milestone's artifact). **Parallel:** Lane B against Lane A; VS-6 against everything; VS-7 drafts early, closes last.

---

## 4. The first tile: `14/7422/6618` — Funchal harbour

| Property | Value | Verified against |
|---|---|---|
| Tile | z14 x7422 y6618 | computed and script-checked this session |
| BBox (W S E N) | −16.9189453 32.6393749 −16.8969727 32.6578757 | slippy math |
| Centre | 32.648625, −16.907959 | contains Funchal's Sé cathedral and harbour |
| `g` tag (p4, from centre) | `etgc` | geohash computed from tile centre, per `item.ts` |
| Item `d` values | `dem:14/7422/6618`, `features:14/7422/6618` | `kinds.ts` d-tag format |
| Width | 2.06 km | ~10.7 m per cell on the 192² heightfield grid |
| Parent z12 cell | 12/1855/1654 — `covered`, detail 2.11, 233 kB/MP, "architectural resolution" | `packages/terrain-engine/src/config/coverage/madeira.json` |

**Why this tile.** DEM correctness is already verified in this region (Madeira massif 439–1831 m matches Pico Ruivo). OSM density is measured, not hoped for — the 51.3 kB Funchal TFT2 conformance tile (1,457 buildings + 1,541 roads) comes from exactly this town. The `madeira` region is configured in `regions.ts`, surveyed in `coverage/madeira.json`, and is the region every crawler example already uses. z14 is the zoom the protocol was tuned around: `GEOHASH_PRECISION = 4` was chosen by z14 events-per-cell, and the `d`-tag example in `kinds.ts` is a z14 tile.

**Negative-case tile: `14/7423/6618`** — the immediate eastern neighbour. Same z12 parent, same `etgc` cell. The `#g` query for it returns the covered tile's two items; the mapplet must refine and still say "no data". Sharpest honest negative available.

**Datasets.** `dem` = Terrarium PNG (`image/png`; licence tag = the Mapzen/AWS terrain-tiles attribution stack). `features` = TFT2 (`application/x-tft2`; licence tag = **ODbL** — share-alike is infectious for derived geometry and the collection event is where that must be declared). Exact mime string for TFT2 is fixed at VS-3 and recorded in the collection event, which is the authoritative registry.

---

## 5. Definition of done — verification ladder

In the style of the brief's ladder: concrete command, concrete observation. All ten pass or the slice is not done.

1. **Workspace green.** `corepack pnpm -r test` and `cd services/blossom-gis && uv run pytest && uv run ruff check .` — all green, including the bidirectional TFT2 golden-bytes pin. CI (task 13) green on the branch.
2. **Stack up.** `docker compose -f deploy/compose.yaml up -d` on alflx; `docker compose ps` shows three healthy services.
3. **Protocol liveness.** A REQ against the strfry endpoint returns EOSE; `curl -sI <blossom>/0000…00` (64 hex) returns 404, not a route error.
4. **One-tile crawl.** `python -m blossom_gis.cli run --region madeira --tile 14/7422/6618` completes for both datasets and reports the two sha256 values and write-through success.
5. **Bytes by hash.** `curl -s <blossom>/<sha_dem> | sha256sum` = `<sha_dem>`; same for `<sha_features>`.
6. **Announcements.** Query `{kinds:[30550], authors:[<crawler>]}` → exactly two collections with `bbox`, `license`, `server` tags. Query `{kinds:[30551], authors:[<crawler>], "#g":["etgc"]}` → exactly two items; each `x` equals its blob hash; `d` values are `dem:14/7422/6618` and `features:14/7422/6618`.
7. **Write path closed.** The same 30551 publish signed with a throwaway key → strfry returns `OK false`. The mapplet manifest contains no `upload` capability.
8. **Client artifact.** `corepack pnpm --filter @terrcvm/mapplet build` then `napplet-conformance` against `apps/mapplet/dist` → PASS; `node scripts/verify-shell-boundary.mjs` → PASS including the mapplet root.
9. **Positive render.** Mapplet open over Funchal in the shell (or dev shim with the fallback named): 3D terrain with buildings and the collection's attribution visible; the request log for the session contains only the relay and blossom origins.
10. **Negative render + record.** Neighbour tile shows the explicit "no data for this tile" state — never a flat plate, never a silent upstream fetch. VS-6 number recorded; ARCHITECTURE.md corrected and deviation 4 recorded (VS-7); secret scan of the diff finds no key material.

---

## 6. Risks, ranked, each with the cheapest retiring experiment

| # | Risk | Impact | Cheapest experiment |
|---|---|---|---|
| R1 | **MapLibre's worker spawns from a Blob URL and the shell CSP under `artifactMode: 'single-file'` may block `worker-src blob:`.** Sinks the mapplet's map layer entirely. Note the existing napplet *bundles* maplibre-gl 5.24.0 but its recorded shell smoke predates the map plans (01-05+ unexecuted), so this is genuinely unproven. | Lane B tool choice | Zero new code: build the **existing** napplet `dist` and run it through `napplet-conformance` plus a real shell/Paja smoke; observe whether basemap tiles render (worker alive). Hours. If blocked: request a `worker-src blob:` allowance from the shell, else drop MapLibre in the mapplet for a hand-rolled raster map — precedent exists, the napplet already hand-rolls WebGL2. |
| R2 | **Shell `outbox`/`resource` domains may not behave as documented** — arbitrary-relay REQ via outbox, arbitrary-host bytes via resource, in a real shell rather than the dev shim. | Steps 5–7 of the path | A ~30-line napplet that issues one outbox REQ to the alflx relay and one `resource.bytes()` to the blossom host, printing EOSE and byte length. Run under the real shell before VS-4 starts. |
| R3 | **Mixed content over Tailscale:** a shell served over https will refuse plain `ws://alflx:7777` and `http://alflx` blob fetches. | Browser can't reach the stack at all | `tailscale serve` (or caddy) fronting strfry and blossom-server with TLS; from any https page, open a `wss://alflx.<tailnet>.ts.net` socket. One evening. Bake the TLS front into VS-1's compose from day one rather than retrofitting. |
| R4 | **strfry may not index `#d`/`#g` as assumed**, or addressable 3055x replacement/write-policy behaves unexpectedly (`maxFilterLimit` 500 clamp is already designed-for). | VS-3 query model | `docker run` strfry alone: publish two versions of one `d`, query `#g` and `#d`, publish with a foreign key against the write policy. One hour with `nak`. (Expected to pass — strfry indexes single-letter tags generically — which is why this ranks below the client risks.) |
| R5 | **Python schnorr signing is new** — blossom-gis is BIP-340 *verify-only* today; the crawler must sign 24242 + 3055x. | VS-2/VS-3 | Sign one event with the chosen library; cross-verify with the repo's own verifier **and** an independent implementation (`nak verify`). |
| R6 | **24242 upload interop** with hzrd149/blossom-server (header format, expiration, `x` tag semantics). | VS-2 | `curl -X PUT <blossom>/upload` with a Python-signed auth event against the containerized server; expect a blob descriptor back. Folds into the R5 spike. |

R1–R3 can each sink or redirect the client lane and are run **before** VS-4 opens. R4–R6 are bounded server-side checks inside VS-1/VS-2.

---

## 7. The hosting decision gate

**The number:** projected corpus bytes for the v1 public crawl plan, produced by **VS-6** (task 8), calibrated on measured constants — 51.3 kB per dense-urban TFT2 tile, 18 B/feature, the 168→32 ocean-tile dedup ratio, and the South Tyrol ladder (z12 5 MB → z16 1.4 GB → z19 88 GB). Scale anchors: continental Europe is 43,617 p4 cells; at ~208 z14 tiles per cell (48° N) that is ~9.1 M z14 tiles before dedup.

**The threshold: 40 GB.**

- **≤ 40 GB** → provision the public VPS. 40 GB fits the cheapest commodity VPS class and rsyncs from alflx overnight on a residential uplink; going public becomes provisioning, not architecture. alflx remains the crawler and writes through to both.
- **> 40 GB** → stay alflx-only and **cut the plan, not upgrade the hosting**: crawl coarse, fetch fine on demand — the DVM model the architecture already commits to. Re-run the gate against the reduced plan.

Sanity check that the gate never blocks the slice: the demo regions are trivial at z14 — Madeira ≈ 2,688 tiles (≪ 200 MB after ocean dedup), South Tyrol ≈ 5,760 tiles (≪ 400 MB). The gate exists for continental ambition only; the slice itself is one tile.

### Input to the gate: the DEM zoom cap (settled 2026-08-01)

`DEM_SOURCE.maxZoom` in `packages/terrain-engine/src/terrain/dem.ts` is now **13**, not 14. Terrarium over every region this project targets is SRTM/GMTED2010 at 1-arcsec posting; a Web Mercator pixel matches that grid at z ≈ 12.3 on the longitude axis and z ≈ 11.8–12.1 on the latitude axis, so **z12 is the last zoom that carries source information** and z13/z14 store Mapzen's own interpolation. The derivation and its numbers live in the comment on the constant — re-derive there before raising it.

DEM is 90–95 % of corpus bytes, and total bytes scale **3.86×** per zoom level (measured 11.19 MB → 0.75 MB over Madeira across two levels; under 4× because finer tiles hold less relief and compress better). Projected DEM bytes, from tile counts over the `regions.ts` coverage boxes at ~10.7 kB/km² of mountainous land at z14:

| Crawl plan | z12 | z13 | z14 |
|---|---|---|---|
| v1: Madeira land + South Tyrol box (16.6 k km²) | 12 MB | **47 MB** | 182 MB |
| Austria national polygon (83.9 k km²) | 62 MB | **239 MB** | 921 MB |
| Austria bbox, all land (168 k km²) | 123 MB | **476 MB** | 1.84 GB |
| Europe land (10.5 M km²) | 7.7 GB | **29.9 GB** | 115.3 GB |

**This is what the cap decides.** v1 and Austria clear the 40 GB threshold at any zoom. Continental Europe **fails** the gate at z14 (115 GB) and **passes** at z13 (30 GB) — the cap is the difference between "provision a commodity VPS" and "cut the plan".

**Open consequence for the slice:** `demTileUrl` now rejects z14, so the item identity `dem:14/7422/6618` in §1 and §4 is no longer buildable by the terrain engine. The features tile is unaffected (the protocol tile grid and `GEOHASH_PRECISION` are independent of the DEM cap). Either the `dem` item moves to `dem:13/3711/3309` — the parent tile, same ground — or the DEM dataset is declared to live on its own zoom ladder. Owner of VS-2/VS-3 decides; not changed here.
