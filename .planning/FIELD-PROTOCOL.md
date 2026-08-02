# Field Protocol — measuring the two parameters MESH-CALCULATOR.md cut

**Defined:** 2026-08-02
**Status:** specified, unrun. Gated on the pilot in §7. Do not run the 20-person day before the pilot passes.
**Measures:** the two parameter classes cut in MESH-CALCULATOR.md §1.1 — per-class vegetation attenuation (P.833 `γ`, `A_m`) and terminal clutter (P.2108) — plus the `project-assumption` rows of §2.4 (`R` in metres).
**Produces:** raw observables only. No excess loss, no path loss, no distance, no margin. Every derived quantity is a function of `terrain_version × code_version` and is regenerated, never stored.

**Provenance tags:** `[ITU]` recommendation text · `[firmware]` read from Meshtastic source this session · `[measured]` this project's own measurement · `[computed]` derived and numerically checked while writing this document · `[published]` peer-reviewed or standards-body · `[vendor]` · `[community]` · `[assumption]` invented here, deliberately visible.

---

## 0. IS THE RIG WORKABLE

**Yes, with one fix, and Meshtastic already does most of it.** The **Range Test module** is the beacon: it emits a monotonic sequence number and sets `p->hop_limit = 0` `[firmware, RangeTestModule.cpp:119]`, so range-test packets are never rebroadcast — which makes relay contamination *structurally impossible* rather than a filter someone must remember, and that single property is worth more than everything else in this document. **The one fix is `position_precision = 32` on the campaign channel** — the firmware default of 13 truncates every position on air to **±2.9 km** `[firmware, Channels.cpp:139]`, silently, with no symptom visible in any export.

So the effort is *configure a module*, not *build a logger*.

### 0.1 The uncomfortable part first — the campaign is identifiable only inside a geographic restriction

The clutter effect being measured is ~5–20 dB. The terrain model's own error, propagated through the spec's governing ratio `dJ/dh ≈ 9.130/F1` `[computed, §3.1]`, at 868 MHz / 2 km (F1 = 13.141 m, dJ/dh = 0.6948 dB/m):

| DEM under the campaign | σ | Terrain error, in dB, per observation | Verdict |
|---|---:|---:|---|
| `at-bev-dtm-1m` (BEV ALS, CC-BY-4.0, nationwide AT) | 0.15–0.5 m `[vendor]` | **0.10–0.35 dB** `[computed]` | negligible — the experiment is identifiable |
| GEDTM30 | 10.69 m `[published]` | **7.43 dB** `[computed]` | same size as the effect — unidentifiable |
| Terrarium | 14.31 m `[measured]` | **9.94 dB** `[computed]` | larger than the effect — unidentifiable |

**Outside a ≤0.5 m DTM footprint this campaign cannot work, at any sample size.** No statistical design removes a confound that is the same magnitude as the signal. The whole campaign runs inside `at-bev-dtm-1m` coverage — 9.53–17.17 E, 46.37–49.02 N (`packages/terrain-engine/src/terrain/elevation-sources.ts`, `AUSTRIA_DTM_1M`) — or it does not run.

Pleasant consequence for the raw-observables rule: the campaign is measured against terrain *better than the GEDTM30 upgrade will deliver*, so the dataset does not merely survive the terrain migration, it outlives it.

### 0.2 What is actually being fitted — and it is not "dB per class"

MESH-CALCULATOR.md's model has **no per-class excess-loss-in-dB term.** Clutter enters as `R`, a height in metres, via `obstructionM[i] = groundM[i] + clutterM[i]` (§2.1). Two estimands, geometrically distinct, **never pooled**:

| Regime | Condition (assigned in analysis, from DTM + canopy raster + recorded AGL — never a field judgement) | Fitted | Replaces |
|---|---|---|---|
| **over-canopy** | LOS line clears canopy top, or within ±F1 of it | `R` (metres) | the `project-assumption` rows of §2.4 |
| **through-canopy** | both terminals below canopy top, path traverses the stand | `γ` (dB/m), `A_m` (dB), P.833 form | the term §1.1 cut entirely — *and the bias §1.1 admits by name* |
| **terminal clutter** | receiver inside mapped clutter, measured against an open reference | one constant per environment class | the P.2108 percentile §1.1 refused to pick |

The third is the highest-value output: it converts *"pick a percentile, which is invention"* into *"measured, Austrian montane forest, leaf-on, 2 m AGL, n = N"*.

---

## 1. THE ERROR BUDGET, RANKED

Every row is why some later section exists. λ = 0.3454 m at 868 MHz throughout.

| # | Term | Uncontrolled σ | Controlled σ | Class | Mechanism / provenance |
|---:|---|---:|---:|---|---|
| 1 | **Body proximity** | 4–10 dB | 0.5 dB | **CONTROL** | ~10 dB through a human at 900 MHz; 6 dB wrist-vs-chest at 868 MHz `[published]`. Spec's own `bodyLossDb` is 3–10 dB and §5.3 says it "dominates everything terrain computes". Deleted by a pole + 3 m of separation. |
| 2 | **Single-sample multipath** | 5.57 dB | 0.73 dB | **CONTROL** | σ of one Rayleigh sample = 5.57 dB; σ of the mean of N = `(10/ln10)·√trigamma(N)`, N=36 → **0.729 dB** `[computed]`. Requires N *spatially* independent samples (§5). |
| 3 | **Mount / ground plane** | ~5 dB | 1.0 dB | **CONTROL** | Monopole peak gain 1.79 dBi at 0.14 λ ground plane → 6.70 dBi at 5.78 λ `[published]`. A stock 868 whip has 0.15–0.20 λ `[spec §5.3]`. Systematic, not random — identical rigs put it in the intercept. |
| 4 | **Height error** | 2–6 dB | 0.9 dB | **CONTROL** | Two-ray: `dL/dh = 8.686/h` dB/m, **distance-independent**. At h = 2.0 m → **4.34 dB/m** `[computed]`. Recording 2.0 m when it was 1.6 m costs 1.94 dB *per end*. Breakpoint `4h_t h_r/λ` = 46.3 m `[computed, spec §1.1]`, so every field link is in this regime. |
| 5 | **Terrain model error** | 9.94 dB (Terrarium) | 0.10–0.35 dB | **CONTROL** | §0.1. Controlled by geography, not statistics. |
| 6 | **Differential antenna tilt** | ~2 dB | 0.3 dB | **CONTROL** | `L = −20log₁₀(cos θ)` on the *differential* tilt: 15° → 0.30 dB, 30° → 1.25 dB, 45° → 3.01 dB `[computed]`. Saturates at real XPD (10–20 dB), not infinity. A bubble level, not a gimbal. |
| 7 | **Device + antenna unit spread** | ~2 dB | 0.5 dB | **RECORD** | TX 21 ± 1 dBm `[vendor, spec §5.3]`; RX `sensToleranceDb` ± 3 dB `[spec §5.2]`; antenna VSWR 1.5→3.6 = 0.18→1.68 dB mismatch, one part at 8:1 = 4.03 dB `[community]`. All *constant per rig* → per-operator random intercept (§6). |
| 8 | **Seasonal / leaf state** | ~2 dB | ~2 dB | **RECORD** | P.833-10: Mulhouse 900–2200 MHz, 15 m trees, **seasonal variation 2 dB at 900 MHz, 8.5 dB at 2200 MHz** `[ITU]`; in-leaf specific attenuation ~20 % greater than leafless at ~1 GHz `[ITU]`. **The 8–10 dB seasonal fear is a 2.2 GHz phenomenon.** Irreducible, small, and a covariate — not a scheduling constraint. |
| 9 | **Position error (GNSS)** | <0.1 dB | <0.1 dB | **IGNORE for dB · RECORD for class** | Along-path: `dL_fs/dd = 8.686/d`, 5 m at 2 km = **0.022 dB** `[computed]`. The real cost is *class misassignment* against a 10 m canopy raster — a wrong-row error, not a dB error, and it blends exactly the constants being separated. |
| 10 | Rain at 868 MHz | <0.1 dB | — | **IGNORE** | `[ITU]` |
| 11 | Along-path distance error | 0.02 dB | — | **IGNORE** | `[computed]`, row 9 |

**Totals** `[computed]`, against the P.833 Mulhouse campaign's own residual scatter of **8.7 dB** `[ITU]` — the floor a good campaign approaches, not a number to beat:

| Execution | Added σ (RSS) | Total σ | n per class at ±3 dB / 95 % |
|---|---:|---:|---:|
| **Uncontrolled** — handheld, ad-hoc mount, guessed height, one packet, Terrarium | 14.7 dB | **17.1 dB** | **125** |
| **Controlled** — pole, marked height, 36-sample spatial mean, identical rigs, BEV 1 m DTM | 2.6 dB | **9.09 dB** | **35** |

`n = (1.96σ/3)²`. **Because n scales as σ², every avoidable decibel costs measurements quadratically.** §8 turns these two numbers into the campaign's honest yield.

### 1.1 Four switches that are not σ terms at all

Binary. They do not degrade the fit — they invalidate it, silently, with no signature in the data.

| Switch | Wrong value does | Defence |
|---|---|---|
| **Relayed packet counted as a link measurement** | `rx_rssi`/`rx_snr` describe the *last hop*. A plausible number for a path nobody measured. | Range Test sets `hop_limit = 0` `[firmware]`. **Additionally** reject any record with `hop_start − hop_limit ≠ 0`. Belt and braces, because this is the only failure that produces a confident wrong answer. |
| **`position_precision < 32`** | ±2.9 km at the default 13; ±365 m at 16 `[firmware]`. Applied to phone-supplied positions too `[firmware, PositionModule.cpp:118]`. | Set 32. **Audit it in the data** — `Position.precision_bits` (field 23) rides in every position packet. |
| **Public MQTT broker** | Public server filters to imprecise positions (10–16 bits) — strips the field being measured. | Campaign does not use MQTT at all (§3.4). If it ever does: private broker only. |
| **Unverified null** | A dead receive chain reads identically to a refused link, and biases the fit optimistic by exactly the quantity being measured. | Loopback transmitter, both ends of every window (§5). |

---

## 2. THE RIG

Identical for every operator. This is what makes the per-operator intercept a *constant* rather than a nuisance process.

### 2.1 Beacon site — one per campaign sector, operator-run

| Item | Spec | Reason |
|---|---|---|
| Nodes | **2 × identical ESP32 SX1262 (Heltec V3 class)** on one mast | Two TX powers = a 2-level amplitude ladder for the tail (§4.2). Identical boards so the *step* is exact even though the absolute is not. |
| Antenna | one model, campaign-wide, vertical, ≥1 m clear of the mast | |
| Height | fixed, tape-measured, recorded once, never moved | |
| TX power | **beacon A = 20 dBm, beacon B = 7 dBm** (`lora.tx_power`, conducted) | Both **below** the SX1262 PA-boost clamp of 22 dBm, so `limitPower()` does not clamp either and the 13 dB step is exact. `config.lora.tx_power` reads back 27 on EU868 while the chip emits 22 `[firmware]` — the absolute is a lie, the difference is not. |
| Preset | **LongFast** (SF11/BW250/CR4-5), campaign-wide, never changed | `sens = −131.0 dBm` `[derived, spec §5.3]` |
| Band | **`etsi-868-g3`**, 869.4–869.65 MHz, 27 dBm ERP, **10 % duty** `[spec §5.4]` | `etsi-868-g1` at 1 % forces ≥60 s intervals and makes the sample count unreachable in a day. |
| Interval | `range_test.sender = 15` on each, **coprime offsets** | Airtime ≈ **0.41–0.45 s** `[computed]`; 0.45/15 = **3.0 % per transmitter**, 6.0 % combined. Coprime start offsets so the two do not phase-lock into repeated collisions and manufacture a fake loss rate. |
| Runtime | **Range Test sender auto-disables after 8 h** `[firmware, 28800000 ms]` | Restart at the mid-day break. Put it on the checklist or the afternoon is silent. |

**Sanity property, free:** at a strong site a receiver hears both beacons 13 dB apart. That is a per-site linearity check on that receiver's RSSI, at zero cost. **Hearing B but not A is physically impossible** — flag any such record as a data-integrity fault, not a measurement.

### 2.2 Field rig — every operator, identical

| Item | Spec | Reason |
|---|---|---|
| Receiver node | **ESP32 SX1262, same model and antenna as the beacons**, `range_test.save = true` | Logs to on-device flash. **nRF52 (RAK4631) cannot save the CSV** `[firmware]` — an all-ESP32 fleet is a hard requirement. |
| Mount | **4 m telescopic fibreglass/wood pole**, node cable-tied at a **painted mark at 2.00 m** | The pole *is* the tape measure. Height stops being measured and becomes a constant. Row 4 of §1 is worth ~4 dB. |
| Antenna | vertical, **bubble level, ±10°** | Row 6. |
| Ground plane | node clamped to the pole, no metal within 0.5 m, pole foot on soil | Row 3. A metal pole is the worst case — a counterpoise of uncontrolled length. |
| Operator | **≥3 m from the pole, off the beacon bearing, for the entire window.** Do not touch the node once the window opens. | Row 1, the largest term in the budget. "Hold it naturally" is how this campaign fails. |
| Loopback node | second node in the backpack, **TX at minimum power**, ~5 m away | §5 step 3. Proves the receive chain is live *at that site, at that moment*. |
| Phone | Pixel or any Android running the stock Meshtastic app, **paired by BLE at session start to set the node RTC**, then left in a pocket | Sets `RTCQualityNTP` on the node; without it a bare ESP32 reports `RTCQualityNone` and writes `??:??:??` `[firmware, RTC.h]`. Timestamps are diagnostic only (§6.3), so this is hygiene, not load-bearing. |
| Form | printed card, one per site, **including sites where nothing is heard** | §4. |

### 2.3 One-time node configuration — every device, read back, signed off

```bash
meshtastic --ch-index 0 --ch-set module_settings.position_precision 32   # §1.1 switch 2
meshtastic --ch-index 0 --ch-set uplink_enabled false                    # no MQTT, ever
meshtastic --set lora.use_preset true --set lora.modem_preset LONG_FAST
meshtastic --set lora.tx_power 20          # beacons: A=20, B=7. Receivers: irrelevant, set 20.
meshtastic --set range_test.enabled true
meshtastic --set range_test.sender 15      # BEACONS ONLY. Receivers: sender 0.
meshtastic --set range_test.save true      # RECEIVERS. ESP32 only.
meshtastic --set position.position_broadcast_secs 30
meshtastic --set telemetry.device_update_interval 60   # LocalStats.noise_floor
```

Then, **per physical device, stored beside the data**:

```bash
meshtastic --info | tee device_<serial>_config.txt
```
plus the boot-log line `"Final Tx power: %d dBm"` — the chip setting after every clamp, and the only honest statement of radiated power obtainable `[firmware]`. Two boards of the same model differ.

### 2.4 Why not Termux, MQTT, or a custom app

| Path | Verdict |
|---|---|
| **Range Test → on-device `rangetest.csv`** | **The campaign path.** Zero per-measurement human action, survives a dead phone, no Termux, no broker, no network. |
| Termux + Mosquitto + MQTT client proxy → JSONL | Best data on a phone; ~3–5 h to build; **~20 volunteer phones will not survive Android battery optimisation for 6 h**. Keep it for the pilot and the beacon site, not the fleet. |
| Laptop + USB serial + `meshtastic-python` | Best data, full stop. **Beacon site only** — mains power, not field-portable. |
| Android app "Export data" CSV | **No RSSI at all** `[firmware/app]`. Fatal alone. |
| Purpose-built Android app | The AIDL IPC surface is **gone** as of v2.8.0 — `onBind` returns `null`, service `exported="false"` `[firmware/app]`. Would mean a BLE GATT + protobuf client from scratch, 3–5 days, and it would lock out the stock app (one global `toPhoneQueue`, dequeued — two clients steal from each other `[firmware, MeshService.h:46]`). **Do not start here.** |

**`rangetest.csv` has one defect and the ingest must know it.** RSSI is written *after* the row terminator `[firmware, RangeTestModule.cpp:300-301]` — `printf("\"%s\"\n", payload)` then `printf("%i,", rx_rssi)`. Every data line is therefore `<previous packet's rssi>,HH:MM:SS,from,…`. Row 1 has no leading RSSI; the file ends with a dangling `<rssi>,`. **The parser shifts the leading field back to the preceding row.** Write it once, test it against a known file, never hand-edit. Flash headroom: ~120 B/row × 36 packets × 2 beacons × 12 sites ≈ **104 kB/day** `[computed]` — fits SPIFFS.

---

## 3. THE FIELD SHEET

Raw observables only. Nothing on this sheet is computed against a terrain model.

### 3.1 Per site visit — the paper form (one per site, **including nulls**)

| Field | Units | How obtained |
|---|---|---|
| `site_id` | — | **pre-assigned by the site selector (§9).** Not invented in the field. |
| `operator_id` | — | pre-assigned. The random-effect key (§6). |
| `date`, `arrival_local` | — | phone clock |
| `window_start_utc`, `window_end_utc` | ISO-8601 | phone clock, read aloud and written |
| `station_marks` | count | number of transect stations occupied (§5) |
| `loopback_open` / `loopback_close` | pass / fail | 3 packets each, **all 3 must arrive** |
| `pole_mark` | m | always 2.00. Recorded anyway, so a deviation is visible. |
| `antenna_tilt` | deg from vertical | bubble level, worst reading during the window |
| `pole_foot` | soil / rock / snow / other | free text |
| `node_serial`, `antenna_serial` | — | printed label |
| `config_hash` | — | from `--info`, §2.3 |
| `gnss_lat`, `gnss_lon`, `gnss_acc_m` | deg, m | phone, 60 s stationary average at the transect midpoint. **A check on arrival, not the site's coordinates** — those come from the selector. |
| `gnss_scatter_m` | m | stddev of the 60 s of 1 Hz fixes. Converts an unknown error into a measured one. |
| `leaf_state` | in-leaf / bare / transitional | observation |
| `precip` | dry / wet-foliage / raining | observation |
| `wind` | calm / moderate / strong | observation |
| `photos` | 6 | N, S, E, W, straight up (canopy closure), and the rig showing antenna + pole mark. Geotagged. |
| `notes` | free text | — |

**Never on the form:** excess loss, estimated range, distance, "probably blocked by the ridge", "out of range", "too far", or any judgement about *why* something was or was not heard. Cause is a model determination. Recording it in the field imports the model's assumption into its own validation data.

**"I made a mistake" is not a selectable category.** It is excluded mechanically by the loopback and the config hash, or the record is void.

### 3.2 Per received packet — from `rangetest.csv`, unmodified

| Field | Units | Source |
|---|---|---|
| `rx_rssi_dbm` | dBm, integer | `lround(lora.getRSSI())` `[firmware, SX126xInterface.cpp:347]`. 1 dB quantisation, ±0.5 dB — negligible against 8.7 dB scatter. |
| `rx_snr_db` | dB, 0.25 steps | `lora.getSNR()`. **Saturates at ~+10…+13 dB** — every strong link reads the same number. This is why RSSI is mandatory and SNR alone is unusable. |
| `seq` | integer | Range Test payload, `"seq %u"`, monotonic per sender per session `[firmware]` |
| `from` | node id | which beacon — A (20 dBm) or B (7 dBm) |
| `hop_limit`, `hop_start` | integer | must both be 0. §1.1 switch 1. |
| `rx_time` | HH:MM:SS | radio RTC. Diagnostic only. |
| `noise_floor_dbm` | dBm | `LocalStats.noise_floor`, telemetry field 15, sampled per minute |

**Both `rssi` and `snr`, always, never combined at record time.** Below the noise floor the SX1262 packet RSSI **plateaus near −100 dBm** and reports thermal noise; true received power is `RSSI + SNR` for SNR < 0. At high signal the front-end ADC **saturates and RSSI clips near 0 dBm** `[published]`. Both corrections are post-processing decisions, revisable, and applying either in the field destroys the raw observable. This is the project's raw-observables rule vindicated by silicon.

### 3.3 The negative-result form — same form, three extra fields

There is no separate null form. **A null is a submitted record, structurally identical to a positive one**, with:

| Field | Units | How obtained |
|---|---|---|
| `expected_seq_lo`, `expected_seq_hi` | integer | from the **beacon's own log**, at ingest: which seq numbers the beacon emitted between `window_start_utc` and `window_end_utc` |
| `received_seq[]` | list | from `rangetest.csv` |
| `prr_a`, `prr_b` | 0–1 | `|received| / |expected|`, per beacon. Derived at ingest, not in the field. |

`PRR = 0` is a **positive datum**, indistinguishable in the schema from `PRR = 1`. There is no such thing as an absent measurement, only a null one.

**Count forms, not rows.** A day yielding 22 forms and 19 with packets is 3 recorded negatives, not 3 failures.

**Sites with `0 < PRR < 1` are the most valuable in the campaign** — they sit on the steepest part of the likelihood. Link failure is abrupt: the transition from reliable reception to complete failure occurs within **2–4 dB** of the demodulation limit `[published]`. A partial-PRR record is a very tight constraint on path loss and is worth several clean receptions. **Operators are not told this** (§9.3).

---

## 4. WHAT ONE READING IS

### 4.1 36 spatially independent samples over 15 m — not 36 packets standing still

Two rules, both counterintuitive, both load-bearing:

1. **N packets from a stationary receiver are not N independent samples.** Static geometry = one frozen fade. Temporal averaging at a fixed position does almost nothing. Independence requires *spatial displacement*: [Lee's criterion] 36–50 samples over **20–40 λ** for ±1 dB at 90 % confidence `[published]`. At 868 MHz that is **6.9–13.8 m**.
2. **Average in linear power, never in dB.** Averaging dB values of a Rayleigh-faded signal is biased **2.51 dB low** (Euler–Mascheroni) `[computed]`. Silent, one-sided, systematic.

**One reading = 36 packets from beacon A, collected at 36 distinct positions spanning a 15 m transect (43 λ), pole held at the 2.00 m mark throughout.** At a 15 s interval that is **9 minutes** of listening, ~42 cm between consecutive positions.

15 m is short enough that the land-cover class, canopy, and DTM cell do not change (15 posts on `at-bev-dtm-1m`), and long enough to satisfy Lee. The transect *replaces* the fixed-point rosette; a 2 m rosette at 0.5 m spacing is 5.8 λ and is under Lee's minimum by a factor of four.

### 4.2 When nothing is received

The window runs its **full 9 minutes regardless.** Do not extend it. Do not move the pole off the transect looking for signal. Do not wait "just a bit longer".

The 13 dB beacon ladder converts silence into a graded observation:

| Outcome | Received power bracketed to | Handling |
|---|---|---|
| A and B both heard | two RSSI series, 13 dB apart — plus a free linearity check | continuous |
| A heard, B not | `[−131, −118] dBm` | **interval-censored** |
| Neither heard, loopback passed | `< −131 dBm` | **left-censored** |
| Neither heard, loopback failed | — | **void**. Not a null. Discard and re-do. |
| B heard, A not | — | **data-integrity fault.** Physically impossible. Investigate the rig. |

**Nulls are censored observations, not missing data.** Fit by Tobit / censored likelihood. Dropping them produces a survivorship-biased, systematically optimistic model — the exact failure MESH-CALCULATOR.md exists to refuse, arrived at through the back door of an analysis convention.

**Cut, deliberately:** the 4-level *sensitivity* ladder (ShortFast → LongSlow, −121 → −136.5 dBm) that would give finer tail censoring. Meshtastic has **no scheduled preset switching**, so it requires a beacon operator and 20 receivers changing preset in sync on a wall clock. Three people can do that; twenty cannot. The 2-level *amplitude* ladder needs no receiver-side change and no synchronisation at all. Cutting the sensitivity ladder costs precision in the tail, not validity. Revisit only if the pilot shows sync is reliable.

---

## 5. THE PROCEDURE — one site visit, ~30 minutes

1. **Navigate** to the named map feature on the route card (path junction, field corner, forest edge). **Not to bare coordinates** — under canopy the operator's GNSS is the weakest link in the chain.
2. **Extend the pole to the painted mark.** Antenna vertical, bubble level. Foot on soil, no metal within 0.5 m.
3. **Loopback: 3 packets from the backpack node at minimum power, ~5 m away. All 3 must arrive.** This proves the antenna, connector, preset, channel and receive chain are live at this site at this moment. Phone connectivity proves only that the node is alive.
4. **Walk ≥3 m away, off the beacon bearing. Do not touch the node again.**
5. **Open the window.** Note `window_start_utc`. Start the 60 s stationary GNSS average at the transect midpoint.
6. **Walk the 15 m transect at a slow constant pace over 9 minutes**, pole held at the mark, arm extended, body off the beacon bearing. ~42 cm between packets.
7. **Close the window.** Note `window_end_utc`. **Loopback again — all 3 must arrive.**
8. **Photograph:** N, S, E, W, straight up, and the rig.
9. **Fill the form. Completely. Whether or not anything was heard.**
10. Collapse the pole. Move to the next site on the card.

**End of day:** retrieve `rangetest.csv` from each node over its WiFi AP (`http://meshtastic.local/rangetest.csv`), before the next session overwrites or the retention prune fires. Hand in the forms and the photos. **The forms are the campaign; the CSV is the instrument reading.**

---

## 6. THE DIFFERENTIAL DESIGN

### 6.1 Adjudication: pairing kills bias, spatial averaging kills variance — they are not substitutes

This is where the reviewers disagreed and it matters.

| Claim | Adjudication |
|---|---|
| "Pair every obstructed site with a geometry-matched open one; the difference cancels common-mode error." | **Half right.** It cancels *bias* exactly. It **increases variance**: if σ = 8 dB with a 5 dB common-mode fraction, the independent part is 6.2 dB and the difference has σ = √2 × 6.2 = **8.8 dB — worse than the raw measurement** `[computed]`. And it halves throughput, because a pair is two site visits. |
| "Match bearing and range so the *model error* is common-mode too." | **True on a coarse DEM, and self-defeating here.** §0.1 restricts the campaign to `at-bev-dtm-1m`, where model error is 0.10–0.35 dB. **The restriction that makes the experiment identifiable also removes the reason for geometric matching.** |
| "Use a per-operator random intercept, identified by ≥3 open-ground reference links per operator." | **Correct and strictly cheaper.** It absorbs the same constants (TX, RX offset, antenna VSWR, ground plane, habitual handling) for 3 site visits per operator instead of doubling every visit. |

**Decision: per-operator-day random intercept, not 1:1 pairing.** Reason: identical bias control, ~2× the throughput, and the LiDAR restriction has already deleted the one thing pairing does that the intercept cannot.

### 6.2 The condition that makes it work, and it is not optional

The operator intercept and the class constant are **confounded if operators are not crossed with classes.** So:

> **Every operator visits sites of every class in the campaign.** Route cards interleave classes; they never give one operator one class. Without this the design collapses and no amount of data recovers it.

### 6.3 The model

```
r_i = α_o  +  f(regime, class, depth, geometry; θ)  +  u_stand  +  ε_i

r_i = y_i − μ_i      y_i = measured P_rx (dBm), linear-power mean of 36 samples
                     μ_i = engine prediction with clutter R forced to 0 — TERRAIN ONLY
α_o = per-operator-day random intercept, identified by 3 open-ground reference links
u_stand = random intercept per land-cover polygon  ← makes the design effect VISIBLE
ε_i = residual; censored contributions for PRR < 1 via the §4.2 ladder intervals
```

`u_stand` is not decoration. Without it, four sites in one wood with ρ = 0.5 give a design effect of 2.5: nominal n = 40 becomes effective n = 16, and ±3 dB is really ±4.7 dB while the spreadsheet still says ±3. **The unit of replication is the stand, not the site.**

### 6.4 Pair by identity, never by timestamp

`rx_time` is one-second granularity and the RTC quality ladder runs `None(0) → Device(1) → FromNet(2) → NTP(3) → GPS(4)` `[firmware, RTC.h]`; a bare ESP32 with no GPS and no WiFi drifts seconds-to-tens-of-seconds per day. **Join on `(site_id, beacon_node, seq)`.** Use timestamps only to bound the window and order within it. Then the clock stops mattering — which is the correct engineering answer: do not make correctness depend on a clock you cannot audit.

### 6.5 What is deliberately not measured

**Reciprocal A→B / B→A links.** Propagation is reciprocal; a reciprocal pair measures *device asymmetry*, which is calibration, not data. One beacon, all rigs listen. This also collapses TX-power-actual-vs-nominal, TX antenna gain, feed loss and mast height into a single campaign-wide constant absorbed by the intercept — the largest single simplification available, and it costs nothing the model needs.

---

## 7. THE PILOT

**3 people, one afternoon, one 5 × 5 km area inside `at-bev-dtm-1m` containing adjacent forest and open ground, beacon site public and reachable.**

The sheet being wrong is a one-day fix once discovered. The pilot's first job is the thing that cannot be obtained any other way and that invalidates the whole plan if wrong.

### 7.1 What it must discover

| # | Quantity | Determines | Currently |
|---|---|---|---|
| 1 | **σ between-site-within-class** | **n per class — the entire campaign size** | assumed 9.09 dB `[computed, §1]` |
| 2 | **ρ intra-stand** | the design effect; whether the unit is stands or sites | **completely unknown** |
| 3 | σ within-site (transect spread) | whether 36 samples over 15 m is enough | assumed 0.73 dB `[computed]` |
| 4 | **Minutes per site visit, door to door** | days × people → class count | assumed 30 min `[assumption]` |
| 5 | Does `rangetest.csv` de-shift cleanly, with RSSI, hop fields and seq intact? | whether the extraction path exists at all | untested against real hardware |
| 6 | Does the loopback catch a dead receive chain? | whether nulls are trustworthy | untested |
| 7 | Duty cycle and `etsi-868-g3` config legal as specified? | whether 15 s intervals are permitted | `[computed]`, needs field confirmation |
| 8 | GNSS scatter under canopy at a surveyed point, 20 min | whether the arrival check gate is 10 m or 25 m | assumed 5–15 m |

### 7.2 Shape

- **14 site visits across ≥8 distinct stands**, deliberately including **3 stands with 2 sites each** — this is the only way to estimate ρ.
- **A 3 × 3 Latin square**: 3 operators × 3 devices × 3 sites, so operator and device effects are separately estimable. ~9 extra observations, the highest information density in the pilot.
- **2–3 sites chosen *because* they are predicted dead.** If the pilot contains no nulls, the null protocol is untested and will fail at scale. Nulls are sought, not awaited.
- **One deliberate sabotage:** one node configured with the wrong preset, unannounced to its operator. The loopback must catch it. If it does not, §1.1 switch 4 is undefended.
- One reciprocal calibration session — every device pair both ways — to *quantify* the per-device offsets §6 assumes the intercept absorbs.

### 7.3 The pilot has failed if

| Condition | Why it is fatal |
|---|---|
| RSSI is not retrievable from `rangetest.csv` after de-shifting | there is no instrument |
| Any record shows `hop_start − hop_limit ≠ 0` | the structural guarantee is not structural; the campaign needs a filter and a re-audit |
| The sabotaged node's window is **not** voided by the loopback | nulls are untrustworthy, and nulls are the point |
| σ between-site > 12 dB | n > 62 per class; one 20-person day resolves **nothing** |
| ρ > 0.7 | design effect > 2.4; the stand count required exceeds what is reachable |
| Per-visit time > 45 min | class count drops below 2 and the campaign has no deliverable |
| Zero nulls collected | the negative-case machinery is unexercised |
| **The pilot's own 14 observations cannot be run end-to-end to produce one fitted `R` or `γ` with a confidence interval, however wide** | if the analysis cannot run on 14 it cannot run on 200, and finding that out after 20 people have given up a Saturday is the expensive way to learn it |

**Any one of these → fix and re-pilot. Do not scale a pipeline that has not produced an answer.**

---

## 8. THE HONEST YIELD

Arithmetic, stated so it can be argued with.

| | |
|---|---:|
| 20 people × 1 day × 6 productive hours | 120 h |
| Per site visit (§5, incl. inter-site travel) | 30 min `[assumption — pilot item 4]` |
| Nominal site visits | 240 |
| Less 3 open-ground reference links per operator (§6.1) | −60 → 180 |
| Volunteer attrition — wrong config, void loopback, site inaccessible, form not filled — 35 % | **117 usable** `[assumption]` |
| n per class at σ = 9.09 dB, ±3 dB / 95 % | 35 |
| × design effect 1.5 (2 sites/stand, ρ = 0.5) | **53 visits per class** |
| **Classes resolvable** | **2.2** |

**Therefore: two classes. Not six.** `forest` (both regimes, assigned in analysis) and `residential` — the ITU suburban default of R = 10 m and the most common real deployment environment. A 2-day campaign gets three.

Attempting 6 classes at ~19 visits each gives every class a CI of about ±4.9 dB — which cannot distinguish `scrub` (R = 3 m) from `orchard` (R = 4 m), **the exact pair of `project-assumption` values the campaign exists to replace**. That campaign costs the same and answers nothing.

**And executed uncontrolled — handheld, guessed height, one packet per site, on Terrarium — σ = 17.1 dB and n = 125 per class. 117 usable observations does not resolve even one.** Twenty person-days, nothing. That is the whole argument for §2 and §5 in two numbers.

**The binding constraint is not measurements — it is distinct stands.** 53 visits per class over ≥27 distinct land-cover polygons, all inside the BEV footprint, all publicly accessible, all with a pairable geometry. Whether 27 such forest stands exist within the volunteers' travel radius is a **question for the site selector (§9), answered before anyone is recruited.**

---

## 9. SITE SELECTION

**Yes, algorithmically, from the corpus this project already holds.** Everything needed exists: the profile sampler and corridor fetch (spec §2.6, §7.3), the 15 `LANDUSE_CLASSES` (`packages/terrain-engine/src/features/types.ts:64`), building footprints with `heightM` on the TFT2 tile, canopy rasters, `at-bev-dtm-1m`, and the delta-Bullington engine itself. The selector is a few hundred lines reusing the calculator, not a new pipeline.

### 9.1 Algorithm

1. **Hard mask** — inside `at-bev-dtm-1m` coverage; within travel radius of the volunteer base; publicly accessible (OSM paths/tracks/public land, reject `access=private`). **Accessibility is a hard constraint that otherwise wrecks the realised design at step 10 of a route card.**
2. **Beacon siting** — high, open, public, mains or solar, reachable, one per sector.
3. **Candidate grid** — 50 m lattice of receiver sites in range.
4. **Per-candidate covariates, all from data already held** — distance; bearing; elevation angle; fraction of path in each landuse class; **metres of path inside forest polygons** (the P.833 depth variable); **LOS clearance above canopy top** (the §0.2 regime classifier); ν at the Bullington point; the spec §4.2 12-run predicted margin interval; local terrain slope.
5. **Filters:**
   - **Purity** — reject unless ≥80 % of the path is one class. Mixed paths are unattributable.
   - **Range** — **0.8–2.5 km.** Short enough for path purity; long enough that F1 (9.3 m at 1 km, 13.1 m at 2 km) is comparable to canopy height, putting ν in the well-conditioned 0.5–2 range. At 2 km / 15 m canopy / 2 m terminals, `dL_bull/dR = 0.634 dB/m` `[computed]`, so a 1.5 dB standard error on the class mean inverts to **±2.4 m on R** — enough to tell 15 m from 20 m, which is the decision §2.4 needs. Long links cross 5–10 classes and are unattributable; reserve ~10 % of effort for them as a **held-out validation set, never for fitting**.
   - **Slope × position error** — reject where `local_slope × σ_horizontal > 0.5 m`. On a 20 % slope a 10 m GNSS error under canopy is 2 m of vertical error, which destroys the entire reason for using a 0.3 m DTM. **On steep ground, horizontal positioning is the binding vertical uncertainty, not the DEM.**
   - **Distinct stand** — at most 2 sites per landuse polygon (§6.3, ρ).
   - **Navigability** — every site must coincide with an identifiable map feature. A site that can only be found by GPS is a site that will be measured in the wrong place.
6. **Stratify on predicted margin** — not uniform coverage; this is the allocation that carries the information:

| Stratum | Share | Reason |
|---|---:|---|
| Strong (margin lower bound > +15 dB) | 40 % | clean high-SNR RSSI; the continuous observations |
| Marginal (interval brackets threshold) | 40 % | `0 < PRR < 1`, steepest likelihood, ladder-censored |
| Predicted null | 20 % | tests that the model is not over-predicting; supplies verified nulls |

7. **Spread** — maximin selection over (log distance, elevation angle, vegetation depth, canopy height) rather than top-scoring, which clusters.
8. **Output** — per-operator ordered route card + GPX, **classes interleaved** (§6.2), each site named by its map feature.

### 9.2 Pre-registration

Every site's predicted margin interval is computed and **committed to git before the campaign runs.** The comparison is then genuinely out-of-sample rather than a fit dressed as a validation. Costs nothing, and it is the same provenance discipline the rest of the repo already runs on.

### 9.3 Blinding

**Operators are not told which stratum a site is in.** Told a site is expected dead, an operator will wait longer, move the pole, and hunt for signal — differential effort that manufactures exactly the bias the campaign exists to remove. Every window is 9 minutes regardless of what is heard. This is why §5 step 6 is a duration, not a condition.

---

## 10. WHAT WOULD MAKE THIS WORTHLESS

Ranked by expected damage × likelihood. Honestly.

| # | Failure | Likelihood | Damage | Signature in the data | Defence |
|---:|---|---|---|---|---|
| 1 | **Run outside a ≤0.5 m DTM footprint** | Low if §0.1 is read, total if not | **Fatal** | none — the fit converges and is wrong | Geographic hard mask in the site selector, not a guideline |
| 2 | **Nulls silently dropped** — windows with nothing heard never get handed in | **Near-certain without protocol** | Severe, one-directional | none — the dataset looks clean | Bounded windows + loopback + PRR schema; a null is a *submitted form*; count forms, not rows |
| 3 | **Relayed packet counted as a link measurement** | Low (structural), catastrophic if the guarantee is wrong | **Total** | **none** — a plausible number for a path nobody measured | `hop_limit = 0` `[firmware]` + explicit filter + pilot verification. Cheapest to prevent, which is why it gets forgotten |
| 4 | **Operator body loss and inconsistent siting** — operators face the node while reading the phone, i.e. stand between node and beacon | High | Severe — 3–10 dB, *larger than the effect* | none | Pole, ≥3 m, off-bearing, hands off. §2.2 |
| 5 | **Clustering** — volunteers go to convenient woods; several sites per stand | High | Moderate — CI reported as ±3 dB when it is ±4.7 | none | `u_stand` random intercept makes it *visible*; selector caps 2 sites/polygon |
| 6 | **Six classes attempted because 400 sounds like a lot** | Moderate | **Total** — 20 person-days, nothing decidable | ±4.9 dB CIs on every class | §8. Two classes. |
| 7 | Height and position sloppiness — "about chest height" | High | Moderate | none | The pole *is* the tape measure; navigate to map features |
| 8 | Single season (leaf-on only) | **Certain** | **Bounded — ~2 dB at 868 MHz** `[ITU]` | — | Not fixable by measurement; fixable by **scoping the claim**. See below. |
| 9 | Single region / terrain type | Certain | Bounded | — | Same treatment |

### 10.1 The most likely outcome, stated plainly

**Executed to this protocol, after a passing pilot:** one 20-person day yields **two land-cover classes, one season, one region, characterised to roughly ±3–4 dB**, enough to move `forest` and `residential` in MESH-CALCULATOR.md §2.4 from `project-assumption` to `project-measured`, plus a first measured value for the P.2108 terminal-clutter term §1.1 refused to invent. That is a real, narrow, honest result and it is worth the weekend.

**Executed without the pilot:** the most likely outcome is an **inconclusive dataset** — nulls missing, stands clustered, body loss uncontrolled, and no way to tell after the fact which of those happened. The failure modes in this table share a property: **they leave no signature.** A dataset that fitted badly would be informative. A dataset that fits *plausibly* and wrongly is worse than no campaign, because it launders an assumption into a `project-measured` provenance tag, and that tag is load-bearing everywhere in this repo.

**The claim the campaign may make** must be scoped as narrowly as it is earned:

> `forest`, mixed Austrian montane, **leaf-on, July**, 868 MHz, terminals at 2.00 m AGL, over `at-bev-dtm-1m`, `R = <value> ± <ci>` m (over-canopy) and `γ = <value>` dB/m, `A_m = <value>` dB (through-canopy), n = N over M distinct stands. Provenance `project-measured`.

A narrow honest number is exactly what §2.4 wants. It is `project-assumption` today.

---

## 11. FILES

| Path | Role |
|---|---|
| `.planning/MESH-CALCULATOR.md` | §1.1 (the two cuts this campaign measures) · §2.4 (the `project-assumption` rows it replaces) · §3.1 (`dJ/dh ≈ 9.130/F1`) · §4.3 (Gate 1) · §5.3 (preset sensitivities, `bodyLossDb`) · §5.4 (`etsi-868-g3`) |
| `packages/terrain-engine/src/terrain/elevation-sources.ts` | `AUSTRIA_DTM_1M` — the coverage that makes the experiment identifiable |
| `packages/terrain-engine/src/features/types.ts:64` | `LANDUSE_CLASSES` — the classes being fitted |
| *(to write)* `tools/mesh-campaign/select-sites.ts` | §9 selector |
| *(to write)* `tools/mesh-campaign/ingest-rangetest.ts` | §2.4 de-shifting parser. Test it against a known file before trusting one byte. |
