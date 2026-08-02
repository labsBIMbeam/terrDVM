VERDICT: REVISE

*(Note: I could not write to `.planning/reviews/requirements-opus5.md` — that file exists but is empty, and this session has no write tool. The review is below for you to save there.)*

## 1. Blocking findings

**B1 — No v1 rule for the invoice amount (PAY-01, PRICE-01).** PAY-01 requires "exactly one active real BOLT11 invoice … with explicit amount units," but no v1 requirement says where the amount comes from; all pricing is deferred to v2. Phase 2 cannot create an invoice from the requirements as written, and nothing bounds a real-sats call.
**Correction — add PAY-07:** "The v1 invoice amount is a single configured flat demo price in explicit sat/msat units, subject to a hard configured maximum; a missing, non-integer, zero, or over-cap amount fails closed before invoice creation. Area/resolution-derived pricing remains v2." Amend PAY-01 to cite PAY-07 as the amount source.

**B2 — Paid artifact retrieval has no authorization model (PAY-05, DIST-01, DIST-05).** Both requirements forbid exposing hash/URL/capability/bytes before payment, but none defines how the post-payment route authorizes its caller. A content-addressed store served by hash makes the gate pure secret-URL obscurity — no binding to the paying request, no expiry, no revocation.
**Correction — add DIST-06:** "Paid retrieval requires an unguessable, scoped, expiring capability bound to the specific paid request ID and artifact hash; the local artifact server rejects unauthenticated or unbound requests, path traversal, and directory listing, and knowledge of a content hash alone does not authorize retrieval." Add a note to DIST-02 that Blossom replication makes the bytes publicly hash-retrievable from that point — an accepted, approval-gated consequence, not a preserved paywall.

**B3 — Local DVM/backend network exposure is unbounded (SBOX-01..04).** SBOX constrains only what Napplet code may hold. The DVM HTTP surface, artifact server, and shell bridge have no binding, origin, or authentication requirement. On conference Wi-Fi, an unauthenticated LAN-reachable DVM lets anyone create invoices, drive job state, and pull artifacts.
**Correction — add SBOX-05:** "DVM, artifact-server, and shell-bridge listeners bind to loopback only by default, require a local authentication token on every state-changing or retrieval endpoint, enforce an explicit origin allowlist for the built Napplet's opaque origin, and fail closed on any non-loopback bind or missing token. Non-loopback exposure requires explicit approval and is documented in VER-05."

**B4 — No requirement-level approval gate for real external actions; DVM signer key unspecified.** AGENTS.md makes external paid calls and public publication approval-gated invariants. VER-06 covers only public *deployment*. The Phase 2 paid trace (DUM-04) is itself an external paid call; publishing result/feedback events to a non-local relay and the first Blossom upload are public publication. None is gated at requirement level. Separately, nothing governs the DVM's own signing key.
**Correction — add VER-07:** "Live invoice creation/settlement, publication of any event to a non-local relay, and any Blossom upload each require recorded explicit operator approval before first execution; absent approval the system runs local-relay/local-serving only and says so explicitly." **Add SBOX-06:** "The DVM signs with a dedicated demo key held only in local operator-controlled storage or a local signer; never committed, never in browser assets; its pubkey is recorded in trace evidence."

**B5 — The paid Phase 2 artifact is not required to be disclosed as a placeholder (DUM-01/02, JOB-04, VIEW-02).** DUM-01 forbids fake bytes under a `.glb` extension, but nothing requires telling the buyer that the artifact they paid real sats for contains no terrain. Silence here contradicts the project's honesty rules as directly as a mislabeled displacement result would.
**Correction — amend DUM-02** to record `producer_type = dummy` plus an explicit non-terrain-placeholder flag in the artifact descriptor and the result/feedback event; **amend JOB-04 and VIEW-02** so the pre-payment invoice screen and the viewer both label the Phase 2 result as a payment-path demonstration placeholder, not terrain data.

**B6 — Orthophoto/texture retrieval is outside the processor's bounds (PROC-02/03/05).** The brief's step 3 is "WCS crop → heightmap → mesh **plus ortho texture** → GLB" and PROC-05 requires a *textured* mesh, but PROC-02/03 bound only elevation retrieval. The second outbound fetch in the most privileged path has no allowlist, budget, or policy constraint.
**Correction — amend PROC-02 and PROC-03** to read "elevation **and orthophoto/texture** retrieval," applying the same allowlisted endpoint/coverage, CRS/axis, redirect, format, dimension, byte, and time limits to both; extend PROC-04's recorded provenance to the texture source.

**B7 — No requirement that source licenses permit paid derived delivery (PROC-03/04, MAP-06).** MAP-06 covers preview attribution only; PROC-04 records source and coverage but not license terms. terrCVM *sells* artifacts derived from third-party elevation and ortho data, and no attribution travels with the delivered artifact.
**Correction — add PROC-09:** "Before live retrieval, each selected elevation and orthophoto source is verified to permit redistribution of derived products under the paid delivery model; the license identifier and required attribution are recorded in the artifact descriptor and shown with the delivered result. An unverified or non-permitting source is not used." Treat as a Phase 3 entry precondition alongside the 21maps provenance gate.

## 2. Non-blocking improvements

1. **PROT — encrypted requests.** State that NIP-04/NIP-44 encrypted job requests are rejected in v1 with a documented feedback reason; note that bbox and requester pubkey are therefore public on relays.
2. **PAY-06 — dual-write crash window.** Persist invoice intent *before* the provider call; reconcile orphaned provider invoices at startup, so "exactly one active invoice" survives a crash between call and persist.
3. **Paid-but-failed policy.** Nothing says what a buyer gets when production fails after settlement. Add an honest documented policy (visible failed state, operator-manual remedy, no silent success) to JOB-01/VIEW-03.
4. **Anti-abuse bounds.** Add per-pubkey and global caps on concurrent jobs, open invoices, and request rate; a public relay subscription is otherwise an unbounded invoice-creation trigger.
5. **PROC-03 SSRF detail.** Beyond the allowlist: pin scheme/host/port, reject IP literals and private/link-local ranges, guard re-resolve-on-connect rebinding, cap response bytes and wall time.
6. **Local store lifecycle.** Add retention, disk budget, and GC policy; DIST-01 makes the local store the permanent authority with no bound.
7. **Time and expiry.** Specify the authoritative clock for invoice expiry and the `created_at` acceptance window and skew tolerance referenced by PROT-02.
8. **VER-05 rehearsal scope.** Include the payer's device and a rehearsal of each fallback script, not only local `strfry` and local serving.
9. I concur with the fable5 review on compound-requirement decomposition (PROT-02, PROT-04, PAY-06, VER-04), MAP-07's implied resolution choice, explicit relay-set configurability, and 21maps provenance as a Phase 1 precondition. Those remain non-blocking.

## 3. Coverage and order assessment

- **Count verified:** 7 MAP + 4 SBOX + 6 PROT + 4 JOB + 6 PAY + 4 DUM + 8 PROC + 5 DIST + 3 VIEW + 6 VER = 53. Traceability is empty (0/53) — expected pre-roadmap, but a Definition-of-Done dependency.
- **Order is faithful to the invariant.** Sections partition cleanly: MAP+SBOX → Phase 1; PROT+JOB+PAY+DUM → Phase 2; PROC → Phase 3; DIST+VIEW → Phase 4. PROC-01 hard-gates Phase 3 on DUM-04 — the single most important line in the document.
- **"Exactly one phase" is unachievable for five requirements.** SBOX-01, SBOX-02, VER-02, VER-03, VER-04 are inherently recurring gates, and the research summary demands built-artifact verification from Phase 1 onward. Give each an owning phase for acceptance plus a standing per-phase gate flag, so conformance, smoke, and failure-path evidence are not pushed into a terminal phase where they can be cut.
- **Overlap is intentional, not a defect.** PAY-05 (Phase 2) and DIST-05 (Phase 4) both forbid pre-payment leakage; keep both. B2's DIST-06 must likewise hold from Phase 2, not Phase 4.
- **Unaddressed by design:** no v1 requirement covers relay-set configuration or the DVM's inbound subscription filter policy; both are implied by VER-05 and PROT-02 and should surface in Phase 2 planning.

## 4. Recommended roadmap constraints

1. Exactly four phases in the fixed order. Phase 3 opens only on the recorded DUM-04 executable trace — never elapsed time or partial Phase 2 progress.
2. Place the B4 approval checkpoint *inside* Phase 2 before the first live invoice call, and again before the first Blossom upload in Phase 4. Until approved, Phase 2 runs on local `strfry` and local serving and labels itself as such.
3. Resolve B1 (flat price + cap) and B3 (loopback/token/origin) during Phase 2 planning, before any invoice or artifact endpoint exists; retrofitting an authorization boundary is the expensive path.
4. Production single-file build, `napplet-conformance`, and real-CSP browser smoke run from Phase 1 onward and re-run at every phase exit.
5. Each phase closes with its own VER-04 failure-path subset — negative testing is per-phase evidence, not a final batch.
6. Record every fallback activation (30-minute blocker law, three-hour mesh cap, 10 m DTM, BOLT11/LNURL, `DELIVERED_LOCAL`, displacement) in the job record and phase evidence, so fallback use is auditable rather than silent.
7. Phase 3 entry preconditions: PROC-09 license verification, pinned WCS/ortho endpoint contract, proven Python/GDAL isolation on the target host. Phase 1 entry precondition: 21maps source and license provenance.
8. Populate traceability at roadmap creation for all 53 requirements plus recurring-gate flags; treat any unmapped requirement as a roadmap defect.
