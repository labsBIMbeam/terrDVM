# Project Research Summary

**Project:** terrCVM
**Domain:** Local-first paid Nostr terrain/GIS Data Vending Machine with a sandboxed single-file Napplet, real Lightning payment gate, bounded raster processing, and content-addressed artifact delivery
**Researched:** 2026-07-26
**Confidence:** MEDIUM

## Executive Summary

terrCVM is not primarily a terrain-mesh project; it is a paid, verifiable data-delivery product whose core proof is a signed terrain request followed by a real invoice, independently confirmed Lightning settlement, and retrieval of structurally valid artifact bytes. Experts should build it as a small ports-and-adapters system: an unprivileged Napplet handles bbox selection, preview, payment presentation, status, and viewing; a deterministic DVM core owns durable job truth; Nostr, Lightning, raster, local serving, and Blossom remain replaceable adapters. The authoritative implementation order is therefore fixed: **bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer**.

The recommended implementation is a Node 24/pnpm TypeScript monorepo for the Napplet, protocol package, and DVM, plus an isolated Python 3.13/`uv` processor introduced only after the paid dummy-delivery gate passes. Store and hash exact artifact bytes locally before any optional Blossom replication. Treat NIP-90 as a draft carrier around a strict, versioned terrCVM micro-profile rather than as a complete business contract, and keep the production Napplet inside its opaque-origin CSP boundary with shell/backend mediation for signing, relay, resource retrieval, payment administration, and upload.

The principal risks are false payment or delivery state, duplicate processing from relay/callback replay, sandbox behavior that differs from the development server, CRS/axis and raster-budget errors, artifact leakage before payment, and schedule loss to mesh or external-service integration. Mitigate these with a pure fail-closed reducer and durable idempotency, trusted wallet settlement readback, job-specific validated GLB bytes, exact-byte SHA-256 readback, built-artifact browser verification from Phase 1 onward, bounded provider adapters, and strict timeboxes. Every blocker over 30 minutes must take its documented fallback; mesh work stops after three hours and becomes an honestly labeled displacement result.

## Key Findings

### Recommended Stack

Use one strict TypeScript domain language across the UI, protocol, and DVM, while isolating native raster/GDAL dependencies in a separate Python worker. Exact versions verified by the research should be pinned, but unresolved package and live-service versions must be selected only during the phase that needs them and after compatibility checks. In particular, do not install the processor stack merely because its versions are known.

**Core technologies:**
- **Node.js 24.18.0 LTS + pnpm 11.10.1:** workspace runtime and deterministic monorepo dependency management.
- **TypeScript 7.0.2 + Vite 8.1.5:** strict browser/protocol/DVM code and Napplet production build; validate the TypeScript major and real Vite/Napplet plugin integration before acceptance.
- **`@napplet/sdk` 0.25.0, `@napplet/vite-plugin` 0.12.0, `vite-plugin-singlefile` 2.3.3:** shell capability boundary, manifest/build integration, and one-file production artifact.
- **`@napplet/conformance-cli` 0.2.16:** production `dist` sandbox/conformance gate; it complements rather than replaces business-flow browser smoke.
- **MapLibre GL JS:** preserve the exact licensed 21maps pin if provenance is verified; otherwise test a greenfield compatible version under the actual CSP. Do not upgrade an inherited major during the demo.
- **Terra Draw 1.32.2 + MapLibre adapter 1.4.1:** bounded rectangle draw/edit/clear, subject to a real compatibility smoke test.
- **`nostr-tools` with strict versioned Zod schemas:** NIP-01 verification and a single selected NIP-90-compatible event profile; exact direct pins remain phase decisions.
- **Pure reducer + durable SQLite-backed job/event store:** one authoritative monotonic state projection with idempotent request, invoice, callback, production, and delivery handling. `better-sqlite3` is the candidate only after Node 24 native installation is proven.
- **LNbits with Phoenixd behind it:** preferred server-side invoice and settlement adapter; direct Phoenixd remains the documented adapter fallback when the deployed LNbits path is unavailable.
- **Python 3.13 + `uv` 0.11.32:** isolated processor environment, added only after paid dummy delivery.
- **Rasterio 1.5.0, pyproj 3.7.2, NumPy 2.5.1, HTTPX 0.28.1, Pillow 12.3.0:** bounded WCS retrieval, explicit CRS/axis transforms, raster validation, normalization, and honest heightmap output.
- **trimesh 4.12.2 and optionally pygltflib 1.16.5:** time-boxed GLB generation only; stop after three hours and switch to displacement.
- **Khronos glTF Validator + three.js GLTFLoader:** structural validation and loading of the exact delivered bytes; exact package versions remain unresolved and must be pinned in their phases.
- **Local artifact repository/server + optional Blossom BUD adapter:** local exact bytes are mandatory authority and fallback; Blossom is replication, never the sole delivery path.
- **Local `strfry`:** conference relay fallback, not proof that payment, WCS, tiles, or Blossom are offline.

### Expected Features

The MVP is the first two ordered gates, not the full terrain pipeline. It succeeds only when malformed/unpaid cases fail closed and a real paid trace returns a valid dummy GLB. Processor and distribution/viewer work are v1.x additions unlocked by that proof.

**Must have — Gate 1, bbox/ortho UI:**
- Bounded bbox draw, edit, clear, canonical coordinate order, explicit CRS, and geodesic/projected area in km².
- Policy-compliant OSM-compatible map and orthophoto preview with attribution, source provenance, limits, and actionable degraded states.
- Production single-file Napplet behavior under the actual sandbox/CSP, using shell resource capabilities or the narrow documented backend fallback.

**Must have — Gate 2, paid DVM dummy delivery:**
- One documented request kind in `5000–5999`, derived result mapping, strict versioned terrain schema, complete event ID/signature verification, and fail-closed limits.
- Deterministic visible states for requested, invoiced, paid, processing, delivered, failed/rejected, and local fallback.
- Real BOLT11 invoice or the documented LNURL/BOLT11 QR plus `lightning:` fallback, with explicit units, expiry, and request/payment binding.
- Trusted LNbits/Phoenixd settlement confirmation; no UI action, relay message, webhook receipt alone, or invoice display can advance `paid`.
- Durable replay-safe job identity and exactly one active invoice/production path per accepted request event.
- Payment-gated delivery of a job-specific, structurally valid dummy GLB whose bytes, MIME, size, and SHA-256 are verified before delivery state.
- A real request → invoice → payment → dummy-delivery trace plus negative cases for malformed, oversized, duplicate, unpaid, expired, wrong-invoice, restart, and hash-mismatch behavior.

**Must have after MVP — Gate 3, terrain processor:**
- A bounded, allowlisted, CRS- and axis-aware WCS crop from real licensed/public data, validated before retrieval and allocation.
- A real heightmap with recorded source, coverage, bbox, CRS, resolution, producer version, and hash.
- A mesh/texture/GLB attempt inside the three-hour limit, otherwise an explicitly typed heightmap plus three.js displacement fallback.
- Isolated low-privilege processing with hard response-byte, pixel, memory, disk, CPU, and timeout ceilings and no wallet/signer/Blossom secrets.

**Must have after processor — Gate 4, Blossom/viewer:**
- Local atomic storage and exact-byte readback as the required artifact authority.
- Blossom upload only as optional hash-addressed replication, with scoped auth, descriptor checks, GET readback, and recomputed SHA-256.
- Payment-gated local serving of the same bytes when Blossom fails or blocks for more than 30 minutes.
- Built-Napplet viewer loading the exact delivered GLB or explicitly labeled displacement result through the allowed shell/resource path.
- Conformance, real-browser smoke, denied/offline/timeout paths, secret scan, and public diff review.

**Differentiators:**
- Signed Nostr intent → verified Lightning settlement → exact terrain bytes in one auditable flow.
- Payment-gated dummy delivery before GIS investment, protecting the project from visually impressive but commercially irrelevant progress.
- Deterministic domain truth separated from unreliable adapters.
- Hash-verifiable Blossom-or-local delivery without making an external server a single point of failure.
- Local-first, explicitly labeled conference fallbacks that preserve truth rather than fabricate success.
- Honest quality/timebox contract: a useful displacement artifact is preferable to an unfinished or mislabeled mesh.

**Defer until after the four gates:**
- sats/km² pricing optimization, resolution multipliers, minimums, and caps.
- Broader terrain microstandard/NIP work or interoperability bridges.
- Production-grade mesh polish and scale-out infrastructure.
- Any Palace/fleet integration discussion.

**Explicit exclusions:**
- FIPS, Freenet, protocol bridges, custom tile infrastructure, Palace coupling in the initial slice, bulk OSM scraping/prefetch, a general GIS workbench, GeoLibre as runtime/backend/dependency, browser-held secrets, and fake or silently substituted production artifacts.

### Architecture Approach

Adopt a functional-core/imperative-shell design. `packages/protocol` owns versioned schemas, canonical identifiers and serialization, immutable commands/facts, artifact descriptors, and the pure transition reducer. `services/dvm` owns durable application truth and orchestration. Relays, wallets, files, processors, HTTP endpoints, and Blossom report verified facts through ports; none may write status directly. Persist idempotent inbox/outbox facts so relay fanout, callbacks, polling, restarts, and publication retries are safe. Locally store and hash every artifact before exposing or replicating it.

**Major components:**
1. **`apps/napplet`** — sandboxed bbox/area, ortho preview, request composition, invoice/status presentation, and actual-artifact viewer; communicates through one feature-detected shell adapter and holds no privileged credentials.
2. **Host shell capability boundary** — signing, identity, relay transport, bounded resource retrieval, storage/config, and policy mediation.
3. **`packages/protocol`** — strict request/feedback/result/artifact schemas, canonical event/job identity, pure reducer, and exhaustive transition/parser tests.
4. **`services/dvm` application core** — verified command handling, durable idempotency, payment gate, producer dispatch, artifact lifecycle, and state-derived Nostr output.
5. **Nostr adapter** — complete NIP-01 verification, one isolated NIP-90-compatible profile, request/result correlation, deduplication, and replay-safe publication.
6. **Lightning adapter** — invoice creation and trusted settlement reconciliation through LNbits/Phoenixd; callbacks are wake-up signals, not authority.
7. **Artifact producer port** — job-specific valid dummy producer first, then a bounded processor implementation after Gate 2.
8. **`services/processor`** — isolated WCS/ortho retrieval, CRS/raster validation, heightmap, time-boxed GLB generation, and typed displacement fallback; it cannot mutate jobs or access payment/signing secrets.
9. **Local artifact repository/server** — atomic exact-byte storage, immutable content identity, paid retrieval authorization, MIME/size/hash metadata, and readback verification.
10. **Blossom adapter and built viewer** — optional replication with scoped authorization and cryptographic readback; rendering only of descriptor-bound verified bytes.

**Required state invariants:**
- Accepted jobs derive from a fully verified request event and are idempotent by event ID.
- `INVOICED` requires durable payment identifier, BOLT11, amount/unit, and expiry.
- `PAID` requires provider-verified settlement for that exact stored invoice; payment UX cannot set it.
- Production is unreachable before `PAID`.
- `ARTIFACT_READY` requires validated exact bytes, MIME, size, SHA-256, producer type/version, and atomic storage.
- `DELIVERED_LOCAL` or `DELIVERED_BLOSSOM` requires exact-byte readback; terminal states are monotonic and contradictory late facts are audit-only.

### Critical Pitfalls

1. **Treating draft NIP-90 as the executable paid-job contract** — freeze one request/result pair and a strict versioned terrCVM schema in Phase 2; reject ambiguity instead of inferring fields.
2. **Incomplete signature validation or relay acceptance as trust** — independently verify canonical event ID, Schnorr signature, kind, timestamp, tags, and application limits before job or invoice creation.
3. **Duplicate jobs, invoices, or results from at-least-once delivery** — deduplicate by verified request event ID and use durable compare-and-set transitions plus an idempotent inbox/outbox.
4. **False payment confirmation and sat/msat races** — use unit-suffixed values, bind exact invoice identity and expiry to the request, and advance only after trusted wallet readback; callbacks merely trigger reconciliation.
5. **Artifact leakage before payment** — never publish hash, URL, or result pre-settlement; make dummy GLBs job-specific and gate local retrieval on durable paid state or a post-payment capability.
6. **Privileged browser code or dev/prod sandbox mismatch** — keep all secrets and unrestricted networking outside the iframe, build single-file from Phase 1, and test conformance plus business smoke under the real CSP.
7. **CRS/axis confusion and unbounded raster inputs** — keep canonical bbox/CRS explicit, use provider-specific adapters, inspect capabilities/coverage metadata, allowlist origins, and validate dimensions/bytes/time/driver before allocation.
8. **Terrain work hiding the core integration risk** — treat a real paid dummy-delivery trace as the permission slip for any processor implementation.
9. **Mistaking `.glb`, MIME, upload status, descriptor, or URL for delivery** — run the Khronos validator, store and hash local bytes, GET each advertised location, recompute SHA-256, and load the same bytes in the built viewer.
10. **False local-first or silent fallback claims** — preflight every remaining dependency and label local relay, local artifact, 10 m DTM, BOLT11/LNURL, and displacement modes explicitly; never fake payment or live WCS provenance.

## Implications for Roadmap

The roadmap should use exactly four implementation phases matching the authoritative dependency order. Do not merge the processor into the paid-DVM phase, and do not put Blossom or the final viewer on the critical path for proving payment-gated delivery.

### Phase 1: Sandboxed Bbox and Orthophoto UI

**Rationale:** A canonical, bounded geographic request and a production-sandbox resource path are prerequisites for every later signed job. This phase also resolves the highest-risk frontend assumptions before protocol/payment work depends on them.

**Delivers:**
- Single-file Napplet baseline with conformance and real-browser smoke.
- Bbox draw/edit/clear, explicit coordinate/CRS model, geodesic/projected km², constraints, and request preview DTO.
- Policy-compliant OSM-compatible map and selected orthophoto preview with attribution and degraded states.
- One feature-detected shell/resource adapter and a proven narrow backend fallback if the built CSP blocks the preferred route.

**Addresses:** bounded selection, area, ortho confirmation, clear constraints, shell boundary, and actionable errors.

**Avoids:** dev-server-only success, privileged/direct Napplet fetch, degree-area errors, axis ambiguity, unverified 21maps reuse, upstream policy violations, and hidden remote assets.

**Gate to exit:** The built one-file artifact works in the real sandbox/CSP, supports draw/edit/clear and correct area, and shows an allowed ortho preview or explicitly activated documented fallback. No direct secret-bearing or unrestricted network path exists.

### Phase 2: Paid DVM Dummy Delivery — Demo Core

**Rationale:** This is the product's core proof and must precede all terrain processing. It establishes protocol truth, durable state, real payment, authorization, and artifact integrity while the producer remains deliberately simple.

**Delivers:**
- `packages/protocol` strict terrCVM event/profile schemas, canonical request/job IDs, and pure exhaustive reducer.
- Durable DVM state, idempotent inbox/outbox, Nostr verification/correlation, and one request/result kind mapping.
- LNbits/Phoenixd invoice adapter with explicit sat/msat conversion, expiry, callback verification, reconciliation polling, and monotonic payment facts.
- User-visible requested/invoiced/paid/processing/delivered/failed/rejected/local-fallback states.
- Job-specific Khronos-valid dummy GLB, payment-gated local artifact route, atomic storage, SHA-256 descriptor, and verified readback.
- Real paid trace and fail-closed tests for invalid signatures/schema/bounds, replay, wrong/expired invoice, unpaid retrieval, restart, and hash mismatch.

**Addresses:** signed request, deterministic status, real invoice, confirmed-payment gate, valid dummy delivery, request/result correlation, and content integrity.

**Avoids:** NIP-90 ambiguity, optimistic payment, duplicate charges/work, unit errors, pre-payment leakage, in-memory truth, shared dummy hash, fake GLB, and adapter-owned state.

**Required fallbacks:** If full kind-7000 payment UX blocks for 30 minutes, use LNURL-pay or BOLT11 QR plus `lightning:` while preserving trusted settlement verification. Use local `strfry` for relay connectivity problems, but do not call the complete flow offline unless wallet settlement is also proven.

**Gate to exit:** A valid signed request creates one real invoice; only trusted settlement opens one producer attempt; malformed and unpaid paths fail closed; the exact valid dummy GLB is stored, hashed, retrieved, and loaded. This executable trace is the sole permission to begin Phase 3.

### Phase 3: Bounded Terrain Processor

**Rationale:** Once paid delivery is proven, replace the dummy producer behind the existing port without changing payment, state, or delivery semantics. This isolates geospatial uncertainty from the core commercial handoff.

**Delivers:**
- Separate Python 3.13/`uv` processor with no signer, wallet, Blossom, or unrelated filesystem authority.
- Versioned bounded manifest with normalized bbox, allowlisted source/coverage, explicit CRS/axis order, resolution, output, and pixel/byte/CPU/time limits.
- Capabilities/coverage-aware WCS adapter, real bounded crop, raster validation, nodata handling, and normalized heightmap.
- Time-boxed texture/mesh/GLB path with Khronos validation, or an honestly typed heightmap/displacement bundle.
- Small licensed/public fixtures for CRS, axis, timeout, corrupt response, budget, and deterministic fallback tests.

**Addresses:** real terrain data, CRS-aware crop, bounded compute, heightmap, terrain artifact, and honest quality fallback.

**Avoids:** processor-first development, arbitrary URLs/SSRF, wrong-location crops, WMS/WCS confusion, GDAL in a privileged process, unbounded transfer/allocation, shell injection, and mislabeled displacement.

**Required fallbacks:** Use 10 m DTM when 5 m exceeds the bounded request/timebox. Stop mesh work at three hours and deliver heightmap plus three.js displacement under the same payment/hash rules. A total WCS outage has no authorized fake substitute and remains a planning/rehearsal gate.

**Gate to exit:** A paid manifest produces an artifact from a real bounded WCS crop; all provider, CRS, raster, and compute checks fail closed; output metadata records actual source/resolution; GLB validates or displacement is labeled and verified honestly.

### Phase 4: Blossom Replication and Built-Napplet Viewer

**Rationale:** Distribution and rendering consume already verified local artifacts. Keeping them last prevents optional external upload and viewer complexity from blocking the paid proof or processor correctness.

**Delivers:**
- Blossom adapter with scoped short-lived authorization, exact-byte upload, descriptor validation, safe retrieval, and recomputed SHA-256.
- Mandatory payment-gated local serving of the same immutable bytes and explicit `DELIVERED_LOCAL` fallback state.
- Built-Napplet viewer that retrieves through the approved shell/resource path, verifies the expected hash, and renders the exact GLB or displacement descriptor.
- Final conformance, target-hardware browser smoke, offline/degraded path tests, secret scan, and public diff review.

**Addresses:** hash-verifiable distribution, Blossom enhancement, local delivery resilience, and inspectable actual output.

**Avoids:** URL-equals-delivery, trusting upload/HEAD/descriptor, unscoped Blossom auth, pre-payment hash publication, external-resource GLB surprises, generated stand-in geometry, and silent local fallback.

**Required fallback:** If Blossom fails or blocks for 30 minutes, serve the same verified artifact locally and label it accurately; do not change artifact identity or claim Blossom success.

**Gate to exit:** Descriptor, local bytes, optional Blossom bytes, expected size/type, and SHA-256 agree; no location/hash was exposed before payment; the built Napplet loads the exact delivered result; all final publication gates pass.

### Phase Ordering Rationale

- Bbox and preview define the bounded request and prove the sandbox transport assumptions required by every subsequent user flow.
- Paid dummy delivery isolates and validates the highest-risk value exchange before GIS work can consume schedule or create misleading progress.
- The processor plugs into an already accepted producer port, so terrain quality cannot bypass or redefine payment and delivery truth.
- Blossom and the viewer operate only on verified local artifacts, preserving a deterministic local fallback and keeping optional external behavior out of the critical path.
- Every phase carries its own built-artifact, failure-path, timebox, and fallback evidence forward; no later adapter may weaken earlier invariants.

### Research Flags

**Targeted phase research is required; no new broad domain survey is warranted.**

- **Phase 1 — research during planning:** verify exact 21maps v0 source/license/provenance and inherited MapLibre pin; choose the orthophoto source and policy; exercise installed Napplet shell resource domains, opaque-origin CSP, workers/styles/images, and no-capability degradation; define antimeridian policy.
- **Phase 2 — research during planning:** select the exact terrCVM request/result kinds and schema; inspect installed `nostr-tools`, Zod, SQLite driver, signer/relay capabilities, deployed LNbits/Phoenixd versions and least-privileged credentials; decide invoice replacement/expiry/late-payment behavior and kind-7000 versus BOLT11/LNURL UX.
- **Phase 3 — research only after Phase 2 passes:** pin the WCS endpoint/version/coverage/CRS/axis/format/nodata/license contract, resource budgets, GDAL driver isolation, and bounded fixtures; decide `trimesh`/`pygltflib` versus displacement-only inside the fixed mesh timebox.
- **Phase 4 — research during planning:** verify the target Blossom server's BUD subset, auth, retention, redirects, CORS, shell upload/resource path, exact three.js/glTF validator versions, and target-hardware artifact limits.
- **Conference gate:** document which services are truly local. Local `strfry` and local artifact serving do not remove Lightning routing or live WCS dependencies; total WCS outage and real settlement without connectivity remain unresolved and may not be replaced with fake success.

**Well-documented patterns that do not need separate broad research phases:**
- Pure reducer and transition-table TDD, strict schema parsing, ports/adapters, transactional idempotency, local atomic storage, SHA-256 verification, path safety, secret scanning, and single-file build checks. These should be implemented and tested directly while targeted integration questions are resolved.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Exact package metadata and compatibility constraints were captured for the main toolchain and raster stack, but several direct package pins, native-module installs, deployed service versions, and real sandbox combinations remain unverified. |
| Features | MEDIUM | Product authority, acceptance gates, and cross-artifact dependencies agree strongly; live provider capability and conference behavior still require validation. |
| Architecture | MEDIUM | Ports/adapters, deterministic state, idempotency, and content addressing are well-grounded and consistently supported; actual shell, payment, provider, persistence, and Blossom adapters are deployment-specific. |
| Pitfalls | MEDIUM | Failure mechanisms are grounded in official protocols, package behavior, and validators. GLB structural validation and project timebox impact are HIGH-confidence; prevalence and complete offline behavior are lower confidence. |

**Overall confidence:** MEDIUM

The roadmap direction and phase order are high-confidence project constraints. Integration details remain deliberately medium-confidence until exercised against the installed shell and selected live services.

### Unresolved Gates to Address

- **Napplet map/resource gate:** installed SDK/shell capability set, actual CSP, MapLibre worker/style/image behavior, ortho path, and no-capability degradation must work in the built artifact.
- **21maps/provenance gate:** exact source, license, version, and MapLibre pin must be verified before reuse; otherwise use a clean policy-compliant fallback.
- **Protocol gate:** choose one request kind in `5000–5999`, derived result convention, strict tags/content schema, feedback semantics, and migration/version policy without attempting broad standardization.
- **Payment gate:** verify deployed LNbits/Phoenixd APIs, credential scope, amount units, expiry/replacement/late-payment policy, callbacks, polling, and an actual settlement route. No generic Napplet Lightning capability was found in the researched SDK surface.
- **Persistence gate:** select and prove the durable SQLite transaction/idempotency implementation on Node 24; in-memory state remains test-only.
- **Geodata gate:** exact orthophoto/WMS/WCS endpoints, coverage IDs, CRS/axis rules, auth, quotas, licenses, CORS, allowed fixtures, and outage behavior remain unknown.
- **Processor gate:** prove Python/GDAL wheels and isolation on the target host, then fix pixel/byte/memory/disk/CPU/time ceilings before live retrieval.
- **Artifact/viewer gate:** pin three.js and validator versions; prove self-contained GLB or every nested resource path under the built sandbox.
- **Blossom gate:** server URL, implemented BUDs, scoped auth, retention, redirects, CORS, and public-approval path remain unresolved; local serving stays mandatory regardless.
- **Conference gate:** full local-first operation is not yet proven. A local relay does not make wallet settlement, tiles, ortho, WCS, or Blossom local; rehearse on the actual laptop and payer device.
- **Pricing gate:** base sats/km², resolution factor, minimum, and caps remain stretch decisions after all four phases.
- **Publication gate:** external paid calls and public deployment require explicit signer/relay/Blossom approval, redacted traces, secret scan, cryptographic readback, and public diff review.

## Sources

### Primary — Project Authority (HIGH confidence)
- `.planning/PROJECT.md` — product scope, active requirements, constraints, exclusions, and fixed ordering.
- `docs/PROJECT-BRIEF.md` — authoritative product promise, gates, timeboxes, fallbacks, boundaries, and verification ladder.
- `AGENTS.md` — repository invariant, safety rules, and engineering expectations.
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, and `PITFALLS.md` — the four verified research artifacts synthesized here.

### Official Protocols, Standards, and Executable Authorities
- Nostr NIP-01 and NIP-90 at researched upstream commits — event verification, request/result ranges, kind-7000 feedback, and draft/unrecommended status. **MEDIUM**
- NIP-5D reference and published Napplet SDK/plugin/conformance packages — opaque-origin shell/capability model and production conformance behavior. **MEDIUM**
- LNbits and Phoenixd official source at researched commits — invoice creation and settlement-state adapter surfaces. **MEDIUM**
- OGC WMS 1.3.0 and WCS 2.x specifications — portrayal versus coverage, domain subsetting, envelope, CRS, and axis semantics. **MEDIUM**
- Rasterio, GDAL, and pyproj official documentation — window/block behavior, security boundaries, reprojection, and geodesic area. **MEDIUM**
- Khronos glTF 2.0 specification and official glTF Validator — GLB structure and executable validation. **HIGH**
- Blossom BUD-01/02/11 and related BUDs at researched commit — content-addressed retrieval/upload, descriptors, and scoped authorization. **MEDIUM**
- OpenStreetMap Foundation Tile Usage Policy — attribution, caching, identification, and prohibition of bulk scraping/prefetch. **MEDIUM**
- MapLibre GL JS and `strfry` official sources at researched commits — sandbox/worker considerations and local relay operation. **MEDIUM**

### Package and Prior-Trace Evidence (MEDIUM confidence)
- npm registry metadata for Node-facing toolchain, Napplet packages, MapLibre/Terra Draw, and conformance versions.
- PyPI metadata for `uv`, rasterio, pyproj, NumPy, HTTPX, Pillow, trimesh, pygltflib, pytest, Ruff, and mypy.
- Cached verified research digests under `.planning/research/.cache/`; operational prevalence claims remain LOW confidence where broad current web search was unavailable.

---
*Research completed: 2026-07-26*
*Ready for roadmap: yes*
