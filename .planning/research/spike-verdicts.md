# Spike verdicts — R1/R2 (VS-4 entry conditions), plus R4

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
