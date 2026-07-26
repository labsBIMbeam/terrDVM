VERDICT: REVISE

Independent fail-closed roadmap review of terrDVM (read-only). Reviewed the actual files: `AGENTS.md`, `docs/PROJECT-BRIEF.md`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/SUMMARY.md`, `.planning/reviews/requirements-fable5.md`, `.planning/reviews/requirements-opus5-final.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/config.json`, `$HOME/.hermes/agents/gsd-roadmapper.md`, and `$HOME/.hermes/gsd-core/templates/roadmap.md`. The Fable self-report (`.planning/reviews/roadmap-fable5.md`) was deliberately not consulted.

The roadmap's structure is sound: four phases, correct immutable order, 67/67 requirements mapped exactly once, DUM-04 as the sole Phase 3 opener, approval checkpoints inside phases, compound requirements expanded into named tests, and STATE.md routing correctly to Phase 1. Two blocking defects remain, both narrow and both fixable without moving requirement ownership or changing phase structure.

## Blocking findings

### B1 — Phase 1 can ship an unauthenticated local backend surface, contradicting its own Gate 1

`REQUIREMENTS.md` Gate 1 (`:164`) states as acceptance criteria: "21maps provenance is verified before reuse, **and local DVM/shell surfaces remain loopback-bound and authenticated**."

`SBOX-02` (Phase 1, `REQUIREMENTS.md:31`) explicitly permits Phase 1 to activate "the exact documented shell/backend resource fallback" when the built Napplet cannot reach ortho/tile resources under the real CSP. Research SUMMARY `:136` confirms this is a likely Phase 1 outcome ("a proven narrow backend fallback if the built CSP blocks the preferred route"). The requirement that constrains such a surface — `SBOX-05` (`:34`: loopback default, scoped local auth token on every state-changing *or retrieval* endpoint, narrow origin/capability policy, fail closed on missing auth or unapproved non-loopback exposure) — is owned by Phase 2 and named in `ROADMAP.md:45` only as a *Phase 2 planning* item.

Consequence: `ROADMAP.md` Phase 1 has no entry gate, success criterion, or exit gate covering a Phase 1 local surface. Phase 1 could therefore be declared complete while running an unauthenticated, potentially non-loopback HTTP proxy — on conference Wi-Fi, per the brief's own operating context — in direct violation of the Gate 1 clause that `REQUIREMENTS.md` already ratified. `SBOX-05` explicitly names the "shell bridge," so this is not a coverage ambiguity; it is a phase-placement gap.

Single-ownership must be preserved (`SBOX-05` stays Phase 2), so the fix applies the boundary conditionally in Phase 1 without re-mapping the requirement.

**Fix 1a — `.planning/ROADMAP.md`, `### Phase 1: Sandboxed Bbox and Orthophoto UI` → `**Entry gates**:` (currently lines 25–27). Append a third bullet:**

```
- If Phase 1 introduces any local shell/backend resource surface (the SBOX-02 fallback route), the SBOX-05 boundary applies to it from first run — loopback bind by default, scoped local auth token on every endpoint, fail closed on missing auth or unapproved non-loopback exposure. No unauthenticated or non-loopback local surface may exist at Phase 1 exit (REQUIREMENTS.md Gate 1). SBOX-05 ownership remains Phase 2; this is early application of the boundary, not a second mapping.
```

**Fix 1b — `.planning/ROADMAP.md:32`, Phase 1 Success Criterion 4. Replace in full with:**

```
  4. Built browser assets and committed code contain no private keys, Lightning admin credentials, Blossom authorization, NIP-46 material, bearer headers, or privileged token-bearing URLs; all signing/relay/resource/storage/payment/upload access goes through feature-detected shell capabilities; and any local shell/backend resource surface introduced by the SBOX-02 fallback is loopback-bound, requires a scoped local auth token on every endpoint, and fails closed on missing auth or unapproved non-loopback exposure
```

No change to `REQUIREMENTS.md` is needed — Gate 1 already carries the constraint; the roadmap is the artifact out of sync.

### B2 — No recurring secret scan on a public repository that auto-commits phase evidence

`AGENTS.md:23` is unconditional: "Public repository: never commit credentials, private keys, invoices containing secrets, production URLs with embedded tokens, or captured authorization headers." `.planning/config.json:3` sets `"commit_docs": true`, so phase evidence, traces, and fixtures are committed automatically.

`VER-06` (final secret scan and public GitHub diff review) is owned by Phase 4 and is **not** in the roadmap's enumerated recurring-gate set. `ROADMAP.md:103` lists exactly six recurring gates — SBOX-01, SBOX-02, VER-02, VER-03, VER-04, OPS-01 — and every phase's `**Exit gates (recurring)**` line (`:34`, `:55`, `:75`, `:95`) reflects that set. `SBOX-04` (Phase 1) does assert that committed code contains no secrets, but as a Phase-1-owned, non-recurring criterion it cannot cover anything committed afterwards.

Consequence: Phase 2 is precisely the phase that produces LNbits/Phoenixd credentials in configuration, real BOLT11 invoices and payment hashes, a scoped local auth token (SBOX-05), request-bound capability URLs (DIST-06), and a signer key pair (SBOX-06) — and its evidence is auto-committed to a public repo with no scan until Phase 4. Phase 3 adds WCS endpoint contracts and any provider auth. This is a fail-closed gap on the project's most explicit safety rule, and the exposure is irreversible once pushed.

**Fix 2a — `.planning/ROADMAP.md`, `#### Recurring Phase-Exit Gates` (line 103). Replace the paragraph in full with:**

```
SBOX-01, SBOX-02, VER-02, VER-03, VER-04, and OPS-01 each have exactly one owning phase in the traceability table (SBOX-01/SBOX-02/VER-02/OPS-01 → Phase 1; VER-03/VER-04 → Phase 4), but all six re-run as standing exit gates at the end of **every** phase: production single-file build, `napplet-conformance` against `dist`, built-artifact browser smoke under the real sandbox/CSP, clean-checkout typecheck/lint, the phase's VER-04 failure-path subset, and the OPS-01 fallback-ledger review. In addition, the secret-scan and public-diff-review portion of VER-06 re-runs at the end of **every** phase against everything that phase commits — source, evidence, traces, fixtures, and configuration — because `commit_docs` is enabled and this is a public repository (AGENTS.md). VER-06 ownership remains Phase 4, where it additionally gates approved public deployment with cryptographic publication/readback. Negative testing and secret scanning are per-phase evidence, never a terminal batch that can be cut.
```

**Fix 2b — `.planning/ROADMAP.md`, each phase's `**Exit gates (recurring)**` line (`:34`, `:55`, `:75`, `:95`). Append to each:**

```
, VER-06 secret-scan and public-diff review of everything this phase commits
```

**Fix 2c — `.planning/REQUIREMENTS.md:195` (Traceability preamble). Replace the sentence beginning "SBOX-01, SBOX-02, VER-02, VER-03, VER-04, and OPS-01 additionally re-run…" with:**

```
SBOX-01, SBOX-02, VER-02, VER-03, VER-04, and OPS-01 additionally re-run as standing recurring phase-exit gates in every phase, as does the secret-scan/public-diff-review portion of VER-06 (see ROADMAP.md Standing Rules); ownership below remains singular.
```

Optionally mirror the same clause in the `Definition of Done` bullet at `REQUIREMENTS.md:191`, which currently names build, conformance, smoke, failure-path subsets, and OPS-01 but not the scan.

## Coverage and order assessment

**Phase count and order — PASS.** Exactly four phases, no fifth, no decimal insertions, no stretch/pricing phase. `ROADMAP.md:13–16` and the Progress table (`:193–198`) both list Phase 1 → 4 in the order `bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer`, matching `AGENTS.md:16`, brief `:9–17`, `PROJECT.md:47`, and research SUMMARY `:126`. Execution order stated as "1 → 2 → 3 → 4" (`:191`). Four phases is within the `coarse` granularity band (`config.json:94`); `phase_naming: "sequential"` and `project_code: null` are honored — headers are `### Phase N:`, parseable downstream.

**Coverage — PASS, verified by independent recount.** v1 totals recomputed from the requirement bodies, not from the stated figure: 8 MAP + 6 SBOX + 8 PROT + 5 JOB + 8 PAY + 4 DUM + 9 PROC + 7 DIST + 3 VIEW + 2 OPS + 7 VER = **67**. Roadmap phase lists: Phase 1 = 14, Phase 2 = 32, Phase 3 = 9, Phase 4 = 12 → **67**, no duplicates, no orphans. The `REQUIREMENTS.md` traceability table (`:199–265`) has 67 rows and agrees with the roadmap on every single ID. The two documents are consistent; there is no divergence to reconcile.

| Phase | Owned requirements | Count |
|---|---|---|
| 1 | MAP-01…08, SBOX-01…04, VER-02, OPS-01 | 14 |
| 2 | SBOX-05, SBOX-06, PROT-01…08, JOB-01…05, PAY-01…08, DUM-01…04, DIST-01, DIST-06, OPS-02, VER-01, VER-07 | 32 |
| 3 | PROC-01…09 | 9 |
| 4 | DIST-02, DIST-03, DIST-04, DIST-05, DIST-07, VIEW-01…03, VER-03, VER-04, VER-05, VER-06 | 12 |

**DIST-01 and DIST-06 in Phase 2 — PASS, and semantically correct.** This was constraint 4 of `requirements-opus5-final.md:38` and the roadmap honors it. `DUM-04` requires a *retrievable* dummy GLB, so Phase 2 necessarily stands up authoritative local storage (DIST-01) and the paid-retrieval authorization model (DIST-06). Assigning them to Phase 4 by section heading would have left the demo core retrieving paid artifacts with no authorization model. Phase 2 Success Criterion 3 (`:52`) makes both observable: retrieval "from authoritative local storage via an unguessable scoped expiring capability bound to the paid request ID and artifact hash," with "hash-knowledge-only requests retrieve nothing." `STATE.md:57` records the decision. Correct.

**Phase 3 opening condition — PASS.** Stated three times and consistently: Overview (`:5`), Phase 2 Success Criterion 4 (`:53`, "this recorded evidence is the sole permission to open Phase 3"), and Phase 3 entry gate (`:65`, "**Sole opening condition: recorded DUM-04 executable evidence.** Phase 3 never opens on elapsed time, calendar pressure, or partial Phase 2 progress"). No time-based or partial-progress escape hatch exists anywhere in the file. `PROC-01` — the load-bearing line — is owned by Phase 3 and reflected in Phase 3 Success Criterion 5, which additionally requires the Phase 2 paid trace to still pass with the real producer installed.

**Order-drift check — PASS.** No PROC, DIST-02/03/04, or VIEW requirement appears in Phase 1 or Phase 2. No raster, GDAL, mesh, or Python work is named before Phase 3; the Phase 3 entry gate even defers proving the Python/`uv`/GDAL install to Phase 3, matching research SUMMARY `:20` ("do not install the processor stack merely because its versions are known").

**Scope-bloat check — PASS.** Nothing in the roadmap traces outside `REQUIREMENTS.md`, the brief, or the research flags. `PRICE-01/02`, `EVOL-01/02`, `PROD-01/02/03` stay in v2; `ROADMAP.md:183` explicitly pushes user-selectable resolution to v2 *with* the pricing requirements rather than smuggling it into MAP-07. The exclusions (`:186`) restate FIPS, Freenet, bridges, custom tile server, Palace coupling, broad NIP standardization, bulk scraping, browser-held secrets, fake artifacts, and unapproved public deployment. The two additions beyond the requirement set — the Fallback Activation Ledger (`:111–122`) and Compound Requirement Expansion (`:124–179`) — are direct discharges of review constraints 8 and 6, not new product surface.

## Phase-by-phase assessment

### Phase 1 — Sandboxed Bbox and Orthophoto UI (14 requirements, 5 criteria)

**Goal** is an outcome, not a task, and is user-observable. Criteria map cleanly: SC1 ← MAP-01/02/03/04; SC2 ← MAP-05/06/07; SC3 ← SBOX-01/02 and the build half of VER-02; SC4 ← SBOX-03/04; SC5 ← OPS-01. MAP-08 correctly sits as an entry gate rather than a success criterion — provenance clearance is a precondition to writing map code, not an outcome of it, and this discharges Fable non-blocking point 5 and opus5 constraint 9. SC3's "or the exact documented shell/backend resource fallback is activated and named" correctly prevents dev-server-only success, which research SUMMARY `:118` flags as pitfall 6.

**SC5 is the weakest criterion** — instituting a blocker law is closer to process than to user-observable behavior. It is nonetheless the only way to make OPS-01 verifiable in its owning phase, and it demands a concrete artifact (a fallback-activation record with which/when/why), so it is acceptable as written.

**Defect: B1** — the SBOX-02 fallback surface is unconstrained in this phase. See fixes 1a/1b.

**Residual note:** MAP-03 requires a "geodesic or projected method rather than raw degree area" and MAP-04 requires an antimeridian-ambiguity rejection, but neither the criteria nor the entry gates pin *which* method or *what* antimeridian policy. Research SUMMARY `:213` flags "define antimeridian policy" as Phase 1 planning research. Carried below as a Phase 1 planning constraint rather than a roadmap defect.

### Phase 2 — Paid DVM Dummy Delivery (32 requirements, 5 criteria)

**The strongest phase in the document.** The goal correctly names the product's core proof. Criteria are observable and falsifiable: SC1 (one kind, result = kind + 1000, exactly one real BOLT11 invoice at the PAY-07 flat price, malformed/oversized/duplicate/unknown-version/over-limit/unapproved-input fail closed before invoicing); SC2 (paid reachable *only* via trusted LNbits/Phoenixd settlement readback, with the explicit negative list — no UI action, invoice display, relay message, webhook receipt alone, wrong/expired invoice, or unit mismatch — plus truthful state labels and the non-terrain placeholder disclosure); SC3 (Khronos-validated, SHA-256-verified, job-specific artifact behind a request-bound expiring capability); SC4 (the DUM-04 trace as the Phase 3 key); SC5 (the payment-UX fallback with settlement verification preserved).

**Entry gates are correctly sequenced.** PAY-07 and SBOX-05 resolve "**before any invoice or artifact endpoint exists**" (`:45`), which discharges opus5 constraint 3 — retrofitting a price cap or authorization boundary onto a live paid endpoint is the expensive failure mode. The R1 invoice-expiry clock decision (provider server time authoritative) is recorded at `:46` and again at `:184`, closing the one residual from `requirements-opus5-final.md:11`.

**Approval checkpoint is correctly placed inside the phase, before execution** (`:47–48`): recorded operator approval before first live invoice creation/settlement and before first non-local relay publication, with local `strfry` + local serving + explicit labeling as the default until approved. This satisfies `AGENTS.md:28`, Fable constraint 3, and opus5 constraint 2.

**Residual — success-criteria compression.** Thirty-two requirements against a 2–5 criterion cap means several owned requirements have no observable criterion: **SBOX-06** (dedicated demo signer key, never committed, pubkey in trace), **PAY-08** (per-pubkey and global rate/concurrency/open-invoice limits *before any provider invoice call*), **JOB-05** (a paid job that later fails stays visibly failed with an operator remedy path, never silently promoted), **PROT-07** (encrypted requests rejected; bbox/pubkey publicity disclosed), and **PROT-08** (explicit relay subscription filters and per-event size limits). PROT-06 (protocol-package purity) is architectural and legitimately unobservable. This is not a coverage defect — all five remain in the phase's `**Requirements**` list and reach `plan-phase` that way — but PAY-08 and SBOX-06 are money- and key-safety gates, and the roadmap already has the right vehicle for surfacing them. **Recommended (non-blocking):** add to `ROADMAP.md` `### Recorded Planning Decisions Carried Into Phases` (`:181`):

```
- **Phase 2 safety requirements without a dedicated success criterion** — SBOX-06 (dedicated demo signer key, local-only, pubkey in trace), PAY-08 (per-pubkey and global rate/concurrency/open-invoice limits enforced *before* any provider invoice call), JOB-05 (paid-then-failed stays visibly failed with an operator remedy path), PROT-07 (encrypted requests rejected with documented reason plus publicity disclosure), and PROT-08 (explicit kind/time/recipient subscription filters and per-event size limits) must each become named must_haves in Phase 2 planning; the five criteria compress 32 requirements and cannot carry them individually.
```

**Residual — approval is a hard prerequisite, not an option.** SC1, SC2, and SC4 all require a *real* invoice and *confirmed* settlement, so Phase 2 cannot exit without the VER-07 approval actually being granted. That is correct and intended, but the roadmap should foreclose the tempting substitute. **Recommended (non-blocking):** append to the Phase 2 approval-checkpoint block (`:48`):

```
- Phase 2 cannot be declared complete without this approval: SC1/SC2/SC4 require a real invoice and trusted settlement readback. A simulated, mocked, or replayed settlement may be used for automated tests only and can never constitute DUM-04 evidence or open Phase 3.
```

### Phase 3 — Bounded Terrain Processor (9 requirements, 5 criteria)

**Cleanest requirement-to-criterion fit in the document.** SC1 ← PROC-02 and the pre-retrieval half of PROC-03; SC2 ← PROC-04 plus the PROC-09 recording clause; SC3 ← PROC-05/06 with both fallbacks (10 m DTM, three-hour mesh cap) named and ledger-recorded; SC4 ← PROC-07/08; SC5 ← PROC-01, and its formulation is exactly right: "Payment and delivery semantics are byte-for-byte unchanged … the Phase 2 paid trace still passes with the real producer in place." That makes producer substitution falsifiable rather than assumed.

**Entry gates are complete and correctly ordered:** DUM-04 evidence (sole opener), PROC-09 license clearance *before any live retrieval*, a pinned WCS/ortho endpoint contract (endpoint, version, coverage/layer IDs, CRS/axis order, format, nodata, budgets), and proven Python 3.13/`uv` + GDAL isolation on the target host. These match research SUMMARY `:215` and `:243` and opus5 constraint 9.

**Residual — split PROC-09 clause.** PROC-09 requires license identifier and attribution to be "recorded in the artifact descriptor **and shown with the delivered result**." Phase 3 SC2 covers the recording; the *showing* happens in the Phase 4 viewer, which is owned by VIEW-02. **Recommended (non-blocking):** append to the Phase 4 entry gates (`:83–85`):

```
- Phase 4 planning carries the display half of PROC-09: the elevation/orthophoto license identifier and required attribution recorded in the Phase 3 artifact descriptor must be shown with the delivered result in the viewer (VIEW-02 surface, PROC-09 ownership stays Phase 3).
```

**Correctly absent:** no UI hint on Phase 3, which is right — it is a backend processor with no user-facing surface.

### Phase 4 — Blossom Replication and Built-Napplet Viewer (12 requirements, 5 criteria)

Criteria map fully: SC1 ← DIST-02/03; SC2 ← DIST-04/07; SC3 ← VIEW-01/02 and DIST-05; SC4 ← VIEW-03; SC5 ← VER-03/04/05/06. The Blossom public-hash-retrievability disclosure survives in SC1 ("the UI and evidence disclose that replicated bytes may become publicly hash-retrievable"), which is the honesty clause closing B2 of the requirements review. SC2 preserves artifact identity across the `DELIVERED_LOCAL` fallback and forbids GC from removing a paid artifact inside its retrieval window. The approval checkpoints (`:86–88`) correctly separate first-Blossom-upload approval (DIST-02) from final public-deployment approval plus cryptographic readback (VER-06).

**Residual — DIST-05 placement.** DIST-05 ("no artifact location, hash, descriptor, or retrieval capability exposed before durable confirmed payment") is owned by Phase 4, yet the exposure risk is live from Phase 2 onward, when the first paid artifact exists. There is no coverage hole: PAY-05 (Phase 2) independently forbids unpaid retrieval of "an artifact hash, URL, capability, or artifact bytes," and Phase 2 SC3 makes it observable. DIST-05 in Phase 4 then re-verifies the property across the added Blossom descriptor surface, which is a defensible reading. No change required; noted so the overlap is not mistaken for a duplicate mapping.

**Residual — DIST-07 placement.** Local storage disk/retention budgets and safe GC are owned by Phase 4 while local storage itself stands up in Phase 2 (DIST-01). Acceptable for a bounded demo; flagged only so Phase 2 planning does not build a storage layer whose retention model must be retrofitted.

### Cross-cutting mechanisms

**Compound requirement expansion — PASS.** All five compound requirements named by the prior reviews are expanded into named test IDs: PROT-02 (T1–T7), PROT-04 (T1–T7), PAY-06 (T1–T9), PROC-03 (T1–T9), VER-04 (T1–T11). Each expansion is faithful to its requirement text — PROT-02's seven tests match the seven verification clauses at `REQUIREMENTS.md:40`; PAY-06's nine match the reconciliation clauses at `:63`, including the T7 provider-clock expiry that resolves R1; PROC-03's nine cover the full SSRF surface (scheme/host/port pin, IP literals, private/link-local, DNS revalidation on connect, redirects, drivers, dimensions/bytes, wall time) plus the allowlisted-source clause. This discharges Fable non-blocking point 3 and opus5 constraint 6.

**Failure subsets — PASS, complete and disjoint.** VER-04's eleven tests are distributed across all four phases with none orphaned and none deferred to a cuttable terminal batch: T1 denied capability (P1), T2 offline relay (P2), T3 timeout (P1), T4 malformed request (P2), T5 oversized raster (P3), T6 failed/expired/wrong invoice (P2), T7 unpaid retrieval (P2), T8 duplicate callback/event (P2), T9 processor fallback (P3), T10 Blossom failure (P4), T11 hash mismatch (P2 **and** P4). Every phase's exit gate names its own subset. DUM-04's own negative enumeration (malformed, oversized, duplicate, unpaid, expired, restart, hash-mismatch) is additionally spelled out in Phase 2 SC4. This discharges opus5 constraint 7.

**Fallback ledger — PASS.** All six mandated fallbacks appear with trigger and recorded form: OPS-01 30-minute blocker law, BOLT11 QR/`lightning:`/LNURL payment fallback, local `strfry` relay mode, 10 m DTM, three-hour mesh cap → displacement (noted as independently enforced), and `DELIVERED_LOCAL`. Every one traces to the brief's fallback table (`:24–30`). Recording which fallback, when, and why makes fallback use auditable rather than silent — opus5 constraint 8, discharged.

**Recurring gates — PARTIAL (B2).** The six-gate set is correct and consistently applied across all four phases, and extending it to OPS-01 closes residual R2 from `requirements-opus5-final.md:12`. The omission is VER-06's secret scan; see B2.

**STATE.md routing — PASS.** Frontmatter is internally consistent and consistent with the roadmap: `status: planning`, `total_phases: 4`, `completed_phases: 0`, `total_plans: 0`, `percent: 0`. Body routes unambiguously to Phase 1 — "Current focus: Phase 1", "Phase: 1 of 4", "Plan: 0 of TBD", "Status: Ready to plan", `Resume file: None`. The five recorded decisions match the roadmap exactly (four fixed phases; DUM-04 as sole Phase 3 opener; DIST-01/DIST-06 owned by Phase 2; six recurring gates; MAP-07 fixed defaults and provider-time expiry authority; PAY-07/SBOX-05 resolved in Phase 2 planning). The four Blockers/Concerns entries correctly front-load MAP-08 as the Phase 1 entry blocker and both VER-07 approval checkpoints. No drift toward Phase 2, no fabricated velocity data.

## Required constraints for Phase 1 planning

These bind `/gsd-plan-phase 1` regardless of whether the B1/B2 roadmap edits land first. Constraints 3 and 8 exist specifically because of the blocking findings and must be honored even if the roadmap text is not amended.

1. **MAP-08 clears before any map code is written.** Verify the exact 21maps v0 source, version, license, provenance, and inherited MapLibre pin. If any of the five cannot be established, select the clean policy-compliant fallback source *first* and record the decision — do not begin against an unverified base and reconcile later. Do not upgrade an inherited MapLibre major during the demo (research SUMMARY `:27`).

2. **MAP-07 displays configured fixed v1 resolution/output defaults, not a user choice.** Resolution selection is v2 and ships with PRICE-01/02. The request preview must show bbox coordinate order, CRS, area, those fixed defaults, and the active source or fallback — before signing.

3. **Any local shell/backend resource surface introduced in Phase 1 is loopback-bound and token-authenticated from its first run** (B1). Scoped local auth token on every endpoint, narrow origin policy, fail closed on missing auth and on unapproved non-loopback exposure. If the SBOX-02 CSP fallback route is not needed, record that no local surface exists — the absence is itself the evidence. SBOX-05 ownership remains Phase 2; this is early application, not re-mapping.

4. **Build single-file production `dist` and run `napplet-conformance` from the first plan, not the last.** Research SUMMARY `:118` names dev/prod sandbox mismatch as a top pitfall; conformance and real-CSP browser smoke are Phase 1 exit gates and recur every phase thereafter. Development-server success is not evidence.

5. **Produce VER-04-T1 (denied capability) and VER-04-T3 (resource timeout) evidence inside Phase 1.** Negative-path evidence is per-phase and is not deferrable to Phase 4.

6. **Create the OPS-01 fallback ledger as a real artifact in Phase 1, with a fixed location and schema** (which fallback, when, why, who decided). Phase 1 owns OPS-01; every later phase writes to the same ledger. An empty-but-existing ledger at Phase 1 exit is a pass; an undefined one is not.

7. **No forward drift.** Phase 1 contains no Nostr signing or relay transport, no protocol schema or reducer implementation, no invoice or payment code, no artifact storage or retrieval endpoint, and no processor dependency. Do not install `rasterio`, GDAL, `trimesh`, or the Python/`uv` stack — research SUMMARY `:20` is explicit that known versions are not a reason to install.

8. **Run a secret scan and public-diff review over everything Phase 1 commits, before pushing** (B2). `commit_docs` is enabled and the repository is public. This applies to evidence files and configuration, not only source.

9. **Pin the km² method and the antimeridian policy in the plan, and unit-test both.** MAP-03 requires geodesic or projected area, never raw degree area; MAP-04 requires explicit rejection of antimeridian-ambiguous boxes alongside non-finite, out-of-range, malformed, and over-limit coordinates. Name the method (for example a geodesic area on WGS84) rather than leaving it to implementation.

10. **Ortho and tile access stays bounded and attributed.** Policy-compliant request volume, required attribution rendered, no bulk prefetch or scraping, no disguised heavy traffic, no custom tile server. Phase 1 touches only read-only public or licensed endpoints — it must not make any paid call or publish anything, so no VER-07 approval is in scope for this phase and none should be requested.

11. **Every Phase 1 blocker over 30 minutes takes its documented fallback and is recorded.** The law is instituted in this phase; demonstrate the mechanism, and record an actual entry if a blocker occurs.

---

No files were modified. No commits, no planning, no service contact, and no live integration were performed. The `Write` tool was unavailable in this session, so this review is returned inline rather than written to disk — save it verbatim to `.planning/reviews/roadmap-opus5.md`.
