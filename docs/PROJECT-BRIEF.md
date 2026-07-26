# terrDVM — Authoritative Project Brief

## Product promise

A user selects a terrain bounding box on an OSM-based map, sees a live orthophoto preview, requests processing from a Nostr Data Vending Machine, pays a Lightning invoice, and receives a viewable terrain artifact.

The demonstration is successful when **a DVM accepts the request, issues an invoice, detects payment, and delivers a dummy GLB**. Mesh quality is polish, not the demo core.

## Non-negotiable execution order

1. **Napplet:** bbox selection on OSM plus live orthophoto preview.
2. **Paid DVM handoff:** DVM accepts job → invoice → payment → dummy GLB delivery.
3. **Processor:** WCS crop → heightmap → mesh plus ortho texture → GLB.
4. **Artifact delivery:** Blossom upload plus GLB viewer in the Napplet.
5. **Stretch only:** sats/km² price formula based on area and resolution/compute factor.

**Never implement step 3 before step 2.** Payment plus delivery is the vertical-slice core.

## Timeboxes and fallback law

- Any blocker lasting more than 30 minutes: take the fallback and continue.
- Mesh pipeline: maximum 3 hours before switching to displacement-map delivery.

| Blocker | Required fallback |
|---|---|
| Blossom fails | Serve the GLB locally |
| Full NIP-90 kind-7000 payment flow is too large | LNURL-pay or bolt11 QR plus `lightning:` link |
| Mesh pipeline consumes the timebox | Heightmap PNG plus three.js displacement instead of GLB |
| Conference Wi-Fi is unreliable | Local `strfry` on the laptop |
| Large WCS crop is too slow | 10 m DTM instead of 5 m |

## Hard boundaries

- No FIPS.
- No Freenet.
- No bridges.
- No custom tile server.
- Choose one job request kind from `5000–5999`, document the rationale, and verify current NIP-90 conventions before implementation.
- Defer broader NIP standardization discussion until after the SEC/demo slice.
- Reuse the existing 21maps v0 base where licensing and source provenance permit.
- Respect upstream OSM tile policy; do not bulk scrape or disguise heavy traffic.
- The Napplet is a sandboxed UI, not a privileged backend. Identity, signing, relay transport, storage, and Blossom upload remain shell/backend capabilities.
- Never embed private keys or Lightning admin credentials in browser/Napplet code.

## Open decisions for the GSD discussion

1. Exact request/result kinds in the NIP-90 `5000–5999` / `6000–6999` mapping.
2. `trimesh`/`pygltflib` mesh output versus displacement-only delivery.
3. Whether direct `fetch()` to WMS/WCS/ortho endpoints works in the built Napplet sandbox and CSP.
4. Whether the installed Napplet SDK exposes a payment capability/domain; otherwise use bolt11 QR and `lightning:` URI.
5. Pricing parameters: base sats/km², resolution multiplier, minimum charge, and caps.
6. Which relay set is used for local demo, conference mode, and later public test.
7. Whether this remains a standalone Napplet package or later joins the Palace 30-Napplet fleet. Do not couple it to Palace during the initial slice.

## Proposed technical split

### `apps/napplet`

- Map UI and bbox drawing.
- Ortho preview.
- Job request composition and status display.
- Invoice/QR presentation.
- GLB or displacement viewer.
- Shell adapter only; no secrets or unrestricted backend access.

### `services/dvm`

- NIP-90 request validation and deterministic job state.
- Quote/invoice creation through LNbits/Phoenixd.
- Payment polling or callback verification.
- Dummy artifact delivery first.
- Processor dispatch only after paid-flow acceptance passes.

### `services/processor`

- Bounded WCS/ortho fetch.
- CRS-aware crop and validation.
- Heightmap normalization.
- Time-boxed mesh/texture/GLB path.
- Deterministic displacement fallback.

### `packages/protocol`

- Versioned request, feedback, invoice, result, and artifact schemas.
- Strict parsers and deterministic state reducer.
- No mutable global truth or signer.

## Initial dependency candidates

- Napplet: TypeScript, Vite, `@napplet/sdk`, `@napplet/vite-plugin`, `vite-plugin-singlefile`.
- Map: existing licensed 21maps base; OSM/MapLibre-compatible rendering as proven by source inspection.
- Viewer: three.js GLTFLoader or displacement plane.
- Processor: Python virtual environment managed with `uv`; `rasterio`, `numpy`, `trimesh` and/or `pygltflib` only after the paid dummy loop passes.
- DVM: Nostr library selected after inspecting existing local stack and current NIP-90 examples.

## Inputs and access required before live integration

- 21maps v0 source and license/provenance.
- LNbits API credentials with Phoenixd behind it; secrets remain local and never committed.
- Blossom server URL and authorization path.
- Relay access for local `strfry`, HAVEN/Pubstreet as applicable.
- Installed Napplet SDK, shell/runtime, Paja/Kehto, and conformance CLI.
- Exact WMS/WCS/orthophoto endpoints and their public usage policies.

## GeoLibre reference boundary

Reference post: <https://x.com/i/status/2081066595527348507>

Repository: <https://github.com/opengeos/geolibre>

GeoLibre may be inspected for open-source GIS UX, MapLibre patterns, browser-side raster handling, and layer/tool architecture. It is **not** the terrDVM repository, runtime, backend, or mandatory dependency. Reuse requires exact license and source-version verification.

## Acceptance gates

### Gate 1 — bbox and preview

- Draw/edit/clear bbox.
- Display area in km².
- Preview the selected ortho without violating tile policy.
- Built Napplet works under production sandbox/CSP or names the exact fallback.

### Gate 2 — paid dummy delivery (demo core)

- Valid signed request accepted; malformed/oversized bbox rejected.
- DVM returns a real invoice or the documented payment fallback.
- Unpaid jobs cannot obtain the delivery artifact.
- Confirmed payment causes delivery of a structurally valid dummy GLB.
- UI wording distinguishes requested, invoiced, paid, processing, delivered, failed, and local fallback.

### Gate 3 — processor

- CRS and bbox validated before download.
- Raster dimensions/compute budget bounded.
- Heightmap produced from a real WCS crop.
- GLB produced inside the 3-hour timebox, otherwise displacement fallback is delivered honestly.

### Gate 4 — artifact and viewer

- Content hash recorded and read back.
- Blossom upload and browser retrieval verified, or local serving fallback active.
- Viewer loads the actual delivered artifact in the built Napplet.
- No artifact is called delivered until bytes and hash are verified.

## Required verification ladder

1. Protocol/reducer unit tests.
2. Processor fixture tests with small bounded public/licensed raster samples.
3. Typecheck and lint.
4. Production single-file Napplet build.
5. `napplet-conformance` against `dist`.
6. Paja/Kehto browser smoke of the built artifact.
7. Real request → invoice → payment → dummy delivery trace.
8. Denied/offline/timeout and malformed-request cases.
9. Final secret scan and public GitHub diff review.
10. Public deployment only after explicit signer/relay/Blossom approval and cryptographic readback.
