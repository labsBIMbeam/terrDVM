---
phase: 01-sandboxed-bbox-and-orthophoto-ui
plan: 02
subsystem: workspace-and-verification-bootstrap
tags: [pnpm, playwright, chromium, gitleaks, verification-runner, supply-chain]

requires:
  - phase: 01-sandboxed-bbox-and-orthophoto-ui
    provides: "Plan 01-01 exact package/default approval, clean-room provenance, and OPS-01 ledger"
provides:
  - "Pinned two-project pnpm workspace with the single approved Phase 1 lockfile mutation"
  - "Playwright Chromium revision 1217 provisioned and launch-smoked without OS packages"
  - "Append-only Phase 1 verification runner with honest PASS/SKIP/FAIL semantics"
  - "Repeatable Gitleaks 8.30.1 secret gate and public-diff gate"
affects: [01-03-sandbox-shell, phase-01-all-later-plans, production-evidence]

tech-stack:
  added:
    - "pnpm workspace with 14 exact approved direct dependency pins"
    - "Playwright 1.59.1 / Chromium 147.0.7727.15 revision 1217"
    - "Gitleaks 8.30.1 verification integration"
  patterns:
    - "Single lockfile mutation followed by frozen-lock verification"
    - "Append-only verification runner that fails on promised-but-missing gates"
    - "Detached tracked/untracked Git inventory for redacted secret scanning"
    - "Semantic-equivalence preservation keeps repeated evidence scans checkout-clean"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - eslint.config.mjs
    - apps/napplet/package.json
    - apps/napplet/tsconfig.json
    - apps/napplet/vitest.config.ts
    - apps/napplet/index.html
    - apps/napplet/src/main.ts
    - apps/napplet/tests/smoke/cases.json
    - scripts/verify-lock-approved.mjs
    - scripts/verify-phase-01.sh
    - scripts/scan-secrets.sh
    - .planning/evidence/phase-01/chromium-provisioning.json
    - .planning/evidence/phase-01/secret-scan.txt
  modified:
    - .gitignore
    - .planning/evidence/fallback-ledger.jsonl

key-decisions:
  - "The lockfile contains exactly the 14 previously approved direct pins across root and napplet importers; no later Phase 1 plan may install another package."
  - "Ubuntu 26.04 uses Playwright's built-in ubuntu24.04-x64 host override for revision 1217 after a separate human checkpoint; no sudo, --with-deps, or OS package installation occurred."
  - "Existing Kehto/Paja tools remain outside project manifests and still require their later real artifact smoke."
  - "Secret-scan evidence preserves its first successful timestamp when all semantic fields remain unchanged, so verification reruns do not dirty a clean checkout."

patterns-established:
  - "Current runner stages may honestly SKIP only until their promised file appears; once a gate is promised, missing prerequisites fail closed."
  - "Secret scans include tracked, untracked non-ignored, and production dist files without traversing raw .git objects or persisting findings."
  - "Unsupported-host and quota recoveries are recorded in public-safe evidence and the OPS-01 ledger."

requirements-completed: []

coverage:
  - id: D1
    description: "Workspace manifests and the single lockfile mutation contain exactly the 14 approved pins."
    verification:
      - kind: integration
        ref: "node scripts/verify-lock-approved.mjs"
        status: pass
      - kind: other
        ref: "pnpm install --frozen-lockfile with unchanged SHA-256 e831efb57189778994a6531110581285f25e4e636866940ef4e2918f033e392e"
        status: pass
    human_judgment: false
  - id: D2
    description: "Approved Playwright Chromium revision 1217 exists and completes a real headless data-page launch smoke."
    verification:
      - kind: integration
        ref: ".planning/evidence/phase-01/chromium-provisioning.json"
        status: pass
    human_judgment: false
  - id: D3
    description: "The ordered Phase 1 runner reports current gates and honest future-gate skips without implying unimplemented coverage."
    verification:
      - kind: integration
        ref: "bash scripts/verify-phase-01.sh"
        status: pass
    human_judgment: false
  - id: D4
    description: "Established Gitleaks scanning covers tracked, untracked, and dist inventory with zero redacted findings and an idempotent evidence file."
    verification:
      - kind: integration
        ref: "bash scripts/scan-secrets.sh run twice with identical evidence SHA-256"
        status: pass
    human_judgment: false
  - id: D5
    description: "A promised manifest case with a missing script fails by case name and restoration returns the manifest byte-identically."
    verification:
      - kind: negative
        ref: "missing-case-proof exits 1; cases.json restored to SHA-256 97a2b5e792633e8d43c67133ac9c1dd1c768957b4aed79dd1f1296ff9cdaba37"
        status: pass
    human_judgment: false

duration: 1h 18m
completed: 2026-07-27
status: complete
---

# Phase 01 Plan 02: Workspace and Verification Bootstrap Summary

**terrDVM now has its only approved Phase 1 dependency graph, a real launch-smoked Chromium, and repeatable fail-closed verification infrastructure without implementing map or sandbox product behavior early.**

## Performance

- **Duration:** 1h 18m
- **Started:** 2026-07-27T08:50:02Z
- **Completed:** 2026-07-27T10:08:02Z
- **Tasks:** 2
- **Files created/modified:** 17 unique plan artifacts

## Accomplishments

- Created the root and `@terrdvm/napplet` workspace with exactly 14 direct dependency pins and one committed `pnpm-lock.yaml` mutation.
- Provisioned Playwright Chromium revision 1217 via the explicitly approved Ubuntu 24.04 host override, then proved executable presence and a real closed headless launch against deterministic local content.
- Added an ordered Phase 1 runner with real unit/typecheck/lint/provenance/ledger/lock/secret/public-diff gates and honest SKIPs for gates whose implementation belongs to later plans.
- Added Gitleaks 8.30.1 scanning over a detached tracked/untracked/dist inventory with redacted zero-finding evidence and no raw `.git` object traversal.
- Proved a missing smoke-case script fails by name and restored the empty smoke manifest byte-identically.
- Fixed the evidence writer so repeated successful secret scans preserve semantic-equivalent evidence and leave a clean checkout clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Workspace scaffolding, exact lockfile, and Chromium provisioning** — `f34a728c36ac788854d5b1c392b2142412a03f59` (`feat`)
2. **Task 2: Phase verification gates, smoke manifest, and secret/public-diff evidence** — `3bd260ebee9c73871609ddc056ada741a53a836e` (`chore`)

Follow-up verification fix:

- **Idempotent secret-scan evidence after independent spot-check** — `bbd5e7d` (`fix`)

**Plan metadata:** committed separately by the GSD close-out commit containing this summary and planning-state updates.

## Files Created/Modified

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — two-project workspace, exact scripts, and the only approved Phase 1 lockfile mutation.
- `apps/napplet/package.json` — exact runtime/dev pins; no Kehto/Paja project dependency.
- `apps/napplet/tsconfig.json`, `vitest.config.ts`, `index.html`, `src/main.ts` — strict featureless bootstrap without map, bbox, ortho, shell, or Vite build configuration.
- `eslint.config.mjs` — ESLint 9 flat configuration for browser TypeScript and Node repository scripts.
- `scripts/verify-lock-approved.mjs` — validates importers, direct pin set, and no hidden manifest drift.
- `scripts/verify-phase-01.sh` — append-only ordered verification runner.
- `scripts/scan-secrets.sh` — established redacted scanner wrapper with detached repository inventory and repeatable evidence behavior.
- `apps/napplet/tests/smoke/cases.json` — schema-valid empty smoke-case manifest ready for later real cases.
- `.planning/evidence/phase-01/chromium-provisioning.json` — public-safe host override, revision, real launch, approval, and recovery evidence.
- `.planning/evidence/phase-01/secret-scan.txt` — Gitleaks version, coverage, timestamp, and zero-finding result.
- `.planning/evidence/fallback-ledger.jsonl` — records the unsupported-host fallback in addition to the scanner provisioning fallback.
- `.gitignore` — preserves all existing secret/runtime exclusions and adds workspace/build/scratch exclusions.

## Decisions Made

- **One install boundary remains binding:** `f34a728` is the first and only commit mutating `pnpm-lock.yaml`; all later Phase 1 work uses the frozen dependency graph.
- **Ubuntu 26.04 fallback is explicit:** Playwright 1.59.1 does not recognize `ubuntu26.04-x64`, so the user separately approved its built-in `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` path. The exact package command remained unchanged and no OS dependency install occurred.
- **Browser evidence requires runtime behavior:** a cache directory alone was insufficient; Chromium revision 1217 had to launch, render deterministic local content, satisfy title/text/status assertions, and close.
- **Verification does not fake future coverage:** build, dist, conformance, shell-boundary, source-policy, and local-surface remain named SKIPs until their planned files exist.
- **Scanner output is public-safe:** findings are redacted and suppressed, only zero findings may produce PASS evidence, and successful semantic-equivalent reruns preserve the original evidence timestamp.

## Validation Results

- `node scripts/verify-lock-approved.mjs` → 14 exact approved dependencies across two importers
- Frozen install → lock SHA-256 remained `e831efb57189778994a6531110581285f25e4e636866940ef4e2918f033e392e`
- Chromium revision 1217 / browser `147.0.7727.15` → executable and real headless launch smoke PASS under approved override
- `pnpm --filter @terrdvm/napplet typecheck` → PASS
- `pnpm lint` → PASS
- `pnpm --filter @terrdvm/napplet test:unit` → PASS with honest no-test baseline
- `bash scripts/verify-phase-01.sh` → unit, typecheck, lint, manifest, provenance, ledger, lock, secret-scan, and public-diff PASS; six future gates honestly SKIP
- Missing-case negative control → exit 1 with named case; manifest restored byte-identically
- `bash scripts/scan-secrets.sh` → Gitleaks 8.30.1, zero findings; three consecutive executions retained identical evidence SHA-256
- Package audit, immutable defaults, map provenance, Chromium evidence, and two-entry OPS-01 ledger → PASS
- `git diff --check` → PASS
- `01-VALIDATION.md` remained unchanged with `wave_0_complete=false`

## Deviations from Plan

### Auto-fixed implementation issues

- The first timed-out executor initially replaced rather than extended `.gitignore`; the parent restored every pre-existing secret/runtime rule before installation or commit.
- ESLint initially lacked Node globals for repository scripts; the flat config was corrected before the complete gate sequence and Task 1 commit.
- Independent verification showed that a new wall-clock timestamp dirtied `secret-scan.txt` after every successful rerun. The scanner now replaces evidence only on a semantic field change; repeated identical PASS results preserve the existing timestamp.

### Approved blocking fallback

- Playwright 1.59.1 rejected Ubuntu 26.04 as unsupported. After the original exact command failed closed, a separate Telegram human checkpoint approved only the built-in `ubuntu24.04-x64` host override, with the same package command and no `--with-deps`, sudo, OS packages, or alternate browser source.
- User quota blocked Playwright's temporary archive write. Recovery used a user-cache temporary directory and removed only stale Playwright Chromium revision-1228 cache directories; revision 1217 and ffmpeg were preserved. This recovery is recorded in Chromium evidence and the OPS-01 ledger.

### Executor runtime recovery

- The first Plan 01-02 executor reached its runtime limit during the initial install attempt before a lockfile or commit existed.
- The host-override continuation reached its runtime limit after successful revision-1217 download and launch smoke but before evidence/commit. A write-only continuation reconciled the real state, reran the smoke, materialized evidence, and committed Task 1.

**Total deviations:** 3 auto-fixed implementation issues, 1 approved host fallback with quota recovery, and 2 executor-timeout recoveries.

**Impact on plan:** No dependency, product-scope, secret-handling, or OS-mutation scope creep. All deviations are durable and machine-verifiable; the final workspace and gates satisfy the plan.

## Issues Encountered

- Network/runtime delays made the initial install exceed the executor budget, but no partial lockfile or lingering process remained.
- Playwright's host table ends at Ubuntu 24.04 for this pin; all later Playwright invocations on this machine must preserve the documented override until the pin is explicitly changed in a later approved milestone.
- The user's temporary-file quota required cache-local TMPDIR recovery. No repository artifact depends on that temporary directory.

## Unresolved Compatibility Risks

- Napplet SDK/plugin/conformance and the single-file production build remain unproved until Plan 01-03's real build and Paja/Kehto smokes.
- Chromium is a Playwright fallback build on Ubuntu 26.04; browser tests must continue to launch-smoke it rather than infer compatibility from presence.
- Build, dist, conformance, shell-boundary, source-policy, and local-surface gates are intentionally SKIP and cannot be claimed complete yet.
- `@kehto/cli@0.2.16` and `@kehto/paja@0.8.0` remain existing-tool-only and retain their research verdicts until real artifact tests pass.

## User Setup Required

None. No credential, sudo action, OS package, or additional project dependency is required for the next plan.

## Next Phase Readiness

- Plan 01-02 is ready to close and Plan 01-03 may implement the production single-file sandbox shell against the frozen workspace.
- The build/conformance/shell-boundary/Paja/Kehto SKIPs are the next plan's explicit gates, not accepted debt.
- Clean-room provenance, immutable defaults, scanner enforcement, browser override, and no-later-install boundaries remain binding.

## Self-Check: PASSED

- Task commits `f34a728c36ac788854d5b1c392b2142412a03f59` and `3bd260ebee9c73871609ddc056ada741a53a836e` exist with their expected scopes; follow-up `bbd5e7d` contains only the repeatability fix and refreshed redacted evidence.
- `f34a728` is the repository's first and only lockfile-mutating commit.
- All declared Plan 01-02 files exist; no map, bbox, orthophoto, shell feature, or Vite production build file was added early.
- Full runner, lock, approval/default, provenance, ledger, secret, public-diff, and independent spot-check gates pass.
- Working tree was clean before this summary was written.

---
*Phase: 01-sandboxed-bbox-and-orthophoto-ui*
*Completed: 2026-07-27*
