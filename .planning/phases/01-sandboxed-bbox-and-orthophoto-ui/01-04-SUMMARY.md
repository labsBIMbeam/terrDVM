---
phase: 01-sandboxed-bbox-and-orthophoto-ui
plan: 04
subsystem: bbox-domain-and-copy-contract
tags: [tdd, bbox, geodesic, turf, dto, copy-contract]

requires:
  - phase: 01-sandboxed-bbox-and-orthophoto-ui
    provides: "Plan 01-03 verified single-file sandbox skeleton and regression ladder"
provides:
  - "Total bbox validation with pinned first-failing discriminator order"
  - "Audited Turf geodesic area wrapper tested against independent absolute and latitude oracles"
  - "Pure canonical EPSG:4326 request-preview DTO using immutable v1 defaults"
  - "Complete typed UI copy single source of truth with verbatim contract tests"
affects: [01-05-map-selection, 01-06-orthophoto-preview, 01-07-failure-states]

tech-stack:
  added: []
  patterns:
    - "Every domain/copy module entered through a committed RED before GREEN"
    - "Bbox validation is a total discriminated result with dependency-injected area calculation"
    - "Geodesic area delegates to approved @turf/area and is never replaced by degree arithmetic"
    - "User-visible text is centralized in typed COPY data/functions"

key-files:
  created:
    - apps/napplet/src/bbox/validate.ts
    - apps/napplet/src/bbox/area.ts
    - apps/napplet/src/bbox/request-preview.ts
    - apps/napplet/src/ui/copy.ts
    - apps/napplet/tests/unit/bbox-validation.test.ts
    - apps/napplet/tests/unit/bbox-area.test.ts
    - apps/napplet/tests/unit/request-preview.test.ts
    - apps/napplet/tests/unit/ui-copy.test.ts
  modified:
    - apps/napplet/src/ui/app.ts

key-decisions:
  - "Longitude equality is ORDER; strict west-greater-than-east is ANTIMERIDIAN_AMBIGUOUS and precedes latitude-order evaluation."
  - "The audited under-limit boundary uses 0.0898 degrees because 0.09 degrees is actually 100.15116034642301 km2 and therefore exceeds the immutable 100 km2 limit."
  - "Request DTO values import fixed resolution/output defaults rather than redeclaring literals."
  - "All Phase 1 visible and deferred state copy is frozen before map/preview wiring."

patterns-established:
  - "Pure bbox modules have no DOM, timer, network, map, ortho, UI, or shell authority."
  - "Source presentation carries exactly one suffix: live, test fixture, local fallback, or unavailable."
  - "Area-limit validation uses unrounded geodesic values; formatting occurs only in the DTO/UI layer."

requirements-completed: [MAP-03, MAP-04, MAP-07]

coverage:
  - id: D1
    description: "Named cases 1-9 pin every malformed/range/order/antimeridian/area-limit discriminator and first-failure order."
    requirement: MAP-04
    verification:
      - kind: unit
        ref: "bbox-validation.test.ts — 10/10 pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Geodesic area matches an independent 12,308 km2 equator oracle and cos(60.5 degree) latitude ratio."
    requirement: MAP-03
    verification:
      - kind: unit
        ref: "bbox-area.test.ts — equator, latitude ratio, and real area-limit cases pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canonical request preview emits W,S,E,N at six decimals, EPSG:4326, formatted geodesic area, pinned defaults, and one source suffix."
    requirement: MAP-07
    verification:
      - kind: unit
        ref: "request-preview.test.ts — cases 12-14 pass"
        status: pass
    human_judgment: false
  - id: D4
    description: "All MAP-04 and Phase 1 state copy is centralized, typed, and verbatim-tested while boot rendering remains unchanged."
    requirement: MAP-04
    verification:
      - kind: e2e
        ref: "ui-copy.test.ts 3/3 plus real Paja boot and boot-denied PASS"
        status: pass
    human_judgment: false

duration: 26 min
completed: 2026-07-27
status: complete
---

# Phase 01 Plan 04: Bbox Domain and Copy Contract Summary

**The complete pure bbox domain, geodesic area oracle, canonical request DTO, and verbatim UI copy contract now pass TDD and the unchanged real Paja sandbox ladder.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-07-27T10:53:46Z
- **Completed:** 2026-07-27T11:20:00Z
- **Tasks:** 3
- **Tests:** 26 unit tests across 6 files, plus 2 real Paja cases

## Accomplishments

- Implemented total bbox structure validation with the exact first-failing clause order and immutable error-code union.
- Proved geodesic area independently at the equator and high latitude, then bound real area-limit validation to the approved Turf wrapper and immutable maximum.
- Created the pure request-preview DTO with W/S/E/N ordering, EPSG:4326, deterministic display formatting, fixed resolution/output imports, and exactly one truthful source suffix.
- Froze all validation, toolbar, empty, loading, success, transport, fixture, attribution, and request-panel copy in one typed module.
- Refactored the existing boot UI to consume the copy SSOT without changing its visible or accessibility output.
- Reran the full production ladder, including conformance and both real Paja capability-on/off cases.

## Task Commits

1. **Task 1 RED: bbox validation cases 1-9** — `4750278`
2. **Task 1 GREEN: pinned bbox discriminator** — `082a128`
3. **Task 2 RED: area and request-preview cases** — `f1398dc`
4. **Task 2 GREEN: geodesic area and canonical DTO** — `f7cf5fa`
5. **Task 3 RED: exact UI copy contract** — `aa1e2ad`
6. **Task 3 GREEN: centralized copy and boot refactor** — `17be6fb`

**Plan metadata:** committed separately by the GSD close-out commit.

## Validation Results

- Named bbox structure cases → 10/10 PASS
- Area and request-preview tests → 6/6 PASS
- UI copy contract → 3/3 PASS
- Complete unit suite → 26/26 PASS
- Typecheck and ESLint → PASS
- Bbox purity scan → 3 files, no DOM/timer/network/map/ortho/UI/shell/I/O authority
- Copy purity and duplicate visible-literal scan → PASS
- Build and independent single-file inventory → PASS
- Conformance → PASS
- Paja boot and resource-denied boot → PASS; four loopback requests per case, cleanup PASS
- Sole shell boundary → 9 source files scanned, PASS
- Approved lock → exactly 14 direct dependencies across 2 importers, PASS
- Gitleaks 8.30.1 → zero findings; public diff clean
- Root/app manifests, workspace definition, lockfile, smoke manifest, and harness → unchanged

## Arithmetic Plan Correction

Plan line 134 described a 0.09° square as approximately 99.7 km² and expected it to pass a 100 km² limit. Both an independent spherical calculation and the installed approved Turf 7.3.5 implementation return **100.15116034642301 km²**. Treating that case as valid would have weakened MAP-03/MAP-04 and rounded before validation.

The implementation therefore preserves the immutable limit and strengthens the test:

- 0.09° square → 100.15116034642301 km² → `AREA_LIMIT`
- 0.0898° square → 99.70653883387968 km² → accepted
- 0.2° square → 494.5728303542486 km² → `AREA_LIMIT`

This is an auto-fixed arithmetic defect in the plan, not a product-scope change.

## Deviations from Plan

### Auto-fixed

- Corrected the inaccurate under-limit coordinate from 0.09° to 0.0898° while retaining an explicit 0.09° rejection test.

### Runtime behavior

- Each task completed inside its bounded executor window; no timeout recovery was required.
- The existing Vite deprecation warning for `inlineDynamicImports` remains non-blocking and was not changed outside this plan's scope.

**Total deviations:** 1 arithmetic correction. No dependency, lockfile, authority, browser-egress, UI-feature, or host mutation.

## Issues Encountered

- The plan's approximate area value was close enough to hide a boundary reversal; direct calculation and the actual pinned library exposed it before RED tests were committed.
- Paja evidence carries dynamic timestamps, so the wave-end rerun was semantically verified and those generated files were restored to their already committed PASS blobs rather than creating unrelated evidence churn.

## Unresolved Risks

- No map, drawing interaction, coordinate form, or selection UI is connected yet; Plan 01-05 owns those features.
- Source-policy and local-surface remain the two honest phase-runner SKIPs.
- The request DTO currently projects domain data only; preview transport and live-source correlation remain Plan 01-06 work.

## User Setup Required

None. No new package, credential, network service, OS mutation, or external approval was needed.

## Next Phase Readiness

- Plan 01-05 can consume `validateBBox`, `geodesicAreaKm2`, `buildRequestPreview`, and `COPY` without inventing business rules in UI code.
- The exact ORDER/ANTIMERIDIAN discriminator and verbatim error strings are frozen against regression.
- Map wiring must remain downstream of these pure modules and behind the existing sandbox boundaries.

## Self-Check: PASSED

- All three RED commits precede their corresponding GREEN commits.
- All six task commits exist with exact declared scopes.
- All declared domain, DTO, copy, and test files exist.
- Full runner reran after the final UI refactor with 26/26 unit tests and both Paja cases green.
- Lockfile and package manifests are unchanged from the Plan 01-02 approved baseline.
- Working tree was clean before this summary was written.

---
*Phase: 01-sandboxed-bbox-and-orthophoto-ui*
*Completed: 2026-07-27*
