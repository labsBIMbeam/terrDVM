# Mesh Calculator — SPEC

**Defined:** 2026-08-01
**Amended:** 2026-08-02 — WiFi/FIPS review. Changed: §0.1 (community wireless as an audience, and FIPS routing), §0.2 (WiFi is a DEM-class requirement, third consequence), §3.5 (new — the automatic-telemetry adjudication), §4.3 (composite ground+clutter σ), §4.6 (`ANTENNA_OFF_MAINLOBE`), §5.2/§5.3/§5.5 (`aperture-model`, `dualPol`, `AntennaAiming`), §5.6.1 (the aperture identity), §5.6.4 (scope correction — the anti-correlation does not transfer to mis-aim), §5.6.5, §5.6.7 (new — aiming, and polarisation reversed), §8.2, §9. Everything else stands.
**Status:** specified, not scheduled. Sequenced *after* the corpus slice (VERTICAL-SLICE.md) and *after* the bare-earth DEM migration. Section 0 says why that ordering is not negotiable.
**Owns:** a new package `@terrcvm/rf-link`, an adapter in `@terrcvm/terrain-engine`, a panel in the mapplet.
**Provenance tags used throughout:** `[ITU]` recommendation text · `[measured]` this project's own measurement · `[computed]` derived and numerically checked while writing this spec · `[vendor]` · `[derived]` from a vendor anchor by stated arithmetic · `[community]` · `[assumption]` invented here, deliberately visible.

---

## 0. WHAT IT IS — and the uncomfortable part first

**What it is.** A point-to-point radio link calculator inside the terrCVM viewer: the user drops hypothetical devices on the terrain, sets an antenna height above ground, and the tool computes the terrain-geometric component of path loss and reports a link margin **as an interval with a three-state verdict**. It models bare earth plus a separately typed clutter layer (buildings, canopy, land cover), not a fused surface. It is a planning tool: placements live in session memory, are never published, never persisted, never sent anywhere — and the corridor-fetch design in §7.4 is the one place that property could erode by accident.

**Who it is for.** Meshtastic/LoRa mesh builders, amateur-radio VHF/UHF repeater and APRS planners, small WISP and AREDN operators, and FIPS-adjacent people who want a geographic sanity check on a protocol that has no geographic concept at all.

### 0.1 The premise is marginal. Say it out loud.

| Claim a naive pitch would make | What the competitive survey actually found |
|---|---|
| "There is no free browser-based terrain-aware LoRa planner." | **False.** Meshtastic Site Planner (site.meshtastic.org) is free, GPL-3.0, fully client-side — SPLAT!'s `itwom3.0.cpp` compiled to WASM in a worker pool — with the community's own modem-preset table baked in and results that never leave the machine. For *coverage heatmaps* it is better than this spec will ever be. |
| "Nobody handles clutter." | **Nobody free does.** CloudRF does it properly (10 m land cover, 2 m global buildings, LiDAR canopy, per-region environment profiles) for £40–288/mo. Everything free — SPLAT!, Site Planner, airLink, Solwise, HeyWhatsThat, SCADACore — is terrain-only, and airLink's and Solwise's own docs say so. |
| "3D is the differentiator." | Google Earth Pro already does ad-hoc LoS against photogrammetric 3D buildings, free, and the Meshtastic community already teaches it. |

**So the honest positioning is narrow, and it is three things, none of which is "better predictions":**

1. **Bare earth + typed clutter, free.** A DTM base with buildings and canopy as a *separate, per-sample, provenance-tagged* layer is the CloudRF feature at the CloudRF price of zero. No free tool has it. This project is about to have all four required inputs (GEDTM30 bare earth, Mapterhorn ~1 m surface, Overture+GHS-OBAT heights, land cover) under redistributable licences.
2. **It refuses.** No tool in the survey has a determinability gate. Every one of them will confidently draw a green line across a 30 m DSM at 5.8 GHz where the error bar is five times the clearance being tested. The refusal is the product.
3. **It is a demand-side reason for the corpus to exist.** A link profile is a corridor of tiles fetched by hash from blossom — the same path VERTICAL-SLICE.md is proving. The calculator is not a standalone product competing with Site Planner; it is the first consumer that *needs* the bare-earth corpus and therefore justifies crawling it.

**Community wireless is not a rescue audience. Amendment 2026-08-02.** The obvious response to §0.1 is "the LoRa audience is served, aim at guifi.net / Freifunk / AREDN / NYC Mesh instead." Surveyed, and the answer is **no, with one narrow exception**. guifi.net has ~37 000 nodes and ~71 000 km of links and plans them with an `<img src>` to **HeyWhatsThat** — a proprietary, all-rights-reserved, rate-limited one-maintainer CGI on 3-arcsec SRTM with no clutter model, called from `guifi_node.inc.php` on master with `curvature=0` `[community]`. AREDN's own docs name four tools (airLink, Radio Mobile, HeyWhatsThat, radiofresnel); Freifunk's `Planungstools` wiki names eight. Nobody is asking for a better calculator, and the dominant method for leaf nodes is not prediction at all — it is `Status > Wireless > Survey` for guifi and a **mandatory rooftop 360° panorama** for NYC Mesh. Three consequences:

- **guifi.net is a 37 000-node existence proof that you can build a working network entirely inside our refusal band.** By §4.3, essentially every link they have ever planned was formally indeterminate at 5 GHz. They built them anyway and they work. "The refusal is the product" is a *much* harder sell to this audience than to a hobbyist, and the pitch has to be *how much* vegetation and *how much* tilt, not *I don't know*.
- **The one quantified, universally acknowledged failure of the incumbents is vegetation.** AREDN operators report airLink predicting −74.6 dBm against an actual −90/−95 dBm on a 12-mile wooded path — **15–20 dB optimistic** — while Radio Mobile with CCIR clutter enabled was "right on the money" `[community]`. That is exactly §1.1's canopy-as-knife-edge in `R`. It is the only wedge with evidence behind it.
- **Urban community wireless is not the audience at all.** In Manhattan and Brooklyn the obstruction is buildings, links are 200 m – 2 km, and `los.nycmesh.net` already solves it against the NYC DOITT 3D building model — better data than we will have. Terrain does not appear on NYC Mesh's own troubleshooting list. The audience is **rural backbone on a national-LiDAR footprint**, which is a fraction of an already small field.

**FIPS as a routing protocol for these networks: no.** They run batman-adv (Freifunk/Gluon), BMX6 + BGP/Bird (guifi, a registered operator peering at CATNIX), Babel (AREDN, which finished a painful network-wide OLSR→Babel migration in 2025 *because control-plane overhead ate the channel*). FIPS is v0.5.0-dev with **no radio transport at all** and coordinate-greedy rather than metric-driven forwarding. The coherent FIPS story here is inter-community federation over the internet replacing hand-rolled WireGuard — which has no geographic content and therefore no bearing on this spec.

### 0.2 The blocking arithmetic

With today's Terrarium DEM (`model: 'mixed'`, 30 m posting, **14.31 m RMS / 65.60 m max** `[measured]`, **+5.54 m above bare earth in built-up areas** `[measured]`), the determinability gate of §4.3 refuses the Fresnel-clearance question for:

| Band | Refuses clearance questions shorter than `[computed]` |
|---|---|
| 145 MHz | 1.10 km |
| 433 MHz | 3.29 km |
| 868 MHz | **6.59 km** |
| 2.4 GHz | 18.2 km |
| 5.8 GHz | 44.0 km |

The flagship case — an 868 MHz Meshtastic link of 1–5 km — is inside the refusal band. **On today's data this feature is largely a machine for saying "I don't know" to its primary user.**

Three consequences, all binding:

- **Do not ship this before the bare-earth base lands.** At σ = 1.5 m the same thresholds fall to 72 m at 868 MHz `[computed]` — the tool becomes answerable everywhere it matters, with *no change to the propagation maths*. The DEM is the whole story; the model is not the limiting factor.
- **WiFi is not a frequency setting. It is a DEM-class requirement. Amendment 2026-08-02.** Gate 1 scales linearly in frequency, so moving from 868 MHz to 5.8 GHz multiplies every refusal threshold by **6.68**. GEDTM30 does *not* fix this: at its declared 10.69 m the tool refuses 2.4 GHz clearance below **10.16 km** and 5.8 GHz below **24.57 km** `[computed]`, and community 5 GHz backhaul is 0.2–17 km. **GEDTM30 is the entry condition for LoRa and is not sufficient for WiFi at any realistic range.** WiFi clearance is answerable only on a ≤1.5 m national LiDAR DTM — for this project, `at-bev-dtm-1m` and the seven other registered national DTMs, i.e. an opt-in footprint, never the global base layer. Any WiFi device in §5.3 therefore ships knowing that outside those footprints it returns `DEM_TOO_COARSE_FOR_CLEARANCE` on essentially every link. That is correct behaviour, and it must be stated in the panel before the user places the second node, not after.
- **The margin question survives where the clearance question does not.** LoRa's ~153 dB budget means a margin interval can be 29 dB wide and still sit entirely above zero (worked in §4.4). So the refusal rule is **per-question, not global** — §4.3 refuses clearance, §4.4 refuses margin, and they refuse at different times. Neither reviewer made this split; it is what makes the tool useful today for the margin question.

---

## 1. THE MODEL

### 1.1 Adjudication of the reviewers

| Question | Options on the table | Decision | Reason |
|---|---|---|---|
| Core model | full ITU-R P.1812-8 · ITM/Longley-Rice · Hata/COST-231 · P.526 delta-Bullington | **P.526-16 delta-Bullington** (= the diffraction sub-model of P.452-18 Att. 4 / P.1812-8 Att. 4) | P.1812's statistical machinery needs the ΔN and β₀ radio-meteorological grids (megabytes, and there is no ambient network) plus a chosen time/location percentile — inventing radio climate. ITM reduces the profile to Δh, answering "median loss over paths statistically like this one" when the user asked "does *that* ridge block *my* link", and declares 8–10 dB of its own variability. Hata ignores terrain entirely, which deletes the tool's only asset. delta-Bullington is the ITU's own multi-obstacle choice since P.452-15 (Deygout over-predicts, Epstein-Peterson under-predicts on adjacent edges), is O(n), non-recursive, and needs no data the browser lacks. |
| Clutter construction | fused DSM · P.1812's `g = h + R` | **`g = h + R`, terminals excluded** | Taken verbatim from the ITU-R WP3K reference code (`eeveetza/p1812`, `tl_p1812.m`): `g = h + R; g(1) = h(1); g(end) = h(end);` `[ITU]`. Masts stand on bare earth, not on the clutter they sit inside. A DSM cannot express this — it is `h + R` with no way to recover `h`, which is the double-counting bug already documented in this repo at `packages/terrain-engine/src/buildings/ground.ts`. |
| Ground reflection | omit · always · gated | **Include, gated on Rayleigh smoothness** | Two nodes at 2 m AGL, 868 MHz: breakpoint `4·h_t·h_r/λ` = **46.3 m** `[computed]`; at 1 km plane-earth loss is 107.96 dB vs FSPL 91.22 dB — **16.74 dB** `[computed]` that a pure-FSPL tool silently discards. That is larger than every other error in this document. Over irregular terrain the coherent reflection does not form, so it is gated, and the budget line names which regime was used. |
| Vegetation | P.833 dB/m through-path · canopy as knife edge in `R` · both | **Knife edge in `R` only. P.833 out of v1.** | Doing both is double counting. We can measure canopy *height* (ETH 10 m / Meta 1 m, both CC BY 4.0); we cannot measure species, LAI, in-leaf state or depth through crown, all of which P.833 needs. Stated bias: this under-predicts loss for a link that goes *through* a stand rather than over it — flagged when a terminal sits inside `forest`. |
| Terminal clutter | P.2108 statistical · omit | **Omit in v1, name it** | P.1812-6 *removed* the terminal clutter terms (`Aht`/`Ahr`) precisely because they belong in P.2108, which returns a distribution at a location percentile, not a number `[ITU]`. Picking that percentile is the same invention as picking a time percentile. v1 reports terminal clutter as an unmodelled term with a magnitude band and refuses when a terminal is inside mapped built-up land cover with no building height available. |
| Refractivity | single k = 4/3 · two k values | **Both: k = 4/3 and k = 0.66** | The spread between them is real physics that no DEM improvement removes. k = 4/3 is not folklore: it requires `dN/dh = −39.25` N-units/km `[computed]`, and P.453's median first-kilometre temperate gradient is ≈ −40 `[ITU]`. |

**Not modelled, stated on the tool's own face:** time variability and fading percentiles, rain, ducting/anomalous propagation, atmospheric absorption (hence no 60 GHz), antenna radiation patterns and mispointing, polarisation mismatch, interference, noise floor, channel congestion, duty cycle / LBT, indoor and body loss beyond a flat editable term, multi-hop routing.

### 1.2 The stack

```
L0  Profile          corridor sample at derived spacing → (d_i, h_i, R_i, Ct_i, σ_i)
L1  Geometry         earth-bulge add, Fresnel clearance at 0.6·F1, k ∈ {4/3, 0.66}   [P.530-18 §2.2]
L2  Reference        FSPL                                                            [P.525-4]
L3  Terrain          delta-Bullington diffraction                    [P.526-16 §4.5.3 / P.452-18 Att.4]
L3b Ground           two-ray, only if Rayleigh-smooth
L4  Budget           dB ledger — an array of named terms, never a scalar
L5  Uncertainty      12-run bracket → margin INTERVAL
L6  Gates            per-question refusal, named error codes
```

Units inside the engine: **metres and MHz**, everywhere, no exceptions. Convert only at the UI boundary.

### 1.3 Free-space path loss

`L_fs = 20·log10(d_m) + 20·log10(f_MHz) + K`, `K = 20·log10(4π/c) + 120` with `c = 299 792 458 m/s`.

**`K = −27.5522`** `[computed]`. (Cross-check: `d` in km / `f` in MHz gives `+32.4478`; `d` in km / `f` in GHz gives `+92.4478`.)

Anchor: 868 MHz, 1000 m → 60.000 + 58.773 − 27.552 = **91.22 dB** `[computed]`.

### 1.4 Fresnel radius and the clearance criterion

`F_n = sqrt(n · λ · d1 · d2 / D)`, all metres. Engineering form, `d` in km, `f` in GHz, result in metres:

`F1 = 17.3145 · sqrt(d1·d2 / (f_GHz · D))` — constant = `sqrt(1000·c/1e9)` `[computed]`.

Criterion `[ITU, P.530-18 §2.2]`: with no refractivity data, use k = 4/3 and require **0.6·F1** clearance for obstructions extended along part of the path; 0.3–0.0·F1 for one or two isolated obstacles, lower value permitted below 2 GHz. Justification, not folklore: `ν = √2·h/F1`, and the P.526 approximation crosses zero loss at ν = −0.78, i.e. `0.5515·F1` — 0.6 is the zero-loss point plus ~9 % `[computed]`. Use 0.6 uniformly in v1; the isolated-obstacle relaxation requires deciding what "isolated" means, which is a judgement the tool must not make silently.

Midpoint F1 at 10 km `[computed]`: 144 MHz 72.1 m · 433 MHz 41.6 m · 868 MHz 29.4 m · 2.4 GHz 17.7 m · 5.5 GHz 11.7 m.

### 1.5 Earth curvature

Add the bulge to the terrain, keep the ray straight — the P.452/P.1812 convention that the Bullington construction below assumes:

`h'_i = h_i + d_i·(D − d_i) / (2·a_e)`, `a_e = 6 371 000 · k` metres.

`[computed]` midpoint bulge at k = 4/3: 1 km → **0.015 m**, 10 km → **1.47 m**, 50 km → **36.8 m**. Below ~5 km it is noise against DEM error and the UI must not display it as if it were a measurement. At 50 km it exceeds the entire clutter budget.

### 1.6 Knife-edge loss

`ν = h · sqrt(2D / (λ·d1·d2)) = √2·h/F1`, h positive = above the TX–RX line.

`[ITU, P.526-16 §4.1]`, valid ν > −0.7:

```
J(ν) = 6.9 + 20·log10( sqrt((ν−0.1)² + 1) + ν − 0.1 )   dB
J(ν) = 0  for ν ≤ −0.78
```

**Anchor values, computed and to be pinned as unit tests** `[computed]`:

| ν | −0.78 | −0.7 | 0 | 0.5 | 1 | 2 | 3 |
|---|---|---|---|---|---|---|---|
| J(ν) dB | 0.000 | 0.536 | **6.033** | 10.288 | **13.926** | **19.043** | 22.416 |

> The MODELS reviewer quoted J(1) = 13.6 and J(2) = 19.4. Both are wrong — the correct values are 13.926 and 19.043. This is exactly why the reference cases in §8 are mandatory and why §8.1 forbids transcribing coefficients from memory.

### 1.7 Bullington and delta-Bullington

Inputs: `(d_i, h'_i)` with bulge added, terminal heights AMSL `h_ts`, `h_rs` (ground + AGL), path length `D`, wavelength `λ` — metres.

**Bullington point.** `S_tx = max_i (h'_i − h_ts)/d_i`, `S_rx = max_i (h'_i − h_rs)/(D − d_i)`.

- LOS case (`S_tx < S_rx`): `ν_b = max_i [ (h'_i − (h_ts(D−d_i) + h_rs·d_i)/D) · sqrt(2D/(λ·d_i(D−d_i))) ]`
- Transhorizon (`S_tx ≥ S_rx`): `d_b = (h_rs − h_ts + S_rx·D)/(S_tx + S_rx)`, then `ν_b = (h_ts + S_tx·d_b − (h_ts(D−d_b) + h_rs·d_b)/D) · sqrt(2D/(λ·d_b(D−d_b)))`

**Bullington loss with the ITU empirical correction** `[ITU, P.452-18 Att. 4]`:

```
L_uc   = J(ν_b)
L_bull = L_uc + (1 − exp(−L_uc/6)) · (10 + 0.02·D_km)
```

This correction is not decorative: at ν = 0.538 over 2 km it adds **8.32 dB** to a 10.59 dB knife edge `[computed]`. The MODELS reviewer's worked budget omitted it.

**delta-Bullington:**

```
L_d = L_bull(actual profile) + max( L_sph − L_bull(zero profile, modified heights), 0 )
```

`L_sph` is the spherical-earth first-term diffraction loss over the equivalent smooth path `[ITU, P.526-16 §3.2 / P.452-18 Att. 4 §4.2.2]`. It is the only place ε_r and σ enter.

> **`L_sph` must be transcribed from the Recommendation text, not reconstructed.** It is the one place in the chain whose coefficients are not derivable in a line, and a mis-remembered digit yields a plausible wrong number — the exact fabrication this project refuses. **Until it exists, transhorizon paths (`S_tx ≥ S_rx`) return the named error `SPHERICAL_TERM_UNAVAILABLE`.** Stubbing it to zero silently under-predicts loss on precisely the paths users care most about.

### 1.8 Ground reflection (gated)

Rayleigh smoothness test over the first Fresnel ellipse: coherent reflection only if terrain deviation `Δh < λ / (8·sin ψ)`, ψ = grazing angle. If it fails, the term is omitted and the ledger line says `two-ray: not applied (Rayleigh test failed)`.

If it passes, beyond the breakpoint `d_b = 4·h_t·h_r/λ` use plane earth:
`L_pe = 40·log10(d) − 20·log10(h_t) − 20·log10(h_r)`; below it use `L_fs − 20·log10|2·sin(2π·h_t·h_r/(λ·d))|`. Never blend the regimes; report which was used.

### 1.9 Link budget

```
L_path = L_fs + L_d [+ L_ground if smooth]
P_rx   = P_tx + G_tx − L_feed,tx − L_body,tx − L_path + G_rx − L_feed,rx − L_body,rx
M      = P_rx − S_rx
```

Evaluated **in both directions**; the reported margin is the worse one, with `limitingDirection` named. Asymmetry is real: a B&Q Station G2's LNA gives it ~+4 dB on receive only `[vendor]`, and a LoRaWAN gateway hears ~8 dB better than a node `[derived, §5]`.

**Worked reference case** — EU868 LongFast, 2 km, single ridge at midpoint 5 m above the LOS line, k = 4/3, `[computed]` and pinned as a test in §8:

| Term | dB / dBm | Source |
|---|---:|---|
| P_tx | +22.0 | SX1262 EU868 PA-boost `[vendor]` |
| G_tx | +2.15 | quarter-wave over ground plane `[community]` |
| L_feed,tx | −0.5 | `[assumption]`, editable |
| F1 at midpoint | 13.141 m | `[computed]` |
| L_fs | −97.24 | §1.3 |
| ν_b = √2·5/13.141 | 0.538 | |
| J(ν_b) | 10.59 | §1.6 |
| **L_bull** | **−18.91** | §1.7, incl. +8.32 correction |
| two-ray | n/a | Rayleigh failed |
| G_rx | +2.15 | |
| L_feed,rx | −0.5 | |
| **P_rx** | **−90.85 dBm** | |
| S_rx LongFast | −131.0 dBm | `[derived]`, §5.1 |
| **Margin** | **+40.15 dB** | meaningless alone — see §4.4 |

---

## 2. THE OBSTRUCTION MODEL

### 2.1 The per-sample record

A sample is a record with provenance, never a bare number.

```ts
type ObstructionSample = {
  groundM: number;           // bare earth, metres above the stated vertical datum
  groundSigmaM: number;      // 1σ from the source's own accuracy statement
  groundSourceId: string;
  groundModel: SurfaceModel; // reuse buildings/ground.ts — 'dtm'|'dsm'|'mixed'|'unknown'
  clutterM: number;          // R_i in P.1812 terms
  clutterSigmaM: number;
  clutterFrom: 'building-measured' | 'building-levels' | 'canopy-raster'
             | 'class-nominal'     | 'none-measured'   | 'unknown';
  clutterType: 1|2|3|4|5;    // P.1812 Ct
};
```

`obstructionM[i] = groundM[i] + clutterM[i]`, **except the two terminal samples, where `clutterM` is forced to 0** `[ITU]`.

### 2.2 Ground — priority chain

Reuses `selectElevationSources` in `packages/terrain-engine/src/terrain/elevation-sources.ts`.

| # | Source | Condition | σ |
|---|---|---|---|
| 1 | National DTM from the registry (`model === 'dtm'`) — eight coverages today | bbox covered | 0.15–0.5 m `[vendor]` |
| 2 | **GEDTM30** | everywhere else — this is the **default global base, not a fallback** | 10.69 m RMSE / 7.77 m std vs GNSS `[published: PeerJ 19673]` |
| 3 | Mapterhorn | only where a project-owned table classifies the contributing source as DTM | per source |
| 4 | Terrarium | last resort; `model: 'mixed'` | 14.31 m `[measured]` |

**Adjudication (MODELS vs CLUTTER):** CLUTTER wins — GEDTM30 is the always-on base, Mapterhorn is an opt-in resolution upgrade on classified-DTM footprints only. Reason in §2.5.

### 2.3 Clutter — first hit wins

| # | Rule | `clutterFrom` | σ |
|---|---|---|---|
| 1 | Inside a building footprint, Overture + GHS-OBAT height, or OSM `height` | `building-measured` | 2.9 m (GHS-OBAT MAE 2.89 m) `[published]` |
| 2 | OSM `building:levels × 3` | `building-levels` | 3 m `[assumption]` |
| 3 | Canopy raster > 0 (ETH 10 m or Meta 1 m, both CC BY 4.0 `[verified]`) | `canopy-raster` | measured per-bbox — see below |
| 4 | Land-cover class → nominal | `class-nominal` | per row |
| 5 | Water / bare rock / measured-open | `none-measured` | 0 |
| 6 | No layer covered this sample | `unknown` | **not 0** — widens the band and counts toward `PROFILE_PROVENANCE_INSUFFICIENT` |

`heightM` is already carried by the TFT2 tile (`features/types.ts`), so rule 1 is a read, not a new pipeline.

**Deriving σ for canopy instead of inventing it.** Once the canopy raster is loaded for the corridor, compute the observed per-class height distribution **over the loaded area**: mean and stddev of canopy height inside `forest` polygons in this bbox. That replaces an invented ±7 m with a measured spread and turns the disclosure into a statement about the data: *"forest canopy here: 21.4 m ± 5.8 m, n = 3 140 samples, ETH 10 m"*.

### 2.4 Class → clutter table

Keyed on the 15 `LANDUSE_CLASSES` already in `packages/terrain-engine/src/features/types.ts`. Every row carries a literal provenance field; **a row without one throws at module load**, exactly as `defineElevationSource` enforces licence.

| LanduseClass | Ct | Nominal R (m) | Provenance |
|---|---:|---:|---|
| `water` | 1 | 0 | `itu-p1812-default` |
| `bare_rock`, `quarry` | 2 | 0 | `itu-p1812-default` |
| `meadow`, `grass`, `heath`, `farmland` | 2 | 0 | `itu-p1812-default` |
| `wetland` | 2 | 2 | `project-assumption` |
| `vineyard` | 2 | 2 | `project-assumption` |
| `scrub` | 2 | 3 | `project-assumption` |
| `orchard` | 2 | 4 | `itu-p452-table` (orchard, regularly spaced) |
| `residential` | 3 | 10 | `itu-p1812-default` (suburban) |
| `commercial` | 3 | 10 | `itu-p1812-default` (suburban) |
| `industrial` | 4 | 15 | `itu-p1812-default` (urban/trees/forest) |
| `forest` | 4 | 15 | `itu-p1812-default` — superseded by the canopy raster wherever it exists |

Note: `features/landcover.ts` deliberately does **not render** zone classes (residential, industrial). The calculator must nonetheless *consume* them. Render policy and obstruction policy must not share a filter.

Caveat to carry in the UI: the P.1812-7 rural study (arXiv 2501.11708) found higher-resolution clutter did **not** consistently improve accuracy, and the LoRaWAN study (SciELO JMOe) found per-point clutter assignment (MAE 9.63 dB) **worse** than a single representative height for the whole link (7.55 dB) in rural terrain. Per-sample clutter is the right *structure* — it is what lets provenance travel — but it is not automatically the more accurate one, and the tool must not imply it is.

### 2.5 The mixed DTM/DSM border hazard

**Verified this session, and worse than assumed.** Mapterhorn's `source-catalog/*/metadata.json` carries `name, website, license, producer, producer_short, resolution, access_year` — **and no DTM/DSM field.** The surface model is recoverable only by parsing product names in the publisher's own language (`"Digitales Geländehöhenmodell (ALS-DGM)"`, `"DTM Kanton Zürich"`, `"Digitaal Hoogtemodel Vlaanderen II, DTM"`, `"Digitales Geländemodell 1m (DGM1)"`). The global filler `glo30` is **COPERNICUS GLO-30 — a DSM — with nothing in the record saying so.** Per-tile provenance is not exposed at all: `pipelines/attribution.py` emits a flat global list.

Parsing four languages of product names to decide whether a radio prediction is valid is precisely the silent wrongness this project exists to refuse.

**Detection — three layers:**

1. **Static classification, project-owned.** A table keyed by Mapterhorn source id declaring `model: 'dtm'|'dsm'|'mixed'`, built exactly like `elevation-sources.ts`: mandatory field, throws at construction if missing, unclassified id → `'unknown'`, and `'unknown'` treated as harshly as DSM. ~134 rows, manual, one-time. Nobody else has paid this cost.
2. **Coverage geometry, baked in.** Per-source coverage polygons bundled the way imagery surveys already are in `config/coverage.ts`, so "does this path cross a source boundary" is an offline segment/polygon test.
3. **Dynamic corroboration.** `mapterhorn − GEDTM30` is a residual to a bare-earth reference. A DTM gives near-zero residual over forest and built-up cover; a DSM gives a persistent positive one. A step in the running mean of that residual, coincident with a declared source change, raises `SURFACE_STEP_DETECTED` naming the along-path distance. **Alarm, not classifier** — at 30 m it cannot distinguish a DSM from a 20 m terrain error.

**Response — and the thing not to do.** Do not smooth the step. Do not blend. Above all **do not subtract a bias** — that is option 2 from `buildings/ground.ts`, already rejected there and "named for what it is: a fudge". Instead, segment the profile by provenance and evaluate **both bounding interpretations** of a DSM segment:

- (a) treat it as bare earth → clutter is added on top → over-obstructed
- (b) treat it as already containing its clutter → add nothing → under-obstructed

Same verdict from both → report it. Different verdicts → `MIXED_SURFACE_PROFILE`, naming the segment and source id. No invented number at any point, and it reuses the interval machinery rather than adding a mechanism.

### 2.6 Sampling spacing — derived, both bounds

Two bounds from opposite directions:

- **Floor.** ITU-R suggests ~30 m profile spacing; the P.1812-7 study warns spacing under 10 m "could lead to an overestimation of loss because the modeling might capture individual obstacles" — the model treats profile points as knife edges, so oversampling *manufactures* diffraction. Never finer than `max(source.nativeResolutionM, 10 m)`. The field already exists (`ElevationSource.nativeResolutionM`).
- **Ceiling.** If spacing exceeds `F1` at the point of minimum clearance, a Fresnel-relevant obstacle can hide between samples. Cap at `0.5 × F1_min`.

```
spacing = clamp( max(nativeResolutionM, 10), … , 0.5 × F1_min )
```

If no spacing satisfies both — the best available source is coarser than the Fresnel zone being claimed — that is `PROFILE_UNDERSAMPLED`, a named refusal stating the source posting and the required spacing. Never a smaller number.

**The optimistic-bias correction.** Bilinear resampling systematically clips ridge crests: a peak between two posts is reconstructed as a chord below the true crest, and the bias is one-sided and **optimistic** for diffraction — the tool would say "clear" when it is not. Any "hill" appearing between posts is an artefact of the interpolant, not a measurement. Mitigation costs one extra pass: build a second profile with a max filter over a `nativeResolutionM`-wide structuring element and carry it as the pessimistic geometric bound (§4.2, run dimension B).

---

## 3. HONEST ACCURACY

### 3.1 The one ratio that governs everything

Differentiating J(ν): `dJ/dh ≈ 9.130 / F1` dB per metre of terrain error, at ν = 1 `[computed]`.

**The entire accuracy story is DEM error over Fresnel radius.** The model is not the limiting factor.

### 3.2 Quantified: same link, three DEMs

868 MHz, 2 km, obstacle at midpoint at grazing (h = 0), F1 = 13.141 m `[computed]`:

| Profile height error | ν | J(ν) |
|---|---:|---:|
| −14.31 m (Terrarium 1σ) | −1.540 | **0.00 dB** |
| 0 (truth) | 0.000 | 6.03 dB |
| +14.31 m | +1.540 | **16.98 dB** |
| −1.5 m (LiDAR DTM 1σ) | −0.161 | 4.66 dB |
| +1.5 m | +0.161 | 7.43 dB |

**A 1σ Terrarium error is a 17 dB spread on one link. The same code on a ~1.5 m DTM gives 2.8 dB.** A factor of six, no maths changed. At Terrarium's measured 65.6 m max error the spread is 0–29.8 dB.

### 3.3 The three biases that do not cancel

On Terrarium (`model: 'mixed'`), the measured **+5.54 m** DSM bias in built-up areas acts in opposite directions at the two ends of the chain:

| Where | Effect | Direction |
|---|---|---|
| At terminals | "ground" is 5.54 m too high; a 2 m mast is modelled at ~7.5 m effective AGL | **optimistic** |
| At obstacles | rooftops and canopy are already in the profile, adding ~5.5 m of blockage | **pessimistic** |
| Everywhere | bilinear peak clipping (§2.6) | **optimistic** |

Three independent ±5–15 dB biases on the same link, in unpredictable combination. This is why the interval, not a point value, is the output.

### 3.4 What the tool may and may not claim — verbatim UI text

**May claim:** *"terrCVM computes ITU-R P.526-16 delta-Bullington diffraction loss over a terrain profile of declared provenance and declared vertical uncertainty, and reports link margin as an interval. It predicts the terrain-geometric component of path loss."*

**May claim, with a ≤2 m bare-earth DTM plus modelled clutter:** terrain-geometry contribution good to roughly **±3 dB (1σ)** in the diffraction regime.

**Must never claim** a total link prediction better than **±8–12 dB on any DEM.** The residual is fast fading, seasonal foliage, ducting, rain, antenna pattern and pointing, real TX power vs datasheet, and RX sensitivity spread — none of which terrain fixes. In the UI, not only in the docs.

**Must not claim anything at all** below the §4.3 thresholds.

### 3.5 Could measurement ever narrow the ±8–12 dB? — the automatic-telemetry adjudication

**Amendment 2026-08-02. The uncomfortable version first: the statistical deadlock that killed crowdsourced LoRa measurement is genuinely broken by automatic WiFi telemetry, and it still does not produce anything this spec can use.** Both halves are true and the second is the one that decides.

A prior survey concluded NO for crowdsourced LoRa link reports on two binding grounds: (a) terminal clutter, device offset and mounting are **one column** of the design matrix — rank deficiency, not sample size; and (b) success-only truncation biases loss low by 4–12 dB, *and the bias does not shrink with n*. It further observed that every surviving volunteer measurement network (WSPRnet, PSKReporter) shares one property: **zero incremental actions per report**. A WiFi mesh node on Linux appears to escape all three — per-station RSSI over nl80211 costs nobody an action, and FIPS already runs a per-link metrics protocol. Adjudicated:

| Finding | Escaped? | Why |
|---|---|---|
| **(a) rank deficiency** | **Formally yes, usefully no.** | With one TX effect `a_i` and one RX effect `r_j` per node, the design `[A\|R]` over directed edges has **nullity 1 on any connected graph containing an odd cycle, 2 if bipartite** `[computed, verified by exhaustive enumeration over 1 384 random connected graphs, N = 3…8, zero counterexamples]`. So the whole node-constant nuisance space — device offset, antenna gain, feed loss, RSSI calibration, mounting, *isotropic* terminal clutter — is estimable up to one global gauge. It is not *decomposed*; it is **absorbed**, and absorption is enough if the estimand is the terrain coefficient. Residual dof = `2L − (2N − 1)`, so information exists only when **L ≥ N**, and the minimum topology with any at all is a **triangle**. A star or tree — which is what guifi.net, NYC Mesh and most Freifunk backbones actually are (§0.1) — has nullity 2, residual dof 0, and yields **exactly zero** terrain information regardless of how long it runs. |
| **(b) success-only truncation** | **Yes at packet level, partly at link level.** | LoRa has a numerator and no denominator. WiFi has both: `TX_FAILED`/`TX_RETRIES`/`RX_DROP_MISC` over nl80211, and FIPS's own `ReceiverReport` carries `highest_counter` + `cumulative_packets_recv`. Observing the censoring *probability* converts a truncated sample into a **censored** one, and censored samples are identified: `α̂ = Φ⁻¹(p̂)` plus the conditional mean gives two equations in `(μ, s)`. Simulation: naive bias 4.79 dB at zero margin, flat in n; corrected bias 0.00 dB with sd falling as 1/√n `[computed]`. That is a change of kind, not of degree. **Link-level selection survives** — a link that never came up is never installed and never reports — but a low-rate broadcast beacon heard 12–26 dB below the data threshold shrinks it from ~5 dB to ~1 dB or ~0.03 dB `[computed]`. |
| **zero incremental actions** | **Yes, per report. No, per install.** | Everything node-constant is absorbed by (a), so gain, feed loss, TX-power error and RSSI offset need no declaration. **Two things do not absorb: position, and antenna height AGL** — height enters the Bullington construction per path, and at §3.1's `dJ/dh ≈ 9.130/F1` a 5 m height guess is 4–8 dB at 2.4 GHz over 1 km. So the honest form is *zero incremental actions per report, two one-time declarations at install*. That is the property WSPRnet actually has (callsign + grid, once), not "zero configuration". |

**And now the part that decides it, three ways:**

1. **What is absorbed is not recoverable.** Adding a free per-edge clutter term raises nullity to `N + 1`; the extra directions are exactly `c_ij → c_ij + t_i + t_j`. Decomposing `c_ij = κ_i + κ_j + π_ij`, the κ terms are **provably absorbed and never separately estimable**. A mesh therefore **calibrates itself and cannot export a clutter table.** The thing this spec would need — a transferable, per-class clutter model to replace the `[assumption]`-tagged §2.4 table — is precisely the thing the fixed-effects escape destroys in order to work. The escape and the deliverable are mutually exclusive.
2. **In a CSMA channel, loss is not a function of SNR.** The (b) correction requires the censoring probability to be the propagation model's own `Φ(α)`. WiFi packet loss conflates propagation with collision, hidden nodes and co-channel interference — AREDN's own docs on the 33 cm noise floor, and NYC Mesh's on 2.4 GHz, say so plainly `[community]`. Unless every observation is conditioned on `SURVEY_INFO_CHANNEL_TIME_BUSY`, `p̂` is contaminated and the two-equation identification is not valid. This objection is fixable and it is not optional.
3. **RSSI is not an absolute quantity.** 802.11 defines RSSI as an 8-bit vendor-defined *monotonic* measure, not a calibrated dBm; the only standardised absolute measure is 802.11k RCPI at a stated **±5 dB**, and most drivers do not implement it `[assumption — not verifiable in this sandbox; must be checked against `include/uapi/linux/nl80211.h` and per-driver source before any of this is built]`. A constant per-device offset is absorbed by (a). **Level-dependent AGC nonlinearity near the noise floor is not**, and it distorts exactly the weak links that carry the information. Bandwidth dependence (~6 dB HT20 vs VHT80) forces the fixed effect to be indexed by **(node, band, width)**, multiplying the parameter count and raising the `L ≥ N` requirement proportionally.

**Decision: nothing in this document changes.** The §3.4 claim ceiling stands at ±8–12 dB, the §2.4 clutter table stays `[assumption]`-tagged, and no measurement pipeline is specified here. The reasoning is not "the statistics fail" — they do not — it is that the identifiable estimand is *within-mesh self-calibration*, the spec needs a *transferable* model, and the two are provably different objects. Recorded so it is not relitigated.

**The one thing that would be worth having, and its trigger.** The estimand that *is* identifiable and *is* useful is the **within-link longitudinal contrast** on fixed declared geometry: deciduous foliage-on vs foliage-off, and rain fade. Link-level selection does not touch it (inclusion was decided once, at install), static DEM error does not change across it, and it directly measures the seasonal component §3.4 currently asserts from the literature. A second identifiable quantity is a **network-wide foliage exponent from dual-band links**: diffraction shifts additively with frequency (+3.54 dB for 2437→5500 MHz) while foliage scales multiplicatively (×1.260 by P.833/Weissberger), giving a 2×2 design with condition number 17.6 — useless per edge, ~1 dB over 50–200 dual-band edges `[computed]`. **Trigger to revisit: a FIPS radio transport actually shipping** (`TransportType::WIFI` is declared at `src/transport/mod.rs:189-194` and never used — a WiFi link is currently indistinguishable from wired Ethernet), **plus a non-bipartite mesh of ≥12 nodes at mean degree ≥3 with declared positions and heights.** Absent both, there is no dataset, and this section is why we are not building one.

**If it is ever built, three constraints are not negotiable** — they follow from §7.4's privacy decision, not from statistics:

- **Consent is not individually exercisable.** Three nodes with declared positions reporting RSSI to an undeclared fourth trilaterate it to ~100 m. A per-node opt-in silently conscripts neighbours. The rule must be **both endpoints opted in**, checked locally before publishing, which means the consent bit has to ride in the link handshake or beacon.
- **The measurement identity must be a separate keypair from the routing/social npub.** A nostr pubkey bound to precise coordinates and replicated to relays is a permanent, un-revocable home-address disclosure.
- **WiFi scan results must never leave the node, under any consent setting.** A scanning node sees every nearby BSSID; publishing that is a wardriving database enumerating third parties who consented to nothing. It is also the *most tempting* field on the system, because scan results carry `BSS_SIGNAL_MBM` at 0.01 dB resolution while station signal is s8. Likewise: no MAC addresses, no per-packet timing or CSI (motion sensing), no sub-minute goodput series (occupancy).

---

## 4. THE REFUSAL RULE

**The rule is per-question. There are two gates, and they fire at different times.**

### 4.1 New mandatory registry field

```ts
/** 1σ vertical uncertainty of the published grid, metres. Mandatory —
 *  a source that does not declare it cannot be used for RF prediction. */
readonly verticalUncertaintyM: number;
```

Enforced in `defineElevationSource` alongside the existing licence and attribution checks, throwing `VERTICAL_UNCERTAINTY_UNDECLARED`. Seed values: Terrarium **14.31** `[measured — better provenance than any vendor figure]`, GEDTM30 **10.69** `[published]`, national LiDAR DTMs 0.15–0.5 `[vendor]`, Mapterhorn per contributing source.

### 4.2 The 12-run bracket

```
runs = { bilinear, max-filtered } × { −σ, 0, +σ } × { k = 4/3, k = 0.66 }
```

12 evaluations ≈ 0.25 ms per link. Report `[min, max]` of the resulting margins.

**The one rule that must not be got wrong: the perturbation is differential.** DEM error is spatially correlated over ~100 m. A uniform offset applied to the whole profile *including both terminal ground heights* cancels exactly and would report **zero** uncertainty — the worst possible bug in this feature. Hold the terminal ground heights fixed; apply ±σ to the interior only, because clearance is a function of obstacle height *relative to the terminal-to-terminal line*. §8 pins this as a test.

### 4.3 Gate 1 — the clearance question

A Fresnel-clearance verdict carries information only if the vertical uncertainty is smaller than the clearance being tested:

```
answerable(clearance)  ⟺  σ_total < 0.6 · F1_min
σ_total = sqrt( groundSigma² + clutterSigma² )   at the minimum-clearance sample
```

Otherwise → **`DEM_TOO_COARSE_FOR_CLEARANCE`**, no verdict, no colour that implies pass or fail.

Solving for the shortest answerable path, `D_min_km = 4·f_GHz · (σ / (0.6 · 17.3145))²` `[computed]`:

| σ | 145 MHz | 433 MHz | 868 MHz | 2.4 GHz | 5.8 GHz |
|---|---:|---:|---:|---:|---:|
| 14.31 m (Terrarium) | 1.10 km | 3.29 km | **6.59 km** | 18.21 km | 44.02 km |
| 10.69 m (GEDTM30) | 0.61 km | 1.83 km | 3.68 km | 10.16 km | 24.57 km |
| 1.5 m (LiDAR DTM) | 12 m | 36 m | 72 m | 0.20 km | 0.48 km |
| 0.5 m | 1 m | 4 m | 8 m | 22 m | 51 m |

Read as the operating envelope. **VHF repeater planning at 145 MHz over 20 km is genuinely determinable on today's data — ship that case first.** 5.8 GHz WISP clearance is never answerable at realistic range on anything coarser than LiDAR.

**The table above is ground-σ only, and the gate is not. Amendment 2026-08-02.** `σ_total = sqrt(groundSigma² + clutterSigma²)` **at the minimum-clearance sample** — so where the binding obstacle is a building or a canopy, the clutter layer sets the floor and a better DTM buys nothing. GHS-OBAT building heights are 2.89 m MAE (Sources) and ETH canopy is worse. Recomputing `D_min` on the composite `[computed]`:

| σ_total composition | σ_total | 868 MHz | 2.4 GHz | 5.8 GHz |
|---|---:|---:|---:|---:|
| 0.5 m LiDAR DTM, bare-earth obstacle | 0.50 m | 8 m | 22 m | 51 m |
| 0.5 m DTM + GHS-OBAT building 2.89 m | 2.93 m | 0.28 km | 0.77 km | **1.85 km** |
| 0.5 m DTM + ETH canopy ~3 m | 3.04 m | 0.30 km | 0.82 km | 1.99 km |
| 1.5 m DTM + GHS-OBAT 2.89 m | 3.26 m | 0.34 km | 0.94 km | 2.28 km |

**Consequence, and it bounds the whole WiFi case.** On a perfect national DTM, a 5.8 GHz link whose limiting obstacle is a *modelled building* is still refused below **1.85 km** — i.e. most urban community-wireless links. Only a LiDAR **DSM or point cloud** (σ ≈ 0.3 m) reaches them, which is the data `los.nycmesh.net` already uses (§0.1). So the answerable WiFi envelope is: **≥1 m national DTM footprint, obstacle is terrain or canopy, path ≥ ~2 km.** That is rural backbone and nothing else. The UI must report *which layer's σ dominated* the refusal — §4.5's `UNRESOLVED` already requires this, and here it is the difference between "get better terrain" (achievable) and "get a LiDAR point cloud" (usually not).

### 4.4 Gate 2 — the margin question

Margin refuses **only when the interval straddles the decision**, which is a much weaker condition, because a LoRa budget is large.

Worked, on the §1.9 reference link, differential perturbation ±14.31 m `[computed]`:

| Interior h | ν | L_bull | Margin |
|---|---:|---:|---:|
| −9.31 m | −1.002 | 0.00 dB | +59.06 dB |
| 5.00 m | 0.538 | 18.91 dB | +40.15 dB |
| +19.31 m | 2.078 | 28.99 dB | +30.01 dB |

**Interval [30.0, 59.1] dB — 29 dB wide, and entirely above +20. Verdict: robust.** Same link on a 1.5 m DTM: L_bull ∈ [17.17, 20.48] → margin ∈ [38.6, 41.9], 3.3 dB wide `[computed]`.

So the tool answers the margin question today for the case it must refuse the clearance question for. Both facts are shown; neither is hidden behind the other.

**Banding — on the interval's lower bound, because a 153 dB budget with ±10 dB total uncertainty cannot support one-decibel verdicts:**

| Lower bound of margin interval | Verdict |
|---|---|
| > +20 dB | robust |
| +10 to +20 dB | likely |
| 0 to +10 dB | marginal — will fail with rain, foliage-on, or seasonal change |
| interval entirely < 0 | predicted fail |
| interval straddles 0 | **`MARGIN_BAND_STRADDLES_ZERO` — no number rendered** |

### 4.5 The three-state clearance verdict

Built from the §4.2 bracket:

| State | Condition |
|---|---|
| `CLEAR` | `obstructionHigh` clears 0.6·F1 at **both** k values |
| `BLOCKED` | `obstructionLow` still obstructs at **both** k values |
| `UNRESOLVED` | the bounds disagree. Named result, never a coin flip. Reports which layer's σ dominates and what data would resolve it |

`UNRESOLVED` is the feature. It is `buildings/ground.ts`'s fail-closed discipline applied to a prediction instead of to geometry, and no free tool in the survey does it.

### 4.6 Named error codes

```ts
export type LinkErrorCode =
  | 'PATH_LEAVES_LOADED_CORRIDOR'      // never extrapolate; heightfield.ts returns 0 for a missing tile,
                                       //   which in a profile is a fabricated sea-level valley reading as clear LOS
  | 'PROFILE_UNDERSAMPLED'             // §2.6: no spacing satisfies both bounds
  | 'DEM_TOO_COARSE_FOR_CLEARANCE'     // §4.3
  | 'MARGIN_BAND_STRADDLES_ZERO'       // §4.4
  | 'MIXED_SURFACE_PROFILE'            // §2.5, bounding interpretations disagree
  | 'SURFACE_STEP_DETECTED'            // §2.5 layer 3 alarm
  | 'PROFILE_PROVENANCE_INSUFFICIENT'  // > 20 % of samples `unknown`  [assumption: 20 %]
  | 'SPHERICAL_TERM_UNAVAILABLE'       // §1.7: transhorizon before L_sph is transcribed
  | 'FREQUENCY_OUT_OF_MODEL_RANGE'     // outside 30 MHz – 6 GHz
  | 'PATH_LENGTH_OUT_OF_MODEL_RANGE'   // outside 0.25 – 3000 km
  | 'TERMINAL_BELOW_TERRAIN'
  | 'TERMINAL_IN_UNMODELLED_CLUTTER'   // terminal inside built-up landcover, no building height
  | 'CLUTTER_LIMITED'                  // BLE / short 2.4 GHz: terrain is not the binding constraint
  | 'VERTICAL_UNCERTAINTY_UNDECLARED'
  | 'ANTENNA_ELEVATION_UNMODELLED'     // §5.6.5: off-boresight beyond e_1dB(G) on an
                                       //   antenna whose pattern is undeclared
  | 'ANTENNA_TILT_EXCEEDS_MOUNT'       // §5.6.5: required mechanical downtilt exceeds
                                       //   what a standard mount provides
  | 'ANTENNA_OFF_MAINLOBE'             // §5.6.5: |phi| > phi_m on an 'aperture-model'
                                       //   antenna. F.699 beyond the main lobe is a
                                       //   regulatory ENVELOPE, so it bounds the loss
                                       //   from below only. Banded, never applied.
  | 'REGULATORY_CAP_UNKNOWN';
```

`PATH_LEAVES_LOADED_CORRIDOR` is not cosmetic. `sampleHeightfield`'s `samplePixel` returns `0` for a tile not in the set (`terrain/heightfield.ts`). In a render that is a flat patch; in a profile it is a fabricated sea-level valley that reads as clear line of sight. The profile sampler must use a distinct `NaN` sentinel and refuse.

### 4.7 What the refusal must say

Not "indeterminate". Refusals name the cause, the magnitude and the fix:

> *Indeterminate — the terrain data cannot resolve whether this link closes. Interval −4 to +13 dB, dominated by ±14.3 m DEM uncertainty (Mapzen Terrarium, 30 m, mixed DSM). A 1 m DTM would narrow this to roughly ±2 dB.*

That message is **more** useful than a fake number, because it tells the user what to do about it.

Plus, on every result, a **provenance histogram**: *"184 samples — 12 building-measured, 71 canopy-raster, 96 class-nominal, 5 unknown."*

---

## 5. DEVICE PROFILES

### 5.1 The cardinal rule: no range field

| 868 MHz, LongFast, 22 dBm, 2+2 dBi, 10 dB margin | Distance |
|---|---|
| Free-space upper bound | ≈ 550 km `[computed]` |
| Best documented ground-to-ground link (mountain-to-mountain, 2024-05-05) | 331 km `[community]` |
| Community-typical dense urban | 0.3–2 km `[community]` |

Same device, same power, same preset — **a 1000:1 spread**, all of it terrain, clutter and antenna height. `DeviceProfile` therefore contains **no range field at all**. Range is an output of the terrain model. Storing a nominal range would be the fabricated-confidence failure this project refuses elsewhere.

### 5.2 Structure

Design rules: (a) no range field; (b) TX power and sensitivity live on the **mode**, because real hardware varies both by modulation; (c) sources and regulatory caps are interned shared tables referenced by id, so profiles stay tiny (~40 % saving); (d) **antenna height is a property of the placement, never the profile**; (e) every number carries a confidence tag and a source.

```ts
type Source     = { id: number; label: string; url: string; retrieved: string };
type Confidence = 'datasheet' | 'vendor' | 'derived' | 'community-typical';

type RegulatoryCap = {
  id: string; label: string;
  loMHz: number; hiMHz: number;
  limitDbm: number;
  limitKind: 'conducted' | 'erp' | 'eirp';   // ERP = EIRP − 2.15 dB
  dutyCyclePct?: number;
  gainAllowanceDbi?: number;    // FCC: 6
  gainReductionRatio?: number;  // 1 = 1 dB/dB, 3 = 1 dB per 3 dB, 0 = none
  src: number;
};

type RadioMode = {
  id: string; label: string;
  freqMHz: number; bwKHz: number;
  sensDbm: number;
  sensToleranceDb: number;   // board spread: ±3 LoRa, ±5 WiFi
  bitrateBps: number;
  txPowerDbm?: number;       // override when TX drops with modulation
  conf: Confidence; src: number[];
};

/** How the antenna's directional behaviour is known. Mandatory — an option
 *  without one throws at module load, exactly as `defineElevationSource`
 *  enforces licence. There is deliberately no `'isotropic'` member: see §5.6. */
type PatternKnowledge =
  | { kind: 'measured';  vCutDb: Uint8Array; license: string; src: number[] }
  | { kind: 'array-model'; elements: number; spacingWl: number }  // derivable in a line, §5.6
  /** Circular parabolic reflector of declared geometry. The main lobe is
   *  ITU-R F.699 §3 case 1 exactly, from two datasheet numbers and no file.
   *  Added 2026-08-02 — see §5.6.1 and §5.6.5. */
  | { kind: 'aperture-model'; apertureMm?: number; efficiency?: number }
  | { kind: 'undeclared'; reason: string };

type AntennaOption = {
  id: string; label: string; gainDbi: number;
  integrated: boolean; directional: boolean; beamwidthDeg?: number;
  /** Dual-polarised 2x2 (every airMAX ac and Mikrotik ac PtP dish) vs single-pol
   *  (LoRa Yagis, ham beams, single-pol sectors). One bit; drives the pairing
   *  warning of §5.6.7. Not a dB term. */
  dualPol: boolean;
  /** Elevation half-power beamwidth. Derived from `gainDbi` by the §5.6
   *  identity when `pattern.kind !== 'measured'`; measured otherwise.
   *  Drives the §5.6 gate — never optional, never invented. */
  hpbwVDeg: number;
  pattern: PatternKnowledge;
  conf: Confidence; src: number[];
};

type DeviceProfile = {
  id: string;
  family: 'lora-mesh' | 'lorawan-gw' | 'lorawan-node' | 'wifi' | 'wifi-ptp'
        | 'wifi-halow' | 'ham-vhf-uhf' | 'ble';
  vendor: string; label: string;
  modes: RadioMode[]; defaultModeId: string;
  txPowerTypicalDbm: number;      // conducted, at the connector
  txPowerMaxHardwareDbm: number;  // what the silicon can do — NOT what is legal
  antennas: AntennaOption[]; defaultAntennaId: string;
  feedLossDb: number;
  rxAdvantageDb?: number;         // Station G2 LNA: +4, RX only, asymmetric
  capIds: string[];
  starTopology?: true;            // gateways
  conf: Confidence; src: number[];
};
```

Placement — where height and DEM provenance live:

```ts
type DevicePlacement = {
  id: string; profileId: string; modeId: string; antennaId: string;
  lon: number; lat: number;

  /** Three references, because users think in all three and conflating them
   *  is the most common planning error. */
  heightRef: 'agl' | 'building' | 'amsl';
  heightM: number;

  groundElevM: number;         // resolved once at placement, cached, shown
  demSourceId: string;
  demIsSurface: boolean;       // true = 'agl' is really 'above canopy'
  demSigmaM: number;           // drives §4.3

  txPowerDbm: number;          // user value, clamped by the resolved cap
  capId: string;               // jurisdiction — selected, never guessed
  feedLossDb: number;
  bodyLossDb: number;          // 3–10 dB; non-optional for HT and BLE

  /** Azimuth is recorded, not modelled — v1 assumes the antenna is aimed at
   *  the far end in azimuth (§9). Mechanical tilt is DIFFERENT: §5.6 computes
   *  the required tilt from the profile and refuses when no mount provides it. */
  azimuthDeg?: number; tiltDeg?: number;
};
```

`heightRef: 'building'` is a two-line reuse of `buildings/extrude.ts` + `sampleGround`, and "on the roof of that building" is the single most common real community-mesh placement.

`demIsSurface` earns its byte: on Terrarium, "2 m above ground" in a forest places the node 2 m above the **canopy**. The tool must say this, not quietly produce a better link than reality.

**Bundle cost:** ~40 profiles × ~8 modes, sources and caps interned ≈ **26 kB raw, ~6 kB gzipped**, zero new runtime dependencies — the arithmetic is `+`, `−`, `log10`.

### 5.3 Initial catalogue

**LoRa modem presets.** Meshtastic publishes link budgets at a stated 22 dBm / 0 dBi reference, so sensitivity is `22 − budget` `[derived]`:

| Preset | BW | SF | Bitrate | Budget | **Sens (dBm)** |
|---|---|---|---|---|---|
| ShortTurbo | 500k | 7 | 21.88 kbps | 140.0 | −118.0 |
| ShortFast | 250k | 7 | 10.94 kbps | 143.0 | −121.0 |
| ShortSlow | 250k | 8 | 6.25 kbps | 145.5 | −123.5 |
| MediumFast | 250k | 9 | 3.52 kbps | 148.0 | −126.0 |
| MediumSlow | 250k | 10 | 1.95 kbps | 150.5 | −128.5 |
| LongTurbo | 500k | 11 | 1.34 kbps | 150.0 | −128.0 |
| **LongFast** (default) | 250k | 11 | 1.07 kbps | 153.0 | **−131.0** |
| LongModerate | 125k | 11 | 0.34 kbps | 156.0 | −134.0 |
| LongSlow | 125k | 12 | 0.18 kbps | 158.5 | −136.5 |

Cross-checks that make this table trustworthy: Meshtastic's own Site Planner defaults to −130 dBm for LongFast (1 dB off), and Semtech quotes SX1262 at −137 dBm @ SF12/125 kHz (0.5 dB off) `[vendor]`. Board spread is ±3 dB and is carried in `sensToleranceDb`: Heltec's *board-level* spec for the V3 is −134 dBm @ SF12/125 kHz, 3 dB worse than the chip `[vendor]`. Semtech's "down to −148 dBm" marketing figure is a different measurement condition and must not be used.

For RNode/MeshCore, expose free `(SF, BW, CR)` and scale from the two 125 kHz anchors at **2.5 dB per SF step, 3.0 dB per bandwidth doubling** `[derived]` — tagged `derived`, not `datasheet`.

**Devices, v1:**

| id | Family | TX max HW | Sens | Notes |
|---|---|---|---|---|
| `heltec-v3-868` | lora-mesh | 21±1 dBm `[vendor]` | −134 @ SF12/125k `[vendor]` | SX1262; the most common cheap node |
| `rak4631-868` | lora-mesh | 22 dBm (PA boost) `[vendor]` | ≈ −137 @ SF12 `[vendor]` | SX1262 + nRF52840 |
| `tbeam-v1x-868` | lora-mesh | 20 dBm `[vendor]` | ≈ −136 @ SF12/125k `[vendor]` | SX1276/78 — distinct profile, do not alias to Heltec |
| `station-g2-868` | lora-mesh | **35 dBm** PA `[vendor]` | +4 dB LNA advantage, **RX only** `[vendor]` | Legal essentially nowhere at full tilt — see §5.4 |
| `lorawan-gw-sx1302` | lorawan-gw | 27 dBm typ `[vendor]` | −139 @ SF12/125k, up to −141 with 18 dB LNA `[vendor]` | `starTopology: true`. Uplink budget is ~8 dB better than downlink — asymmetric by design |
| `ubnt-powerbeam-5ac-620` | wifi-ptp | 24 dBm `[vendor]` | −96 @ 1x BPSK 1/2 → −65 @ 8x 256QAM `[vendor]` | 29 dBi. **TX drops with modulation: 24 → 23 → 20 dBm** — this is why `txPowerDbm` lives on the mode |
| `ubnt-litebeam-5ac-g2` | wifi-ptp | ~25 dBm `[vendor]` | ~−96 at lowest MCS `[vendor]` | 23 dBi. AREDN reflashes this class under Part 97 |
| `ham-ht-5w` | ham-vhf-uhf | 37 dBm (5 W) | ≈ −120 spec, −129 @145 / −126 @435 measured `[community]` | rubber duck −3…+2 dBi. `bodyLossDb` 3–10 dB dominates everything terrain computes |
| `ham-mobile-50w` | ham-vhf-uhf | 47 dBm | ≈ −121 | 1/4-wave 0 dBi, 5/8-wave 2–3 dBi |
| `ham-base-100w` | ham-vhf-uhf | 50 dBm | ≈ −121 | collinear 6–8 dBi (2 m), 8–11 dBi (70 cm) |
| `ble-nrf52840` | ble | +8 dBm `[datasheet]` | −95 (1M PHY), −103 (Coded S=8) `[datasheet]` | Always returns `CLUTTER_LIMITED` — see §5.5 |

APRS is a **mode**, not a device family: the same HT does voice and APRS. 1200 baud AFSK, 144.800 (R1) / 144.390 (NA), practical decode ≈ −118 dBm `[community]`; 9600 baud costs a further 6–8 dB.

**Antenna gain, and the least trustworthy numbers here:**

| Class | dBi | HPBW_v | Pattern knowledge | Confidence |
|---|---:|---:|---|---|
| LoRa stock stubby | 1 (claimed 2–3) | — | `undeclared` — ground plane is 0.15–0.2 λ at 868 MHz, below the practical minimum; the pattern is not a dipole's `[computed, §5.6]` | community-typical |
| Flexible whip (NA-771 class) | 2.15 claimed | — | `undeclared` | vendor |
| Station G2 stock (TX868-JKD-20) | 3 | 77.9° | `array-model` N=1 — vendor documents it as a **sleeve dipole**, which is ground-plane-independent, so the half-wave dipole cut is a correct model, not a stand-in `[vendor + computed]` | vendor |
| LoRa outdoor fibreglass omni | 5.0–6.5 | 30.0–24.5° | `array-model` N=2 | vendor |
| LoRa Yagi 868/915 | 6–12 | 25.5–6.4° | `undeclared`; directional, azimuth-aimed | vendor |
| 2 m base collinear | 6–8 (marketed) — **5.38 / 7.23 computed** | 30.0 / 19.3° | `array-model` N=2 / N=3 | community-typical |
| 70 cm base collinear | 8–11 (marketed) — **8.52 / 10.30 computed** | 14.3 / 9.4° | `array-model` N=4 / N=6 | community-typical |
| LiteBeam 5AC Gen2 | 23 | **10° datasheet** (11.94° from the §5.6.1 identity) | `aperture-model` — the reflector geometry is declared on the box; Ubiquiti's `.ant`/`.msi` files remain unusable (no redistributable licence, §5.6.5) and are **not needed** for the main lobe | vendor |
| PowerBeam 5AC 620 | 29 | **~6° datasheet** (5.98° from the identity) | `aperture-model`, same reason | vendor |
| Mikrotik LHG 5 ac (community-wireless staple, not yet a device row) | 24.5 | ~7° (10.04° from the identity) | `aperture-model` | vendor |

Meshtastic's own antenna page declines to certify small-whip gain claims. **Anything under ~6 dBi ships as `community-typical` and the UI says so on hover.**

**And the marketed collinear numbers are optimistic in the same way.** Numerically integrating the directivity of a collinear array of N half-wave dipoles at 0.9 λ spacing gives **5.38 dBi for N=2 and 8.52 dBi for N=4** `[computed]` — the "6 dBi" and "9 dBi" omnis on every fibreglass datasheet are ~0.5 dB high. The integrator is validated by N=1 returning **exactly 2.15 dBi / 77.9° HPBW**, the textbook half-wave dipole. So the `community-typical` tag extends *upward* past 6 dBi, not only below it: there is no gain figure in this table that is `datasheet`-grade.

### 5.4 Regulatory caps — where EU and US bind differently

| Cap id | Band | Limit | Kind | Duty | Source |
|---|---|---|---|---|---|
| `etsi-433` | 433.05–434.79 MHz | 10 dBm | ERP | 10 % | ETSI EN 300 220-2 |
| `etsi-868-g1` | 868.0–868.6 MHz | **14 dBm** | ERP | 1 % or LBT | ETSI EN 300 220-2 |
| `etsi-868-g3` | 869.4–869.65 MHz | **27 dBm** | ERP | 10 % | ETSI EN 300 220-2 — what Meshtastic `EU_868` encodes |
| `fcc-15247-915` | 902–928 MHz | **30 dBm** + 6 dBi free, then −1 dB per dB | conducted | none | 47 CFR §15.247(b) |
| `fcc-15247-2400` | 2400–2483.5 MHz | 30 dBm; fixed PtP: −1 dB per 3 dB above 6 dBi | conducted | none | §15.247(b)(3)(i) |
| `fcc-15247-5800` | 5725–5850 MHz | 30 dBm; fixed PtP: **no reduction at any gain** | conducted | none | §15.247(b)(3)(ii) |
| `part97-us` | ham | 1500 W PEP | conducted | none | 47 CFR §97.313 |
| `ham-de-a` | ham | 750 W | conducted | none | Bundesnetzagentur |
| `ham-uk-full` | ham | 400 W PEP | conducted | none | Ofcom |

**Three subtleties the model must not skip:**

1. **ERP ≠ EIRP ≠ conducted.** `EIRP = P_tx + G − L_feed`; `ERP = EIRP − 2.15 dB`. EU 27 dBm is **ERP**; FCC 30 dBm is **conducted**. Comparing them naively is wrong by several dB. Hence `limitKind` on every cap.
2. **The three FCC gain rules are three different functions** — hence `gainAllowanceDbi` + `gainReductionRatio`, not one number.
3. **US legal EIRP on 915 is ~6.9 dB above EU legal EIRP on 868** (36 vs 29.15 dBm EIRP) — a **2.2× free-space distance advantage** `[computed]`. Surface it, or every European user will be confused by American range reports.

`txPowerMaxHardwareDbm` and the cap-derived limit are separate fields and the UI shows **which one is binding**. Austria's amateur limits are class- and band-dependent; `REGULATORY_CAP_UNKNOWN` rather than a guessed number until verified per band.

### 5.5 Result type

```ts
type LinkResult =
  | { kind: 'ok'; marginLoDb: number; marginHiDb: number; verdict: Band;
      clearance: 'CLEAR'|'BLOCKED'|'UNRESOLVED';
      limitingDirection: 'a-to-b'|'b-to-a'; bitrateBps: number;
      ledger: BudgetTerm[]; provenance: ProvenanceHistogram }
  | { kind: 'refused'; code: LinkErrorCode; detail: string;
      wouldResolveWith?: string };   // "a 1 m DTM would narrow this to ±2 dB"
```

`marginLoDb`/`marginHiDb` are **derived** from `sensToleranceDb`, antenna-gain confidence and the §4.2 bracket — never asserted. A 6 dB margin with a 14 dB band is an honest "we don't know" and must not render green.

Extended for §5.6 — the elevation term travels with every `ok` result, whether or not it was applied:

```ts
type AntennaElevationTerm = {
  elevAngleDeg: number;        // computed, always — atan(Δh/D) − D/(2·a_e)
  requiredTiltDeg: number;     // same quantity as a mounting instruction
  hpbwVDeg: number;
  estLossDbLo: number;         // two-end, the disclosed band
  estLossDbHi: number;
  applied: boolean;            // true only when pattern.kind !== 'undeclared'
  patternFrom: 'measured' | 'array-model' | 'aperture-model' | 'undeclared';
};
```

**Amended 2026-08-02 — the aiming block, which for a directional antenna is the deliverable and the dB figure is the supporting evidence (§5.6.7):**

```ts
/** Present only when the selected antenna is `directional`. Every field is
 *  geometry the profile has already computed, or a closed form of `gainDbi`.
 *  Zero new data, zero licence exposure, ~1 kB for the WMM coefficients. */
type AntennaAiming = {
  requiredAzimuthDegTrue: number;
  requiredAzimuthDegMagnetic: number;  // NOAA/NCEI World Magnetic Model, public domain
  declinationDeg: number;              // named, because +5° E in Austria is a BIAS,
                                       //   not noise, and does not average out
  requiredTiltDeg: number;             // = elevAngleDeg, restated as an instruction
  tiltAchievable: boolean;             // false → ANTENNA_TILT_EXCEEDS_MOUNT
  aimToleranceDeg: number;             // 34.42·√T·10^(−G/20), T = 1 dB two-end
  beamFootprintM: number;              // 2·D·tan(θ₃/2) at the far end
  aimOffsetToleranceM: number;         // D·tan(aimToleranceDeg) — the ±1 dB miss distance
};
```

### 5.6 The antenna elevation term — computed always, applied sometimes, never invented

**The uncomfortable version first, and it cuts both ways.** §9 cuts antenna patterns from v1 on the grounds that the tool "assumes the antenna is aimed at the far end (best case)". For azimuth that is defensible. For elevation it is not even coherent: an omnidirectional antenna cannot be aimed, the elevation angle is set by the terrain the tool has just fetched, and for a 70 cm base collinear looking into a valley the resulting loss is **17.4 dB** on a 2 km / 400 m link `[computed]` — larger than the 16.74 dB two-ray term §1.1 includes *because* it "is larger than every other error in this document", and 17× the DEM error on the bare-earth base this feature is gated behind. The spec is currently rigorous about elevation geometry and silent about the one antenna variable that geometry controls.

**And yet it changes the verdict essentially never.** That is not a hedge; it is a measured anti-correlation, and it is the reason this section adds no pattern data. Both facts are stated because both are true.

#### 5.6.1 The physics, derived rather than quoted

Collinear array of N half-wave dipoles at 0.9 λ spacing. Element pattern `Fe(θ) = cos((π/2)·cos θ)/sin θ`, array factor `AF(θ) = sin(Nψ/2)/sin(ψ/2)` with `ψ = 2πd·cos θ`; directivity by numerical integration of `|Fe·AF|²·sin θ` over the sphere. **Validation before use: N=1 returns 2.15 dBi and 77.9° HPBW — the textbook half-wave dipole** `[computed]`.

| N | Gain | HPBW_v | First deep null | `D_linear × HPBW_v` |
|---:|---:|---:|---:|---:|
| 1 (dipole) | 2.15 dBi | 77.9° | 85.9° | 127.9 |
| 2 | 5.38 dBi | 30.0° | 32.0° | 103.5 |
| 3 | 7.23 dBi | 19.3° | — | 101.8 |
| 4 | 8.52 dBi | 14.3° | 15.3° | 101.5 |
| 6 | 10.30 dBi | 9.4° | — | 101.2 |

**The gain–beamwidth identity is the whole engineering result of this section.** `D_linear × HPBW_v = 101.5 ± 2 %` for N ≥ 2 `[computed]`, so

```
HPBW_v ≈ 101.5 · 10^(−G_dBi/10)     deg     [computed, collinear omnis, G ≥ 5 dBi]
```

Cross-check `[ITU]`: ITU-R F.1336-5's omnidirectional reference uses `θ₃ = 107.6 · 10^(−0.1·G₀)`. The two agree to within 6 % for every G ≥ 5 dBi (5.38 dBi: 29.4 vs 31.2 vs 30.0 derived; 10.3 dBi: 9.5 vs 10.0 vs 9.4) `[computed]`. **They disagree by 16 % for the single dipole** (61.9 / 65.6 vs 77.9 derived) — F.1336 is a base-station reference and must not be applied below ~5 dBi. Use the derived value there.

**`hpbwVDeg` therefore costs zero bytes.** It is a one-line function of `gainDbi`, which `AntennaOption` already carries.

**The aperture sibling — added 2026-08-02, and the exponent is the whole point.** For a circular parabolic reflector, `G = η(πD/λ)²` at η = 0.6 gives `G_dBi = 7.725 + 20·log10(D/λ)`, and F.699's 3 dB point is `D/λ · θ₃ = 40√3 = 69.282`. Eliminating `D/λ`:

```
θ₃ ≈ 168.6 · 10^(−G_dBi/20)     deg     [computed, circular aperture, η ≈ 0.6]
```

Note **/20 against the collinear's /10**. That is not a fitting artefact: a collinear narrows in one plane, an aperture in two. Both fall out of the same directivity integral this section already validated by recovering the textbook dipole at N = 1.

And the near-axis loss law is then an **identity**, not an approximation. F.699 §3 case 1 is `ΔG = 2.5×10⁻³·(D·φ/λ)²`; substituting `D/λ = 69.282/θ₃` gives `2.5×10⁻³ · 4800 · (φ/θ₃)² = 12·(φ/θ₃)²` **exactly**, because `2.5×10⁻³ = 12/(40√3)²` `[computed — the two forms agree to 1e-9 dB for every D/λ and φ tested]`. So:

```
ΔG_one-end = 12 · (φ/θ₃)²   dB      valid for |φ| ≤ φ_m
φ_m = (20·λ/D)·√(G − G₁),  G₁ = 2 + 15·log10(D/λ)    [ITU-R F.699]
```

**Self-validation against §5.3, which was populated from vendor datasheets:** PowerBeam 5AC 620 at 29 dBi → **5.98°** against the catalogue's ~6°. LiteBeam 5AC Gen2 at 23 dBi → **11.94°** against a datasheet 10° — a 19 % over-prediction, which is the honest failure mode: η is nearer 0.85 than 0.6 on that reflector, or the datasheet figure is not the −3 dB point. **The identity is therefore a fallback, not an override.** `hpbwVDeg` already exists on `AntennaOption`; where a datasheet beamwidth is published it wins, and the identity fills in only where it is not. §8.2 pins both anchors — the 29 dBi → 5.98° recovery, and the `12(φ/θ₃)² ≡ 2.5×10⁻³(Dφ/λ)²` identity — beside the existing N=1 → 2.15 dBi / 77.9° dipole test.

#### 5.6.2 Two-end loss — the loss is taken twice

Reciprocal geometry: the hilltop node looks *down* by exactly the angle the valley node looks *up*, so both ends are off-boresight by the same amount and the scalar model hides the loss twice over.

| Elevation | 2.15 dBi | 5.38 dBi | 7.23 dBi | 8.52 dBi | 10.30 dBi |
|---:|---:|---:|---:|---:|---:|
| 1° | −0.00 | −0.03 | −0.06 | −0.11 | −0.25 |
| 2° | −0.02 | −0.10 | −0.24 | −0.44 | −1.01 |
| 3° | −0.03 | −0.23 | −0.55 | −1.00 | −2.32 |
| 5° | −0.10 | −0.63 | −1.53 | −2.83 | −6.79 |
| 8° | −0.25 | −1.63 | −4.04 | −7.68 | −20.83 |
| 10° | −0.39 | −2.57 | −6.50 | −12.79 | **−46.90** (null) |
| 12° | −0.56 | −3.75 | −9.73 | −20.34 | −38.43 |
| 15° | −0.87 | −6.01 | −16.59 | **−44.84** (null) | −25.91 |
| 20° | −1.56 | −11.39 | −42.19 | −29.37 | −42.69 |

All `[computed]`. Two properties of this table decide the design:

- **It is non-monotonic.** The 10.30 dBi column reads −20.83, −46.90, −38.43, −25.91 across 8–15°: a null at 10°, a sidelobe at 15°. **A scalar gain plus a tolerance cannot bound a function that is not monotone in the perturbed variable**, so the §4.2 bracket would produce a confidently wrong interval rather than a wide one. This is why the term is reported as a band and gated, never folded into ±σ.
- **It is entirely a function of gain.** At 2.15 dBi it never exceeds 1.6 dB anywhere on Earth. The whip that dominates the Meshtastic fleet does not need this section at all.

#### 5.6.3 The gate — two bytes, no new data

Elevation angle at which the two-end loss reaches a threshold, from the identity above:

| Gain | HPBW_v | 0.5 dB | 1 dB | 3 dB | 6 dB |
|---:|---:|---:|---:|---:|---:|
| 2.15 dBi | 77.9° | 11.34° | 16.04° | 27.71° | 38.97° |
| 5.38 dBi | 30.0° | 4.46° | 6.29° | 10.78° | 14.99° |
| 7.23 dBi | 19.3° | 2.87° | 4.05° | 6.94° | 9.64° |
| 8.52 dBi | 14.3° | 2.13° | 3.00° | 5.14° | 7.14° |
| 10.30 dBi | 9.4° | 1.41° | 1.99° | 3.40° | 4.72° |

`[computed]`. Closed form for the mainlobe: `e_T = 20.72 · √T · 10^(−G_dBi/10)` deg for a two-end budget of `T` dB.

**Rule.** Compute `elevAngleDeg = atan(Δh/D) − D/(2·a_e)` on every link — it is a by-product of the §1.5 geometry the profile already builds. If `|e| < e_0.5dB(G)`, say so in the ledger and move on. Otherwise §5.6.5 applies.

#### 5.6.4 Against the errors already in this document — and why the verdict still does not move

Same links, the antenna term beside the §3.1 DEM term (`dJ/dh ≈ 9.130/F1` dB per metre), 868 MHz `[computed]`:

| Link | Elev | DEM 1σ, Terrarium | DEM 1σ, GEDTM30 | DEM 1σ, 1.5 m DTM | 5.38 dBi | 8.52 dBi | 10.30 dBi |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2 km, 400 m drop | 11.31° | 9.94 dB | 7.43 dB | 1.04 dB | 3.32 | **17.36** | **49.85** |
| 1 km, 150 m drop | 8.53° | 14.06 | 10.50 | 1.47 | 1.86 | 8.86 | **25.11** |
| 10 km, 1000 m drop | 5.71° | 4.45 | 3.32 | 0.47 | 0.82 | 3.73 | 9.11 |
| 5 km, 400 m drop | 4.57° | 6.29 | 4.70 | 0.66 | 0.53 | 2.36 | 5.60 |
| 20 km, 1000 m drop | 2.86° | 3.14 | 2.35 | 0.33 | 0.21 | 0.91 | 2.10 |
| 2 km, 100 m drop | 2.86° | 9.94 | 7.43 | 1.04 | 0.21 | 0.91 | 2.10 |

So the honest ordering is **not** "dwarfed today, dominant after GEDTM30". It is **dominant today for ≥8 dBi omnis on steep short links, and never relevant for ≤5.4 dBi at any DEM quality**. The dividing variable is antenna gain, not DEM generation.

**And yet — the anti-correlation.** Pattern loss is large only at steep angles; steep angles need a large Δh/D; large Δh/D means a *short* link; a short link has a huge margin because FSPL is low. 8.52 dBi omni, obstacle held at grazing, LongFast `[computed]`:

| Elev | two-end loss | margin @ 0.5 km | 2 km | 10 km | 30 km |
|---:|---:|---:|---:|---:|---:|
| 4° | −1.79 | 69.7 | 57.6 | 43.5 | 33.7 |
| 8° | −7.68 | 63.8 | 51.7 | 37.6 | 27.8 |
| 11.3° | −17.32 | 54.1 | 42.1 | 28.0 | 18.2 |
| 14° | −33.03 | 38.4 | 26.4 | 12.3 | 2.5 |
| 15° | −44.84 | 26.6 | 14.6 | 0.5 | −9.3 |

The term spends 17 dB out of a 50 dB surplus. The two curves cross only at **long *and* steep** — 14° at 30 km requires **7 480 m of vertical drop** `[computed]`. That geometry does not exist. Bounding the sweep at a Grossglockner-class 2 500 m maximum drop, the verdict changes in a handful of cells at 3–15 km with a ≥8.5 dBi omni and nowhere else.

**Two structural facts finish the argument:**

1. **The term cannot touch Gate 1.** §4.3 tests `σ_total < 0.6·F1_min` — pure geometry, no gain term anywhere in it. Antennas can only ever move Gate 2.
2. **Gate 1 already refuses the worst cases.** The 2 km / 11.3° link that costs 17.4 dB is inside the 868 MHz clearance refusal band on both Terrarium (6.59 km) and GEDTM30 (3.68 km).

**Decision: no pattern data in v1. The elevation angle ships in v1 as a computed, disclosed, gated term.** It costs zero bytes, zero licence exposure and zero new machinery — it reuses the §1.1 unmodelled-term-with-a-magnitude-band convention already used for P.2108.

**Scope correction, 2026-08-02: everything above is about the ELEVATION term on OMNIDIRECTIONAL antennas, and it does not transfer to a dish.** The conclusion survives; two of the three arguments do not.

*The anti-correlation sign-reverses.* Every step of it — steep angle needs large Δh/D, large Δh/D means a short link, a short link has huge margin — is a statement about **elevation geometry**. **Mis-aim has no geometry dependence at all.** The same 2° error costs the same 2.67 dB on a PowerBeam 5AC 620 pair at 1 km and at 50 km, while the margin collapses. 5.8 GHz, 20 dBm, 29 dBi both ends, MCS9 (−65 dBm) `[computed]`:

| D | FSPL | margin | 2° two-end loss | **% of margin** |
|---:|---:|---:|---:|---:|
| 1 km | 107.71 | 35.3 dB | 2.67 dB | 7.6 % |
| 5 km | 121.69 | 21.3 dB | 2.67 dB | 12.5 % |
| 10 km | 127.71 | 15.3 dB | 2.67 dB | 17.4 % |
| 20 km | 133.73 | 9.3 dB | 2.67 dB | 28.8 % |
| 30 km | 137.25 | 5.7 dB | 2.67 dB | **46.4 %** |
| 50 km | 141.69 | 1.3 dB | 2.67 dB | **203 %** |

The elevation term is worst where margin is largest; the mis-aim term is worst where margin is smallest. **The one paragraph that carries the "no patterns" decision is a positive correlation for mis-aim.**

*It is larger than the DEM term at the only DEM quality where WiFi is answerable at all.* Converting through §3.1 (`h = L·F1/9.130` metres of equivalent terrain error), two-end mis-aim on a 25 dBi / 7° dish at 5.8 GHz `[computed]`:

| mis-aim | loss | ≡ DEM error, 1 km | 5 km | 10 km | 20 km |
|---:|---:|---:|---:|---:|---:|
| 1° | 0.49 dB | 0.19 m | 0.43 m | 0.61 m | 0.86 m |
| 2° | 1.96 dB | 0.77 m | 1.72 m | 2.44 m | 3.45 m |
| 3.5° | 6.00 dB | 2.36 m | 5.28 m | 7.47 m | 10.56 m |
| 5° | 12.24 dB | 4.82 m | 10.78 m | **15.25 m** | **21.56 m** |

> **A 5° aiming error on a 25 dBi dish at 10 km is worth 15.25 m of terrain error — more than the 14.31 m Terrarium σ this whole project is migrating away from.** A sloppy install discards the entire Terrarium → GEDTM30 → LiDAR migration and then some.

Against the §4.3 composite σ on a national DTM (0.28–1.27 dB on these geometries), mis-aim exceeds the DEM term from about **1.5° upward at every geometry**.

*Structural fact 1 survives untouched.* §4.3 contains no gain term; antennas still cannot move Gate 1, and every WiFi refusal in §0.2 stands regardless of what any antenna does. **Structural fact 2 does not transfer**: the LoRa argument was that Gate 1 already refuses the worst elevation cases. On a national LiDAR footprint at 5.8 GHz Gate 1 refuses only below ~50 m of bare-earth path (§4.3), so it refuses essentially nothing and cannot cover for the aiming term.

*And the verdict is a different kind of object.* LoRa LongFast is pass/fail against a fixed −131 dBm. WiFi returns a **rate**, selected from a 31 dB sensitivity ladder — §5.3's own PowerBeam row spans −96 to −65 dBm over 9 MCS steps, **3.44 dB per step** `[computed]`. There is no threshold to be comfortably far from: every 3.44 dB of mis-aim is one MCS step, continuously. §5.6.4's "17 dB out of a 50 dB surplus" reasoning presumes a binary verdict with a surplus, and for WiFi there is neither.

**What this changes: nothing about pattern files. §5.6.5 gains an `aperture-model` rule and §5.6.7 adds an aiming block. See both.**

#### 5.6.5 The fallback for a device with no published pattern — the common case

**Nothing in the flagship family publishes a pattern under a redistributable licence.** Verified: Heltec V3, LILYGO T-Beam, RAK4631 publish none at all — the antenna is not their product. RAK's fibreglass omnis publish raster plots under "All rights reserved". Ubiquiti publishes real `.ant` and `.msi` files for airMAX/airFiber with no licence grant; the `Cloud-RF/UBNT2ANT` converter repo returns `license: null`. Cambium's patterns are inside LINKPlanner under a EULA granting a "personal, nonexclusive, non-transferable license". The 400 000-file MSI aggregator libraries state no redistribution terms at all. Cebik's ham NEC archive says explicitly it "may not be reproduced for publication". `meshtastic/antenna-reports` is genuinely GPL-3.0 and contains **VSWR and return loss only — zero radiation-pattern data**, because a VNA cannot measure a pattern. **Free of charge is not redistributable** — the same test that already ruled out commercial imagery and elevation for this project, applied unchanged.

Four options were on the table for the resulting gap:

| Option | Verdict |
|---|---|
| **Isotropic, labelled** | **Rejected.** It is the "typical 3 dBi omni" fabrication under a different name. It is also *wrong in a known direction* — a stock LoRa whip on a 0.15–0.2 λ ground plane has its main lobe tilted 20–40° up and roughly 0 dBi toward the horizon, so isotropic is neither conservative nor neutral. |
| **A first-principles pattern for every device** | **Rejected for undeclared geometry, accepted for declared geometry.** A collinear array's cut is derivable in a line and is the same epistemic class as J(ν) or the earth bulge — computed, checkable, `[computed]`. But nobody knows what radiating structure is inside a rebadged stubby, and assuming one is invention. **Amendment 2026-08-02: a 620 mm PowerBeam is a circular parabolic reflector — the structure is visible from outside, printed on the box, and is the exact geometry F.699 was written for.** This rule was calibrated on the hardest case (an undeclared whip) and then applied to the easiest one. `aperture-model` is the declared-geometry branch for dishes, and it costs **one uint8 per antenna** (40 bytes for the catalogue) against the 7.07 kB a v-cut catalogue would cost in §5.6.6 — 177× smaller, and *correct* for this device class rather than merely affordable. |
| **Blanket refusal whenever no pattern exists** | **Rejected.** It would refuse nearly every link the tool is for. A refusal that fires everywhere is not a refusal; it is a broken tool, and it violates §0.2's own lesson that refusal must be *per-question*. |
| **Compute the term, disclose it as a band, gate on it** | **Adopted.** |

**The rule, in full:**

```
elevAngleDeg is computed on EVERY link and appears in EVERY ledger.

pattern.kind === 'measured'      → apply the cut. patternFrom: 'measured'.
pattern.kind === 'array-model'   → apply the derived cut. patternFrom: 'array-model'.
                                   The ledger names N and the spacing.
pattern.kind === 'aperture-model'→ [added 2026-08-02] apply the F.699 main-lobe cut
                                   12·(phi/theta3)^2 for |phi| <= phi_m. applied: true.
                                   Beyond phi_m, report a band bounded BELOW by the
                                   F.699 sidelobe envelope — an envelope is a regulatory
                                   ceiling on radiation, so it UNDER-states real loss —
                                   emit ANTENNA_OFF_MAINLOBE, applied: partial.
pattern.kind === 'undeclared'    → apply NOTHING to the number.
                                   Report the term as an unmodelled band:
                                     estLossDbLo = loss for a dipole of the same gain
                                     estLossDbHi = loss for a collinear of the same gain
                                   applied: false.
```

The band is honest because it brackets the real physical uncertainty: at a declared 8.5 dBi the antenna is *some* structure with *some* aperture, and the two bounds are the widest and narrowest beam that can legitimately produce that gain. It is not a guess dressed as a number; it is the range the nameplate permits.

**Two new named codes, extending the §4.6 union:**

```
'ANTENNA_ELEVATION_UNMODELLED'   // |e| > e_1dB(G) on an antenna with pattern.kind
                                 //   === 'undeclared'. Not a refusal of the link —
                                 //   a refusal to let the gain figure stand unqualified.
'ANTENNA_TILT_EXCEEDS_MOUNT'     // requiredTiltDeg beyond the ±20–30° a standard mount
                                 //   provides. Pure geometry, no pattern data, and a
                                 //   genuine planning bug-catcher: 400 m over 1 km needs
                                 //   21.8° of downtilt that no dish mount offers. [computed]
```

`ANTENNA_ELEVATION_UNMODELLED` fires stricter as gain rises — 16.04° at 2.15 dBi, 3.00° at 8.52 dBi, 1.99° at 10.30 dBi `[computed]` — which is the correct direction and mirrors how §4.3 gets stricter with frequency.

**Ledger text, in the §4.7 style:**

> *Elevation angle 11.3° (node B is 400 m below A over 2.0 km). This is a 9 dBi collinear with no published radiation pattern; at 11.3° off boresight it loses an estimated **4–20 dB per pair of ends** depending on its internal structure, which the vendor does not state. Not modelled — the margin below excludes it. A lower-gain antenna, or a mechanical downtilt of 11.3°, removes the uncertainty.*

That is more useful than a fake pattern, because it tells the user what to do.

**And the one output worth more than any of it: `requiredTiltDeg`.** For a directional antenna the useful answer was never the pattern — it is the mechanical tilt, which is the same `atan(Δh/D) − D/(2·a_e)` already computed, at zero byte cost and with no licence problem `[computed]`:

| Δh | 0.5 km | 1 km | 2 km | 5 km | 10 km | 20 km |
|---:|---:|---:|---:|---:|---:|---:|
| 30 m | 3.43° | 1.71° | 0.85° | 0.33° | 0.14° | 0.02° |
| 100 m | 11.31° | 5.71° | 2.86° | 1.13° | 0.54° | 0.22° |
| 400 m | 38.66° | 21.80° | 11.30° | 4.56° | 2.26° | 1.08° |
| 800 m | 57.99° | 38.66° | 21.79° | 9.07° | 4.54° | 2.22° |

Everything past ~20–30° is not aimable as mounted. An installer who aims by map azimuth and leaves tilt at zero loses **29.6 dB** on a 400 m / 2 km link with a 24 dBi dish `[computed]`.

#### 5.6.6 If patterns are ever added — the shape they must take

Recorded now so that v2 does not have to relitigate it.

**Representation: the vertical cut only, at 1°, and nothing else.**

- For an omni the V-cut **is** the full 3D pattern, exactly, by rotational symmetry. No reconstruction, no error.
- For a directional antenna aimed at the far end, `|azimuth offset| ≤ 5°` and the V-cut **is** the φ = 0 plane of the 3D pattern. Reading it is a lookup of published data, not interpolation. Reconstruction error under 0.5 dB for every class tested.
- Beyond ±15° azimuth the industry-standard two-cut reconstruction (cross-weighted, MATLAB `patternFromSlices`; summing and max-hold are both worse by 3–15 dB RMS) is **7.2 dB RMS with a 37.6 dB worst case** on a real circular-aperture pattern with sidelobes. Against §3.4's refusal to claim better than ±8–12 dB total, that reconstruction *is* the entire error budget. **It must return a named refusal, not a number.** MSI Planet, NSMA WG16.99.050 and Radio Mobile `.ant` all ship two cuts and nothing else — in IES terms, a photometric file containing only the C0–C180 and C90–C270 planes. The remaining 64 440 samples of a 1° sphere would be invented by an algorithm.
- MATLAB's default cross-weighting exponent `k = 2` is wrong for narrow beams (7.4 dB RMS vs 2.2 dB at k = 1). If it is ever implemented, `k` is a per-antenna field, never a constant.

**Encoding:** uint8, 0.5 dB per count, index = degrees, elevation −90…+90 folded to 0…180 → **181 bytes per antenna**. Quantisation error max 0.249 dB, RMS **0.145 dB** `[computed]` — below chamber repeatability, not the limiting term. Sample spacing derived, not chosen: linear interpolation error is bounded by `3h²/HPBW²`, so `h_max = HPBW_v·√(ε/3)`; at ε = 0.1 dB a 6° dish needs 1.1° and a 25° omni needs 4.6°. **1° covers the narrowest antenna in §5.3 and nothing narrower is in scope.**

**Byte cost, 40 antennas** `[computed]`:

| Representation | Raw | gzip |
|---|---:|---:|
| Full sphere, 1° (360×181) | 2 545 kB | — |
| H + V cuts, 1° (541 B/ant) | 21.1 kB | — |
| **V-cut only, 1° (181 B/ant)** | **7.07 kB** | 0.66 kB clean / **4.4 kB real** |
| V-cut only, 2° | 3.55 kB | — |
| Three analytic params | 0.12 kB | — |
| **v1: derived from `gainDbi`, already present** | **0 kB** | **0 kB** |

Full sphere is dead on arrival against a bundle where MapLibre is the incumbent tenant. The V-cut at 7.07 kB is a 27 % increase on the existing 26 kB catalogue — affordable, and still not worth paying for a term that does not move the verdict.

**The integrity test that makes a v2 catalogue self-policing** `[computed]`, and it belongs in §8.6 the day any pattern data lands:

> Smooth modelled cuts gzip to **9.3 %** of raw; the same cuts with 0.4 dB of chamber-like measurement noise gzip to **61.8 %** — a factor of 6.6. **A pattern catalogue that compresses below ~25 % is a catalogue of models, not measurements.**

That is stronger than a provenance tag because it cannot be faked by editing a metadata field, and it detects precisely the failure this whole section exists to prevent: a "typical" pattern quietly substituted for a real one. It also sets the honest expectation — a real 40-antenna measured catalogue costs ~4.4 kB gzipped, not 0.66 kB.

**Finally, the composition trap.** A vendor pattern measured on a real mast over real ground is *wrong to use here*: it already contains the ground reflection that §1.8 computes separately, and applying both double-counts an 18–22 dB term. Only free-space anechoic patterns compose correctly with this model — which is the one kind nobody publishes for this device class. This is the same double-counting adjudication §1.1 already made for `g = h + R` versus a fused DSM, and it must be made explicitly again before any pattern file is imported. **Note 2026-08-02: `aperture-model` is free-space by construction and therefore composes correctly with §1.8 — one more reason to prefer it over a vendor file even where a vendor file exists.**

#### 5.6.7 Aiming — the output that is worth more than the decibel

**Added 2026-08-02.** §5.6.5 already computes `requiredTiltDeg` and then files it under a closing remark. **That is the misallocation.** For an omni the elevation angle is a diagnosis with no cure. For a dish it is a **work instruction**: the installer turns a bolt and 20–30 dB goes away.

*Why the number is not enough on its own.* Realistic first-install aiming accuracy `[assumption, except where noted]`:

| method | σ_az | σ_el |
|---|---|---|
| phone/handheld compass on a steel mast | 5–15° | — |
| compass, clear of steel, declination applied | 2–5° | — |
| **declination not applied (Austria ≈ +5° E, 2025)** | **+5° systematic** | — |
| phone inclinometer / spirit level | — | 0.5–2° |
| **mount left at 0° tilt (the default)** | — | = the full elevation angle |
| optical sighting on a visible far end | 0.3–1° | 0.3–1° |
| RSSI peaking against a live far end (airOS align) | 0.2–0.5° | 0.2–0.5° |

Two structural facts fall out. **The accurate methods require the link to already exist** — RSSI peaking and optical sighting both need the far end up and visible, so first-install bootstrapping runs on the *inaccurate* path, which is precisely the moment a planner is useful. And **elevation is the easy axis, azimuth the hard one**: an inclinometer has no magnetic problem, a compass on a steel mast has a large one. The tool cannot improve the compass, but it can **remove the declination bias entirely** — the NOAA/NCEI World Magnetic Model coefficient set is public domain and ~1 kB, well inside this bundle's tolerance and two orders below the v-cut catalogue §5.6.6 declined to pay for.

*Expected loss under random pointing error, closed form.* With `θ ~ Rayleigh(σ_aim)`, `E[θ²] = 2σ²`, so the two-end expectation is `E[L] = 48·σ_aim²/θ₃²` dB `[computed]`. Setting `E[L] = 1 dB` at a realistic corrected-compass σ_aim = 2° gives `θ₃ = 13.9°`, i.e. **G ≈ 21.7 dBi**. That is the clean analogue of §5.6.2's "≤5.4 dBi never matters": **below ~22 dBi pointing is not a first-order term; above it, it is.** NanoStations and sectors are exempt; every dish in §5.3 is not.

*The tolerance, deliberately parallel to §5.6.3's omni form `e_T = 20.72·√T·10^(−G/10)`:*

```
θ_T = 34.42 · √T · 10^(−G_dBi/20)   deg   two-end budget of T dB, circular aperture
```

| Device | θ₃ | 0.5 dB | 1 dB | 3 dB | 6 dB |
|---|---:|---:|---:|---:|---:|
| NanoStation-class, 16 dBi | 26.7° | 3.86° | 5.46° | 9.45° | 13.36° |
| LiteBeam 5AC Gen2, 23 dBi | 10° | 1.72° | 2.44° | 4.22° | 5.97° |
| PowerBeam-class, 25 dBi | 7° | 1.37° | 1.94° | 3.35° | 4.74° |
| PowerBeam 5AC 620, 29 dBi | 6° | 0.86° | 1.22° | 2.12° | 2.99° |
| AirFiber-class, 30 dBi | 4° | 0.77° | 1.09° | 1.89° | 2.67° |

*And the form an installer can act on — the same tolerance as a ground footprint at the far end* `[computed]`:

| Device | 2 km | 5 km | 10 km | 20 km |
|---|---|---|---|---|
| 23 dBi / 10° | 350 m / ±85 m | 875 m / ±213 m | 1750 m / ±426 m | 3500 m / ±851 m |
| 25 dBi / 7° | 245 m / ±68 m | 612 m / ±169 m | 1223 m / ±338 m | 2447 m / ±676 m |
| 29 dBi / 6° | 210 m / ±43 m | 524 m / ±107 m | 1048 m / ±213 m | 2096 m / ±426 m |
| 30 dBi / 4° | 140 m / ±38 m | 349 m / ±95 m | 698 m / ±190 m | 1397 m / ±380 m |

(first = −3 dB beam width where it lands; second = the ±offset costing 1 dB two-end)

**Ledger text, in the §4.7 style — five numbers, no decibel in the headline:**

> *Aim 247° true / 242° magnetic (declination +5.0° E, WMM 2025). Tilt **down 11.3°** — a ±20° mount does this. Your beam is 210 m wide where it lands, 2.0 km away; miss by 43 m and you pay 1 dB. Leaving the tilt at zero costs about 28 dB.*

That sentence costs zero bytes beyond the WMM table — the tool already knows D, Δh and G — and it has no free competitor, no licence exposure and no DEM dependency. **For a community-wireless installer it is the product; the margin interval is supporting evidence.**

*Polarisation — the finding runs the other way, and the §9 plan would have fired a false alarm.* With `H_eff = X·R(α)`, the mechanical roll `R` is orthogonal, so the singular values of `H_eff` are those of the cross-coupling `X` **independent of α** `[computed]`. For every dual-polarised 2×2 device — which is every airMAX ac and every Mikrotik ac PtP dish — **rolling the dish is mathematically invisible**: it swaps the chains and the receiver's channel estimate absorbs it. The familiar 20–30 dB number is real but belongs to **single-pol** hardware only (3.01 dB at 45°, 30 dB at 90° against a 30 dB XPD floor) — i.e. to LoRa Yagis, ham beams and single-pol sectors, not to the WiFi PtP gear that raised the question. Two residual cases, neither a path-loss term:

- **Mixed dual-pol ↔ single-pol pairing:** ~0 dB of path loss, but rank 1 — one spatial stream, **half the rate, independent of roll**. Derivable from the `dualPol` flag alone; ships as a device-pairing warning.
- **Interference rejection, not path loss:** a cross-polarised co-channel neighbour is suppressed by ~30 dB of XPD; roll a dish 45° and that becomes ~3 dB. Real, invisible to a terrain model, and it stays **unmodelled and named**, exactly as P.2108 is.

**So `POLARISATION_MISMATCH` as a 5–20 dB band (§9) is replaced by one boolean and a pairing warning — strictly fewer bytes and strictly more correct.**

---

## 6. UI

### 6.1 Adjudication: 3D placement vs profile chart

**Do both. The chart is the useful one, and the spec says so plainly.**

| | 3D viewer | 2D path profile |
|---|---|---|
| Placing a device | **Yes — this is what 3D is for.** Click the terrain, the device snaps to `sampleGround`, drag to move | no |
| Seeing which ridge is in the way | good | good |
| Reading Fresnel clearance | **No.** Perspective foreshortening hides clearance; a 13 m ellipse over 2 km is sub-pixel | **Yes — the only honest place** |
| Reading the uncertainty band | no | **Yes — shaded envelope around the obstruction line** |
| Reading provenance | no | **Yes — the obstruction line coloured by `clutterFrom`** |
| Reading the verdict and ledger | badge only | **Yes** |

3D is the placement affordance and the visual differentiator. It cannot carry the verdict. Every load-bearing output — clearance, interval, provenance, ledger — lives in the chart.

**A hard constraint the 3D view creates.** `apps/napplet/src/terrain/generate.ts` sets `TERRAIN_EXAGGERATION = 1.5`, and `buildTerrainMesh` multiplies heights by it *and* shifts the datum so the lowest sample sits at y = 0. **A link line drawn straight through 1.5×-exaggerated terrain looks blocked when it is clear.** Two rules follow:

1. **Calculator mode forces exaggeration to 1.0**, with a visible badge saying so, or
2. if exaggeration is kept for legibility, the link line, Fresnel envelope and device masts are drawn in the *same* exaggerated space and the view carries a permanent `vertical exaggeration ×1.5 — geometry here is illustrative` notice, and the verdict badge is suppressed in 3D entirely.

Default to (1). Reason: the whole point is not lying about geometry.

### 6.2 Placement flow

1. Pick a device profile and mode from the catalogue (search + family filter).
2. Click the terrain in 3D. Device is placed at `sampleGround(x, z)`; the panel immediately shows resolved `groundElevM`, the DEM source id, and its declared σ.
3. Set height: a numeric field plus a `heightRef` selector — `agl` / `building` / `amsl`. On a `demIsSurface` DEM the `agl` option carries an inline warning: *"this DEM measures rooftops and canopy — 2 m AGL here may be 2 m above the treetops"*.
4. Set jurisdiction once per session (`capId`); TX power field is clamped to the resolved cap and shows which limit binds.
5. Links are computed pairwise for all placed devices. Drag recomputes only the N−1 links touching the dragged device at **preview resolution** (the viewer's 192-grid), badged `preview`. Drop triggers the full corridor recompute at derived spacing. **The two results must be visually distinguishable** — a preview verdict that looks like a committed verdict is the same failure mode in a new place.

### 6.3 The profile chart

Along-path distance on x, metres AMSL on y. Layers, bottom to top:

| Layer | Rendering |
|---|---|
| Bare earth | solid line |
| Clutter (`R`) | filled band above bare earth, **coloured by `clutterFrom`** — measured / raster / nominal / unknown visually distinct |
| Uncertainty envelope | shaded `obstructionLow`…`obstructionHigh` |
| Earth bulge | applied to the y values, both k values drawn — shown only when the bulge exceeds 1 m, else stated as negligible |
| LOS line | terminal to terminal |
| 0.6·F1 envelope | dashed, both k values |
| Bullington point | marked, with its ν |
| Source-boundary markers | vertical rules at declared source changes and at any `SURFACE_STEP_DETECTED` |

Below the chart: the ledger (every term named, editable where it is a user assumption), the margin interval with its band, and the provenance histogram.

### 6.4 Rendering a refusal

- A refused link is drawn in 3D as a **dashed neutral-grey line** — no colour implying pass or fail. Never green, never red.
- The panel shows the error code, the plain-language cause, the magnitude, and `wouldResolveWith`.
- No margin number is rendered anywhere for a refused link, including in tooltips and exports.

### 6.5 Privacy in the UI

State it, once, visibly: *"Placements exist only in this browser tab. Nothing is uploaded, published or stored. Terrain for a link corridor is fetched by content hash from the collection server — see §7.4 for what that reveals."*

---

## 7. ARCHITECTURE

### 7.1 Ownership

| Package / path | Owns | Constraints |
|---|---|---|
| **`packages/rf-link`** (new, `@terrcvm/rf-link`) | FSPL, Fresnel, curvature, J(ν), Bullington, delta-Bullington, two-ray, Rayleigh gate, budget ledger, uncertainty bracket, gates and error codes, device catalogue + caps | **Zero runtime dependencies. No DOM. No network. No imports from terrain-engine.** Consumes plain arrays and a `(lon, lat) => ObstructionSample` callback. Node-testable in isolation |
| `packages/terrain-engine/src/rf-adapter.ts` (new) | Binds `Heightfield` + `FeatureTile` + land cover + canopy to the `ObstructionSample` callback; geodesic path walk; corridor tile selection | May depend on terrain-engine internals; still no DOM |
| `packages/terrain-engine/src/terrain/elevation-sources.ts` (edit) | `verticalUncertaintyM` mandatory field + enforcement; Mapterhorn source-model classification table | Same fail-closed discipline as `license`/`attribution` |
| `apps/mapplet` | Placement UI, profile chart, corridor fetch through `loadBytesCacheFirst`, session state | Owns all I/O |

**Why a separate package, not `terrain-engine/src/rf/`.** `terrain-engine` declares `maplibre-gl` and `@turf/area` as package dependencies. The propagation module must be provably dependency-free and node-testable; a separate package makes that a build-enforced fact rather than a convention. Precedent exists — the tree just did `refactor: extract the terrain engine into @terrcvm/terrain-engine`.

**Estimated size:** ~600 lines of TypeScript for the propagation core, < 8 kB minified; ~26 kB raw / ~6 kB gzipped for the catalogue. Inside the single-file artifact budget.

**Interactivity budget** `[computed]`: profile walk ~5 µs + delta-Bullington ~20 µs; ×12 uncertainty runs ≈ 0.3 ms per link. N = 20 devices, dragging one → 19 links ≈ 5.7 ms, inside a frame. Full pairwise for N = 20 is ~57 ms — do that on drop, not per frame.

### 7.2 The calculator must NOT reuse the viewer's terrain

Four independent reasons, each verified against the source:

| # | Fact | Consequence |
|---|---|---|
| 1 | `buildTerrainMesh` writes `(heights[v] − minM) × exaggeration` (`terrain/mesh.ts`), and `preview3d.groundAt` samples that shifted, scaled frame | RF needs metres above a stated datum. **Read `Heightfield` (`terrain/heightfield.ts` — "Metres above sea level"), never the mesh** |
| 2 | `bboxExtentMetres` is an equirectangular approximation at the bbox mid-latitude (`terrain/mesh.ts`) | Fine at 2 km, wrong at 50 km. Path geometry must be geodesic |
| 3 | `demTilesForBBox` **reduces the zoom** rather than exceed `MAX_DEM_TILES = 16` (`terrain/dem.ts`) | A bandwidth cap would silently halve the resolution of a radio prediction with nothing in the result saying so. That is the cardinal rule violated by reuse alone |
| 4 | `samplePixel` returns `0` for a missing tile (`terrain/heightfield.ts`) | A fabricated sea-level valley reading as clear LOS. Needs a `NaN` sentinel and `PATH_LEAVES_LOADED_CORRIDOR` |

Also: the 192-grid is the wrong sampling in both directions. Over a 2 km bbox its step is **10.47 m** on ~13 m posting — interpolation, not information. Over the `MAX_AREA_KM2 = 100` maximum it is **52.4 m**, discarding real posting `[computed]`.

### 7.3 Corridor fetch

**Yes, the calculator needs its own terrain fetch, independent of the viewer bbox.** The viewer bbox becomes purely a *display* window; devices placed outside it remain valid and are simply not drawn in 3D.

Fetch a **corridor, not a bbox**: walk the tile grid along the geodesic (tile-space DDA), take tiles intersecting a corridor of half-width `max(F1_max, one tile)`, plus a neighbourhood around each terminal.

**Cost** `[computed]`, 50 km path at z13: ~15 tiles on the line, ~45 with a one-tile skirt, against **225** for the bounding box — a 5× saving, and that saving is exactly what buys full resolution on a long link. The calculator gets its own budget (**128 tiles**) with a **named error on exceeding it** — `PATH_EXCEEDS_TILE_BUDGET` — and never the silent coarsening of `demTilesForBBox`.

New tile types needed server-side (no new client decode cost): **canopy height in Terrarium encoding** (quantisation 1/256 m ≈ 3.9 mm, irrelevant against a 2.8 m MAE, and `decodeTerrarium` already exists) and **land cover as a single-channel palette PNG** whose byte maps onto `LANDUSE_CLASSES` — the same byte the TFT2 tile already stores.

### 7.4 The privacy consequence — a written decision, not an emergent property

The non-negotiable is that no real node positions are collected, published or stored. The calculator stores nothing. But **a corridor fetch requests exactly the tiles along the user's hypothetical link**, which is a side channel a bbox fetch does not have: the tile server can infer link geometry from the request pattern.

Decision, in this order:

1. **Route through the existing collection-server cache** (`loadBytesCacheFirst`, `job/collection.ts`, already used by `generate.ts`), so repeat analysis is local and each corridor is requested at most once.
2. **Request the full tile rectangle around the corridor when it is small** (≤ 32 tiles), so the request reveals an area rather than a line.
3. **State the residual in the UI** (§6.5) for corridors that exceed that.

This is a *supporting argument* for the corpus thesis, not a problem with it: once tiles are fetched by content hash from a blossom host that serves everyone the same bytes, the request pattern is the only thing left to leak, and (1) and (2) bound it.

---

## 8. VERIFICATION

**A propagation model with no reference cases is untrustworthy by construction.** This section is not optional and the numbers below are the acceptance criteria.

### 8.1 The transcription rule

Every constant in `@terrcvm/rf-link` must be either (a) derived in one line in a comment at the definition site, or (b) transcribed from the Recommendation text with the clause number cited. **No coefficient may be written from memory.** Evidence this matters: the MODELS reviewer's J(1) and J(2) were both wrong (13.6/19.4 vs the true 13.926/19.043) `[computed]`, and their worked link budget omitted the Bullington correction entirely, understating loss by 8.32 dB.

### 8.2 Closed-form anchors — unit tests, exact

| Quantity | Expected | Tolerance |
|---|---|---|
| FSPL constant, (m, MHz) | −27.5522 | 1e-4 |
| FSPL 868 MHz @ 1000 m | 91.22 dB | 0.01 |
| Fresnel constant (km, GHz → m) | 17.3145 | 1e-4 |
| F1 midpoint, 2 km, 868 MHz | 13.141 m | 0.001 |
| J(−0.78) | 0.000 | 1e-3 |
| J(0) | 6.033 | 1e-3 |
| J(0.5) | 10.288 | 1e-3 |
| J(1) | 13.926 | 1e-3 |
| J(2) | 19.043 | 1e-3 |
| J(3) | 22.416 | 1e-3 |
| Bulge, 10 km midpoint, k = 4/3 | 1.47 m | 0.01 |
| Bulge, 50 km midpoint, k = 4/3 | 36.8 m | 0.1 |
| Two-ray breakpoint, 2/2 m, 868 MHz | 46.3 m | 0.1 |
| Plane-earth 1 km, 2/2 m, 868 MHz | 107.96 dB | 0.01 |
| k for dN/dh = −39.25 N/km | 1.3333 | 1e-4 |
| Collinear integrator, N = 1 → gain / HPBW (§5.6.1) | 2.15 dBi / 77.9° | 0.01 / 0.1 |
| Aperture identity, θ₃(29 dBi) (§5.6.1) | 5.98° | 0.01 |
| Aperture identity constant, `θ₃·10^(G/20)` | 168.6 | 0.1 |
| F.699 near-axis identity, `12(φ/θ₃)² − 2.5e-3(Dφ/λ)²` at `D/λ·θ₃ = 40√3` | 0.000 dB | 1e-9 |
| Aim tolerance constant, `θ_T·10^(G/20)/√T` (§5.6.7) | 34.42 | 0.01 |
| Dual-pol roll invariance: singular values of `X·R(α)` for α ∈ {0°, 45°, 90°} | identical | 1e-9 |

### 8.3 The reference link (pin the whole chain)

The §1.9 case: 868 MHz, 2 km, ridge at midpoint 5 m above LOS, k = 4/3.

| Stage | Expected `[computed]` |
|---|---|
| ν_b | 0.538 |
| J(ν_b) | 10.59 dB |
| L_bull | 18.91 dB |
| L_fs | 97.24 dB |
| P_rx | −90.85 dBm |
| Margin (LongFast, −131.0) | +40.15 dB |
| Margin interval, σ = 14.31 m differential | **[30.01, 59.06] dB** → verdict `robust` |
| Margin interval, σ = 1.5 m differential | **[38.6, 41.9] dB** |
| Clearance verdict, σ = 14.31 m at 868 MHz / 2 km | **`DEM_TOO_COARSE_FOR_CLEARANCE`** (threshold 6.59 km) |

### 8.4 Published test vectors

- **ITU-R P.452 / P.1812 validation data.** `eeveetza/p1812` is the ITU-R WP3K-approved reference implementation and ships validation examples. delta-Bullington is *shared* between P.452-18 Att. 4 and P.1812-8 Att. 4, so a P.1812 validation case with `R = 0` and the statistical terms disabled exercises this implementation's diffraction core directly. **This is the primary external check.** Port the diffraction-only subset of those vectors into the test suite as golden files.
- **P.526 rounded-obstacle and single-edge worked examples** from the Recommendation text.
- Once `L_sph` is transcribed, its own P.526 §3.2 worked examples.

### 8.5 Cross-checks that prove less than they look like they do

**SPLAT! and Meshtastic Site Planner both run ITM/ITWOM, a different model with different semantics.** Agreement is not expected and disagreement proves nothing about either. Use them only as an order-of-magnitude sanity check on a handful of real paths, **record the disagreement in the test fixture as data, and never tune toward it.** Tuning delta-Bullington to match ITM would produce a model that is neither.

Google Earth Pro is a usable independent check on *geometry only* (does that ridge intersect the line) on paths where its photogrammetric buildings exist — again a sanity check, not a reference.

### 8.6 Structural and invariance tests — these catch the real bugs

| Test | Assertion | Bug it catches |
|---|---|---|
| **Uniform-offset invariance** | Add a constant to the *entire* profile including both terminal ground heights → margin must not move | The §4.2 correlated-noise bug: white-noise perturbation would falsely report zero uncertainty |
| **Differential sensitivity** | Add +σ to the interior only → margin must decrease monotonically | Perturbation applied to the wrong array |
| **Reciprocity** | `L_path(A→B) == L_path(B→A)` to 1e-9; margins differ only by the gain/sensitivity ledger | Asymmetric profile indexing |
| **Monotonicity** | J(ν) monotone non-decreasing; margin monotone non-increasing in obstacle height | Sign error in ν |
| **Degenerate LOS** | Flat earth, both terminals at 10 m, 1 km → L_d = 0 | Bullington case selection |
| **Clutter at terminals** | `R` forced to 0 at samples 0 and n−1 | The `g(1)=h(1)` rule silently dropped |
| **Missing tile** | Profile crossing an unloaded tile → `PATH_LEAVES_LOADED_CORRIDOR`, never a 0 m sample | `heightfield.ts` `return 0` leaking into RF |
| **Undeclared σ** | A source without `verticalUncertaintyM` throws at registry construction | The gate being bypassable |
| **Exaggeration leak** | Any RF code path reading `TerrainMesh.positions` fails a lint/import rule | §7.2 reason 1 |
| **Provenance table** | A class→clutter row without a provenance tag throws at module load | Invented numbers becoming indistinguishable from cited ones |
| **Oversampling refusal** | Spacing request below `max(nativeResolutionM, 10)` → `PROFILE_UNDERSAMPLED` | Manufactured diffraction |
| **Golden profile** | One recorded real profile (Funchal or South Tyrol) pinned byte-exact, in the style of the existing TFT2 golden-bytes pin | Silent numerical drift |

### 8.7 The honest-claims test

A snapshot test on the rendered result asserting that (a) no margin number appears anywhere in the DOM for a refused link, (b) the provenance histogram is present on every `ok` result, and (c) the ±8–12 dB total-uncertainty statement is present in the panel, not only in the docs.

---

## 9. SCOPE CUT — what v1 does NOT do

The owner is one person and has just chosen "close the corpus loop" as the near-term target. This feature is the version *after* that, and after the bare-earth DEM migration. Cut aggressively.

| Cut | Reason |
|---|---|
| **Ship before GEDTM30 is the base layer** | §0.2: on Terrarium the flagship 868 MHz case is inside the refusal band. Shipping a tool that refuses its primary user is worse than not shipping |
| **Coverage heatmaps / viewshed / point-to-area** | Meshtastic Site Planner does this better, free, today. Point-to-point only. Area is N² profiles and a different UI |
| **Full ITU-R P.1812 statistics** — time %, location %, ΔN/β₀ | Requires megabytes of gridded radio-climate data and a chosen percentile. Not available offline; picking one is invention |
| **ITM / Longley-Rice as a second model** | Different semantics, 1000 lines of hostile Fortran-derived branching, and it answers a different question |
| **Vegetation attenuation (P.833)** | Double-counts against canopy-in-`R`. Needs species/LAI/leaf-state we cannot measure |
| **Terminal clutter loss (P.2108)** | Statistical; requires choosing a location percentile. Reported as unmodelled with a magnitude band instead |
| **Antenna radiation pattern *data*** | Still cut, and better justified after the 2026-08-02 review. No pattern file is obtainable for the flagship device family under a redistributable licence (§5.6.5); for a *dish* there is additionally no file worth having, because two datasheet numbers reproduce the main lobe exactly (§5.6.1). **The elevation term is not cut** — §5.6 computes `elevAngleDeg` and `requiredTiltDeg` on every link at zero byte cost, applies the cut where the radiating structure is declared (`array-model`, and now `aperture-model`), and otherwise reports a magnitude band with `ANTENNA_ELEVATION_UNMODELLED` |
| **Azimuth mispointing as a loss term** | Cut as a *loss*; **promoted to v1 as an aiming instruction**. Modelling a mispointing the tool cannot observe would be invention. But §5.6.4's anti-correlation, which licenses cutting the elevation term for omnis, **sign-reverses for mis-aim on a dish** — the loss is independent of link geometry while the margin shrinks with distance, so it is worst where margin is smallest. v1 therefore still *assumes* boresight aiming in the budget, and additionally emits §5.6.7's `AntennaAiming` block (true and magnetic bearing, required tilt, tolerance, footprint) so the assumption is one the installer can actually satisfy. Cost: ~1 kB of public-domain WMM coefficients and one uint8 per antenna |
| **Polarisation as a dB term** | Cut, and the previously planned v2 form was **wrong**: `POLARISATION_MISMATCH` with a 5–20 dB band would fire on dual-polarised 2×2 hardware where the true value is 0.0 dB, because mechanical roll is orthogonal and the singular values of the channel do not depend on it (§5.6.7). Replaced by a `dualPol: boolean` on `AntennaOption` and a dual-pol↔single-pol **pairing** warning (rank 1, half rate, no path loss). XPD-based interference rejection stays unmodelled and named, as P.2108 is |
| **60 GHz / mmWave** | Oxygen absorption and rain fade are first-order there. Either model them or refuse — v1 refuses via `FREQUENCY_OUT_OF_MODEL_RANGE` |
| **BLE as a predictable link** | Always `CLUTTER_LIMITED`: walls, bodies and 2.4 GHz noise dominate, and terrain is never the binding constraint. Kept in the catalogue only so the tool can say that |
| **Multi-hop routing, route metrics, mesh topology optimisation** | FIPS has no geographic concept; inventing a routing metric is a research project, not a calculator feature |
| **Saving, sharing, exporting or syncing device layouts** | Deliberate. The privacy property is that placements never leave the tab. A "share this plan" link would design it away |
| **LoRaWAN gateway viewshed rendering** | `starTopology` flag is defined; the viewshed render it implies is point-to-area — cut with point-to-area |
| **Mapterhorn as a base layer** | Opt-in resolution upgrade on classified-DTM footprints only, and the ~134-row classification table is a prerequisite, not a v1 deliverable. Ship with GEDTM30 + the eight existing national DTMs |
| **Meta 1 m canopy** | ETH 10 m CC BY 4.0 is enough for v1 and is a smaller transcode. Meta v2 is a later upgrade |
| **Transhorizon paths** | Gated behind `SPHERICAL_TERM_UNAVAILABLE` until `L_sph` is transcribed from P.526-16 §3.2. A stubbed zero would under-predict loss on exactly the paths users care most about |
| **WiFi clearance outside a national-LiDAR footprint** | Added 2026-08-02. Not a cut of the WiFi *devices* — they stay in §5.3 — but of the expectation. Gate 1 scales linearly in frequency, so on GEDTM30 the tool refuses 2.4 GHz below 10.16 km and 5.8 GHz below 24.57 km (§0.2). WiFi is answerable on `at-bev-dtm-1m` and the seven other registered national DTMs and nowhere else, and only where the limiting obstacle is terrain or canopy rather than a modelled building (§4.3). The panel says this before the second node is placed |
| **Any measurement or telemetry pipeline — crowdsourced, FIPS-derived or otherwise** | Added 2026-08-02, adjudicated at length in §3.5. Two-way fixed effects over a multi-link mesh *does* escape the rank deficiency that killed crowdsourced LoRa, and observed loss counters *do* convert success-only truncation into identified censoring. Both escapes are real and neither produces a **transferable** clutter model — what fixed effects absorb they provably cannot decompose, so a mesh calibrates itself and exports nothing. Add to that: FIPS has no radio transport shipping, most community meshes are trees (residual dof 0), WiFi loss conflates propagation with contention, and RSSI is a vendor-defined monotonic scale with uncharacterised AGC nonlinearity at the noise floor. §3.5 records the trigger that would reopen it |
| **Any change to `apps/napplet`** | The napplet is the frozen demo. This lands in the mapplet |

### 9.1 Ordered build sequence

1. `packages/rf-link` — `fspl.ts`, `fresnel.ts`, `curvature.ts` + §8.2 anchors. Pure arithmetic, no dependencies, testable on day one.
2. `diffraction.ts` — J(ν), Bullington, delta-Bullington (LOS case only) + §8.3 reference link.
3. `budget.ts` — the ledger as an array of named terms.
4. `uncertainty.ts` — the 12-run bracket + §8.6 invariance tests. **The uniform-offset test must pass before anything renders.**
5. `gates.ts` + `LinkError` union; `verticalUncertaintyM` added to `ElevationSource` with enforcement.
6. `catalogue/` — devices, modes, caps, sources, all interned. Includes `hpbwVDeg` (datasheet where published, §5.6.1 identity otherwise) and the `dualPol` bit.
6a. `aiming.ts` — §5.6.7's `AntennaAiming` block: bearing, WMM declination, tilt, tolerance, footprint. Pure arithmetic over the geodesic already walked in step 7, plus a ~1 kB coefficient table. **Independent of everything above it and shippable on its own** — it needs no DEM quality, no diffraction chain and no verdict, which makes it the only part of this feature that is useful before GEDTM30 lands.
7. `terrain-engine/src/rf-adapter.ts` — geodesic walk, corridor tile selection, `ObstructionSample` assembly, provenance histogram.
8. Mapplet: profile chart first, 3D placement second. The chart is the deliverable; 3D placement without a chart is a demo, not a tool.
9. `L_sph` transcription; unlock transhorizon.

---

## Sources

- ITU-R **P.526-16** (11/2025) Propagation by diffraction — J(ν) §4.1, Bullington §4.5.3, spherical-earth §3.2
- ITU-R **P.452-18** (10/2023) Att. 4 — delta-Bullington construction and the empirical correction
- ITU-R **P.1812-8** (09/2025) Att. 4 — same diffraction core; §Att.4 for `g = h + R`; clutter types Ct 1–5
- ITU-R **P.530-18** §2.2 — 0.6·F1 clearance criterion, k values
- ITU-R **P.525-4** — free-space loss; **P.453** — refractivity gradient; **P.527-6** — ground constants
- ITU-R **P.833-10**, **P.2108-1** — the two models deliberately *not* implemented in v1
- ITU-R **F.699-8** §3 — point-to-point aperture reference pattern: near-axis `2.5×10⁻³(Dφ/λ)²` (≡ `12(φ/θ₃)²`, §5.6.1) and the sidelobe envelope beyond `φ_m`; **F.1245-3** as the averaged sibling; **F.1336-5** already cited in §5.6.1 as the omni/sectoral reference
- **NOAA/NCEI World Magnetic Model** (WMM2025) — public domain coefficient set, ~1 kB, for the magnetic bearing of §5.6.7
- `eeveetza/p1812` — ITU-R WP3K reference implementation; `matlab/tl_p1812.m` for `g = h + R; g(1)=h(1); g(end)=h(end)`
- arXiv **2501.11708** — Estimating Rural Path Loss with ITU-R P.1812-7: RMSE 7.4–17.8 dB; higher-resolution clutter not consistently better
- SciELO JMOe — Choosing Clutter Heights in ITU-R P.1812 for LoRaWAN: per-point 9.63 dB MAE vs single-height 7.55 dB
- **GEDTM30** — PeerJ 19673, Zenodo 14900181, Codeberg openlandmap/GEDTM30; CC BY 4.0; 10.69 m RMSE / 7.77 m std vs GNSS
- **ETH Global Canopy Height 2020** (Lang et al., Nat Ecol Evol 2023), CC BY 4.0 · **Meta/WRI HRCHM v2**, CC BY 4.0 · **ESA WorldCover**, CC BY 4.0
- **Mapterhorn** `source-catalog/*/metadata.json`, `pipelines/attribution.py`, `pipelines/source_polygonize.py` — verified: no DTM/DSM field, flat global attribution, `glo30` = COPERNICUS GLO-30 DSM undeclared
- **Overture** buildings + **GHS-OBAT** heights (CC BY 4.0, MAE 2.89 m)
- Meshtastic — Radio Settings (modem preset budgets), LoRa Configuration (region caps), Site Planner, Antennas, Station Series
- Semtech SX1262 / SX1276 / SX1302 datasheets · Heltec V3 · RAK4631 · LILYGO T-Beam · nRF52840 PS
- Ubiquiti PowerBeam 5AC 620, LiteBeam 5AC Gen2 tech specs
- ETSI **EN 300 220-2 V3.2.1** · 47 CFR **§15.247**, **§97.313** · Bundesnetzagentur · Ofcom
- Competitive survey: SPLAT! (KD2BD), Meshtastic Site Planner, Radio Mobile, CloudRF, Ubiquiti airLink, Cambium LINKPlanner, TowerCoverage, GridVisio, HeyWhatsThat, Solwise, WebRF, Google Earth Pro, Sionna RT
- Community-wireless survey (2026-08-02, §0.1): `guifi/drupal-guifi` `guifi_node.inc.php` (the HeyWhatsThat `<img src>`), HeyWhatsThat tech FAQ (SRTM 3-arcsec outside the USA, no interpolation), AREDN *Network Modeling* and the airLink-vs-Radio-Mobile forum thread, Freifunk `Planungstools` and Freifunk-Franken `Richtfunk`, `meshcenter/line-of-sight` (NYC DOITT 3D building model, 2014), NYC Mesh member-troubleshooting guide, AWMN/WiND, ICGC 2×2 m terrain elevation model (CC BY)
- FIPS (`github.com/jmcorgan/fips`, v0.5.0-dev) — `docs/design/fips-mmp.md`, `docs/reference/wire-formats.md`, `src/transport/{mod.rs,ethernet/*,types.rs}`, `src/proto/mmp/wire.rs`. Read for §3.5; **no radio transport, `TransportType::WIFI` declared and unused**
- This repo: `packages/terrain-engine/src/terrain/{heightfield,mesh,dem,elevation-sources}.ts`, `src/buildings/ground.ts`, `src/features/types.ts`, `src/config/defaults.ts`, `apps/napplet/src/terrain/generate.ts`
