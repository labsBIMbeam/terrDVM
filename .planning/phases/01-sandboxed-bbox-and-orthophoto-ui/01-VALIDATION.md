---
phase: 1
slug: sandboxed-bbox-and-orthophoto-ui
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-26
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `01-RESEARCH.md`; task IDs are final and map to Plans 01–09 (`01-<plan>-<task>`). Coverage was not reduced during ID assignment.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 candidate after required SUS package verification; Chromium via `@napplet/conformance-cli@0.2.16` and installed Kehto/Paja |
| **Config file** | `apps/napplet/vitest.config.ts` and browser harness — Wave 0 creates after package gates pass |
| **Quick run command** | `pnpm --filter @terrdvm/napplet test:unit` |
| **Full suite command** | `pnpm verify:phase-01` (`bash scripts/verify-phase-01.sh` — manifest-driven; executes every `cases.json` case) |
| **Production build** | `pnpm --filter @terrdvm/napplet build` |
| **Conformance** | `pnpm --filter @terrdvm/napplet exec napplet-conformance ./dist --reporter json --out ../../.planning/evidence/phase-01/conformance.json` |
| **Clean-checkout gate** | `pnpm verify:clean:phase-01` (`bash scripts/verify-clean-checkout.sh`) — separate command; NOT part of the quick or full runner targets |
| **Machine gate / sign-off** | `node scripts/phase-01-gate.mjs --require-pass` (`pnpm gate:phase-01`) · `pnpm signoff:phase-01` |
| **Estimated runtime** | quick and full: measure in Plan 08 Task 2 (01-08-02); update with observed values — cold clean install excluded from both targets; the clean-checkout gate is timed separately |

All commands are prescribed interfaces. They remain `MISSING` until Wave 0 creates the workspace and the required package-verification checkpoints pass.

---

## Sampling Rate

- **After every TDD cycle:** run the named targeted unit test first, then the app unit suite.
- **After every task commit:** run `pnpm --filter @terrdvm/napplet test:unit` and the app typecheck.
- **After every production-build task:** run build, `verify-dist`, and conformance against `dist`.
- **After every plan wave:** run `pnpm verify:phase-01` (full manifest runner), including the current Paja smoke subset.
- **After any package/source/transport change:** re-run package/provenance checks, build/conformance, denied-capability and timeout smoke.
- **Before `/gsd-verify-work`:** clean-checkout suite, built-artifact Paja smoke, fallback-ledger review, secret scan, and public-diff review must be green.
- **Max feedback latency:** quick and full runner latencies — measure in Plan 08 Task 2 (01-08-02); update with observed values (no unmeasured latency claim).

---

## Per-Task Verification Map

Task IDs are final (`01-<plan>-<task>`); every provisional row was retained and remapped to the nine-plan structure — no coverage was dropped.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | MAP-08 | T-01 supply-chain/provenance | No 21maps reuse without five-field provenance; clean-room fallback recorded otherwise | schema/static | `pnpm verify:map-provenance` (pre-workspace: `node scripts/verify-map-provenance.mjs`) | ❌ W0 | ⬜ pending |
| 01-01-01 | 01 | 1 | OPS-01 | T-10 audit integrity | Fixed JSONL ledger validates; real fallbacks record which/when/why, no fake entry required | schema/process | `node scripts/validate-fallback-ledger.mjs` (re-checked as gate check ledger-valid in 01-09-01) | ❌ W0 | ⬜ pending |
| 01-01-02 / 01-01-03 | 01 | 1 | SBOX-01, VER-02 | T-01 | Auto task 01-01-02 produces the complete package audit; checkpoint 01-01-03 verifies every SUS package before the single lockfile mutation (01-02-01) | package audit + checkpoint | `node scripts/verify-package-audit.mjs`; then blocking `checkpoint:human-verify`; approved-pins cross-check re-runs in 01-09-01 via `pnpm ls -r --depth 0 --json` (never lockfile regex) | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | VER-02 | T-07 | Manifest-driven runner exists: conditional steps SKIP honestly only while backing scripts are absent and FAIL on any manifest case whose script is missing | runner/static | `bash scripts/verify-phase-01.sh` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | SBOX-04 | T-08 secret disclosure | Source, dist, evidence, traces, fixtures, and config contain no secrets/token-bearing URLs (recurring every wave; re-proven in 01-09-01 and 01-09-03) | security/static | `pnpm scan:secrets` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | SBOX-01 | T-06 remote asset/CSP | Single-file `dist/index.html` has no required sidecars, remote executable assets, or secret-like material | build/static | `node scripts/verify-dist.mjs` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | SBOX-03 | T-05 capability boundary | Shell/resource access is feature-detected and privileged globals are not reached outside the sole adapter | unit/static | `node scripts/verify-shell-boundary.mjs` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | SBOX-01, SBOX-02 | T-07 sandbox mismatch | Built artifact passes real Chromium conformance and Paja boot cases with a loopback/runtime-only request log — zero direct egress (re-run in the 01-09-01 clean checkout) | conformance/browser | `bash scripts/verify-phase-01.sh` (manifest boot cases) | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 4 | MAP-04 | T-02 input integrity | Non-finite, malformed, range/order, antimeridian, zero-area, and over-limit boxes fail closed (verbatim UI error copy asserted in 01-04-03) | unit + UI copy | `pnpm --filter @terrdvm/napplet test:unit -- bbox-validation` | ❌ W0 | ⬜ pending |
| 01-04-02 | 04 | 4 | MAP-03 | T-02 | WGS84 geodesic km² is correct at equator and high latitude against an independent oracle; no degree area | unit | `pnpm --filter @terrdvm/napplet test:unit -- bbox-area` | ❌ W0 | ⬜ pending |
| 01-04-02 | 04 | 4 | MAP-07 | — | Canonical preview DTO shows W,S,E,N, EPSG:4326, km², fixed defaults, and active source/fallback | unit/snapshot | `pnpm --filter @terrdvm/napplet test:unit -- request-preview` | ❌ W0 | ⬜ pending |
| 01-05-01 / 01-05-02 | 05 | 5 | MAP-05, MAP-06 | T-03 endpoint/policy abuse | Two-role source policy (basemap + imagery) with exact attributed bounded contracts and no credential values; full approval requires both roles live, while approved-basemap-only may unlock MAP-01/02 Task 3 but never MAP-05/06 or Plan 06; fixture/unavailable is never completion | schema/live audit + checkpoint | `node scripts/verify-source-policy.mjs` (honest schema/blocked mode) and `node scripts/verify-source-policy.mjs --require-live` (hard Plan 06 gate) | ❌ W0 | ⬜ pending |
| 01-05-03 | 05 | 5 | MAP-01, MAP-02 | — | Exactly one rectangle can be drawn, edited, and cleared in the built app, including the keyboard coordinate path, with a no-egress request log | Paja browser | `bash scripts/verify-phase-01.sh` (manifest cases incl. draw-edit-clear) | ❌ W0 | ⬜ pending |
| 01-06-01 | 06 | 6 | MAP-05 | T-04 stale response | Preview is correlated to the current bbox; a late old response cannot overwrite it (built-artifact proofs: 01-06-03 live case, 01-07-01 stale-late-response) | unit | `pnpm --filter @terrdvm/napplet test:unit -- preview-correlation` | ❌ W0 | ⬜ pending |
| 01-06-02 | 06 | 6 | MAP-06, MAP-07 | T-03 | Attribution renders in both variants, the source indicator states are truthful, and request behavior is bounded with no bulk prefetch | unit + UI | `pnpm --filter @terrdvm/napplet test:unit -- source-policy` | ❌ W0 | ⬜ pending |
| 01-06-03 | 06 | 6 | MAP-05, SBOX-02, SBOX-03 | T-04/T-14 honesty | Built-artifact live preview: outcome derived from the rendered DOM source-row suffix/indicator, cross-checked against the two-role policy, bbox-correlated, zero direct egress; `--require-live` becomes a hard runner step | Paja browser | `bash scripts/verify-phase-01.sh` (manifest case preview-ready-live) | ❌ W0 | ⬜ pending |
| 01-07-01 | 07 | 7 | VER-04-T1 (SBOX-02) | T-05 | Denied resource capability produces the exact actionable frozen copy with Retry, no unhandled rejection, selection/DTO intact; redacted evidence carries `ver04: VER-04-T1` | Paja degraded | `bash scripts/verify-phase-01.sh` (manifest case resource-denied) | ❌ W0 | ⬜ pending |
| 01-07-01 | 07 | 7 | VER-04-T3 (MAP-05) | T-04/T-09 timeout | Deterministic delay produces the timeout state; a stale late response NEVER renders over a newer selection; generic failure shows only the generic copy; all with loopback-only request logs | Paja fault cases | `bash scripts/verify-phase-01.sh` (manifest cases resource-timeout, stale-late-response, preview-failed-generic) | ❌ W0 | ⬜ pending |
| 01-07-03 | 07 | 7 (branch per 01-07-02 checkpoint) | SBOX-02, early SBOX-05 | T-11 local proxy | Either no-local-surface is machine-proven (static scan + socket enumeration) or the approved fallback is born-secure: RED boundary tests before first start, loopback-only, scoped token on every endpoint, exact origin/source allowlists — approved at the blocking 01-07-02 checkpoint after the OPS-01 ledger trigger | integration/socket | `pnpm verify:no-local-surface` (always); `pnpm test:local-resource-boundary` (exists ONLY in the approved-fallback branch) | ❌ W0 | ⬜ pending |
| 01-08-01 | 08 | 8 | VER-02 | T-12 fail-open tooling | Gate/clean-checkout/sign-off tooling is unit-tested before use: schema, 13-check count, run_id freshness, FAIL-unsignable, allowed-diff logic, and the fail-open command-shape regression (extended in 01-08-03) | unit (fixtures) | `pnpm test:gate-tooling` | ❌ W0 | ⬜ pending |
| 01-08-02 | 08 | 8 | MAP-01..MAP-07, SBOX-02 (UI-SPEC evidence) | T-08/T-14 honesty | All 15 UI-SPEC captures (320px, desktop, 2× DPR, reduced-motion, forced-colors, keyboard-only, long-attribution backstop) with outcomes READ FROM THE RENDERED DOM and cross-checked against the source policy; a11y contract asserted mechanically with recorded checker provenance | Paja visual + a11y | `pnpm test:smoke:ui && pnpm test:a11y` | ❌ W0 | ⬜ pending |
| 01-09-01 | 09 | 9 | VER-02 | T-13 stale evidence | Frozen clean checkout at the exact captured HEAD SHA passes the FULL manifest suite fail-closed: preflight-clean abort, SHA/run_id as first log line, worktree at that SHA, required-artifact assertions, frozen install, isolated preview port | clean worktree | `pnpm verify:clean:phase-01` | ❌ W0 | ⬜ pending |
| 01-09-01 | 09 | 9 | Phase 1 gate (all 14 reqs + VER-04-T1/T3) | all | Fail-closed 13-check verdict bound to the tested SHA: requirement evidence complete, both source roles live, DOM-derived live outcome, `pnpm ls -r --depth 0 --json` approved-pins cross-check, dist clean, secret/diff clean, SBOX-05 branch consistent, ledger valid, zero Phase 2 surface; generates the 16-row EVIDENCE-INDEX; output-only commit rule preserves the SHA binding | gate script | `node scripts/phase-01-gate.mjs --require-pass` | ❌ W0 | ⬜ pending |
| 01-09-03 | 09 | 9 | All (sign-off) | T-13 | Sign-off is recorded ONLY by the script, which recomputes the gate and mechanically refuses machine FAIL, stale run_id, tested-SHA mismatch, dirty tree, or any diff beyond the declared gate outputs; final rescan and `--require-pass` re-proof follow | gate script | `pnpm signoff:phase-01 && node scripts/phase-01-gate.mjs --require-pass` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Verify every SUS package's official repository, packed artifact, exact version, scripts, peer matrix, and disposition before installation; require a human-verification checkpoint.
- [ ] Resolve MAP-08 with five-field 21maps provenance or record the clean-room fallback before map code.
- [ ] Resolve and pin one exact orthophoto endpoint/policy/CORS contract before live preview code; a small licensed fixture may support tests but is not live-preview acceptance.
- [ ] Create workspace/package manifests, Corepack/pnpm pin, frozen-lock verification, TypeScript/Vite config, and Vitest config.
- [ ] Create the 20 named bbox/area/preview/source unit cases listed in `01-RESEARCH.md`.
- [ ] Create `verify-dist`, `verify:map-provenance`, source-policy, shell-boundary, fallback-ledger validators and the manifest-driven full phase runner.
- [ ] Create built-artifact Paja/Chromium smoke harness and deterministic denied/timeout fixtures.
- [ ] Select and verify the established secret scanner behind `pnpm scan:secrets`; scan reports must be redacted and rescanned.
- [ ] Create `.planning/evidence/fallback-ledger.jsonl` plus `.planning/evidence/phase-01/` conventions.
- [ ] If local fallback is selected, create SBOX-05 loopback/token/origin tests before its first run; otherwise create explicit no-local-surface evidence.

---

## Production Artifact Assertions

`pnpm verify:dist` must fail unless `apps/napplet/dist/index.html` is non-empty and self-contained, has no required local JS/CSS sidecars, no remote executable script/style/font/worker or unaudited image URL, no unapproved source map, no secret-like pattern, fixed non-secret defaults/source policy, and can boot in the conformance opaque-origin iframe without `allow-same-origin`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Orthophoto visually corresponds to the selected bbox | MAP-05 | Automation can verify request correlation but not imagery semantics | In the built Paja app, select a recognizable bounded fixture/live area, compare visible landmarks/bounds against the source reference, capture a redacted screenshot and reviewer note. |
| Attribution is legible and source/fallback labeling is honest | MAP-06, MAP-07 | Legibility and misleading presentation require human judgment | Inspect built Paja UI at target viewport/high-DPI sizes; record source label, attribution text, active transport, and fallback mode. |
| Public diff contains no unsafe evidence or unexplained dependency additions | SBOX-04, recurring VER-06 portion | Contextual review cannot be fully reduced to pattern matching | Review source, lockfile, dist inventory, evidence, logs, traces, and config after automated scan; save a redacted sign-off. |

All three manual-only verifications are executed at the Plan 09 blocking checkpoint (task 01-09-02), which is reachable as an approval only when the committed `gate-verdict.json` from 01-09-01 records verdict PASS; the sign-off itself is recorded mechanically by 01-09-03. The MAP-05 imagery-correspondence row is meaningful only when the gate verdict records a live DOM-derived outcome — fixture/unavailable evidence never satisfies it.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or an explicit Wave 0 dependency.
- [ ] Sampling continuity: no three consecutive tasks without automated verification.
- [ ] Wave 0 covers every MISSING reference and every open implementation gate.
- [ ] No watch-mode flags in acceptance commands.
- [ ] Quick and full runner runtimes are recorded as OBSERVED values measured in 01-08-02; no unmeasured runtime claim remains anywhere in this file.
- [ ] Package verification checkpoints occur before lockfile mutation.
- [ ] MAP-08 and orthophoto source gates resolve before their respective implementation tasks.
- [ ] `wave_0_complete: true` only after infrastructure commands actually exist and run.
- [ ] `nyquist_compliant: true` only after the plan checker confirms task/test alignment.

**Approval ownership:** the independent plan checker sets `nyquist_compliant`; execution Task 01-09-03 sets `status: approved` and `wave_0_complete: true` only after every mapped infrastructure command exists, ran, the machine gate is PASS, and human sign-off is recorded. Current approval remains pending.
