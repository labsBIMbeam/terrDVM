# terrCVM

## What This Is

terrCVM is a public, local-first demonstration of a paid terrain Data Vending Machine. A user selects a terrain bounding box on an OSM-based map, previews orthophoto imagery, submits a signed Nostr DVM request, pays a Lightning invoice, and receives a terrain artifact that can be inspected in the Napplet.

The initial release is a standalone sandboxed Napplet plus backend services. It is not coupled to Palace and does not attempt broader protocol standardization before the SEC/demo slice works.

## Core Value

A valid signed request must produce an invoice and, only after confirmed payment, deliver verified artifact bytes—first as a structurally valid dummy GLB so payment plus delivery is proven before terrain processing begins.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] A user can draw, edit, and clear a bounded terrain bbox and see its area in km².
- [ ] A user can preview selected orthophoto imagery without violating upstream tile or data-use policies.
- [ ] A valid signed NIP-90 terrain request is accepted while malformed, oversized, or unsafe requests fail closed.
- [ ] The DVM issues a real Lightning invoice or activates the documented bolt11/LNURL fallback.
- [ ] Unpaid jobs cannot retrieve delivery artifacts; confirmed payment advances deterministic job state.
- [ ] Confirmed payment delivers a structurally valid dummy GLB before processor implementation begins.
- [ ] A bounded, CRS-aware processor can derive a heightmap from a real WCS crop and produce a terrain artifact or honest displacement fallback.
- [ ] Delivered artifacts are hash-verified, uploaded to Blossom when available, and viewable in the built Napplet; local serving remains the required fallback.
- [ ] The production single-file Napplet passes conformance and browser smoke checks under the actual sandbox/CSP or documents the exact fallback.
- [ ] Secrets and privileged operations remain outside browser/Napplet code.

### Out of Scope

- FIPS — explicitly excluded from this project.
- Freenet — explicitly excluded from this project.
- Protocol bridges — explicitly excluded from the initial slice.
- Custom tile server — unnecessary for the demo and contrary to the bounded upstream-use approach.
- Palace or 30-Napplet fleet coupling — defer until terrCVM succeeds as a standalone package.
- Broader NIP standardization — defer until after the SEC/demo vertical slice.
- Production-grade terrain mesh quality before payment delivery — polish must not block the paid DVM proof.
- Bulk tile scraping or disguised heavy traffic — violates upstream OSM/data-service policy.
- Pricing optimization — sats/km² pricing is stretch scope only.

## Context

- The authoritative brief is `docs/PROJECT-BRIEF.md`.
- The non-negotiable build order is: bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer.
- The demonstration succeeds when a DVM accepts a request, issues an invoice, detects payment, and delivers a dummy GLB. Mesh quality is secondary.
- Proposed project split:
  - `apps/napplet`: bbox map UI, ortho preview, request/status UI, invoice/QR display, artifact viewer, shell adapter only.
  - `services/dvm`: NIP-90 validation, deterministic job state, invoice creation, payment verification, dummy delivery, later processor dispatch.
  - `services/processor`: bounded WCS/ortho retrieval, CRS-aware crop, heightmap, time-boxed GLB path, deterministic displacement fallback.
  - `packages/protocol`: versioned schemas, strict parsers, deterministic state reducer, no signer or mutable global truth.
- Initial candidates are TypeScript/Vite with the Napplet SDK and single-file plugin, an OSM/MapLibre-compatible licensed 21maps base, three.js for viewing, Python 3 with `uv`, and raster/mesh libraries only after the paid dummy loop passes.
- GeoLibre may be inspected for licensed GIS UX and browser raster patterns, but it is not the repository, runtime, backend, or mandatory dependency.
- Live integration depends on verified 21maps provenance, local LNbits/Phoenixd credentials, Blossom authorization, relay access, installed Napplet tooling, and exact WMS/WCS/orthophoto usage policies.
- Open decisions for phase discussion include exact NIP-90 request/result kinds, mesh library versus displacement-only delivery, sandbox/CSP fetch viability, payment capability availability, pricing parameters, relay sets, and eventual fleet placement.

## Constraints

- **Execution order**: Never implement terrain processing before invoice/payment/dummy-delivery works — payment plus delivery is the vertical-slice core.
- **Blocker timebox**: Any blocker over 30 minutes must take the documented fallback — preserves demo momentum.
- **Mesh timebox**: Maximum three hours before switching to heightmap plus three.js displacement — mesh polish cannot consume the project.
- **Blossom fallback**: Serve GLB locally if Blossom fails — delivery remains demonstrable.
- **Payment fallback**: Use LNURL-pay or bolt11 QR plus `lightning:` link if full NIP-90 kind-7000 flow is too large — preserve a real payment gate.
- **Network fallback**: Use local `strfry` when conference connectivity is unreliable — demo must work offline/local-first.
- **Raster fallback**: Use 10 m DTM if a 5 m WCS crop is too slow — bound compute and transfer.
- **Protocol**: Choose one request kind in `5000–5999`, document the rationale, and verify current NIP-90 conventions before implementation.
- **Sandbox**: Napplet UI is unprivileged; signing, relay transport, storage, payment admin, and Blossom upload are shell/backend capabilities.
- **Security**: Never embed private keys, Lightning admin credentials, authorization headers, or privileged production URLs in browser code or commits.
- **Validation**: Bounds, CRS, raster dimensions, compute budget, paths, subprocess arguments, payment state, artifact bytes, and content hashes fail closed.
- **Dependencies**: Reuse 21maps only after exact source and license/provenance verification; respect OSM and upstream service usage policy.
- **Publication**: External paid calls and public deployment require explicit signer/relay/Blossom approval and cryptographic readback.
- **Verification**: Unit tests, bounded processor fixtures, typecheck/lint, production build, Napplet conformance, browser smoke, real paid delivery trace, failure cases, secret scan, and public diff review are required.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build the paid dummy-delivery loop before terrain processing | It proves the product's core value and prevents mesh work from hiding payment/integration risk | — Pending |
| Keep protocol/job truth separate from Nostr, Lightning, raster, and Blossom adapters | Enables deterministic tests and fail-closed state transitions | — Pending |
| Keep the Napplet sandboxed and secret-free | Privileged capabilities belong to shell/backend boundaries | — Pending |
| Use mandatory fallbacks after strict timeboxes | A working honest demo is more valuable than an unfinished ideal path | — Pending |
| Keep terrCVM standalone for the initial slice | Avoids Palace coupling and protects narrow execution focus | — Pending |
| Treat GeoLibre as an optional licensed reference only | Prevents accidental architectural or licensing dependency | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-26 after initialization*
