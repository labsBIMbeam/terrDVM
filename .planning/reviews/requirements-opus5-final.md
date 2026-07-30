# VERDICT: PASS

All seven blockers (B1–B7) from the prior REVISE are closed with clauses that are substantively correct, not cosmetic. No scope creep and no violation of the fixed vertical-slice order was introduced by the corrections. The 67-requirement count is verified.

## 1. Unresolved blockers

**None.** No blocking findings remain.

Three residual items are non-blocking and must be handled at roadmap time, not by another requirements revision:

- **R1 — Authoritative clock for invoice expiry is still unspecified.** `PROT-02:40` now fixes the `created_at` window and clock-skew tolerance (closing half of my prior point 7), but no clause names which clock governs BOLT11 expiry. `PAY-03:60` makes trusted provider settlement readback the only path to paid, which makes the provider the de facto authority — sufficient for v1, but state it explicitly in Phase 2 planning.
- **R2 — `OPS-01:104` is cross-cutting but is not listed in the Definition-of-Done recurring-gate bullet (`:191`), which names only build, conformance, smoke, and failure-path subsets.** The 30-minute fallback law will otherwise be assigned to one owning phase and lose force in the other three.
- **R3 — `MAP-07:26` deliberately keeps "configured fixed-default or user-selected resolution/output" open.** This is an honest deferral of Fable's point 4 rather than a resolution. Decide it in Phase 1 planning; fixed default remains the recommendation.

## 2. Closure matrix B1–B7

| # | Blocker | Closing clause | Assessment |
|---|---|---|---|
| **B1** | No v1 invoice-amount rule | `PAY-07:64` (flat configured sat/msat price, hard cap, fail-closed on missing/non-integer/zero/negative/over-cap); `PAY-01:58` amended to cite "the PAY-07 v1 amount source"; Gate 2 `:169` | **Closed.** Adds `negative` beyond the correction as written. `PRICE-01/02` correctly stay v2. |
| **B2** | No authorization model for paid retrieval | `DIST-06:93` (unguessable scoped expiring capability bound to paid request ID + artifact hash; rejects unauthenticated/unbound requests, path traversal, directory listing; hash knowledge alone insufficient); `DIST-02:89` amended with the public-hash-retrievability disclosure | **Closed.** Gate 2 `:171` correctly pulls DIST-06 to Phase 2 acceptance. See roadmap constraint 4. |
| **B3** | Unbounded local DVM/backend exposure | `SBOX-05:34` (loopback default, scoped local auth token on every state-changing *and* retrieval endpoint, narrow origin/capability policy, fail closed on missing auth or unapproved non-loopback bind); Gate 1 `:164` | **Closed.** Retrieval endpoints explicitly covered, which is what B2 depends on. |
| **B4** | No requirement-level approval gate; DVM signer key unspecified | `VER-07:115` (first live invoice creation/settlement, first non-local relay publication, first Blossom upload each need recorded approval; otherwise local-relay/local-serving, labeled); `SBOX-06:35` (dedicated demo key, local storage or local signer, never committed or in browser assets, pubkey in trace) | **Closed.** VER-07 says "first"; the *ongoing* gate holds by composition with `OPS-02:105` ("non-local relay use is approval-gated") and `DIST-02:89` ("After explicit upload approval"). |
| **B5** | Paid Phase 2 artifact not disclosed as placeholder | `DUM-02:70` (`producer_type=dummy` + explicit non-terrain-placeholder flag in descriptor *and* result/feedback event); `JOB-04:53` (invoice **and** result screens label it); `VIEW-02:99` (viewer labels it) | **Closed.** JOB-04's "invoice screen" satisfies the pre-payment disclosure requirement. |
| **B6** | Ortho/texture retrieval outside processor bounds | `PROC-02:77` ("allowlisted elevation **and orthophoto/texture** endpoints and coverage/layer IDs"); `PROC-03:78` (same for retrieval, plus scheme/host/port pinning, IP-literal and private/link-local rejection, DNS revalidation on connect, redirect/format/dimension/byte/wall-time limits); `PROC-04:79` (records elevation **and texture** source) | **Closed.** Also absorbs my non-blocking SSRF point 5. |
| **B7** | No license clearance for paid derived delivery | `PROC-09:84` (per-source redistribution verification before live retrieval, license ID + attribution in artifact descriptor *and* shown with delivered result, unverified/non-permitting sources rejected); Gate 3 `:175` | **Closed.** Complemented by `MAP-08:26` for the 21maps provenance gate. |

**Fable non-blocking points:** #1 closed by `OPS-01:104`; #2 closed by `OPS-02:105`; #4 explicitly deferred (R3); #5 closed by `MAP-08:26`; #6 expected pre-roadmap. #3 (decomposing compound requirements into named test cases) is inherently a roadmap task — carried below as constraint 6.

**My own non-blocking points:** #1→`PROT-07:45`; #2→`PAY-06:63` ("Invoice intent is durably persisted before the provider call… handles orphaned provider invoices"); #3→`JOB-05:54`; #4→`PAY-08:65`; #5→`PROC-03:78`; #6→`DIST-07:94`; #7→partial, see R1; #8→`VER-05:113` (payer device + each fallback script); #9→DoD `:191`. Additionally `PROT-08:46` closes the subscription-filter gap I had flagged as unaddressed-by-design.

**Count verification (conceptual):** 8 MAP + 6 SBOX + 8 PROT + 5 JOB + 8 PAY + 4 DUM + 9 PROC + 7 DIST + 3 VIEW + 2 OPS + 7 VER = **67**, matching `:201`. The delta from the prior 53 is exactly +14 and every added ID traces to a blocker or a named non-blocking point: MAP-08, SBOX-05/06, PROT-07/08, JOB-05, PAY-07/08, PROC-09, DIST-06/07, OPS-01/02, VER-07. No requirement was added without a review antecedent, and none was silently deleted. Traceability remains 0/67, correct pre-roadmap.

## 3. Roadmap constraints that must survive

1. **Exactly four phases in the fixed order** — bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer. Phase 3 opens only on the recorded `DUM-04` executable trace, never on elapsed time or partial Phase 2 progress. `PROC-01:76` is the load-bearing line of the document.
2. **Approval checkpoints sit inside phases, not at the end.** `VER-07` fires before the first live invoice call in Phase 2 and again before the first Blossom upload in Phase 4. Until approved, Phase 2 runs on local `strfry` with local serving and labels itself as such.
3. **`PAY-07` and `SBOX-05` are resolved during Phase 2 planning**, before any invoice or artifact endpoint exists. Retrofitting a price cap or an authorization boundary onto a live endpoint is the expensive path.
4. **`DIST-01` and `DIST-06` must be owned by Phase 2, not Phase 4**, despite living in the Artifact Distribution section. `DUM-04:72` requires a *retrievable* dummy GLB, and Gate 2 `:171` already demands the request-bound expiring capability. Assigning them to Phase 4 by section would leave the Phase 2 demo core retrieving artifacts with no authorization model — the exact defect B2 closed.
5. **Recurring gates keep an owning phase plus a standing per-phase flag.** `SBOX-01`, `SBOX-02`, `VER-02`, `VER-03`, `VER-04`, and `OPS-01` are inherently cross-cutting; DoD `:191` authorizes this for the first five. Extend it to `OPS-01` (see R2). Production single-file build, `napplet-conformance`, and real-CSP browser smoke run from Phase 1 onward and re-run at every phase exit.
6. **Compound requirements expand into named test cases at roadmap time.** `PROT-02`, `PROT-04`, `PAY-06`, `PROC-03`, and `VER-04` each bundle six or more assertions; without decomposition a requirement can be checked off while partially verified.
7. **Each phase closes with its own `VER-04` failure-path subset.** Negative testing is per-phase evidence, not a terminal batch that can be cut under time pressure.
8. **Every fallback activation is recorded** in the job record and phase evidence — 30-minute blocker law, three-hour mesh cap, 10 m DTM, BOLT11/LNURL, `DELIVERED_LOCAL`, displacement — so fallback use is auditable rather than silent.
9. **Phase entry preconditions:** Phase 1 requires `MAP-08` 21maps source/license/provenance verification; Phase 3 requires `PROC-09` license clearance, a pinned WCS/ortho endpoint contract, and proven Python/GDAL isolation on the target host.
10. **Populate traceability for all 67 requirements at roadmap creation**, one owning phase each plus recurring-gate flags. Any unmapped requirement is a roadmap defect, not a backlog item.

No files were modified and no integration was started.
