# terrCVM — handoff

Prototype state, end of the 2026-08-01/02 session. Written for whoever picks this up next,
including a future me with no memory of it.

**Read this file, then `MESH-CALCULATOR.md` §0 and `VERTICAL-SLICE.md`.** Those two lead with the
case against themselves and will save you from re-deciding things that were already decided against.

---

## 1. What terrCVM is

Select a bounding box on a map; a browser client builds a 3D model of that area from public data —
elevation, orthophoto, OSM buildings/roads/land cover — and **tells you honestly where usable data
does not exist**. Artifacts are content-addressed (SHA-256) and announced on nostr, so anything that
can read a relay and fetch a blob by hash can consume them.

Renamed from terrDVM (Data Vending Machine) to terrCVM after adopting ContextVM. The repo directory
keeps the old name deliberately.

**The refusal is the product.** That property is the one thing here nobody else does, and most of
this session's decisions follow from protecting it.

---

## 2. State

Branch `feat/mapplet-and-nostr-gis`, pushed to `github.com/labsBIMbeam/terrDVM`.

| commit | what |
|---|---|
| `5d551db` | pillow declared — a clean checkout was unimportable |
| `0086d46` | terrain engine extracted to `@terrcvm/terrain-engine` |
| `1024e38` | the geo protocol — kinds 30550/30551, CONTRACT.md, differential vector suite |
| `a0655d4` | TerrDVM → TerrCVM |
| `77d9998` | `terrain-mcp` — MCP server over stdio |
| `89fd62c` | elevation registry, DSM fix, code-drawn intro replacing a 32 MB film |
| `95621ab` | mesh calculator spec + field protocol |

**Tests at handoff:** 391 geo-protocol + 196 terrain-engine + 139 napplet TS, 664 blossom-gis + 142
terrain-mcp Python. Both gates pass. The napplet builds to a single ~1.5 MB `index.html`.

**In flight, uncommitted:** Mapterhorn + GEDTM30 elevation sources. Two `apps/napplet` tests fail
against it (`terrain-source-chain.test.ts` asserts the old single-source chain) — expected, small,
fix before committing.

### Layout

```
apps/napplet              the working demo — map, select, generate, 3D preview, nostr presence
packages/terrain-engine   pure engine: DEM decode, heightfield, mesh, TFT2 codec, GLB, WebGL2 render
packages/geo-protocol     nostr event builders, kinds 30550/30551, CONTRACT.md + vector suite
services/blossom-gis      Python: Blossom BUD-01/02 blob store, geo index, crawler, texture bake
services/terrain-mcp      Python: MCP server, one tool `generate_terrain`, stdio
```

---

## 3. Decided — do not re-litigate

| decision | reason |
|---|---|
| Three napplets: terrain, player, field-measurement | NAP spec wants one app doing one thing; `app.ts` was 1737 lines because it did five |
| Geo protocol = one global event + one local event, two spatial tags | Owner's constraint. Maps to STAC Collection/Item |
| Kinds **30550/30551** | 30450 sits on Marmot's documented `30000+N` growth path |
| geohash **precision 4** on items | Sized by events-per-cell, not cell area — p3 holds ~4,000 z14 tiles and truncates at the relay |
| Social kinds keep their multi-precision ladder | Collapsing them killed continent-wide presence; tag filters are exact string matches |
| **strfry**, not a custom relay | The repo's own README argued this before I arrived |
| **hzrd149/blossom-server** owns bytes; blossom-gis becomes the geo index | It ships BUD-04/05/06/09/11 and retention; blossom-gis has 01/02 |
| Crawler key only writes the corpus | Curated, un-spammable, one identity to trace |
| ContextVM adopted, confined to a gateway process | CEP-8 is Draft and changed two months ago. Containment is what makes an alpha dependency defensible |
| `generate_terrain` returns **source tiles**, not a baked mesh | Porting the 385-line TS mesher would be a third implementation needing its own conformance suite |
| Pricing: `max(1000, 21 × work_units)` | 21 sats is below Lightning's dust limit. Feature tiles weigh 40× because Overpass is the bottleneck |
| Fiat: **two rails, no bridge** | Operating an exchange is a MiCA CASP activity — €125k capital, 9–18 months |
| Logo: **neatline** recommended, not yet chosen | 1,669 B gzipped, works at 16px per both judges |

---

## 4. Ruled out — with the reason, so it stays ruled out

- **Paid imagery/elevation.** Airbus and Maxar exclude DEM/DTM/3D derivatives from redistribution
  *by name*. There is no price at which the current design becomes licensed.
- **Prepaid credits / "euros that are really sats".** Stored value plus crypto custody — the two
  regulated things at once.
- **Crowdsourced calibration.** Terminal clutter is *formally unidentifiable* from link reports —
  rank deficiency, not sample size. Plus 4–12 dB success-only bias that does not shrink with n.
- **Mesh telemetry calibration.** Breaks both identifiability killers and still cannot export a
  clutter table: node-side terms are provably absorbed. A mesh calibrates itself and can tell nobody.
- **Mapping live FIPS nodes.** FIPS ships Tor and Nym precisely to break the identity/location link.
- **FIPS as a routing protocol for community wireless.** They run batman-adv, BMX6+BGP, Babel; AREDN
  migrated off OLSR *because control-plane overhead ate the channel*. FIPS has no radio transport.

---

## 5. Traps — expensive to rediscover, cheap to read

**Meshtastic `position_precision` defaults to 13 bits**, truncating recorded positions to kilometre
scale **with no symptom in any export**. Set it to 32 before any measurement. Verified in
`meshtastic/protobufs` `channel.proto`.

**`rangetest.csv` writes RSSI after the row terminator** — every row carries the *previous* packet's
value. Parses cleanly, wrong by one, everywhere.

**`TERRAIN_EXAGGERATION = 1.5`** makes a straight RF link line look blocked when it is geometrically
clear. Calculator mode must force 1.0.

**Mapterhorn has no DTM/DSM field** and its `glo30` filler is an undeclared DSM. Untrustworthy for
bare earth. Hence GEDTM30 as the always-on base.

**Mapterhorn's pyramid is sparse, and I got this wrong twice.** I probed Vienna, found z16, and
called it "a 16× improvement from one registry entry". Re-probed across 14 points on six continents:
z12 answers everywhere, z13–14 most of Europe, z15–16 major cities only, z17–18 Zurich alone.
Madeira stops at z13; Nairobi, the Amazon, the Sahara and Siberia stop at z12. Worse — **512 px at
z12 is exactly the ground sampling of 256 px at z13**, so its *reliable* layer is no sharper than the
Terrarium already shipping. The entire 16× lives in the sparse tail. Hence `denseMaxZoom` and
`{ allowSparse: true }`, and hence opt-in.

**Lossy WebP would silently destroy elevation.** Terrarium packs the ¹⁄₂₅₆ m fraction into the blue
channel, so a lossy codec quantises height into metre steps *while decoding perfectly cleanly*.
Mapterhorn's tiles are VP8L (lossless), verified byte-wise. Standing requirement for any future WebP
source.

**`cachedDemTileUrl(z,x,y)` → `/dem/{z}/{x}/{y}.png` is the cache slot for *any* direct source**
(`apps/napplet/src/job/collection.ts:22`). Fine while Terrarium was the only one; with a second
direct source it is a cache-namespace collision — a different tile, at a different size, served from
the same slot. **Fix this before wiring Mapterhorn into any chain.** It is why it is not in one.

**GEDTM30 has no tile service** — one 432 GB COG on s3.opengeohub.org, range-readable, CORS-open. But
it is already EPSG:4326, so WebMercator is closed-form: no proj datum grids, no sub-metre shift to
get wrong. That makes it the *cheapest* transcode in the registry and the only one that lifts every
bbox on earth.

**GEDTM30 is 10.69 m RMSE, not 1.5 m.** I got this wrong mid-session and it matters: GEDTM30 is the
entry condition for **LoRa only**. WiFi needs ≤1.5 m national LiDAR — at 2.4 GHz it still refuses
below 10.16 km on GEDTM30.

**The elevation qualification gate passes white noise.** `elevation_check.py` `detail_score` has a
lower bound only, and the score *rises* with noise. Known, recorded, unfixed.

**`git add apps/napplet/` sweeps in `public/`** — caught a 32 MB `intro.mp4` twice. Those assets now
live in `docs/demo/napplet-start/`, untracked, and the file was **not** in git history despite my
saying it was.

**Tests passing is not evidence the app works.** Eight registered DTM sources were unreachable from
the running app while all 132 tests passed, because only the test passed a `region`. Trace the call
path.

---

## 6. Open

1. **Logo** — neatline recommended, three concepts rendered, not chosen.
2. **Rate constant** — 21 sats/work-unit is arithmetic, not a business decision. Needs a fiat check.
3. **Esri licence** — its sub-metre content is Vantor, and Vantor is Maxar rebranded. Needs a
   lawyer's hour, not mine. It is a source already in production.
4. **Austrian tax** — the *Grundstücksleistung* question (is a site model a land-related service?)
   is the largest unpriced risk and has nothing to do with bitcoin. Steuerberater, not fintech lawyer.
5. **The napplet split** — decided, not executed.

---

## 7. Next

The dependency chain, which is the useful summary:

```
Mapterhorn + GEDTM30  →  DSM double-count fix  →  mesh calculator  →  field napplet
                      →  corpus loop (compose, write-through, crawler publish)
```

**Do first:** finish the elevation sources (in flight), fix the two `terrain-source-chain` tests,
commit.

**Then the corpus loop** — tasks 9/10/11, the owner's stated near-term target. It is what makes the
geo protocol carry real data instead of being a well-tested library nothing uses, and the field
napplet needs it anyway to fetch tiles by hash.

**Cheapest high-value thing not on the critical path:** 15 measurements to check whether the margin
bracket actually covers 95%. That tells you whether the refusal machinery is real or theatre —
which is the product's one distinguishing claim. An afternoon with three people.

---

## 8. How this session worked

Adversarial verification found things reading could not. Three examples worth the pattern:

- The geo protocol needed **three rounds** to converge two implementations. Round 1: float formatting
  produced different event ids for the same input. Round 2: regex character classes disagree between
  languages (`\d` is Unicode-aware in Python, ASCII in JS). Round 3: validation ordering.
- A **conformance test that asserted the fixture equalled itself** — it read the expected bbox out of
  the fixture and fed it back into the builder.
- A **GLB that expands 38 kB into 56 MB** on the UI thread, constructed and measured, not theorised.

The pattern that worked: implement and verify with different agents, tell verifiers to *refute*, and
mutation-test the tests themselves. A constant you can change without a red test is a hole.
