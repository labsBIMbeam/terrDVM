## ROADMAP CREATED

**Files written:**
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

**Updated:**
- `.planning/REQUIREMENTS.md` (traceability: 67/67 mapped, unmapped 0 ✓)

### Summary

**Phases:** 4 (fixed order, sequential IDs, `**Mode:** mvp` on each)
**Granularity:** coarse
**Coverage:** 67/67 v1 requirements mapped, verified programmatically — 67 defined IDs, 67 traceability rows, 67 roadmap-mapped IDs, zero duplicates, zero orphans, and the roadmap and traceability table agree on every phase assignment. All three files are on disk and sentinel-free.

| Phase | Goal | Owned requirements |
|-------|------|--------------------|
| 1 — Sandboxed Bbox and Orthophoto UI | Bounded selection + proven sandbox/CSP, no browser secrets | 14: MAP-01…08, SBOX-01…04, VER-02, OPS-01 |
| 2 — Paid DVM Dummy Delivery — Demo Core | Signed request → real invoice → trusted settlement → retrievable dummy GLB | 32: SBOX-05/06, PROT-01…08, JOB-01…05, PAY-01…08, DUM-01…04, DIST-01, DIST-06, OPS-02, VER-01, VER-07 |
| 3 — Bounded Terrain Processor | Real heightmap/GLB behind the existing producer port, semantics unchanged | 9: PROC-01…09 |
| 4 — Blossom Replication and Built-Napplet Viewer | Approval-gated replication, DELIVERED_LOCAL, exact-byte viewer, release safety | 12: DIST-02/03/04/05/07, VIEW-01…03, VER-03/04/05/06 |

### Hard constraints honored

- **Phase 3 gating**: sole opening condition is recorded DUM-04 executable evidence; PROC-09 license clearance, the pinned WCS/ortho contract, and proven Python/GDAL isolation are listed as Phase 3 entry gates. MAP-08 is the Phase 1 entry gate.
- **DIST-01/DIST-06 in Phase 2** (authenticated retrievable dummy delivery is the demo core); remaining DIST requirements in Phase 4.
- **Approval checkpoints** sit inside Phase 2 (first live invoice/settlement, first non-local relay publication) and inside Phase 4 (first Blossom upload, plus final public deployment), with local-strfry/local-serving labeled mode until approved.
- **Recurring gates**: SBOX-01, SBOX-02, VER-02, VER-03, VER-04, OPS-01 each have one owner but re-run as standing exit gates every phase, with per-phase VER-04 subsets named in each phase's exit gates.
- **Compound expansion**: PROT-02 (7 named tests), PROT-04 (7), PAY-06 (9), PROC-03 (9), and VER-04 (11, phase-assigned) are decomposed under Standing Rules so no clause can pass partially.
- **Fallback Activation Ledger** covers all six mandated fallbacks (30-minute law, three-hour mesh cap, 10 m DTM, BOLT11/LNURL, DELIVERED_LOCAL, displacement) with recorded activations.
- **Recorded decisions**: MAP-07 fixed v1 resolution/output defaults, provider server time as invoice-expiry authority, PAY-07/SBOX-05 resolved in Phase 2 planning before endpoints exist, and all exclusions/secret boundaries preserved.

STATE.md points to Phase 1 of 4, status "Ready to plan". Nothing was committed, per instruction.
