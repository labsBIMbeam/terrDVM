VERDICT: PASS

Closure review of the terrCVM roadmap against the prior REVISE (`.planning/reviews/roadmap-opus5.md`). Read-only; no files modified, no commits, no planning, no service contact. Scope limited to the two blocking findings, the three non-blocking recommendations, and non-damage to the previously passing structure.

## Unresolved blockers

None. Both blocking findings are closed at the exact locations and in substantially the wording specified by the prior review.

- **B1 — closed.** The SBOX-05 boundary now applies conditionally in Phase 1 from the first run of any SBOX-02 fallback surface, in both required places: the entry gate (`ROADMAP.md:28`) and Success Criterion 4 (`ROADMAP.md:33`). Both state loopback bind, scoped local auth token on every endpoint, and fail-closed on missing auth or unapproved non-loopback exposure. The entry gate explicitly preserves ownership ("SBOX-05 ownership remains Phase 2; this is early application of the boundary, not a second mapping") and cites `REQUIREMENTS.md` Gate 1, so the roadmap is now in sync with the already-ratified Gate 1 clause at `REQUIREMENTS.md:164`. No `REQUIREMENTS.md` change was needed and none was made.
- **B2 — closed in all five required places.** The VER-06 secret-scan/public-diff portion recurs in every phase exit gate (`ROADMAP.md:35`, `:57`, `:77`, `:98`), is codified in Standing Rules (`ROADMAP.md:106`, including the `commit_docs`/public-repo rationale and the "never a terminal batch that can be cut" clause), appears in the REQUIREMENTS traceability preamble (`REQUIREMENTS.md:195`), is mirrored in the Definition of Done (`REQUIREMENTS.md:191` — the optional item was carried), and is recorded as a roadmap decision in STATE (`STATE.md:58`). VER-06 ownership stays Phase 4 in every one of these statements.

## Closure matrix

| Item | Required change | Status | Evidence |
|---|---|---|---|
| B1 — Fix 1a | Conditional SBOX-05 boundary as Phase 1 entry gate, applying from first fallback-surface run, ownership preserved | Closed | `ROADMAP.md:28` |
| B1 — Fix 1b | Phase 1 Success Criterion 4 extended with the loopback/token/fail-closed clause for any SBOX-02 fallback surface | Closed | `ROADMAP.md:33` |
| B2 — Fix 2a | Standing Rules paragraph extended: VER-06 scan/diff re-runs every phase over everything committed; ownership stays Phase 4 | Closed, verbatim | `ROADMAP.md:106` |
| B2 — Fix 2b | VER-06 clause appended to all four `Exit gates (recurring)` lines | Closed, all four | `ROADMAP.md:35`, `:57`, `:77`, `:98` |
| B2 — Fix 2c | Traceability preamble names the recurring VER-06 portion, ownership singular | Closed, verbatim | `REQUIREMENTS.md:195` |
| B2 — optional mirror | Definition of Done names the scan alongside build/conformance/smoke/failure subsets/OPS-01 | Closed | `REQUIREMENTS.md:191` |
| B2 — STATE reflection | Recorded decision states VER-06 scan/diff re-runs every phase, with the public-repo/auto-commit reason | Closed | `STATE.md:58` |
| Rec 1 — Phase 2 safety must-haves | SBOX-06, PAY-08, JOB-05, PROT-07, PROT-08 become named must-haves in Phase 2 planning | Carried | `ROADMAP.md:189` |
| Rec 2 — approval not simulable | Phase 2 cannot complete without real approval; simulated/mocked/replayed settlement never constitutes DUM-04 evidence or opens Phase 3 | Carried | `ROADMAP.md:50` |
| Rec 3 — PROC-09 display half | Phase 4 planning carries license/attribution display on the VIEW-02 surface; PROC-09 ownership stays Phase 3 | Carried | `ROADMAP.md:88` |
| Singular ownership 67/67 | No requirement gains a second owning phase | Undamaged — recounted: table has 67 rows, coverage block reads 67/67/0; phase lists total 14+32+9+12 = 67 with no duplicate or orphan; SBOX-05→P2, VER-06→P4, PROC-09→P3 all still single-owner | `REQUIREMENTS.md:199–270`; `ROADMAP.md:24`, `:43`, `:65`, `:84` |
| Four-phase order | Exactly four integer phases in fixed order, no insertions | Undamaged | `ROADMAP.md:13–16`, `:194–202`; matches `AGENTS.md:16` |
| DUM-04 gate | Sole opening condition for Phase 3, no time-based escape | Undamaged, still stated three times | `ROADMAP.md:5`, `:55`, `:67` |
| Approval gates (VER-07) | Inside-phase, before-execution checkpoints for Phase 2 and Phase 4 | Undamaged and strengthened by Rec 2; Phase 4 checkpoints and Standing Rules unchanged | `ROADMAP.md:48–50`, `:89–91`, `:108–112` |
| Criteria caps | 2–5 success criteria per phase | Undamaged — still 5 per phase; B1 landed as an extension of existing SC4, not a sixth criterion | `ROADMAP.md:29–34`, `:51–56`, `:71–76`, `:92–97` |
| No scope drift from the edits | Edits add no product surface | Confirmed — all six edits are gate/criterion/decision text; v2 and exclusion lists unchanged | `ROADMAP.md:186–190`; `REQUIREMENTS.md:117–156` |

Two wording deviations from the proposed text are immaterial and do not affect meaning: `ROADMAP.md:189` writes "named must-haves" for "named must_haves", and `ROADMAP.md:50` spells out "Success Criteria 1, 2, and 4" for "SC1/SC2/SC4".

Residuals carried unchanged from the prior review, all previously judged non-blocking and none reopened: Phase 1 SC5 is process-shaped rather than user-observable (accepted as the only way to make OPS-01 verifiable in its owning phase); DIST-05 in Phase 4 overlaps PAY-05 in Phase 2 as re-verification across the Blossom descriptor surface, not a duplicate mapping; DIST-07 retention/GC lands in Phase 4 while DIST-01 storage stands up in Phase 2.

## Phase 1 planning constraints that survive

These bind `/gsd-plan-phase 1`. Constraints 1 and 2 are now also roadmap entry gates, and 3 and 8 are now roadmap-encoded (entry gate + SC4, and the recurring exit gate respectively) — they bind through the roadmap as well as here, and their earlier "even if the roadmap text is not amended" caveat is discharged. Constraint 9 remains the only one with no roadmap or requirements anchor beyond the requirement text itself.

1. **MAP-08 clears before any map code is written.** Verify the exact 21maps v0 source, version, license, provenance, and inherited MapLibre pin. If any of the five cannot be established, select the clean policy-compliant fallback source first and record the decision — do not begin against an unverified base and reconcile later. Do not upgrade an inherited MapLibre major during the demo.
2. **MAP-07 displays configured fixed v1 resolution/output defaults, not a user choice.** Resolution selection is v2 and ships with PRICE-01/02. The request preview must show bbox coordinate order, CRS, area, those fixed defaults, and the active source or fallback — before signing.
3. **Any local shell/backend resource surface introduced in Phase 1 is loopback-bound and token-authenticated from its first run.** Scoped local auth token on every endpoint, narrow origin policy, fail closed on missing auth and on unapproved non-loopback exposure. If the SBOX-02 CSP fallback route is not needed, record that no local surface exists — the absence is itself the evidence. SBOX-05 ownership remains Phase 2; this is early application, not re-mapping.
4. **Build single-file production `dist` and run `napplet-conformance` from the first plan, not the last.** Conformance and real-CSP browser smoke are Phase 1 exit gates and recur every phase thereafter. Development-server success is not evidence.
5. **Produce VER-04-T1 (denied capability) and VER-04-T3 (resource timeout) evidence inside Phase 1.** Negative-path evidence is per-phase and is not deferrable to Phase 4.
6. **Create the OPS-01 fallback ledger as a real artifact in Phase 1, with a fixed location and schema** (which fallback, when, why, who decided). Every later phase writes to the same ledger. An empty-but-existing ledger at Phase 1 exit is a pass; an undefined one is not.
7. **No forward drift.** No Nostr signing or relay transport, no protocol schema or reducer implementation, no invoice or payment code, no artifact storage or retrieval endpoint, no processor dependency. Do not install `rasterio`, GDAL, `trimesh`, or the Python/`uv` stack — known versions are not a reason to install.
8. **Run a secret scan and public-diff review over everything Phase 1 commits, before pushing.** `commit_docs` is enabled and the repository is public. This covers evidence files, traces, fixtures, and configuration, not only source.
9. **Pin the km² method and the antimeridian policy in the plan, and unit-test both.** MAP-03 requires geodesic or projected area, never raw degree area; MAP-04 requires explicit rejection of antimeridian-ambiguous boxes alongside non-finite, out-of-range, malformed, and over-limit coordinates. Name the method (for example a geodesic area on WGS84) rather than leaving it to implementation. This is the one surviving constraint with no roadmap anchor — the roadmap states the property, not the method.
10. **Ortho and tile access stays bounded and attributed.** Policy-compliant request volume, required attribution rendered, no bulk prefetch or scraping, no disguised heavy traffic, no custom tile server. Phase 1 touches only read-only public or licensed endpoints — it makes no paid call and publishes nothing, so no VER-07 approval is in scope for this phase and none should be requested.
11. **Every Phase 1 blocker over 30 minutes takes its documented fallback and is recorded.** The law is instituted in this phase; demonstrate the mechanism, and record an actual entry if a blocker occurs.
