# Roadmap: terrDVM

## Overview

terrDVM ships as a fixed four-phase vertical slice: a sandboxed bbox/orthophoto Napplet defines the bounded request and proves the production sandbox transport; the paid DVM dummy-delivery loop proves signed request → real invoice → trusted settlement → hash-verified retrievable dummy GLB before any terrain work exists; the bounded terrain processor then replaces the dummy producer behind the same port without touching payment or delivery semantics; finally Blossom replication and the built-Napplet viewer distribute and render the already-verified bytes. Phase order is non-negotiable (`bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer`), Phase 3 opens only on recorded DUM-04 executable evidence, and every fallback activation is recorded rather than silent.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Sandboxed Bbox and Orthophoto UI** - Production single-file Napplet with bbox draw/edit/clear, km² area, policy-compliant ortho preview, and proven sandbox/CSP behavior
- [ ] **Phase 2: Paid DVM Dummy Delivery — Demo Core** - Signed NIP-90 request → real invoice → trusted settlement → payment-gated retrievable dummy GLB with fail-closed negative paths
- [ ] **Phase 3: Bounded Terrain Processor** - Isolated, allowlisted, budget-bounded WCS/ortho processor producing a real heightmap and time-boxed GLB or honest displacement fallback
- [ ] **Phase 4: Blossom Replication and Built-Napplet Viewer** - Approval-gated Blossom replication with cryptographic readback, DELIVERED_LOCAL fallback, exact-byte viewer, and final release safety

## Phase Details

### Phase 1: Sandboxed Bbox and Orthophoto UI

**Goal**: A user can select, validate, and visually confirm a bounded terrain area in the production-built sandboxed Napplet, with all privileged access behind shell capabilities and no secrets in browser assets
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04, MAP-05, MAP-06, MAP-07, MAP-08, SBOX-01, SBOX-02, SBOX-03, SBOX-04, VER-02, OPS-01
**Entry gates**:

- MAP-08 — exact 21maps v0 source, version, license, provenance, and inherited MapLibre pin verified before any reuse; otherwise the clean policy-compliant fallback source is selected before map work begins
- Phase 1 planning decision recorded: MAP-07 displays the configured fixed v1 resolution/output defaults (not a user-selectable choice)
- If Phase 1 introduces any local shell/backend resource surface (the SBOX-02 fallback route), the SBOX-05 boundary applies to it from first run — loopback bind by default, scoped local auth token on every endpoint, fail closed on missing auth or unapproved non-loopback exposure. No unauthenticated or non-loopback local surface may exist at Phase 1 exit (REQUIREMENTS.md Gate 1). SBOX-05 ownership remains Phase 2; this is early application of the boundary, not a second mapping.

**Success Criteria** (what must be TRUE):

  1. User can draw, edit, and clear a rectangular bbox on the OSM-compatible map, sees the area in km² from a geodesic/projected calculation, and sees clear validation errors for non-finite, out-of-range, malformed, antimeridian-ambiguous, or over-limit coordinates
  2. User sees a live, attributed, policy-compliant orthophoto preview for the selected bbox, and the canonical request preview shows bbox coordinate order, CRS, area, the configured fixed v1 resolution/output defaults, and the active source or fallback before signing
  3. The production single-file build passes `napplet-conformance` against `dist` and completes bbox/preview browser smoke under the actual Paja/Kehto sandbox and CSP, or the exact documented shell/backend resource fallback is activated and named
  4. Built browser assets and committed code contain no private keys, Lightning admin credentials, Blossom authorization, NIP-46 material, bearer headers, or privileged token-bearing URLs; all signing/relay/resource/storage/payment/upload access goes through feature-detected shell capabilities; and any local shell/backend resource surface introduced by the SBOX-02 fallback is loopback-bound, requires a scoped local auth token on every endpoint, and fails closed on missing auth or unapproved non-loopback exposure
  5. The OPS-01 30-minute blocker law is instituted with a working fallback-activation record (which fallback, when, why), and any Phase 1 blocker over 30 minutes demonstrably took its documented fallback

**Exit gates (recurring)**: SBOX-01 conformance, SBOX-02 built-artifact smoke, VER-02 clean-checkout typecheck/lint/build/conformance, VER-03 smoke subset (bbox/preview), VER-04 Phase 1 failure subset (VER-04-T1 denied capability, VER-04-T3 resource timeout), OPS-01 fallback ledger review, VER-06 secret-scan and public-diff review of everything this phase commits
**Plans**: 4/9 plans executed

- [x] 01-01-PLAN.md
- [x] 01-02-PLAN.md
- [x] 01-03-PLAN.md
- [x] 01-04-PLAN.md
- [ ] 01-05-PLAN.md
- [ ] 01-06-PLAN.md
- [ ] 01-07-PLAN.md
- [ ] 01-08-PLAN.md
- [ ] 01-09-PLAN.md

- **Wave 1**
  - [ ] `01-01-PLAN.md` — Provenance, package-audit, fixed defaults, and blocking supply-chain approval
- **Wave 2** *(blocked on Wave 1 completion)*
  - [ ] `01-02-PLAN.md` — Exact-pinned workspace, lint/test infrastructure, and manifest runner
- **Wave 3** *(blocked on Wave 2 completion)*
  - [ ] `01-03-PLAN.md` — Browser-first shell adapter, production single-file walking skeleton, conformance, and Paja smoke
- **Wave 4** *(blocked on Wave 3 completion)*
  - [ ] `01-04-PLAN.md` — Bbox normalization, geodesic area, canonical request DTO, and exact-copy TDD
- **Wave 5** *(blocked on Wave 4 completion)*
  - [ ] `01-05-PLAN.md` — Two-role source-policy achievement gate plus map draw/edit/clear UI
- **Wave 6** *(blocked on Wave 5 both-role live approval)*
  - [ ] `01-06-PLAN.md` — Bbox-correlated live orthophoto preview and truthful attribution/state UI
- **Wave 7** *(blocked on Wave 6 completion)*
  - [ ] `01-07-PLAN.md` — Denied/timeout/failure proofs and conditional SBOX-05 local-adapter branch
- **Wave 8** *(blocked on Wave 7 completion)*
  - [ ] `01-08-PLAN.md` — UI/a11y evidence, requirement map, and fail-closed machine-gate tooling
- **Wave 9** *(blocked on Wave 8 completion)*
  - [ ] `01-09-PLAN.md` — SHA-bound clean-checkout certification, human public-diff review, and mechanical sign-off

**Cross-cutting constraints:**

- Browser-first transport only; every production data byte crosses the single shell adapter, with no direct browser egress.
- Registry/package use is exact-pinned, audit-evidenced, and human-approved before the sole Phase 1 lockfile mutation.
- All live/fixture/unavailable, capability-denied, timeout, source-policy, and optional local-fallback branches remain fail-closed and evidence-backed.
- No Phase 2 signing, relay, invoice, payment, artifact-server, processor, viewer, Python, or GDAL surface may enter Phase 1.
- Production single-file build, actual Paja/Kehto smoke, secret/public-diff scan, clean checkout, machine PASS, and human sign-off are mandatory exit gates.

**UI hint**: yes

### Phase 2: Paid DVM Dummy Delivery — Demo Core

**Goal**: A valid signed terrain request produces exactly one real invoice and, only after trusted settlement readback, delivers one job-specific hash-verified dummy GLB through an authenticated request-bound capability — the product's core proof
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SBOX-05, SBOX-06, PROT-01, PROT-02, PROT-03, PROT-04, PROT-05, PROT-06, PROT-07, PROT-08, JOB-01, JOB-02, JOB-03, JOB-04, JOB-05, PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PAY-08, DUM-01, DUM-02, DUM-03, DUM-04, DIST-01, DIST-06, OPS-02, VER-01, VER-07
**Entry gates**:

- Phase 1 complete with recurring gates green
- Phase 2 planning resolves PAY-07 (flat demo price, explicit sat/msat units, hard cap, fail-closed amount validation) and SBOX-05 (loopback default, scoped local auth token, narrow origin/capability policy) **before any invoice or artifact endpoint exists**
- Phase 2 planning records the R1 decision: the payment provider's server-reported invoice and settlement time is the authoritative clock for BOLT11 expiry (per PAY-04)

**Approval checkpoints (inside this phase, per VER-07)**:

- Recorded explicit operator approval required **before the first live invoice creation/settlement** and **before the first publication to a non-local relay**; until approved, the system runs on local `strfry` with local serving and labels that mode explicitly
- Phase 2 cannot be declared complete without this approval: Success Criteria 1, 2, and 4 require a real invoice and trusted settlement readback. A simulated, mocked, or replayed settlement may be used for automated tests only and can never constitute DUM-04 evidence or open Phase 3.

**Success Criteria** (what must be TRUE):

  1. A valid signed request of the single documented kind (5000–5999, result = kind + 1000, kind-7000 usage documented) creates exactly one real BOLT11 invoice at the PAY-07 flat demo price, while malformed, oversized, duplicate, unknown-version, over-limit, and unapproved-input requests fail closed before invoicing
  2. A job reaches paid only via trusted LNbits/Phoenixd settlement readback for the exact stored invoice, amount, payment hash, and request binding; no UI action, invoice display, relay message, webhook receipt alone, wrong/expired invoice, or unit mismatch can advance it, and user-visible status truthfully distinguishes requested, invoiced, paid, processing, delivered, failed/rejected, and named fallback states with the dummy output labeled as a non-terrain placeholder
  3. After confirmed payment the user retrieves a job-specific, Khronos-validated, SHA-256-verified dummy GLB from authoritative local storage via an unguessable scoped expiring capability bound to the paid request ID and artifact hash; unpaid, expired, rejected, mismatched, or hash-knowledge-only requests retrieve nothing
  4. The DUM-04 executable trace is recorded — valid signed request → real invoice → confirmed payment → retrievable dummy GLB, plus fail-closed malformed, oversized, duplicate, unpaid, expired, restart, and hash-mismatch cases — and this recorded evidence is the sole permission to open Phase 3
  5. If the full kind-7000 payment UX blocks over 30 minutes, the BOLT11 QR / `lightning:` / LNURL fallback activates with trusted settlement verification preserved, and the activation is recorded in the fallback ledger

**Exit gates (recurring)**: SBOX-01, SBOX-02 (now covering invoice/status screens), VER-02, VER-03 smoke subset (invoice/status, paid dummy retrieval), VER-04 Phase 2 failure subset (VER-04-T2 offline relay, VER-04-T4 malformed request, VER-04-T6 failed/expired/wrong invoice, VER-04-T7 unpaid retrieval, VER-04-T8 duplicate callback/event, VER-04-T11 artifact hash mismatch), OPS-01 fallback ledger review, VER-06 secret-scan and public-diff review of everything this phase commits
**Plans**: TBD
**UI hint**: yes

### Phase 3: Bounded Terrain Processor

**Goal**: The dummy producer is replaced behind the existing artifact-producer port by an isolated, allowlisted, budget-bounded processor that derives a real heightmap from a bounded WCS crop and delivers a validated GLB inside the mesh timebox or an honestly typed displacement result — without changing payment or delivery semantics
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-06, PROC-07, PROC-08, PROC-09
**Entry gates**:

- **Sole opening condition: recorded DUM-04 executable evidence.** Phase 3 never opens on elapsed time, calendar pressure, or partial Phase 2 progress (PROC-01)
- PROC-09 — each elevation and orthophoto source verified to permit redistribution of paid derived products, with license identifier and attribution recorded, before any live retrieval
- Pinned WCS/ortho endpoint contract: endpoint, version, coverage/layer IDs, CRS/axis order, format, nodata, and resource budgets fixed before implementation
- Proven Python 3.13/`uv` + GDAL wheel installation and process isolation on the target host

**Success Criteria** (what must be TRUE):

  1. Processor validates normalized bbox, explicit CRS and axis order, allowlisted elevation and orthophoto/texture endpoints and coverage/layer IDs, resolution, output type, and pixel/byte/CPU/memory/disk/time budgets before any network retrieval or allocation, and everything outside the allowlist or budget fails closed
  2. A paid bounded manifest produces a normalized heightmap from a real bounded WCS crop, with recorded elevation and texture source, license/attribution, coverage/layer, bbox, CRS, axis order, resolution, nodata handling, producer version, and SHA-256
  3. A structurally validated GLB is produced within the fixed three-hour mesh timebox, or an explicitly typed heightmap-plus-displacement result is delivered instead; the 10 m DTM fallback activates when 5 m retrieval is too slow, and every timebox or DTM fallback activation is recorded in the fallback ledger
  4. Processor runs with low privilege and no signer, wallet, Blossom, or unrelated filesystem authority, using path-safe file handling and argument-safe subprocess execution, and bounded licensed/public fixtures verify CRS, axis order, nodata, corrupt response, timeout, raster budget, deterministic output, and displacement fallback behavior
  5. Payment and delivery semantics are byte-for-byte unchanged: the processor implements the existing artifact-producer port and the Phase 2 paid trace still passes with the real producer in place

**Exit gates (recurring)**: SBOX-01, SBOX-02, VER-02, VER-03 smoke subset (status/processing paths), VER-04 Phase 3 failure subset (VER-04-T5 oversized raster, VER-04-T9 processor fallback), OPS-01 fallback ledger review (including the independently enforced three-hour mesh cap), VER-06 secret-scan and public-diff review of everything this phase commits
**Plans**: TBD

### Phase 4: Blossom Replication and Built-Napplet Viewer

**Goal**: Verified local artifacts are optionally replicated to Blossom with cryptographic readback and always retrievable locally, the built Napplet renders the exact delivered bytes with truthful degradation, and the full release-safety ladder passes
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: DIST-02, DIST-03, DIST-04, DIST-05, DIST-07, VIEW-01, VIEW-02, VIEW-03, VER-03, VER-04, VER-05, VER-06
**Entry gates**:

- Phase 3 complete with recurring gates green
- Phase 4 planning pins the target Blossom server's BUD subset, scoped auth path, retention/redirect/CORS behavior, and exact three.js/glTF-validator versions
- Phase 4 planning carries the display half of PROC-09: the elevation/orthophoto license identifier and required attribution recorded in the Phase 3 artifact descriptor must be shown with the delivered result in the viewer (VIEW-02 surface, PROC-09 ownership stays Phase 3).

**Approval checkpoints (inside this phase, per VER-07 owned by Phase 2)**:

- Recorded explicit operator approval required **before the first Blossom upload**; until approved, local serving remains the only distribution path and is labeled as such
- Public signer/relay/Blossom deployment additionally requires final approval plus cryptographic publication/readback verification (VER-06)

**Success Criteria** (what must be TRUE):

  1. After recorded upload approval, the Blossom adapter uploads only locally hash-verified bytes with scoped authorization, retrieves the advertised bytes back under safe redirect and size limits, and recomputes matching SHA-256, size, and media type before `DELIVERED_BLOSSOM`; the UI and evidence disclose that replicated bytes may become publicly hash-retrievable
  2. When Blossom fails or blocks for more than 30 minutes, the same verified artifact is served locally with an explicit `DELIVERED_LOCAL` state and unchanged artifact identity, and the activation is recorded in the fallback ledger; storage GC never removes the current paid artifact inside its promised retrieval window
  3. The built Napplet retrieves the exact descriptor-bound delivered bytes through the approved shell/resource path, rejects size or hash mismatch, renders the actual GLB or explicitly labeled heightmap/displacement result, and never substitutes stand-in geometry; no artifact location, hash, descriptor, or capability was exposed before durable confirmed payment
  4. User receives actionable denied, offline, timeout, payment, processor, upload, retrieval, and unsupported-capability errors with the active fallback named explicitly
  5. Conference rehearsal on the actual laptop and payer device executes each fallback script with honest local-versus-remote dependency documentation, the complete VER-04 failure suite passes, and the final secret scan and public GitHub diff review pass

**Exit gates (recurring)**: SBOX-01, SBOX-02 (full flow), VER-02, VER-03 full target-hardware smoke (bbox/preview, invoice/status, paid retrieval, final viewer — owned here), VER-04 full suite (owned here, including VER-04-T10 Blossom failure and VER-04-T11 hash mismatch), OPS-01 fallback ledger review, VER-06 secret-scan and public-diff review of everything this phase commits
**Plans**: TBD
**UI hint**: yes

## Standing Rules

### Recurring Phase-Exit Gates

SBOX-01, SBOX-02, VER-02, VER-03, VER-04, and OPS-01 each have exactly one owning phase in the traceability table (SBOX-01/SBOX-02/VER-02/OPS-01 → Phase 1; VER-03/VER-04 → Phase 4), but all six re-run as standing exit gates at the end of **every** phase: production single-file build, `napplet-conformance` against `dist`, built-artifact browser smoke under the real sandbox/CSP, clean-checkout typecheck/lint, the phase's VER-04 failure-path subset, and the OPS-01 fallback-ledger review. In addition, the secret-scan and public-diff-review portion of VER-06 re-runs at the end of **every** phase against everything that phase commits — source, evidence, traces, fixtures, and configuration — because `commit_docs` is enabled and this is a public repository (AGENTS.md). VER-06 ownership remains Phase 4, where it additionally gates approved public deployment with cryptographic publication/readback. Negative testing and secret scanning are per-phase evidence, never a terminal batch that can be cut.

### Approval Checkpoints (VER-07)

- **Inside Phase 2, before execution**: first live invoice creation/settlement; first publication to a non-local relay. Non-local relay use stays approval-gated afterward (OPS-02).
- **Inside Phase 4, before execution**: first Blossom upload (DIST-02), and final public deployment (VER-06).
- Without recorded approval the system remains local-relay/local-serving and labels that mode explicitly.

### Fallback Activation Ledger

Every fallback activation is recorded in the job record and phase evidence — which fallback, when, and why — so fallback use is auditable rather than silent:

| Fallback | Trigger | Recorded as |
|---|---|---|
| 30-minute blocker law (OPS-01) | Any integration blocker > 30 min | Named documented fallback taken |
| BOLT11 QR + `lightning:` / LNURL (PAY-02) | Full kind-7000 payment UX too large / blocked | Payment-fallback activation |
| Local `strfry` relay mode (OPS-02) | Unreliable conference connectivity | Active relay mode in trace evidence |
| 10 m DTM (PROC-06) | 5 m WCS crop too slow | Raster-fallback activation |
| Three-hour mesh cap → displacement (PROC-05/06) | Mesh work exceeds 3 h (independently enforced) | Explicitly typed heightmap+displacement result |
| `DELIVERED_LOCAL` (DIST-04) | Blossom fails/blocks > 30 min | Explicit fallback state, unchanged artifact identity |

### Compound Requirement Expansion (named test expectations)

These compound requirements expand into named test cases at plan time so no clause can be checked off while partially verified:

**PROT-02** (Phase 2):

- PROT-02-T1 canonical-serialization mismatch rejected
- PROT-02-T2 event-ID mismatch rejected
- PROT-02-T3 invalid Schnorr signature rejected
- PROT-02-T4 wrong kind rejected
- PROT-02-T5 created-at outside configured window / clock-skew tolerance rejected
- PROT-02-T6 pubkey verification enforced
- PROT-02-T7 non-string tag structure rejected — all before job or invoice creation

**PROT-04** (Phase 2):

- PROT-04-T1 unknown schema version rejected
- PROT-04-T2 unsupported output type rejected
- PROT-04-T3 duplicate singleton tag rejected
- PROT-04-T4 conflicting parameters rejected
- PROT-04-T5 malformed content rejected
- PROT-04-T6 oversized request rejected
- PROT-04-T7 unapproved provider input rejected — all before invoicing

**PAY-06** (Phase 2):

- PAY-06-T1 invoice intent durably persisted before provider call
- PAY-06-T2 orphaned provider invoice reconciled at startup
- PAY-06-T3 callback replay idempotent
- PAY-06-T4 polling repetition idempotent
- PAY-06-T5 restart recovery without duplicate invoice or duplicate production
- PAY-06-T6 late payment handled per documented policy
- PAY-06-T7 expiry authoritative from provider clock
- PAY-06-T8 replacement policy without duplicate charges
- PAY-06-T9 terminal state never regressed

**PROC-03** (Phase 3):

- PROC-03-T1 scheme/host/port pin enforced
- PROC-03-T2 IP-literal destination rejected
- PROC-03-T3 private/link-local destination rejected
- PROC-03-T4 DNS revalidated on connect
- PROC-03-T5 redirect rejected
- PROC-03-T6 disallowed driver/format rejected
- PROC-03-T7 dimensions/response bytes outside limits rejected
- PROC-03-T8 wall-time limit enforced
- PROC-03-T9 real bounded elevation and orthophoto/texture inputs come only from selected licensed/public allowlisted sources

**VER-04** (owned by Phase 4; subsets run at each phase exit):

- VER-04-T1 denied capability (Phase 1)
- VER-04-T2 offline relay (Phase 2)
- VER-04-T3 timeout (Phase 1)
- VER-04-T4 malformed request (Phase 2)
- VER-04-T5 oversized raster (Phase 3)
- VER-04-T6 failed/expired/wrong invoice (Phase 2)
- VER-04-T7 unpaid retrieval denied (Phase 2)
- VER-04-T8 duplicate callback/event (Phase 2)
- VER-04-T9 processor fallback (Phase 3)
- VER-04-T10 Blossom failure (Phase 4)
- VER-04-T11 artifact hash mismatch (Phase 2 and Phase 4)

### Recorded Planning Decisions Carried Into Phases

- **MAP-07**: v1 uses configured fixed resolution/output defaults displayed in the request preview; user-selectable resolution is v2 (with area/resolution pricing, PRICE-01/02).
- **Invoice-expiry clock (R1)**: the payment provider's server-reported invoice and settlement time is authoritative for expiry (PAY-04); restated explicitly in Phase 2 planning.
- **PAY-07 and SBOX-05** are resolved during Phase 2 planning before any invoice or artifact endpoint exists — no retrofitting price caps or auth boundaries onto live endpoints.
- **Phase 2 safety requirements without a dedicated success criterion** — SBOX-06 (dedicated demo signer key, local-only, pubkey in trace), PAY-08 (per-pubkey and global rate/concurrency/open-invoice limits enforced before any provider invoice call), JOB-05 (paid-then-failed stays visibly failed with an operator remedy path), PROT-07 (encrypted requests rejected with documented reason plus publicity disclosure), and PROT-08 (explicit kind/time/recipient subscription filters and per-event size limits) must each become named must-haves in Phase 2 planning; the five criteria compress 32 requirements and cannot carry them individually.
- **Exclusions preserved**: no FIPS, no Freenet, no bridges, no custom tile server, no Palace coupling, no broad NIP standardization, no bulk scraping, no browser-held secrets, no fake or silently substituted artifacts, no public deployment without explicit approval.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Sandboxed Bbox and Orthophoto UI | 4/9 | In Progress|  |
| 2. Paid DVM Dummy Delivery — Demo Core | 0/TBD | Not started | - |
| 3. Bounded Terrain Processor | 0/TBD | Not started | - |
| 4. Blossom Replication and Built-Napplet Viewer | 0/TBD | Not started | - |
