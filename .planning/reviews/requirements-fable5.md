VERDICT: PASS

## Blocking findings

None. All hard invariants are represented: the fixed slice order is stated in the v1 preamble and enforced by PROC-01 and the Definition of Done; the paid dummy delivery is explicitly labeled the demo core (DUM-01–04); FIPS, Freenet, bridges, custom tile server, and Palace coupling are all in Out of Scope with reasons; the mesh three-hour cap (PROC-05/06), 10 m DTM fallback (PROC-06), Blossom-to-local fallback with the 30-minute rule (DIST-04), payment fallback (PAY-02), and conference/local-strfry rehearsal (VER-05) are all present; anti-dishonesty rules are covered by DUM-01 (no fake `.glb` bytes), VIEW-02 (no stand-in geometry), VIEW-03/JOB-04 (explicit named fallback states), DIST-05/PAY-05 (no pre-payment leakage), and VER-05 (no false local/offline claims). The stated count of 53 v1 requirements is arithmetically correct.

## Non-blocking improvements

1. **Generic 30-minute blocker law is only concrete in DIST-04.** The brief applies it to every blocker (payment UX, relay, WCS speed). Restate it as a cross-cutting roadmap constraint so PAY-02 and PROC-06 fallback activation inherit the same trigger, not just Blossom.
2. **Local relay configurability is implied, not required.** VER-05 proves local `strfry` works, but no requirement says the DVM and Napplet relay set is configurable to a local relay. Add this as an explicit sub-point when mapping VER-05 to a phase, or it risks being discovered late at rehearsal.
3. **Compound requirements need decomposed evidence.** PROT-02, PROT-04, PAY-06, and VER-04 each bundle 6+ assertions. Acceptable as written, but the roadmap should expand each enumerated clause into a named test case so a requirement cannot be checked off while partially verified.
4. **MAP-07 implies user-selectable resolution/output** that no other MAP requirement establishes. Clarify in Phase 1 planning whether resolution is a fixed default in v1 (recommended) or a UI input; if fixed, MAP-07 should display the default, not a choice.
5. **21maps license/provenance verification** is an input gate (per the brief and research summary) but appears nowhere in REQUIREMENTS.md. Correct to keep it out of requirements, but it must appear as a Phase 1 entry precondition in the roadmap so MAP-06 policy compliance isn't mistaken for provenance clearance.
6. **Traceability table is empty (53 unmapped).** Expected at this stage, but the Definition of Done depends on it; roadmap creation must populate it before any phase executes.

## Acceptance-gate / testability assessment

- **Gate 1** ← MAP-01–07, SBOX-01–04. All observable: draw/edit/clear, km² method, attribution, built-artifact conformance, and the named-fallback-or-pass condition in SBOX-02 prevents dev-server-only success.
- **Gate 2** ← PROT-01–06, JOB-01–04, PAY-01–06, DUM-01–04. DUM-04's executable trace plus enumerated negative cases (malformed, duplicate, unpaid, expired, restart, hash mismatch) makes the demo core falsifiable, and PAY-03/04 correctly make trusted settlement readback the only path to `paid`.
- **Gate 3** ← PROC-01–08. Real-crop provenance (PROC-03/04), fail-closed budgets (PROC-02), and honest displacement typing (PROC-06) are all testable via the PROC-08 fixtures.
- **Gate 4** ← DIST-01–05, VIEW-01–03. Exact-byte readback, recomputed SHA-256, and explicit `DELIVERED_LOCAL` prevent URL-equals-delivery claims.
- **Verification ladder:** all ten brief items map cleanly — 1→VER-01, 2→PROC-08, 3/4→VER-02, 5→VER-02, 6→VER-03, 7→DUM-04, 8→VER-04, 9/10→VER-06. No ladder rung is orphaned.

No scope bloat detected: v2 (pricing, protocol evolution, expansion) and the Out of Scope table faithfully mirror the brief's deferrals and exclusions without adding new product surface.

## Recommended roadmap constraints

1. Exactly four phases matching the fixed order; every PROC requirement is gated on DUM-04 evidence, never on calendar progress.
2. Production single-file build + `napplet-conformance` + real-CSP smoke run from Phase 1 onward, not deferred to VER-02/03 at the end.
3. Schedule the explicit-approval checkpoint (AGENTS.md: external paid calls) **before** the Phase 2 real paid trace — DUM-04 requires an actual settled invoice, so the approval gate sits inside Phase 2, not at publication time only.
4. Each phase closes with its own failure-path evidence (the relevant VER-04 subset) so negative testing is not batched into a final phase where it can be cut.
5. The 30-minute blocker law and three-hour mesh timebox are standing phase rules, recorded with the fallback actually taken, so fallback activation is auditable rather than silent.
6. Traceability: populate the phase mapping at roadmap creation with one phase per requirement; treat any unmapped requirement as a roadmap defect, not a backlog item.
