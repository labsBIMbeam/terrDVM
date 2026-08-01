# Feature Research

**Domain:** Paid, local-first Nostr NIP-90 terrain/GIS Data Vending Machine Napplet
**Researched:** 2026-07-26
**Confidence:** MEDIUM

## Feature Landscape

### Table Stakes (Users Expect These)

Features required for the product promise and acceptance gates. Missing any item makes the paid terrain flow incomplete, unsafe, or misleading.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| OSM-based map with bounded bbox draw, edit, and clear | Terrain tools begin with an understandable geographic selection | MEDIUM | Show the selected area in km²; reject oversized, malformed, non-finite, or out-of-range bounds before request creation |
| Live orthophoto preview for the selected area | Users need visual confirmation that they selected the intended terrain | HIGH | Respect attribution, caching, request-identification, and upstream-use policy; no bulk scraping or disguised heavy traffic |
| Clear selection and processing constraints | Users need to know why an area or resolution is rejected | MEDIUM | Surface bbox, CRS, raster-size, and compute-budget limits rather than failing silently |
| Signed, versioned terrain job request | A Nostr DVM request must be attributable, parseable, and linked to later feedback/results | HIGH | Choose and document one request kind in `5000–5999`; use strict schemas and verify event ID/signature before acceptance |
| Fail-closed request validation | Paid processing cannot accept malformed, oversized, or unsafe work | HIGH | Validate tags, bbox, CRS, resolution/compute budget, paths, subprocess arguments, and protocol version; reject unknown or unsafe input |
| Explicit deterministic job status | DVM users expect visible progress and terminal outcomes | MEDIUM | Distinguish `requested`, `invoiced`, `paid`, `processing`, `delivered`, `failed`, and `local fallback`; do not infer payment or delivery from UI actions |
| Real Lightning invoice presentation | Payment-required work needs an actionable quote/invoice | HIGH | Prefer the documented NIP-90 feedback flow; required fallback is LNURL-pay or bolt11 QR plus a `lightning:` link |
| Confirmed-payment gate | “Money in, data out” requires proof of settlement before access | HIGH | Verify LNbits/Phoenixd payment state or callback; unpaid jobs must never retrieve artifact bytes |
| Structurally valid dummy GLB delivery | The demo core must prove paid delivery before terrain processing begins | MEDIUM | Validate GLB structure, MIME/type, bytes, and hash; never put fake/non-GLB output behind a `.glb` extension |
| Result linked to the originating request | Clients need to correlate request, feedback, invoice, and result | MEDIUM | Preserve Nostr request/result references and deterministic job identity across adapters |
| Bounded, CRS-aware WCS crop | Real terrain processing requires a correctly scoped elevation coverage | HIGH | Validate coverage envelope, CRS and axis order before retrieval; bound pixel dimensions and download/compute budgets; use 10 m DTM if 5 m is too slow |
| Heightmap from real licensed/public raster data | The processor must produce genuine terrain data, not simulated production output | HIGH | Normalize a real bounded WCS crop; keep small fixtures for repeatable tests |
| Time-boxed terrain output with honest fallback | Users need a deliverable even when mesh generation is not viable | HIGH | Attempt mesh/texture/GLB for at most three hours, then deliver a clearly labeled heightmap plus three.js displacement fallback |
| Content-addressed artifact integrity | A delivery claim must refer to exact verified bytes | MEDIUM | Record SHA-256, size, and media type; read bytes back and verify the advertised hash before marking delivered |
| Artifact retrieval with local fallback | Users must be able to retrieve the paid output even if Blossom is unavailable | HIGH | Upload to Blossom when available; if it fails, serve the same verified bytes locally and label the state accurately |
| Built-Napplet artifact viewer | The final result must be inspectable in the actual product surface | HIGH | Load the actual delivered GLB or explicitly labeled displacement result, not a development-only stand-in |
| Sandboxed single-file production Napplet | The initial product is an unprivileged Napplet, not a conventional trusted web app | HIGH | Production build must pass conformance and browser smoke under actual sandbox/CSP, or document and activate the exact fallback |
| Secret-free shell/backend capability boundary | Signing, relay transport, payments, storage, and upload are privileged operations | HIGH | Browser code receives only bounded shell capabilities; never embed keys, Lightning admin credentials, auth headers, or privileged URLs |
| Actionable errors and degraded-mode labels | Networked GIS/payment workflows fail in multiple independent ways | MEDIUM | Cover denied, offline, timeout, malformed-request, payment-failure, processor-failure, and local-fallback cases without claiming false success |

### Differentiators (Competitive Advantage)

These features align directly with terrCVM’s narrow product promise rather than expanding it into a general GIS suite.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Signed Nostr request → real Lightning payment → terrain bytes | Combines verifiable job intent, payment, and digital terrain delivery in one demonstrable flow | HIGH | The paid dummy-delivery trace is the core proof; terrain quality must not hide payment/integration risk |
| Payment-gated verified artifact bytes before processor investment | Proves the risky commercial handoff first and prevents unpaid access | HIGH | No processor work begins until invoice, settlement verification, and valid dummy delivery pass |
| Deterministic protocol/job truth separated from adapters | Makes Nostr, Lightning, raster, Blossom, and UI failures testable without corrupting state | MEDIUM | Versioned schemas and a deterministic reducer own state; adapters do not become mutable global truth |
| Local-first conference-resilient fallbacks | Keeps the demo honest and operable when relay, Blossom, raster resolution, or network conditions degrade | MEDIUM | Local `strfry`, local artifact serving, 10 m DTM, bolt11/LNURL, and displacement are explicit fallbacks, not silent substitutions |
| Hash-verifiable Blossom-or-local delivery | Gives the user cryptographic evidence that retrieved bytes match the delivered artifact | MEDIUM | Verify exact bytes after upload/retrieval; Blossom is an enhancement, never a delivery single point of failure |
| Secure Napplet shell boundary | Preserves a small, distributable UI while privileged identities and credentials remain outside it | HIGH | Use shell resource/sign/relay capabilities; current SDK evidence does not document a generic Lightning payment domain |
| Honest quality/timebox contract | Guarantees a useful bounded result rather than an unfinished “perfect” mesh | MEDIUM | Three-hour mesh cap and explicit displacement labeling protect demo completion and user trust |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Terrain processor before paid dummy delivery | Mesh output is visually impressive | Violates the fixed execution order and can conceal payment, state, and delivery failures | First complete bbox/ortho UI, then signed request → invoice → confirmed payment → valid dummy GLB |
| Production-grade mesh quality in the demo core | Makes the result look finished | Can consume the schedule without validating the paid DVM | Time-box mesh work to three hours, then ship honest displacement output |
| General-purpose GIS workbench | GeoLibre demonstrates many useful GIS tools | Expands scope far beyond a terrain purchase flow and creates unnecessary dependencies | Keep bbox, preview, constraints, status, payment, and artifact inspection only |
| FIPS | May appear related to adjacent infrastructure work | Explicitly excluded from terrCVM | Keep the project focused on the standalone paid terrain slice |
| Freenet | May appear useful for decentralized delivery | Explicitly excluded and unrelated to the core validation | Use Nostr for DVM messaging and Blossom/local serving for artifact delivery |
| Protocol bridges | Promise broader interoperability | Add integration and security surface before the core flow is proven | Implement one documented NIP-90 terrain request/result mapping |
| Broader NIP standardization before the demo | A terrain microstandard may eventually be useful | NIP-90 is draft/unrecommended and premature standardization blocks execution | Choose one kind and schema locally; revisit standardization after the SEC/demo slice |
| Custom tile server | Gives maximum control over basemap traffic | Unnecessary infrastructure for a bounded demo and contrary to the upstream-use approach | Reuse verified/licensed 21maps or policy-compliant OSM/MapLibre-compatible sources |
| Bulk tile scraping or disguised heavy traffic | Can make data appear locally available | Violates upstream policy and risks blocking | Bound requests, cache normally, identify the client, show attribution, and use licensed/public raster samples |
| Direct privileged network/payment/upload logic in the Napplet | Seems simpler than a shell/backend split | Breaks sandbox/CSP assumptions and risks exposing secrets | Use narrow shell/backend adapters for signing, relay, resource fetch, payment admin, storage, and Blossom upload |
| Palace or 30-Napplet fleet coupling | Offers immediate ecosystem integration | Adds unrelated deployment dependencies before standalone success | Ship terrCVM as a standalone package; discuss fleet placement later |
| GeoLibre as runtime/backend/mandatory dependency | It already contains broad GIS patterns | Violates the reference-only boundary and imports an oversized architecture | Use it only as a licensed UX/pattern reference after exact source/version verification |
| Pricing optimization in the MVP | Dynamic pricing sounds commercially complete | Distracts from proving a real payment gate and has unresolved parameters | Use a simple bounded price first; sats/km² with factors/caps is stretch scope |
| Unverified “delivered” state | Reduces latency and implementation work | Can charge users for absent, corrupt, or substituted bytes | Require byte readback and hash verification before the delivered transition |
| Fake processor output labeled as GLB | Simplifies the demo | Misrepresents artifact format and defeats executable verification | Use a structurally valid dummy GLB, or label the displacement fallback exactly |
| Silent fallback | Keeps the happy-path UI simple | Misleads users about payment, network, quality, or storage state | Expose the active fallback and preserve deterministic status transitions |

## Feature Dependencies

```text
[Licensed/policy-compliant map + ortho sources]
    └──requires──> [Bounded bbox draw/edit/clear + area]
                         └──requires──> [Strict versioned request schema]
                                              └──requires──> [Signed request validation]
                                                                   └──requires──> [Deterministic job state]
                                                                                        └──requires──> [Real invoice]
                                                                                                             └──requires──> [Confirmed payment gate]
                                                                                                                                  └──requires──> [Valid dummy GLB + hash]

[Valid dummy delivery acceptance passes]
    └──unlocks──> [Bounded CRS-aware WCS crop]
                       └──requires──> [Real heightmap]
                                            └──requires──> [Time-boxed GLB path or honest displacement fallback]

[Verified processor artifact]
    └──requires──> [SHA-256 descriptor + byte readback]
                       ├──enhances──> [Blossom upload/retrieval]
                       └──fallback──> [Local artifact serving]
                                            └──requires──> [Built-Napplet viewer of actual delivered bytes]

[Sandbox/CSP conformance + shell capability boundary]
    └──constrains──> [Signing, relay, resource fetch, payment admin, and upload]

[Processor-first work] ──conflicts──> [Paid dummy-delivery core]
[Silent fallback] ──conflicts──> [Deterministic truthful job state]
```

### Dependency Notes

- **BBox/ortho UI precedes the paid handoff:** The user must create and verify a bounded geographic request before signing it.
- **Signed validation precedes invoicing:** Invalid or unsafe work must fail before a payment obligation is created.
- **Confirmed settlement precedes artifact access:** Creating or displaying an invoice is not proof of payment.
- **Dummy delivery precedes processor work:** This is the fixed project invariant and primary MVP risk gate.
- **WCS validation precedes raster download:** CRS, axis order, bbox, dimensions, and budget must be bounded before network or compute work.
- **Artifact verification precedes delivery state:** Blossom or local retrieval must return bytes matching the advertised hash.
- **Viewer follows artifact delivery:** It must inspect the actual delivered result, not a separately generated preview asset.
- **Sandbox constraints apply across all phases:** Current Napplet evidence indicates direct fetch/external image URLs are restricted; privileged operations belong to shell/backend capabilities.

## MVP Definition and Fixed Ordering

### Launch With: Demo MVP Proof Gate

Complete these in order; do not start processor implementation before both are accepted.

1. **BBox and orthophoto UI**
   - [ ] Draw, edit, and clear a bounded bbox.
   - [ ] Display area in km² and clear constraint errors.
   - [ ] Preview selected orthophoto with attribution and upstream-policy compliance.
   - [ ] Pass the production single-file Napplet sandbox/CSP path or activate the documented shell-resource fallback.
2. **Paid DVM dummy delivery — demo core**
   - [ ] Compose and submit one documented signed NIP-90 terrain request.
   - [ ] Reject malformed, oversized, unsigned/invalid, or unsafe requests fail-closed.
   - [ ] Issue a real Lightning invoice or activate the documented bolt11/LNURL fallback.
   - [ ] Show deterministic requested/invoiced/paid/processing/delivered/failed/fallback states.
   - [ ] Prove unpaid jobs cannot retrieve artifacts.
   - [ ] On confirmed payment, deliver structurally valid, hash-verified dummy GLB bytes.
   - [ ] Capture a real request → invoice → payment → dummy-delivery trace.

**MVP validation condition:** A DVM accepts a valid request, issues an invoice, confirms payment, and delivers a structurally valid dummy GLB while unpaid and malformed cases fail closed.

### Add After MVP Validation (v1.x), In This Order

3. **Terrain processor**
   - [ ] Validate bbox, CRS/axis order, raster dimensions, and compute budget before retrieval.
   - [ ] Produce a heightmap from a real bounded WCS crop.
   - [ ] Attempt mesh/texture/GLB only inside the three-hour timebox.
   - [ ] Deliver an explicitly labeled displacement fallback if the mesh path exceeds the timebox.
4. **Blossom delivery and built-Napplet viewer**
   - [ ] Record content hash, size, and media type and verify bytes by readback.
   - [ ] Upload/retrieve through Blossom when available; use verified local serving when not.
   - [ ] Load the actual delivered GLB or displacement result in the built Napplet.
   - [ ] Pass conformance, browser smoke, failure-path, secret-scan, and public-diff gates.

### Stretch Only (After the Four Ordered Steps)

- [ ] **sats/km² pricing formula** — add only after the paid flow, processor, and delivery/viewer are validated; parameters, multipliers, minimum charge, and caps remain open.

### Explicitly Excluded from the Initial Slice

- FIPS, Freenet, protocol bridges, custom tile infrastructure, Palace/fleet coupling, broad NIP standardization, bulk scraping, and production-grade mesh polish as a prerequisite.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Bounded bbox draw/edit/clear and area | HIGH | MEDIUM | P1 |
| Policy-compliant ortho preview | HIGH | HIGH | P1 |
| Signed request plus fail-closed validation | HIGH | HIGH | P1 |
| Deterministic status display | HIGH | MEDIUM | P1 |
| Real invoice and confirmed-payment gate | HIGH | HIGH | P1 |
| Structurally valid dummy GLB delivery | HIGH | MEDIUM | P1 |
| Hash verification before delivered state | HIGH | MEDIUM | P1 |
| Production Napplet sandbox/conformance path | HIGH | HIGH | P1 |
| Bounded CRS-aware WCS crop and real heightmap | HIGH | HIGH | P2 |
| Time-boxed mesh or honest displacement fallback | HIGH | HIGH | P2 |
| Blossom upload with local serving fallback | MEDIUM | HIGH | P2 |
| Viewer for actual delivered artifact | HIGH | HIGH | P2 |
| sats/km² pricing optimization | LOW | MEDIUM | P3 |

**Priority key:**
- **P1:** Required for the demo MVP proof gate.
- **P2:** Required for the full ordered v1 slice after the paid dummy loop passes.
- **P3:** Stretch only after end-to-end validation.

## Reference Product and Standards Analysis

| Capability | Prior evidence | terrCVM approach |
|------------|----------------|------------------|
| Map-based bounded terrain selection | TouchTerrain and Terrain2STL expose area/region selection; GeoLibre includes map controls, area measurement, bbox extraction, raster/WMS loading, and CRS metadata | Implement only bounded bbox draw/edit/clear, area, preview, and constraints—not a general GIS workbench |
| Request/payment/result lifecycle | NIP-90 defines request/result ranges and kind-7000 feedback including payment-required, processing, error, success, and partial; LNbits exposes invoice creation and payment-state lookup | Use one documented terrain kind, strict event validation, real invoice, verified settlement, explicit state, and result correlation |
| Content-addressed blob delivery | Blossom BUD evidence uses SHA-256-addressed retrieval and descriptors with URL/hash/size/type; authorization may be signed and scoped | Upload exact bytes, read them back, verify SHA-256, and retain local serving as required fallback |
| Valid terrain artifact | glTF 2.0 defines GLB structure/media type and the official validator checks structure, references, buffers, images, and resources | Validate the dummy and processor GLB; never mislabel displacement or fake output as GLB |
| Sandboxed Napplet distribution | Current SDK/plugin/conformance package evidence supports shell-owned domains, single-file opaque-origin artifacts, signed hashed manifests, and real-browser sandbox checks | Keep secrets and privileged I/O outside the UI; verify the production artifact under actual sandbox/CSP |

## Research Gaps and Phase Flags

These are unresolved inputs or implementation decisions already named by the brief or exposed by the collected trace; they are not invitations to expand scope.

- **NIP-90 kinds and schema:** Exact request/result kinds and terrain payload tags remain to be selected and documented. NIP-90 is draft, optional, and marked unrecommended; treat the first schema as a versioned project microstandard, not a broad standardization effort.
- **Payment capability:** Current collected Napplet SDK evidence does not document a generic Lightning payment domain. Confirm the installed shell/runtime capability during phase discussion; otherwise use the required bolt11 QR plus `lightning:` or LNURL fallback.
- **Sandbox/CSP resource path:** Direct WMS/WCS/ortho fetch viability in the built Napplet is unresolved. Current package evidence points toward shell-mediated resource bytes; verify this with the actual production artifact.
- **21maps source/provenance:** Exact v0 source, license, and permitted reuse are not yet verified. Do not make it mandatory until verified.
- **Live data policy:** Exact WMS/WCS/orthophoto endpoints, credentials, quotas, CRS/axis behavior, and public-use policies remain required integration inputs.
- **Mesh library choice:** `trimesh`/`pygltflib` versus displacement-only remains open, but the three-hour mesh timebox and fallback are fixed.
- **Blossom integration:** Server URL, authorization path, and publication approval remain unavailable; local verified serving is mandatory regardless.
- **Relay sets and offline limits:** Local/conference/public relay choices remain open. Local `strfry` removes relay dependence, but real Lightning settlement and live WCS may still require connectivity.
- **Pricing:** Base sats/km², resolution factor, minimum, and caps are unresolved and explicitly stretch scope.
- **Fleet placement:** Eventual Palace integration may be discussed only after standalone success.

## Sources

Evidence below was already collected in the prior research trace; no additional research was performed to create this artifact.

- terrCVM authoritative sources: `.planning/PROJECT.md`, `docs/PROJECT-BRIEF.md`, and `AGENTS.md`.
- Nostr protocol NIP-90 (`nostr-protocol/nips`, `90.md`) and the `nostr-protocol/data-vending-machines` kind-range reference inspected in the prior trace.
- Current LNbits source, especially `lnbits/core/views/payment_api.py`, inspected in the prior trace.
- Blossom BUD-01, BUD-02, BUD-04, BUD-07, and BUD-11 inspected in the prior trace.
- OpenStreetMap Foundation, Tile Usage Policy: <https://operations.osmfoundation.org/policies/tiles/>.
- OGC Web Coverage Service material inspected in the prior trace.
- Khronos glTF 2.0 specification and official glTF Validator material inspected in the prior trace.
- Current npm package documentation/metadata captured in the trace: `@napplet/sdk` 0.25.0, `@napplet/vite-plugin` 0.12.0, `@napplet/conformance` 0.14.0, and `@napplet/conformance-cli` 0.2.16.
- GeoLibre repository and MIT license: <https://github.com/opengeos/geolibre> (reference only).
- TouchTerrain and Terrain2STL live interfaces captured in the prior trace.
- Cached verified digests in `.planning/research/.cache/` (eight JSON records, mostly MEDIUM confidence; conference/offline prevalence synthesis is LOW confidence).

---
*Feature research for: terrCVM paid terrain/GIS DVM demo*
*Researched: 2026-07-26*
