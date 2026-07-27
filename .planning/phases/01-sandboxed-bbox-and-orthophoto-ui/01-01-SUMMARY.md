---
phase: 01-sandboxed-bbox-and-orthophoto-ui
plan: 01
subsystem: supply-chain-and-entry-gates
tags: [provenance, package-audit, supply-chain, defaults, fallback-ledger]

requires: []
provides:
  - "Fail-closed MAP-08 clean-room provenance decision"
  - "Validated empty OPS-01 fallback activation ledger"
  - "Human-approved exact Phase 1 package and Chromium scope"
  - "Human-approved immutable v1 request defaults"
affects: [01-02-workspace-bootstrap, phase-01-package-installation, phase-01-map-implementation]

tech-stack:
  added: []
  patterns:
    - "Zero-dependency Node entry-gate validators before package installation"
    - "Research verdicts remain distinct from explicit human approval"
    - "Machine-readable approval scope embedded in public evidence"

key-files:
  created:
    - .planning/evidence/fallback-ledger.jsonl
    - .planning/evidence/phase-01/README.md
    - .planning/evidence/phase-01/map-provenance.json
    - .planning/evidence/phase-01/package-audit.md
    - .planning/evidence/phase-01/v1-defaults.json
    - scripts/validate-fallback-ledger.mjs
    - scripts/verify-map-provenance.mjs
    - scripts/verify-package-audit.mjs
    - scripts/verify-v1-defaults.mjs
  modified:
    - .planning/evidence/phase-01/package-audit.md
    - .planning/evidence/phase-01/v1-defaults.json
    - scripts/verify-package-audit.mjs
    - scripts/verify-v1-defaults.mjs

key-decisions:
  - "MAP-08 remains clean-room-fallback: no 21maps code, assets, styles, or configuration may be copied."
  - "The 14 exact project pins are approved for all Phase 1 installs, exclusively through Plan 01-02's one lockfile mutation."
  - "Chromium provisioning is authorized only as `pnpm --filter @terrdvm/napplet exec playwright install chromium`; --with-deps, sudo, OS packages, and extra packages remain prohibited."
  - "RES_M=5, OUTPUT_MIME=model/gltf-binary, MAX_AREA_KM2=100, and TIMEOUT_S=15 are immutable approved v1 defaults."
  - "@kehto/cli@0.2.16 and @kehto/paja@0.8.0 may be used only as already-installed tools; their SUS/UNRESOLVED research verdicts remain and compatibility requires the later real smoke."

patterns-established:
  - "Approval records carry a parseable timestamp and source without private message metadata."
  - "Validators reject approval-scope drift, rewritten research verdicts, host mutation, extra packages, and default drift."
  - "An empty fallback ledger is valid evidence; fake fallback activations are forbidden."

requirements-completed: [MAP-08, OPS-01]

coverage:
  - id: D1
    description: "MAP-08 clean-room provenance decision is durable and fail-closed."
    requirement: MAP-08
    verification:
      - kind: integration
        ref: "node scripts/verify-map-provenance.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "OPS-01 fallback ledger exists at its fixed location and validates honestly with zero entries."
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "node scripts/validate-fallback-ledger.mjs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exact all-Phase-1 package, lockfile, Chromium, host-mutation, and existing-tool approval scope is recorded."
    verification:
      - kind: integration
        ref: "node scripts/verify-package-audit.mjs"
        status: pass
      - kind: other
        ref: "fail-closed negative suite: 5/5 tamper cases rejected"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four immutable v1 defaults and their explicit human approval are recorded exactly."
    verification:
      - kind: integration
        ref: "node scripts/verify-v1-defaults.mjs"
        status: pass
    human_judgment: false
  - id: D5
    description: "Plan 01-01 completed without package installation, lockfile creation, secret-like material, or map implementation."
    verification:
      - kind: other
        ref: "repository artifact/secret/diff gate executed during Plan 01-01 close-out"
        status: pass
    human_judgment: false

duration: 1h 11m
completed: 2026-07-27
status: complete
---

# Phase 01 Plan 01: Provenance, Supply-Chain, and Defaults Entry Gates Summary

**Fail-closed provenance, fallback, package-approval, and immutable-default gates now protect Phase 1 before its first manifest or lockfile mutation.**

## Performance

- **Duration:** 1h 11m
- **Started:** 2026-07-27T07:23:18Z
- **Completed:** 2026-07-27T08:34:24Z
- **Tasks:** 3
- **Files modified:** 9 unique plan artifacts

## Accomplishments

- Recorded MAP-08 as `clean-room-fallback` before map code exists and created the schema-validated, honestly empty OPS-01 fallback ledger.
- Audited all 14 exact Phase 1 project pins plus the two existing Kehto/Paja tools, preserving every `SUS` and `UNRESOLVED` research verdict.
- Recorded the explicit `approved` human checkpoint with source `Telegram human checkpoint`, exact install/default scope, and no private metadata.
- Strengthened the package/default validators so scope, command, research-verdict, approval-source, host-mutation, and default drift fail closed; five negative tamper cases were rejected.
- Confirmed no `package.json`, `pnpm-lock.yaml`, `node_modules`, package installation, Chromium provisioning, or application implementation occurred in Plan 01-01.

## Task Commits

Each task was committed atomically:

1. **Task 1: Record MAP-08 decision and create OPS-01 fallback ledger with validators** — `a7c500e7dd83f11a5a713ab40a4a80ce0291e62f` (`chore`)
2. **Task 2: Assemble package dossier and pin fixed v1 defaults** — `ca8bf358f0d4150cddb2d6f1a44f3c775a17bf17` (`chore`)
3. **Task 3: Record exact human approval and close the blocking checkpoint fail-closed** — `f2951a2f8b80a2797730509ee2a621ffbed18030` (`chore`)

**Plan metadata:** committed separately by the GSD close-out commit containing this summary and planning-state updates.

## Files Created/Modified

- `.planning/evidence/phase-01/map-provenance.json` — MAP-08 clean-room decision with the five null fallback evidence fields and strict reuse condition.
- `.planning/evidence/fallback-ledger.jsonl` — Fixed-location zero-byte OPS-01 ledger; empty is the truthful initial state.
- `.planning/evidence/phase-01/README.md` — Public evidence redaction and secret-rescan conventions.
- `.planning/evidence/phase-01/package-audit.md` — Exact 14-pin dossier, existing-tool evidence, exclusions, and machine-readable human approval scope.
- `.planning/evidence/phase-01/v1-defaults.json` — Immutable approved MAP-07 defaults with timestamped checkpoint source.
- `scripts/verify-map-provenance.mjs` — Rejects provenance reuse unless all five immutable fields are populated.
- `scripts/validate-fallback-ledger.mjs` — Validates the OPS-01 JSONL schema while accepting an honest zero-entry ledger.
- `scripts/verify-package-audit.mjs` — Enforces exact rows, unchanged verdicts, exact approval scope, one-lockfile boundary, Chromium command, prohibitions, and existing-tool-only use.
- `scripts/verify-v1-defaults.mjs` — Enforces exact values, approval source/shape, and explicit change control.

## Decisions Made

- **Clean-room MAP-08 boundary:** 21maps provenance remained unresolved, so the existing clean-room fallback decision remains unchanged. Reuse is still forbidden unless all five provenance fields independently pass before map code exists.
- **Exact package approval:** All 14 exact project pins are approved for all Phase 1 installs, but only Plan 01-02 may install them and only in its one lockfile mutation. Approval did not rewrite any research verdict.
- **Exact browser provisioning:** Only `pnpm --filter @terrdvm/napplet exec playwright install chromium` is authorized. `--with-deps`, sudo, distro/OS package installation, and any extra package remain outside approval.
- **Existing tools are not dependencies:** `@kehto/cli@0.2.16` and `@kehto/paja@0.8.0` may be invoked only from their existing installation/cache. They must never enter a terrDVM manifest or lockfile and still require the later real compatibility smoke.
- **Immutable defaults:** `RES_M=5`, `OUTPUT_MIME=model/gltf-binary`, `MAX_AREA_KM2=100`, and `TIMEOUT_S=15` are approved and may change only through a new explicit human checkpoint followed by re-pinning.

## Validation Results

All Plan 01-01 gates passed in the exact repository root:

- `node scripts/verify-map-provenance.mjs` → `map provenance valid: clean-room-fallback`
- `node scripts/validate-fallback-ledger.mjs` → `ledger valid: 0 entries`
- `node scripts/verify-package-audit.mjs` → exact 14-pin all-Phase-1 approval, Plan 01-02 one-lockfile scope, exact Chromium command, host/extra-install denial, and Kehto/Paja existing-tool-only scope valid
- `node scripts/verify-v1-defaults.mjs` → exact approved `5 / model/gltf-binary / 100 / 15` immutable defaults valid
- Fail-closed negative suite → 5/5 tamper cases rejected (Chromium command drift, host mutation, research verdict rewrite, `RES_M` drift, approval source drift)
- Secret-like scan → 0 matches across 53 tracked/current paths; staged scan → 0 matches in the four Task 3 files
- `git diff --check` and staged `git diff --cached --check` → PASS
- Prohibited install artifacts → no `package.json`, `pnpm-lock.yaml`, or `node_modules`; no install/provisioning command was executed

## Deviations from Plan

None - the plan executed within its declared evidence and validator scope.

**Timeout recovery:** The first executor reached the 600-second limit after completing and committing Task 1 while collecting Task 2 metadata. A bounded continuation reused the collected metadata, completed Task 2, and stopped at the human gate. The checkpoint close-out executor then reached the same limit after committing Task 3 and writing this already-verified summary. No task was duplicated, no fallback activation was fabricated, and both recoveries were reconciled through Git/artifact spot-checks before continuation.

**Total deviations:** 0 implementation deviations; 2 executor-timeout recoveries.
**Impact on plan:** No scope creep and no loss of verification. Validator strengthening was the required fail-closed recording of Task 3 approval.

## Issues Encountered

Two executor runtime limits required bounded continuation/spot-check recovery. The blocking human checkpoint itself was normal plan flow and resumed only after the explicit `approved` response.

## Unresolved Compatibility Risks

- `playwright@1.59.1` retains its `UNRESOLVED` research verdict; approval permits the exact install but does not prove browser provisioning or runtime compatibility.
- Napplet SDK/plugin/conformance and Vite pins retaining `SUS` must pass the real install, build, conformance, and browser smoke in later plans.
- `@kehto/cli@0.2.16` remains `SUS` and `@kehto/paja@0.8.0` remains `UNRESOLVED`; only the later real built-artifact smoke can close compatibility.
- If Chromium requires host packages, Plan 01-02 must fail closed and return for separate approval; `--with-deps`, sudo, and OS package installation are not authorized.

## User Setup Required

None - no external service, credential, package installation, or host mutation was performed.

## Next Phase Readiness

- Plan 01-01 entry gates are complete and Plan 01-02 has the exact machine-readable authorization it requires.
- Execution intentionally stops here before Plan 01-02. No dependency or Chromium installation has started.
- The clean-room MAP-08 decision and all unresolved compatibility gates remain binding downstream.

## Self-Check: PASSED

- All nine declared Plan 01-01 artifacts exist.
- Task commits `a7c500e7dd83f11a5a713ab40a4a80ce0291e62f`, `ca8bf358f0d4150cddb2d6f1a44f3c775a17bf17`, and `f2951a2f8b80a2797730509ee2a621ffbed18030` exist with the expected file scopes.
- All four plan validators and the five-case negative tamper suite pass.
- No prohibited install artifact or secret-like material was found.

---
*Phase: 01-sandboxed-bbox-and-orthophoto-ui*
*Completed: 2026-07-27*
