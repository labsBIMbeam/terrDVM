# Spike verdicts — R1/R2 (VS-4 entry conditions), plus R4

## VS-4 / VS-5 — the corpus napplet, verified live

**Verdict: the slice thesis holds `[measured]`, 2026-08-03 against the local stack.**
`apps/corpus` renders tile 14/7422/6618 from relay events and blob hashes alone. Three
states observed in a real browser, all from the same build:

| Tile | Result |
|---|---|
| `14/7422/6618` (covered) | Rendered: −3–182 m, 4,668 buildings, 3,826 roads, 139 land-use areas, attribution read from the collection events |
| `14/7423/6618` (neighbour) | **Elevation only**: −9–437 m from the z13 parent, `features: no item covers this tile` |
| `14/8500/6618` (uncovered) | Nothing rendered, both datasets named missing, no upstream request |

**The one observable.** During the covered render the network log contains exactly two
data requests — `http://127.0.0.1:3000/<sha>` twice, the two blobs by hash — plus the
relay websocket. No Mapzen, no Overpass, no Esri. (The `localhost:5175` entries are the
vite dev server serving the app's own modules; the artifact is a single 102 kB file.)

**The negative case has changed shape, and the change is an improvement.**
VERTICAL-SLICE.md §1 step 9 expects the neighbour to show "no data for this tile". Since
the DEM moved to z13 (decided 2026-08-02) the z13 parent legitimately covers the
neighbour, so the honest answer is per-dataset: elevation yes, features no. The client
reports both rather than collapsing them — "this tile has no features" and "there is no
data here" are different facts about the world. VS-7 should carry this wording.

**Two defects the live run and the gates caught**, both fixed and pinned by tests:
a dead relay was reported as a missing shell capability (two different facts, one
message), and hoisting the `import.meta.env.DEV` guard out of the socket function left
`WebSocket(` in the artifact — `verify-dist` and conformance's forbidden-globals scan
both failed the build, which is the gate working.

## R4 — strfry addressable replacement and tag indexing

**Verdict: retired `[measured]`, live on the corpus stack 2026-08-02.** Re-announcing
the dem pair left the relay at exactly 2 collections and 2 items (the new item id
replaced the old — addressable 30551 replacement works), and a `#d` filter for
`dem:13/3711/3309` returns exactly the current event (single-letter tags indexed).
The write-policy half was already proven by `probe-write-policy.mjs`.

**Run:** 2026-08-02, bitbeam (Windows laptop). Provenance tags per MESH-CALCULATOR.md:
`[measured]` observed in this run · `[blocked]` could not be executed here.

## R1 — MapLibre's blob worker under the shell CSP

**Verdict: the risk is real, and `worker-src blob:` is exactly the allowance that
retires it.** `[measured]`, differentially:

The built napplet dist (`corepack pnpm --filter @terrcvm/napplet build`, this commit) was
served under two CSPs with a `securitypolicyviolation` collector injected ahead of the
app's scripts, and loaded in Chromium:

| CSP | worker-src violations | outcome |
|---|---|---|
| A: `default-src 'none'; script-src 'unsafe-inline'; …` — **no worker-src** | **1: `worker-src \| blob`** | App boots, UI fully functional, maplibre canvas present but its worker is blocked — a dead basemap, not a crash |
| B: A + `worker-src blob:; child-src blob:` | **0** | MapLibre's worker starts cleanly |

Consequences for the mapplet lane:

1. **MapLibre in the mapplet is viable iff the shell's single-file CSP carries
   `worker-src blob:`** (or `child-src blob:` for older fallback chains). Upstream NAPs
   publish no canonical CSP (NAP-SHELL is handshake-only), so this is a Paja/Kehto
   implementation property — ask for the allowance before VS-4 commits to MapLibre.
2. Failure mode is graceful: if the allowance is refused, the map layer dies quietly —
   the fallback (hand-rolled raster map; the napplet already hand-rolls WebGL2) stands.
3. Independent confirmation of the split finding: the monolith's direct
   `wss://relay.bimcvp.com` / `wss://relay.damus.io` connections violate `connect-src`
   under any strict CSP — the transports must come from shell capabilities (fixed by the
   transport seam in the napplet split, PR #6).

**Not proven here `[blocked]`:** the *actual* Paja/Kehto CSP string. Kehto is absent on
this host (it is a user-local Deno CLI; `.deno/bin` here has `napplet` and `nsyte` only)
and the smoke harness hard-requires the `ubuntu24.04-x64` Playwright override. The
differential above proves the CSP *mechanism* is the deciding variable; one
`pnpm test:smoke:paja` run on a kehto-equipped host (alflx) settles the constant.
Recorded in the fallback ledger.

## R2 — real shell `outbox`/`resource` behaviour

**Verdict: blocked on this host `[blocked]` — but the probe artifact is built and
CONFORMANT.** `apps/shell-probe` is the ~30-line napplet: manifest requires
`outbox` + `resource` (never `upload`), one `outbox.query` REQ to the corpus relay, one
`resource.bytes()` of the announced dem blob, results printed on the page. Conformance
6 passed / 0 failed / 4 skipped (manifest checks skip without a signing key);
`boot/no-forbidden-globals` passes — the probe holds the capability discipline the
monolith did not. Targets default to the local stack and override via a URL-encoded
JSON location hash. One `kehto paja` run on a kehto-equipped host (alflx) closes R2.
