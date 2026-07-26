---
phase: 1
slug: sandboxed-bbox-and-orthophoto-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-26
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. This draft is seeded from `01-RESEARCH.md`; the Fable 5 planner must replace provisional task IDs with the final plan/task IDs without reducing coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 candidate after required SUS package verification; Chromium via `@napplet/conformance-cli@0.2.16` and installed Kehto/Paja |
| **Config file** | `apps/napplet/vitest.config.ts` and browser harness — Wave 0 creates after package gates pass |
| **Quick run command** | `pnpm --filter @terrdvm/napplet test:unit` |
| **Full suite command** | `pnpm verify:phase-01` |
| **Production build** | `pnpm --filter @terrdvm/napplet build` |
| **Conformance** | `pnpm --filter @terrdvm/napplet exec napplet-conformance ./dist --reporter json --out ../../.planning/evidence/phase-01/conformance.json` |
| **Clean-checkout gate** | `pnpm verify:clean:phase-01` |
| **Estimated runtime** | quick ≤30 seconds; full suite target ≤180 seconds excluding manual visual check |

All commands are prescribed interfaces. They remain `MISSING` until Wave 0 creates the workspace and the required package-verification checkpoints pass.

---

## Sampling Rate

- **After every TDD cycle:** run the named targeted unit test first, then the app unit suite.
- **After every task commit:** run `pnpm --filter @terrdvm/napplet test:unit` and the app typecheck.
- **After every production-build task:** run build, `verify-dist`, and conformance against `dist`.
- **After every plan wave:** run `pnpm verify:phase-01`, including the current Paja smoke subset.
- **After any package/source/transport change:** re-run package/provenance checks, build/conformance, denied-capability and timeout smoke.
- **Before `/gsd-verify-work`:** clean-checkout suite, built-artifact Paja smoke, fallback-ledger review, secret scan, and public-diff review must be green.
- **Max feedback latency:** 30 seconds for unit feedback; 180 seconds for the automated phase suite.

---

## Per-Task Verification Map

The planner must replace `TBD` task IDs while retaining every row.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-G1 | TBD | 0 | MAP-08 | T-01 supply-chain/provenance | No 21maps reuse without five-field provenance; clean-room fallback recorded otherwise | schema/static | `pnpm verify:map-provenance` | ❌ W0 | ⬜ pending |
| TBD-PKG | TBD | 0 | SBOX-01, VER-02 | T-01 | Every SUS package receives human verification before lockfile mutation | package audit | `pnpm verify:package-audit` | ❌ W0 | ⬜ pending |
| TBD-01 | TBD | 1 | MAP-01, MAP-02 | — | Exactly one rectangle can be drawn, edited, and cleared in the built app | Paja browser | `pnpm --filter @terrdvm/napplet test:smoke:paja -- --case draw-edit-clear` | ❌ W0 | ⬜ pending |
| TBD-02 | TBD | 1 | MAP-03 | T-02 input integrity | WGS84 geodesic km² is correct at equator and high latitude; no degree area | unit | `pnpm --filter @terrdvm/napplet test:unit -- bbox-area` | ❌ W0 | ⬜ pending |
| TBD-03 | TBD | 1 | MAP-04 | T-02 | Non-finite, malformed, range/order, antimeridian, zero-area, and over-limit boxes fail closed | unit + UI | `pnpm --filter @terrdvm/napplet test:unit -- bbox-validation` | ❌ W0 | ⬜ pending |
| TBD-G2 | TBD | 0 | MAP-05, MAP-06 | T-03 endpoint/policy abuse | One exact attributed bounded source contract passes policy/CORS/capability review before live preview | schema/static | `pnpm verify:ortho-source-policy` | ❌ W0 | ⬜ pending |
| TBD-04 | TBD | 2 | MAP-05 | T-04 stale response | Preview is correlated to current bbox; late old response cannot overwrite it | unit + Paja | `pnpm --filter @terrdvm/napplet test:unit -- preview-correlation` | ❌ W0 | ⬜ pending |
| TBD-05 | TBD | 2 | MAP-06 | T-03 | Attribution renders and request behavior is bounded with no bulk prefetch | unit + evidence | `pnpm --filter @terrdvm/napplet test:unit -- source-policy` | ❌ W0 | ⬜ pending |
| TBD-06 | TBD | 1 | MAP-07 | — | Canonical preview shows W,S,E,N, EPSG:4326, km², fixed defaults, and active source/fallback | unit/snapshot | `pnpm --filter @terrdvm/napplet test:unit -- request-preview` | ❌ W0 | ⬜ pending |
| TBD-07 | TBD | 1 | SBOX-03 | T-05 capability boundary | Shell/resource access is feature-detected and privileged globals are not reached outside one adapter | unit/static | `pnpm verify:shell-boundary` | ❌ W0 | ⬜ pending |
| TBD-08 | TBD | 2 | SBOX-01 | T-06 remote asset/CSP | Single-file `dist/index.html` has no required sidecars, remote executable assets, or secret-like material | build/static | `pnpm verify:dist` | ❌ W0 | ⬜ pending |
| TBD-09 | TBD | 2 | SBOX-01, SBOX-02 | T-07 sandbox mismatch | Built artifact passes real Chromium conformance and Paja smoke, not only dev mode | conformance/browser | `pnpm verify:phase-01` | ❌ W0 | ⬜ pending |
| TBD-10 | TBD | 2 | SBOX-04 | T-08 secret disclosure | Source, dist, evidence, traces, fixtures, and config contain no secrets/token-bearing URLs | security/static | `pnpm scan:secrets` | ❌ W0 | ⬜ pending |
| TBD-11 | TBD | 2 | VER-04-T1 | T-05 | Denied resource capability produces an actionable named state and no unhandled rejection | Paja degraded | `pnpm --filter @terrdvm/napplet test:smoke:paja -- --case resource-denied` | ❌ W0 | ⬜ pending |
| TBD-12 | TBD | 2 | VER-04-T3 | T-04/T-09 timeout | Deterministic resource delay produces timeout state; late response cannot mutate current preview | Paja fault fixture | `pnpm --filter @terrdvm/napplet test:smoke:paja -- --case resource-timeout` | ❌ W0 | ⬜ pending |
| TBD-13 | TBD | 0 | OPS-01 | T-10 audit integrity | Fixed JSONL ledger validates; real fallbacks record which/when/why, no fake entry required | schema/process | `pnpm verify:fallback-ledger` | ❌ W0 | ⬜ pending |
| TBD-14 | TBD | 3 | VER-02 | all | Frozen clean checkout passes typecheck, lint, tests, production build, conformance, scan, and current smoke | clean worktree | `pnpm verify:clean:phase-01` | ❌ W0 | ⬜ pending |
| TBD-COND | TBD | conditional | SBOX-05 early boundary | T-11 local proxy | Any fallback surface is loopback-only and rejects missing/wrong token/non-approved exposure; otherwise no-surface evidence exists | integration/socket | `pnpm test:local-resource-boundary` or `pnpm verify:no-local-surface` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Verify every SUS package's official repository, packed artifact, exact version, scripts, peer matrix, and disposition before installation; require a human-verification checkpoint.
- [ ] Resolve MAP-08 with five-field 21maps provenance or record the clean-room fallback before map code.
- [ ] Resolve and pin one exact orthophoto endpoint/policy/CORS contract before live preview code; a small licensed fixture may support tests but is not live-preview acceptance.
- [ ] Create workspace/package manifests, Corepack/pnpm pin, frozen-lock verification, TypeScript/Vite config, and Vitest config.
- [ ] Create the 20 named bbox/area/preview/source unit cases listed in `01-RESEARCH.md`.
- [ ] Create `verify-dist`, `verify:map-provenance`, `verify:ortho-source-policy`, shell-boundary, fallback-ledger, and full phase runner scripts.
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

---

## Validation Sign-Off

- [ ] All provisional task IDs replaced by final plan/task IDs.
- [ ] All tasks have `<automated>` verify or an explicit Wave 0 dependency.
- [ ] Sampling continuity: no three consecutive tasks without automated verification.
- [ ] Wave 0 covers every MISSING reference and every open implementation gate.
- [ ] No watch-mode flags in acceptance commands.
- [ ] Unit feedback latency <30 seconds and full automated suite target <180 seconds.
- [ ] Package verification checkpoints occur before lockfile mutation.
- [ ] MAP-08 and orthophoto source gates resolve before their respective implementation tasks.
- [ ] `wave_0_complete: true` only after infrastructure commands actually exist and run.
- [ ] `nyquist_compliant: true` only after the plan checker confirms task/test alignment.

**Approval:** pending
