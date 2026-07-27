I'll read the review bundle now.

## ISSUES FOUND

**Phase:** 1 — Sandboxed Bbox and Orthophoto UI
**Plans checked:** 5 (01-01 … 01-05)
**Issues:** 12 blocker(s), 12 warning(s)

**Review-scope limitation (stated, not credited):** `01-RESEARCH.md` was not included in the bundle although all five plans depend on it (`read_first` references to "Open Gates G1/G2/G5", "Pattern 1/3/6", "Required Named Unit Cases", "OPS-01 Fallback Ledger Contract", "Actual Paja/Kehto Smoke Protocol", "Assumption A5"). Dimension 7c (Architectural Responsibility Map), Dimension 11 (Open Questions resolved) and Dimension 12 (PATTERNS.md) could not be verified and are neither passed nor failed here. Named unit cases 1–20, the ledger schema, and the package-audit SUS list are taken as asserted by the plans.

---

### Blockers (must fix)

**1. [verification_derivation] The clean-checkout gate does not provably test the state being gated — worktree is created from HEAD with no clean-tree, SHA, or content binding**
- Plan: 01-05, Task 2
- Evidence: *"`git worktree add` an isolated directory **from HEAD** into a temp path outside the repo, run a Corepack-pinned `pnpm install --frozen-lockfile` … then run the full ordered phase suite … inside the worktree"*. Nothing in the task requires the working tree to be committed first, records the tested commit, or asserts the worktree contains Plan 01–05 outputs. Task 1 of this same plan writes `a11y-contract.mjs`, extends `paja-harness.mjs`, and wires `test:smoke:ui` / `test:a11y`; Task 2 itself creates `verify-clean-checkout.sh` and `phase-01-gate.mjs`. If any of that is uncommitted when the script runs (the normal state mid-task), the "clean checkout" validates a **prior** commit that lacks the very artifacts the gate is certifying, and gate condition (2) — *"clean-checkout.log records frozen install and full-suite success"* — accepts that log as proof for the current tree. `T-01-19`'s stated mitigation ("Isolated worktree from HEAD … any drift fails VER-02") does not hold: drift between HEAD and the working tree is exactly what goes undetected.
- Fix (bounded): in `verify-clean-checkout.sh`, (a) abort unless `git status --porcelain` is empty; (b) capture `git rev-parse HEAD` and write it as the first line of `clean-checkout.log` plus into a `clean_checkout.head_sha` field; (c) after `worktree add`, assert presence of the phase's committed artifacts (`scripts/phase-01-gate.mjs`, `scripts/verify-phase-01.sh`, `apps/napplet/src/config/source-policy.json`, `.planning/evidence/phase-01/package-audit.md`, `apps/napplet/tests/smoke/a11y-contract.mjs`) and fail closed on any missing; (d) in `phase-01-gate.mjs` condition (2), fail unless the logged SHA equals current `HEAD` **and** the working tree is clean.

**2. [verify_command_format] Plan 05 Task 2's `<automated>` verify is fail-open — a failed clean checkout or a crashed gate script still passes the task**
- Plan: 01-05, Task 2
- Evidence: `<automated>bash scripts/verify-clean-checkout.sh && node scripts/phase-01-gate.mjs; test -s .planning/evidence/phase-01/EVIDENCE-INDEX.md && test -s .planning/evidence/phase-01/gate-verdict.json</automated>`. The `;` discards both preceding exit codes; the command's status is the final `test -s`, which passes on **stale** files from any earlier run. A gate script that throws, or a clean-checkout that fails, is indistinguishable from success.
- Fix: split into `bash scripts/verify-clean-checkout.sh && node scripts/phase-01-gate.mjs --emit-only && node -e "const v=require('./.planning/evidence/phase-01/gate-verdict.json'); if(!v.generated_at||!Array.isArray(v.checks)||v.checks.length!==9||!['PASS','FAIL'].includes(v.verdict)) process.exit(1)"` plus a freshness assertion (`generated_at` within this run). Keep "verdict may legitimately be FAIL" as a *recorded* outcome, but make "gate did not run / evidence is stale" a hard command failure.

**3. [key_links_planned] `verify-phase-01.sh` is never extended after Plan 02, so the phase runner, the clean-checkout ladder, and gate condition (1) exercise a stale subset of validators and smoke cases**
- Plans: 01-02 (T2), 01-03 (T3), 01-04 (T3), 01-05
- Evidence: Plan 02 defines the runner as *"unit tests → typecheck → lint → build → verify-dist → conformance → **current Paja smoke cases** → verify-shell-boundary → verify-map-provenance → validate-fallback-ledger → scan:secrets"* and wires root scripts `verify:phase-01, verify:dist, verify:map-provenance, verify:fallback-ledger, verify:shell-boundary, scan:secrets, test:smoke:paja`. `verify:ortho-source-policy` is **not** wired anywhere (01-VALIDATION row `01-04-01` names it as the automated command), `verify-no-local-surface` and `test:local-resource-boundary` are not in the runner, and neither `scripts/verify-phase-01.sh` nor root `package.json` appear in Plan 03/04 `files_modified`. Consequently the cases added later (`draw-edit-clear`, `preview-ready`, `resource-denied`, `resource-timeout`, `ui-states`) are never run by the runner, contradicting Plan 05's must-have truth *"the entire validation ladder passes from the working tree AND from a frozen-install clean checkout: … all Paja built-artifact cases, provenance/source-policy/shell-boundary/ledger/no-local-surface validators"*.
- Fix: make `verify-phase-01.sh` enumerate smoke cases from a single checked-in manifest (e.g. `apps/napplet/tests/smoke/cases.json`) and add `verify:ortho-source-policy`, `verify:no-local-surface`, `test:smoke:ui`, `test:a11y` to the ordered runner; add `scripts/verify-phase-01.sh`, root `package.json`, and the case manifest to `files_modified` of Plans 03, 04, 05, each appending its own cases in the same task that creates them.

**4. [task_completeness] `package-audit.md` is a must-have artifact and gate input, but no task is assigned to produce it**
- Plan: 01-01
- Evidence: `files_modified` and `must_haves.artifacts` both list `.planning/evidence/phase-01/package-audit.md` (*"Human-approved package pins and evidence recorded before any lockfile exists"*). Task 1 creates only provenance + ledger + validators + README. Task 2 is `checkpoint:human-verify`, whose `<what-built>` describes the dossier as already *"assembled into `.planning/evidence/phase-01/package-audit.md`"* — but checkpoints have no `<files>`/`<action>` and build nothing. Every downstream gate depends on this file: Plan 02 precondition, Plan 03 `read_first`, Plan 05 gate condition (4).
- Fix: insert an `auto` task between the current Tasks 1 and 2 that assembles the dossier (per-package: registry URL, repo ownership, license, version, tarball identity from `/tmp/npm-packs/pack-output.json`, lifecycle-script findings, peer reconciliation, exact pin) with `<automated>` verifying the file parses and contains one row per named package and zero rows outside the list; the checkpoint then reviews it.

**5. [context_compliance] Human sign-off can be recorded over a machine FAIL — the guard is prose only**
- Plan: 01-05, Task 3
- Evidence: `<resume-signal>Type "approved" to record the sign-off and close Phase 1…</resume-signal>` is offered unconditionally; the only restraint is `<how-to-verify>` step 1 prose (*"if the verdict is FAIL with reason blocked-on-G2, the phase does NOT complete"*), which covers **one** of nine possible FAIL reasons. The executor action is *"flips gate-verdict.json human_signoff to approved"* with no precondition, so an approved-but-FAIL verdict is mechanically writable, defeating T-01-17.
- Fix: add `scripts/phase-01-signoff.mjs` (or a `--signoff` mode of `phase-01-gate.mjs`) that refuses to write `human_signoff: "approved"` unless the freshly recomputed verdict is `PASS`, and rewrite the resume-signal to: *"If verdict is PASS, type 'approved'… If verdict is FAIL, the only valid responses are 'acknowledged-blocked' (records the FAIL reasons and leaves the phase open) or a described failing evidence item."*

**6. [task_completeness] The Paja/UI smoke harness plans to import Playwright from a transitive dependency, which pnpm's isolated `node_modules` will not resolve — and adding it would trip the gate's own supply-chain check**
- Plans: 01-02 (T2), 01-05 (T1)
- Evidence: Plan 02: *"drives Chromium automation against the Paja runtime (**reuse the Playwright chromium already pulled in by `@napplet/conformance-cli`** — no new package)"*; Plan 05 repeats *"reuse the conformance CLI's Playwright Chromium — no new package"*. Under pnpm's default (non-hoisted) layout, `apps/napplet/tests/smoke/*.mjs` cannot import a package it does not declare. Installing it ad hoc during execution then fails Plan 05 gate condition (4) (*"every dependency name@version in pnpm-lock.yaml importers appears in the approved pin list"*), because Playwright is absent from the Plan 01 approved list. All SBOX-02/VER-03/VER-04-T1/T3/UI evidence depends on this harness.
- Fix: add the exact `playwright`/`@playwright/test` pin (and its browser-provisioning story) to the Plan 01 Task 2 dossier and approval list **before** the Plan 02 lockfile mutation; alternatively pin `node-modules-linker`/`public-hoist-pattern` in `.npmrc` and state the resolved path explicitly, and record the chosen mechanism in the audit. Either way the harness's browser dependency must be an approved, declared pin.

**7. [requirement_coverage] MAP-06 is planned only for the orthophoto half — no basemap tile endpoint is pinned, policy-verified, or allowlisted, and the source-policy validator forbids a second source**
- Plans: 01-03 (T3), 01-04 (T1/T2)
- Evidence: Plan 03: *"basemap raster tiles are requested ONLY through the shell resource adapter … bounded to visible tiles with normal caching and no prefetch/bulk behavior (MAP-06)"* — but no basemap URL template, host, usage policy, rate limit, or attribution source is pinned anywhere. Gate G2 (Plan 04 T1) verifies exactly one **orthophoto** endpoint, and `verify-ortho-source-policy.mjs` *"exits 0 only if the record parses, **has exactly one source**"*. Named case 19 (`source_policy_rejects_unapproved_origin_layer_or_scheme`) then rejects any URL outside that single record — i.e. every basemap tile request. MAP-06 requires attribution and bounded policy-compliant requests for *map and orthophoto* views, and PROJECT-BRIEF requires respecting upstream OSM tile policy.
- Fix: extend the policy record to a two-entry schema (`basemap` + `imagery`), each with its own verified fields and status, update `verify-ortho-source-policy.mjs` to require exactly one entry per role, add basemap verification (host/template, OSM tile usage policy compliance, attribution, rate/bounds) to Plan 04 Task 1, and make `source.ts` allowlist both roles.

**8. [requirement_coverage] MAP-05 has a detection plan but no achievement plan — the expected outcome of the plan set is a FAIL verdict**
- Plans: 01-04 (T1), 01-05 (T2)
- Evidence: Plan 04 Task 1 lists the only candidates with their already-known blockers: *"NLS Finland WMTS (… tested capabilities URL returned 401 with no usable CORS), Kapsi NLS mirror (… tested tile redirected to an unresolvable host), USGS imagery service (… exact terms page unverified)"*, and instructs *"do not invent a new endpoint"*. Plan 05 gate condition (3) then hard-fails the phase on anything but `live-verified` + `live`. Phase 1 Success Criterion 2 requires a live attributed preview; no task obtains a source that can satisfy it, and OPS-01's 30-minute fallback law has no documented fallback that satisfies MAP-05 (fixture/unavailable are explicitly excluded).
- Fix: add a bounded source-selection task before Plan 04 Task 2 — enumerate ≥5 candidate public/licensed WMTS/WMS endpoints (including operator-supplied credentials mediated by the shell, which keeps SBOX-04 intact), execute the per-field contract test against each, stop at the first fully passing candidate — followed by a blocking `checkpoint:human-verify` if none pass, whose options are (a) operator supplies an approved endpoint, or (b) record the OPS-01 activation and re-scope MAP-05 with the user. Do not leave "phase blocks" as the sole planned branch.

**9. [task_completeness] Named cases 5 and 7 are mutually unsatisfiable as specified — ORDER and ANTIMERIDIAN claim the same inputs with no discriminator**
- Plan: 01-03, Task 1
- Evidence: `<behavior>` fixes clause order as *"malformed → range → order → antimeridian → area limit (first failing clause wins)"* with `bbox_rejects_west_greater_or_equal_east` → `ORDER`. The `<action>` then states *"any bbox where west ≥ east after range checks … is rejected with code **ANTIMERIDIAN** when both longitudes are in range but ordered west ≥ east across the line"*. In `[W,S,E,N]` with both longitudes in range, "crossing the antimeridian" **is** `west ≥ east` — so the same input must return two different codes, and under the stated clause order `ANTIMERIDIAN` is unreachable. UI-SPEC has distinct copy for each ("West must be less than east…" vs. "Selections crossing the ±180° line are not supported…"), so the mapping must be decided, not left to the executor.
- Fix: pin the discriminator explicitly in the action, e.g. `ANTIMERIDIAN` for inputs whose longitudes are out of `[-180,180]` in the wrapping sense or that arrive pre-flagged as crossing (east < west with `east + 360 - west ≤ configured max span`), `ORDER` for all other `west ≥ east`; state which named case exercises which and align the UI copy mapping.

**10. [scope_sanity] Three plans exceed the file-count blocker threshold and three tasks are single-task monoliths**
- Plans: 01-02 (21 files / 2 tasks), 01-03 (19 files / 3 tasks), 01-04 (21 files / 3 tasks); Plan 01-05 (13 files) is borderline.
- Evidence: Task 01-02-01 alone lists 15 files (workspace scaffolding + lockfile mutation + Vite/TS/Vitest config + adapter + tokens + app shell + `verify-dist.mjs`) plus build and conformance runs. Task 01-03-03 lists 11 files and implements the map, the rectangle state machine, eight UI components, verbatim copy, the full accessibility contract, and a new Paja case. Task 01-04-03 embeds an entire conditional sub-project: *"build the local fallback TDD-first — RED security tests before first run covering loopback-only bind …, startup-generated scoped token …, exact origin/capability allowlist …, then GREEN implementation"*.
- Fix: split 01-02 into 02a (workspace + lockfile + adapter + tokens + skeleton + `verify-dist`) and 02b (Paja harness + boundary scan + secret scanner + phase runner); split 01-03 into 03a (Tasks 1–2, pure domain TDD) and 03b (map + UI + Paja case); extract 01-04 Task 3's conditional local-fallback branch into its own conditionally-executed plan (`01-04b`) gated on the recorded OPS-01 activation, leaving Task 3 with the three smoke cases and the no-local-surface evidence.

**11. [task_completeness] `lint` runs in the phase runner and the clean-checkout gate, but no plan creates an ESLint configuration**
- Plan: 01-02, Task 1
- Evidence: the task installs `eslint@9.39.2`, `@eslint/js@9.39.2`, `typescript-eslint@8.46.4` and adds a `lint` script; `verify-phase-01.sh` runs *"unit tests → typecheck → **lint** → build …"*. No `eslint.config.js`/`eslint.config.mjs` appears in any plan's `files_modified`. ESLint 9 errors out without a flat config, so the runner and therefore the VER-02 clean-checkout gate fail on first execution.
- Fix: add `eslint.config.mjs` (flat config composing `@eslint/js` + `typescript-eslint`, scoped to `apps/napplet/src` and `scripts/`) to Task 01-02-01 `<files>` and `<action>`, and add it to the acceptance criteria.

**12. [scope_reduction] The fixed v1 request defaults — user-visible and carried into Phase 2's signed request — are deferred to the executor, with an example that misstates the output type**
- Plan: 01-02, Task 1
- Evidence: *"`src/config/defaults.ts`: … `RES_M`, `OUTPUT_MIME`, `MAX_AREA_KM2`, `TIMEOUT_S` (**choose concrete values now** and document them as the configured v1 defaults, **e.g. resolution 10 m/px, output image/png**, max area 100 km², timeout 15 s)"*. ROADMAP records MAP-07 as a *planning* decision (*"MAP-07 displays the configured fixed v1 resolution/output defaults"*), and these values render verbatim in the UI-SPEC rows "Resolution: **{RES_M} m/px** — fixed for v1 · Output: **{OUTPUT_MIME}** — fixed for v1". `OUTPUT_MIME` is the *requested terrain artifact* MIME (REQUIREMENTS PROT-03 "requested output MIME"; Phase 2 DUM-01 delivers GLB 2.0) — `image/png` would make the canonical request preview state the wrong output type and contradicts Phase 2. `RES_M: 10` also silently pre-consumes PROC-06's 10 m *fallback* as the default.
- Fix: pin the four values in the plan (not "e.g."): `OUTPUT_MIME = "model/gltf-binary"`, `RES_M` = the intended v1 default (5 unless the user decides otherwise), `MAX_AREA_KM2`, `TIMEOUT_S`; if the values are genuinely undecided, add a short `checkpoint:human-verify` in Plan 01 to record them alongside the package approval.

---

### Warnings (should fix)

**1. [task_completeness] Plan 01-03 Task 3's acceptance demands unit/snapshot copy assertions but the task creates no test file.** `<acceptance_criteria>`: *"UI strings match the Copywriting Contract verbatim (unit/snapshot assertions reference the exact strings)"*, yet `<files>` contains no test path; only the Paja case asserts *one* string ("the exact range-error string"). 01-VALIDATION row for MAP-04 states *"UI error copy asserted in 01-03-03"*. **Fix:** add `apps/napplet/tests/unit/ui-copy.test.ts` covering all five MAP-04 strings plus toolbar/empty-state/toast copy to the task's files and `<automated>`.

**2. [task_completeness] Named case 10 is tautological.** *"a 1°×1° box at the equator matches **the @turf/area reference value** within 0.5%"* — the implementation delegates to `@turf/area`, so the test asserts the library against itself. (Case 11's cos-latitude ratio does still exclude degree arithmetic.) **Fix:** assert the absolute expected value (~12,308 km² ±0.5%).

**3. [key_links_planned] Attribution copy is undefined for the most likely Phase 1 state.** UI-SPEC has a single always-visible string *"Basemap © OpenStreetMap contributors · Imagery © {SOURCE_ATTRIBUTION} — {LICENSE_ID}"*, and named case 20 renders it *"from the policy record"* — but when `status: "unavailable"` those placeholders have no value. **Fix:** define and assert the no-imagery-source attribution variant in Plan 04 Task 2 `<behavior>` (basemap credit only, no dangling separator).

**4. [context_compliance] No blocking checkpoint before standing up the conditional local listening surface.** Plan 01-04 is `autonomous: true` while Task 3 may build an authenticated local server; ROADMAP's Phase 1 entry gate treats non-loopback exposure as approval-gated and the plan itself requires *"startup refusal on … non-loopback bind without recorded approval"*. **Fix:** add a `checkpoint:human-verify` immediately before the fallback branch (after the ledger entry, before first run).

**5. [context_compliance] The package approval's scope is narrower than the installs it must authorize.** Plan 01-01 resume-signal: *"authorize exactly these pins for **the single lockfile mutation in Plan 02**"*, but Plan 01-03 performs two further mutations (`@turf/area`, then `maplibre-gl`/`terra-draw`/`terra-draw-maplibre-gl-adapter`). **Fix:** reword to "for all Phase 1 installs (Plans 02 and 03)" and list the per-plan install split in the dossier.

**6. [verify_command_format] Gate condition (4) parses `pnpm-lock.yaml` with "zero new dependencies".** Regex-parsing lockfile YAML is brittle and can silently under-match. **Fix:** derive direct deps from `pnpm ls -r --depth 0 --json` (JSON, no parser needed) and cross-check that against the approved pin list.

**7. [key_links_planned] `pnpm test:local-resource-boundary` is named in 01-VALIDATION (conditional SBOX-05 row) but no plan wires it.** Plan 04 Task 3 creates only `verify-no-local-surface.mjs` and describes the security tests in prose. **Fix:** wire the script name in the fallback branch, or amend the VALIDATION row to the actual command.

**8. [task_completeness] No `.gitignore` is created.** `dist/` is described as *"build output, not committed"*, and the clean-checkout script creates a temp worktree; nothing establishes ignores for `node_modules/`, `apps/napplet/dist/`, or worktree paths — the Plan 05 public-diff review would otherwise face committed build output. **Fix:** add `.gitignore` to Task 01-02-01.

**9. [task_completeness] Kehto/Paja automation assumptions are unverified and have no named fallback.** *"launches `kehto paja --target-url http://127.0.0.1:4173 -- pnpm … vite preview`"* and, for the timeout case, *"if Paja offers no injection point, run the preview server through a local delay proxy owned by the harness process only"*. The first is an unverified CLI contract on which all SBOX-02/VER-03 evidence rests. **Fix:** add a first sub-step that probes `kehto paja --help` and records the observed flags into the boot evidence, with the SBOX-02 documented fallback named if the flags differ.

**10. [verification_derivation] Feedback-latency claim is unlikely to hold.** 01-VALIDATION asserts *"full suite target ≤180 seconds"*, but `verify-phase-01.sh` chains unit + typecheck + lint + production build + conformance + multiple Paja browser cases + scanners, and `verify:clean:phase-01` adds a cold `pnpm install --frozen-lockfile`. **Fix:** re-measure after Plan 02 and update the VALIDATION table, or split a "quick" runner from the full ladder.

**11. [verification_derivation] The `preview-ready` outcome flag is harness-authored rather than observed.** Gate condition (3) trusts *"the preview-ready Paja evidence records outcome `live`"*; the harness writes that flag itself, so a harness bug or an edited evidence file satisfies the strongest honesty gate in the phase. **Fix:** derive the recorded outcome from the built app's own rendered transport (source-row suffix text + indicator dot class) read out of the DOM, and cross-check it against `source-policy.json` status inside the gate.

**12. [architectural_tier_compliance] SBOX-03 is enforced by a comment-filtered grep only.** `verify-shell-boundary.mjs` scans for `window.napplet` and `@napplet/sdk` outside `src/shell/`; nothing asserts the built artifact makes zero direct network egress (MapLibre worker-side fetches, image `src`, CSS `url()`). **Fix:** add a Paja assertion that the page issues no request outside the adapter path (request log already captured by the harness per Plan 02 Task 2).

---

### Structured Issues

```yaml
issues:
  - plan: "01-05"
    task: 2
    dimension: verification_derivation
    severity: blocker
    description: "verify-clean-checkout.sh creates a worktree from HEAD with no clean-tree requirement, no SHA binding, and no assertion that prior-plan outputs are present; the clean-checkout log can certify a commit that lacks the gated work"
    fix_hint: "Abort on dirty tree; record HEAD SHA in the log and gate-verdict.json; assert phase artifacts exist in the worktree; gate condition 2 compares logged SHA to current HEAD"
  - plan: "01-05"
    task: 2
    dimension: verify_command_format
    severity: blocker
    description: "'... && node phase-01-gate.mjs; test -s A && test -s B' discards both exit codes; stale evidence files make a failed clean checkout or crashed gate pass"
    fix_hint: "Chain with &&; validate gate-verdict.json shape, 9 checks, and freshness instead of `test -s`"
  - plans: ["01-02", "01-03", "01-04", "01-05"]
    dimension: key_links_planned
    severity: blocker
    description: "verify-phase-01.sh is never extended after Plan 02; verify:ortho-source-policy, verify:no-local-surface, test:smoke:ui, test:a11y and the later Paja cases are outside the runner, so the VER-02 clean-checkout ladder and gate condition 1 verify a subset"
    fix_hint: "Case-manifest-driven runner; add verify-phase-01.sh and root package.json to files_modified of Plans 03-05"
  - plan: "01-01"
    task: 2
    dimension: task_completeness
    severity: blocker
    description: "package-audit.md is a must_have artifact and downstream gate input, but only a checkpoint references it — no task builds it"
    fix_hint: "Add an auto task that assembles the dossier before the blocking checkpoint"
  - plan: "01-05"
    task: 3
    dimension: context_compliance
    severity: blocker
    description: "Human sign-off can be recorded over a machine FAIL; only prose covering one of nine FAIL reasons prevents it"
    fix_hint: "Signoff script refuses approved unless recomputed verdict is PASS; restrict resume-signal options by verdict"
  - plans: ["01-02", "01-05"]
    dimension: task_completeness
    severity: blocker
    description: "Smoke/UI harnesses plan to import Playwright from a transitive dep of @napplet/conformance-cli, unresolvable under pnpm isolation and absent from the approved pin list"
    fix_hint: "Add the Playwright pin to the Plan 01 dossier/approval before the Plan 02 lockfile mutation, or pin an explicit hoist/resolution mechanism"
  - plans: ["01-03", "01-04"]
    dimension: requirement_coverage
    severity: blocker
    description: "MAP-06 basemap half unplanned: no verified OSM tile endpoint/policy record, and the source-policy validator requires exactly one (ortho) source, so basemap requests are either unallowlisted or blocked"
    fix_hint: "Two-role policy record (basemap + imagery) with per-role verification and allowlisting"
  - plans: ["01-04", "01-05"]
    dimension: requirement_coverage
    severity: blocker
    description: "No task plans to obtain a live-verified ortho source; the only endpoint work targets three candidates already recorded as failing, and no OPS-01 fallback satisfies MAP-05 — expected phase outcome is FAIL"
    fix_hint: "Bounded multi-candidate source-selection task plus a blocking operator checkpoint if none pass"
  - plan: "01-03"
    task: 1
    dimension: task_completeness
    severity: blocker
    description: "ORDER vs ANTIMERIDIAN codes claim the same inputs; under the pinned clause order ANTIMERIDIAN is unreachable and named cases 5 and 7 cannot both pass"
    fix_hint: "Pin an explicit discriminator and the case-to-code mapping in the action"
  - plans: ["01-02", "01-03", "01-04"]
    dimension: scope_sanity
    severity: blocker
    metrics: {files_plan_02: 21, files_plan_03: 19, files_plan_04: 21, files_task_01_02_01: 15, files_task_01_03_03: 11}
    description: "Three plans exceed the 15-file blocker threshold; tasks 01-02-01, 01-03-03 and 01-04-03 are monoliths (01-04-03 embeds a full authenticated local server with security TDD)"
    fix_hint: "Split 02 -> 02a/02b, 03 -> 03a/03b, extract 01-04-03's fallback branch into a conditional plan 04b"
  - plan: "01-02"
    task: 1
    dimension: task_completeness
    severity: blocker
    description: "ESLint 9 is installed and `lint` runs in the phase runner and clean-checkout gate, but no eslint flat config file is created by any plan"
    fix_hint: "Add eslint.config.mjs to task files, action, and acceptance criteria"
  - plan: "01-02"
    task: 1
    dimension: scope_reduction
    severity: blocker
    description: "Fixed v1 request defaults deferred to the executor with an example (OUTPUT_MIME image/png) that misstates the requested artifact type and contradicts Phase 2 GLB delivery"
    fix_hint: "Pin RES_M / OUTPUT_MIME / MAX_AREA_KM2 / TIMEOUT_S in the plan (OUTPUT_MIME = model/gltf-binary) or add a decision checkpoint in Plan 01"
  - plan: "01-03"
    task: 3
    dimension: task_completeness
    severity: warning
    description: "Acceptance requires verbatim copy assertions in unit/snapshot tests but no test file is in the task's files"
    fix_hint: "Add tests/unit/ui-copy.test.ts covering all five MAP-04 strings plus toolbar/empty-state/toast copy"
  - plan: "01-03"
    task: 1
    dimension: verification_derivation
    severity: warning
    description: "Named case 10 compares @turf/area output to the @turf/area reference value — tautological"
    fix_hint: "Assert ~12,308 km² +/- 0.5% for a 1x1 degree equatorial box"
  - plan: "01-04"
    task: 2
    dimension: key_links_planned
    severity: warning
    description: "Attribution string has no defined form when source-policy status is unavailable — the most likely Phase 1 state"
    fix_hint: "Define and assert the no-imagery-source attribution variant"
  - plan: "01-04"
    task: 3
    dimension: context_compliance
    severity: warning
    description: "Conditional local listening surface is created inside an autonomous plan with no blocking checkpoint"
    fix_hint: "Add checkpoint:human-verify after the ledger entry, before first run"
  - plan: "01-01"
    task: 2
    dimension: context_compliance
    severity: warning
    description: "Approval scope names only Plan 02's lockfile mutation while Plan 03 performs two more installs"
    fix_hint: "Reword resume-signal to cover all Phase 1 installs with the per-plan split listed"
  - plan: "01-05"
    task: 2
    dimension: verify_command_format
    severity: warning
    description: "Lockfile-to-approved-pins cross-check parses pnpm-lock.yaml without a YAML parser"
    fix_hint: "Use `pnpm ls -r --depth 0 --json` as the input"
  - plan: "01-04"
    task: 3
    dimension: key_links_planned
    severity: warning
    description: "01-VALIDATION names `pnpm test:local-resource-boundary` but no plan wires it"
    fix_hint: "Wire the script in the fallback branch or amend the VALIDATION row"
  - plan: "01-02"
    task: 1
    dimension: task_completeness
    severity: warning
    description: "No .gitignore is created for node_modules/, dist/, or temp worktree paths"
    fix_hint: "Add .gitignore to task 01-02-01"
  - plan: "01-02"
    task: 2
    dimension: task_completeness
    severity: warning
    description: "kehto paja CLI flags and the timeout injection point are unverified assumptions carrying all SBOX-02/VER-03 evidence"
    fix_hint: "Probe and record observed CLI flags in boot evidence; name the SBOX-02 fallback if they differ"
  - plan: null
    dimension: verification_derivation
    severity: warning
    description: "01-VALIDATION's <=180s full-suite target is inconsistent with a ladder containing build + conformance + multiple browser cases, plus a cold frozen install for the clean-checkout gate"
    fix_hint: "Re-measure after Plan 02 and update the table, or separate quick vs full runners"
  - plan: "01-05"
    task: 2
    dimension: verification_derivation
    severity: warning
    description: "Gate condition 3 trusts a live/fixture honesty flag written by the harness itself"
    fix_hint: "Derive the outcome from the built app's rendered transport suffix/indicator and cross-check against source-policy status"
  - plan: "01-02"
    task: 2
    dimension: architectural_tier_compliance
    severity: warning
    description: "SBOX-03 enforcement is a static grep only; no assertion that the built artifact makes zero direct network egress outside the adapter"
    fix_hint: "Add a Paja request-log assertion using the harness's existing request summary"
```

---

### Non-blocking recommendations

- Generate `EVIDENCE-INDEX.md` from `phase-01-gate.mjs` rather than hand-authoring it, so "no empty evidence cell" is structurally guaranteed instead of review-dependent.
- Have `verify-clean-checkout.sh` copy the worktree's conformance/Paja evidence back under `.planning/evidence/phase-01/clean/` before teardown — currently everything the clean run produces is discarded, so only the log survives.
- Pin the Paja preview port via an env var rather than the hard-coded `4173`, since the clean-checkout run can collide with a working-tree run.
- Consider recording the a11y checker's provenance explicitly in `a11y-contract.json` (hand-rolled contrast computation from `tokens.css` literals verifies declared tokens, not rendered pairs) so the UI-SPEC's "axe-core or equivalent" claim stays auditable.

### Recommendation

12 blocker(s) require revision before execution. The strongest structural finding is the VER-02 chain: a HEAD-based worktree with no commit binding (Blocker 1), a fail-open verify command (Blocker 2), and a runner that never grows past Plan 02 (Blocker 3) mean the clean-checkout gate can report green over a state that is neither the gated tree nor the full ladder. Blockers 7 and 8 mean the phase goal (live attributed preview, policy-compliant map) has no planned path to success, only a planned path to detecting failure. Returning to planner with the fixes above.
