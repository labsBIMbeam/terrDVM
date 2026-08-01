# Requirements: terrCVM

**Defined:** 2026-07-26
**Core Value:** A valid signed request produces a real invoice and, only after confirmed payment, delivers verified artifact bytes—first as a structurally valid dummy GLB so payment plus delivery is proven before terrain processing begins.

## User Stories

- As a terrain buyer, I can select and visually confirm a bounded area before signing a request so I know what I am paying for.
- As a terrain buyer, I can see an actionable invoice and truthful job states so I know whether payment, processing, and delivery actually happened.
- As a DVM operator, I can reject malformed or unsafe work before invoicing and reconcile duplicate events, callbacks, and restarts without double charging or processing.
- As a paid user, I can retrieve and inspect the exact hash-verified artifact I purchased, with honest local/displacement fallbacks when optional services fail.

## v1 Requirements

Requirements for the complete ordered demo slice. Phases must preserve: bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer.

### Map and Orthophoto Preview

- [ ] **MAP-01**: User can draw a rectangular terrain bounding box on an OSM-compatible map.
- [ ] **MAP-02**: User can edit and clear the selected bounding box.
- [ ] **MAP-03**: User sees the selected area in km² calculated with an appropriate geodesic or projected method rather than raw degree area.
- [ ] **MAP-04**: User sees clear validation errors when bbox coordinates are non-finite, out of range, malformed, antimeridian-ambiguous, or larger than configured area limits.
- [ ] **MAP-05**: User sees a live orthophoto preview corresponding to the selected bbox before request signing.
- [ ] **MAP-06**: Map and orthophoto views display required attribution and use bounded, policy-compliant requests without bulk scraping or disguised heavy traffic.
- [ ] **MAP-07**: The canonical request preview shows bbox coordinate order, CRS, area, the configured fixed v1 resolution/output defaults, and active source or fallback before signing.
- [ ] **MAP-08**: Before reuse, the exact 21maps v0 source, version, license, provenance, and inherited MapLibre pin are verified; otherwise the Napplet uses a clean policy-compliant fallback source.

### Napplet Sandbox and Capability Boundary

- [ ] **SBOX-01**: The Napplet builds as the required production single-file artifact and passes `napplet-conformance` against `dist`.
- [ ] **SBOX-02**: The built Napplet completes bbox and preview browser smoke under the actual Paja/Kehto sandbox and CSP, or activates and names the exact documented shell/backend resource fallback.
- [ ] **SBOX-03**: Napplet code accesses signing, relay transport, external resource bytes, storage, payment administration, and Blossom upload only through feature-detected shell/backend capabilities.
- [ ] **SBOX-04**: Built browser assets and committed code contain no private keys, Lightning admin credentials, Blossom authorization, NIP-46 material, bearer headers, or privileged token-bearing URLs.
- [ ] **SBOX-05**: DVM, local artifact server, and shell bridge bind to loopback by default, require a scoped local authentication token for every state-changing or retrieval endpoint, enforce the narrow origin/capability policy required by the built Napplet, and fail closed on missing auth or unapproved non-loopback exposure.
- [ ] **SBOX-06**: DVM signs with a dedicated demo key held only in local operator-controlled storage or a local signer; the secret is never committed or exposed to browser assets, while the public key is recorded in trace evidence.

### Signed Request Protocol

- [ ] **PROT-01**: The project documents exactly one terrain request kind in `5000–5999`, derives its result kind as request kind + 1000, and documents kind-7000 feedback usage and rationale against current NIP-90 conventions.
- [ ] **PROT-02**: DVM independently verifies canonical Nostr serialization, event ID, Schnorr signature, kind, configured created-at window and clock-skew tolerance, pubkey, and string-only tag structure before creating a job or invoice.
- [ ] **PROT-03**: A versioned strict terrCVM request schema atomically validates bbox order, bbox CRS, source/coverage identifier, resolution or compute factor, requested output MIME, and configured resource limits.
- [ ] **PROT-04**: DVM rejects unknown schema versions, unsupported output types, duplicate singleton tags, conflicting parameters, malformed content, oversized requests, and unapproved provider inputs before invoicing.
- [ ] **PROT-05**: Requester identity and job identity derive from the verified request event, and every feedback, invoice, result, and artifact descriptor remains correlated to that immutable request ID.
- [ ] **PROT-06**: Protocol schemas, parsers, canonical identifiers, artifact descriptors, and state transitions reside in `packages/protocol` without signer, relay, wallet, raster, or Blossom I/O.
- [ ] **PROT-07**: v1 rejects NIP-04/NIP-44 encrypted terrain requests with a documented feedback reason and discloses that bbox and requester pubkey are public when requests use non-local relays.
- [ ] **PROT-08**: Relay subscriptions use an explicit kind, time, and recipient/provider filter plus configured per-event size limits so unrelated public-relay traffic cannot become job input.

### Deterministic Job State

- [ ] **JOB-01**: A pure reducer models legal monotonic states for requested, invoiced, paid, processing, artifact-ready, delivered, rejected, failed, and explicit local/displacement fallback outcomes.
- [ ] **JOB-02**: Illegal transitions fail closed, production is unreachable before paid state, and terminal contradictory late facts are recorded for audit without rewriting delivered truth.
- [ ] **JOB-03**: Durable storage deduplicates requests by verified event ID and makes relay replay, wallet callback repetition, polling, restart, producer retry, and result publication idempotent.
- [ ] **JOB-04**: User-visible status distinguishes requested, invoiced, paid, processing, delivered, failed/rejected, and local or displacement fallback without deriving truth from button clicks or optimistic client state; Phase 2 invoice and result screens explicitly label the dummy output as a non-terrain payment-path demonstration placeholder.
- [ ] **JOB-05**: A paid job that later fails remains visibly failed with recorded cause and an operator-manual remedy/refund decision path; it is never silently promoted to success or substituted with an undisclosed artifact.

### Lightning Invoice and Settlement

- [ ] **PAY-01**: An accepted bounded request creates exactly one active real BOLT11 invoice through the configured LNbits/Phoenixd adapter using the PAY-07 v1 amount source, explicit units, expiry, request ID, and payment identifier.
- [ ] **PAY-02**: User can display and pay the invoice through the available Napplet/shell capability or through the documented bolt11 QR plus `lightning:`/LNURL fallback.
- [ ] **PAY-03**: DVM marks a job paid only after trusted LNbits/Phoenixd settlement readback for the exact stored invoice, amount, payment hash, and request binding.
- [ ] **PAY-04**: A UI action, invoice display, relay message, webhook receipt alone, wrong invoice, expired invoice, or under/over-unit mismatch cannot advance the job to paid; the payment provider's server-reported invoice and settlement time is authoritative for expiry.
- [ ] **PAY-05**: Unpaid, expired, rejected, or mismatched jobs cannot retrieve an artifact hash, URL, capability, or artifact bytes.
- [ ] **PAY-06**: Invoice intent is durably persisted before the provider call, and callback/polling/startup reconciliation handles orphaned provider invoices, replay, restart, late payment, expiry, and replacement policy without duplicate charges, duplicate production, or regression of terminal state.
- [ ] **PAY-07**: v1 uses one configured flat demo price in explicit sat/msat units with a hard configured maximum; missing, non-integer, zero, negative, or over-cap amounts fail closed before invoice creation, while area/resolution-derived pricing remains v2.
- [ ] **PAY-08**: DVM enforces configured per-pubkey and global limits for request rate, concurrent jobs, and open invoices before any provider invoice call.

### Paid Dummy Artifact Delivery — Demo Core

- [ ] **DUM-01**: After confirmed payment, the initial producer creates a job-specific, structurally valid GLB 2.0 dummy artifact rather than fake bytes with a `.glb` extension.
- [ ] **DUM-02**: The dummy artifact passes the Khronos glTF validator and records exact MIME, byte size, SHA-256, originating request ID, `producer_type=dummy`, and an explicit non-terrain-placeholder flag in its descriptor and result/feedback event.
- [ ] **DUM-03**: Artifact bytes are atomically stored and read back with matching size and SHA-256 before the job can become artifact-ready or delivered.
- [ ] **DUM-04**: An executable trace proves valid signed request → real invoice → confirmed payment → retrievable dummy GLB, while malformed, oversized, duplicate, unpaid, expired, restart, and hash-mismatch cases fail closed.

### Bounded Terrain Processor

- [ ] **PROC-01**: The terrain processor is introduced only after DUM-04 passes and implements the existing artifact-producer port without changing payment or delivery semantics.
- [ ] **PROC-02**: Processor validates normalized bbox, explicit CRS and axis order, allowlisted elevation and orthophoto/texture endpoints and coverage/layer IDs, resolution, output type, and pixel/byte/CPU/memory/disk/time budgets before any network retrieval or allocation.
- [ ] **PROC-03**: Processor obtains real bounded elevation and orthophoto/texture inputs from selected licensed/public sources; it pins allowed scheme/host/port, rejects IP literals and private/link-local destinations, revalidates DNS on connect, and rejects redirects, drivers, dimensions, formats, response bytes, or wall time outside its allowlist and limits.
- [ ] **PROC-04**: Processor produces a normalized heightmap with recorded elevation and texture source, coverage/layer, bbox, CRS, axis order, resolution, nodata handling, producer version, and SHA-256.
- [ ] **PROC-05**: Processor attempts textured terrain mesh/GLB generation only within the fixed three-hour mesh timebox and validates successful GLB output structurally.
- [ ] **PROC-06**: When 5 m retrieval is too slow the processor can use the documented 10 m DTM fallback, and when mesh work exceeds three hours it delivers an explicitly typed heightmap plus displacement result rather than claiming GLB success.
- [ ] **PROC-07**: Processor runs with low privilege and no signer, wallet, Blossom, or unrelated filesystem authority, using path-safe file handling and argument-safe subprocess execution.
- [ ] **PROC-08**: Small bounded licensed/public fixtures verify CRS, axis order, nodata, corrupt response, timeout, raster budget, deterministic output, and displacement fallback behavior.
- [ ] **PROC-09**: Before live retrieval, each elevation and orthophoto source is verified to permit redistribution of paid derived products; license identifier and required attribution are recorded in the artifact descriptor and shown with the delivered result, and unverified or non-permitting sources are rejected.

### Artifact Distribution

- [ ] **DIST-01**: Local immutable artifact storage remains the authoritative source and can serve the same payment-gated verified bytes when external distribution is unavailable.
- [ ] **DIST-02**: After explicit upload approval, Blossom adapter uploads only after local hash verification using scoped authorization and records the returned descriptor without treating upload success alone as delivery; the UI and evidence acknowledge that replicated bytes may become publicly hash-retrievable and are no longer a private paywall.
- [ ] **DIST-03**: Blossom retrieval follows safe redirect and size limits, reads the advertised bytes back, and recomputes matching SHA-256, size, and media type before `DELIVERED_BLOSSOM`.
- [ ] **DIST-04**: If Blossom fails or blocks for more than 30 minutes, the system serves the same verified artifact locally and exposes an explicit `DELIVERED_LOCAL` fallback without changing artifact identity.
- [ ] **DIST-05**: No artifact location, hash, descriptor, or retrieval capability is exposed before durable confirmed payment for that request.
- [ ] **DIST-06**: Paid local retrieval requires an unguessable scoped expiring capability bound to the paid request ID and artifact hash; the server rejects unauthenticated or unbound requests, path traversal, and directory listing, and knowledge of a content hash alone does not authorize retrieval.
- [ ] **DIST-07**: Local artifact storage enforces configured disk and retention budgets with safe garbage collection that cannot remove the current paid artifact before its promised retrieval window expires.

### Built-Napplet Viewer and Truthful Degradation

- [ ] **VIEW-01**: The built Napplet retrieves the exact delivered descriptor-bound bytes through the approved shell/resource path and rejects size or hash mismatch.
- [ ] **VIEW-02**: User can inspect the actual delivered GLB or explicitly labeled heightmap/displacement result; the viewer never substitutes separately generated stand-in geometry and labels Phase 2 dummy output as a non-terrain payment-path demonstration placeholder.
- [ ] **VIEW-03**: User receives actionable denied, offline, timeout, payment, processor, upload, retrieval, and unsupported-capability errors with the active fallback named explicitly.

### Operational Fallbacks and Relay Modes

- [ ] **OPS-01**: Any integration blocker lasting more than 30 minutes activates the documented fallback, records which fallback was taken and why, and keeps user-visible state truthful; the mesh-specific three-hour limit remains independently enforced.
- [ ] **OPS-02**: Operator can select documented local-demo, conference, and later-public relay sets, including local `strfry`, without code changes; non-local relay use is approval-gated and the active relay mode is visible in trace evidence.

### Verification and Release Safety

- [ ] **VER-01**: Protocol parsers, canonical identifiers, reducer transitions, payment gates, replay/idempotency, and unpaid retrieval denial have automated unit and integration tests.
- [ ] **VER-02**: Typecheck, lint, production single-file build, and `napplet-conformance` pass from a clean checkout.
- [ ] **VER-03**: Paja/Kehto browser smoke verifies the built artifact for bbox/preview, invoice/status, paid dummy retrieval, and final viewer paths on target hardware.
- [ ] **VER-04**: Failure-path tests cover denied capability, offline relay, timeout, malformed request, oversized raster, failed/expired/wrong invoice, unpaid retrieval, duplicate callback/event, processor fallback, Blossom failure, and artifact hash mismatch.
- [ ] **VER-05**: Conference rehearsal on the actual laptop and payer device documents which dependencies are local versus remote and executes each fallback script, including local `strfry` and local artifact serving, without falsely claiming Lightning, tile, ortho, WCS, or Blossom independence.
- [ ] **VER-06**: Final secret scan and public GitHub diff review pass, and any public signer/relay/Blossom deployment occurs only after explicit approval plus cryptographic publication/readback verification.
- [ ] **VER-07**: First live invoice creation/settlement, first publication to a non-local relay, and first Blossom upload each require recorded explicit operator approval before execution; without approval the system remains local-relay/local-serving and labels that mode explicitly.

## v2 Requirements

Deferred beyond the ordered initial slice. These are tracked but not part of the current roadmap.

### Pricing

- **PRICE-01**: DVM calculates a configurable sats/km² quote from area, resolution/compute multiplier, minimum charge, and caps.
- **PRICE-02**: User sees a transparent price breakdown before signing and paying.

### Protocol Evolution

- **EVOL-01**: Project can migrate versioned terrain request profiles while preserving compatibility and audit history.
- **EVOL-02**: Proven terrCVM semantics can inform a broader terrain microstandard discussion after the demo succeeds.

### Product Expansion

- **PROD-01**: Standalone terrCVM may be evaluated for Palace/30-Napplet fleet integration after all four gates pass.
- **PROD-02**: Terrain quality, formats, and large-area processing may be expanded beyond the bounded demo budgets.
- **PROD-03**: Multi-node or scale-out DVM deployment may replace the single-machine local-first architecture when demonstrated demand requires it.

## Out of Scope

Explicit exclusions prevent scope creep.

| Feature | Reason |
|---------|--------|
| FIPS | Explicitly excluded and unrelated to the paid terrain slice |
| Freenet | Explicitly excluded; Nostr plus Blossom/local serving are sufficient |
| Protocol bridges | Additional integration/security surface before core validation |
| Custom tile server | Unnecessary infrastructure; use bounded policy-compliant upstream sources |
| Palace coupling in v1 | terrCVM must succeed as a standalone Napplet/DVM first |
| Broad NIP standardization during v1 | Choose one documented local profile; standardization is post-demo work |
| General GIS workbench | Bbox, preview, payment, delivery, and viewing are the narrow product |
| GeoLibre as runtime/backend/dependency | It is reference-only and reuse requires exact license/source verification |
| Bulk OSM scraping or disguised traffic | Violates upstream policy and risks service blocking |
| Browser-held secrets or privileged backend authority | Violates the Napplet sandbox and project security boundary |
| Processor implementation before paid dummy delivery | Violates the core invariant and hides the main integration risk |
| Production-grade mesh polish as a release prerequisite | Three-hour timebox and honest displacement fallback are mandatory |
| Fake or silently substituted production artifacts | Bytes, type, provenance, and fallback must remain truthful and verifiable |
| Public deployment without explicit approval | Signer, relay, paid calls, and Blossom publication are external high-impact actions |

## Acceptance Criteria

### Gate 1 — Bbox and Preview

- User can draw, edit, and clear a bounded bbox, see correct km², and preview selected ortho with attribution.
- Production `dist` works under the actual sandbox/CSP or activates the named resource fallback.
- 21maps provenance is verified before reuse, and local DVM/shell surfaces remain loopback-bound and authenticated.

### Gate 2 — Paid Dummy Delivery

- One valid signed request creates one real invoice; malformed and oversized requests are rejected before invoicing.
- The invoice uses a bounded flat v1 demo price, and only recorded approval plus trusted settlement unlocks one structurally valid, hash-verified, explicitly labeled dummy GLB.
- Unpaid, duplicate, wrong-invoice, restart, and hash-mismatch paths fail closed.
- Paid local retrieval requires the request-bound expiring capability rather than hash knowledge alone.

### Gate 3 — Processor

- A paid bounded manifest produces a heightmap from licensed elevation data and bounded orthophoto/texture inputs with actual source/license/CRS/resolution metadata.
- GLB validates within the timebox or an honestly labeled displacement artifact is delivered.

### Gate 4 — Distribution and Viewer

- Local and optional Blossom readback agree on exact bytes, size, type, and SHA-256.
- The built Napplet displays the actual paid result and truthful fallback/error state.
- Blossom's public hash-retrieval consequence is disclosed and upload remains explicitly approval-gated.

## Definition of Done

- Every v1 requirement is mapped to exactly one roadmap phase and verified by automated or explicit manual evidence.
- Protocol/reducer tests, bounded processor fixtures, typecheck, lint, production build, conformance, browser smoke, real paid trace, failure cases, secret scan, and public diff review pass.
- No processor work was accepted before the paid dummy-delivery gate passed.
- No artifact is called delivered until exact bytes and hash are read back and verified.
- External paid calls and public publication remain blocked pending explicit approval.
- Production build, conformance, browser smoke, each phase's relevant failure-path subset, the OPS-01 30-minute blocker/fallback law, and the VER-06 secret-scan/public-diff-review portion are recurring exit gates even though each requirement has one owning phase.

## Traceability

Populated during roadmap creation. Every v1 requirement maps to exactly one owning phase. SBOX-01, SBOX-02, VER-02, VER-03, VER-04, and OPS-01 additionally re-run as standing recurring phase-exit gates in every phase, as does the secret-scan/public-diff-review portion of VER-06 (see ROADMAP.md Standing Rules); ownership below remains singular.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MAP-01 | Phase 1 | Pending |
| MAP-02 | Phase 1 | Pending |
| MAP-03 | Phase 1 | Pending |
| MAP-04 | Phase 1 | Pending |
| MAP-05 | Phase 1 | Pending |
| MAP-06 | Phase 1 | Pending |
| MAP-07 | Phase 1 | Pending |
| MAP-08 | Phase 1 | Pending |
| SBOX-01 | Phase 1 | Pending |
| SBOX-02 | Phase 1 | Pending |
| SBOX-03 | Phase 1 | Pending |
| SBOX-04 | Phase 1 | Pending |
| SBOX-05 | Phase 2 | Pending |
| SBOX-06 | Phase 2 | Pending |
| PROT-01 | Phase 2 | Pending |
| PROT-02 | Phase 2 | Pending |
| PROT-03 | Phase 2 | Pending |
| PROT-04 | Phase 2 | Pending |
| PROT-05 | Phase 2 | Pending |
| PROT-06 | Phase 2 | Pending |
| PROT-07 | Phase 2 | Pending |
| PROT-08 | Phase 2 | Pending |
| JOB-01 | Phase 2 | Pending |
| JOB-02 | Phase 2 | Pending |
| JOB-03 | Phase 2 | Pending |
| JOB-04 | Phase 2 | Pending |
| JOB-05 | Phase 2 | Pending |
| PAY-01 | Phase 2 | Pending |
| PAY-02 | Phase 2 | Pending |
| PAY-03 | Phase 2 | Pending |
| PAY-04 | Phase 2 | Pending |
| PAY-05 | Phase 2 | Pending |
| PAY-06 | Phase 2 | Pending |
| PAY-07 | Phase 2 | Pending |
| PAY-08 | Phase 2 | Pending |
| DUM-01 | Phase 2 | Pending |
| DUM-02 | Phase 2 | Pending |
| DUM-03 | Phase 2 | Pending |
| DUM-04 | Phase 2 | Pending |
| PROC-01 | Phase 3 | Pending |
| PROC-02 | Phase 3 | Pending |
| PROC-03 | Phase 3 | Pending |
| PROC-04 | Phase 3 | Pending |
| PROC-05 | Phase 3 | Pending |
| PROC-06 | Phase 3 | Pending |
| PROC-07 | Phase 3 | Pending |
| PROC-08 | Phase 3 | Pending |
| PROC-09 | Phase 3 | Pending |
| DIST-01 | Phase 2 | Pending |
| DIST-02 | Phase 4 | Pending |
| DIST-03 | Phase 4 | Pending |
| DIST-04 | Phase 4 | Pending |
| DIST-05 | Phase 4 | Pending |
| DIST-06 | Phase 2 | Pending |
| DIST-07 | Phase 4 | Pending |
| VIEW-01 | Phase 4 | Pending |
| VIEW-02 | Phase 4 | Pending |
| VIEW-03 | Phase 4 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 2 | Pending |
| VER-01 | Phase 2 | Pending |
| VER-02 | Phase 1 | Pending |
| VER-03 | Phase 4 | Pending |
| VER-04 | Phase 4 | Pending |
| VER-05 | Phase 4 | Pending |
| VER-06 | Phase 4 | Pending |
| VER-07 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 67 total
- Mapped to phases: 67
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-26*
*Last updated: 2026-07-26 after roadmap creation (traceability populated 67/67)*
