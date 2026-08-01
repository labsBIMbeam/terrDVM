# Stack Research

**Domain:** Local-first paid terrain Nostr DVM with a sandboxed single-file Napplet, Lightning payment gate, bounded GIS processor, and hash-addressed artifact delivery
**Researched:** 2026-07-26
**Confidence:** MEDIUM — package metadata and protocol/source surfaces were verified in the prior trace; several live-service versions and end-to-end sandbox integrations remain intentionally unresolved.

## Recommendation in One Line

Use a Node 24/pnpm TypeScript monorepo for the single-file Napplet, protocol core, and DVM; keep raster work in a separate Python 3.13/`uv` worker; make LNbits, relay, Blossom, WCS, and signing replaceable backend adapters; and do not add the processor until the paid dummy-GLB loop passes.

## Non-Negotiable Build Order

```text
bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer
```

1. Prove bbox selection and an upstream-policy-compliant preview in the built sandbox.
2. Prove signed request → real invoice → confirmed payment → structurally valid dummy GLB.
3. Only then add bounded WCS/CRS/raster processing.
4. Only then add Blossom upload and the final viewer path; local artifact serving remains mandatory.

The processor packages below are phase-gated recommendations, not permission to begin mesh work early.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended / Confidence |
|------------|---------|---------|------------------------------|
| Node.js LTS | **24.18.0** | JS toolchain and DVM runtime | Exact Node 24 LTS patch was observed in the trace and satisfies Vite 8's Node requirement. **HIGH for compatibility, MEDIUM for “current” status.** |
| pnpm | **11.10.1** | Monorepo package manager | Exact registry/tool result from the trace; use one lockfile for `apps/napplet`, `services/dvm`, and `packages/protocol`. **MEDIUM.** |
| TypeScript | **7.0.2** | Browser, protocol, and DVM code | Exact npm result from the trace; strict schemas and reducers benefit from one language across the paid path. Validate the Napplet toolchain before accepting the major upgrade. **MEDIUM.** |
| Vite | **8.1.5** | Napplet build | Exact npm result; requires Node `^20.19.0 || >=22.12.0`, so Node 24.18.0 is compatible. **HIGH for metadata, MEDIUM until production build.** |
| `@napplet/sdk` | **0.25.0** | Shell-mediated sandbox capabilities | Verified package metadata and SDK surface. Direct `fetch`, external image URLs, storage, relay access, and signing are not browser authorities; use shell domains such as `resource`. **MEDIUM.** |
| `@napplet/vite-plugin` | **0.12.0** | Napplet manifest/build integration | Verified metadata; peer dependency is Vite `>=5.0.0`, so Vite 8 is nominally allowed. Build/conformance must prove actual compatibility. **MEDIUM.** |
| `vite-plugin-singlefile` | **2.3.3** | Single-file production artifact | Exact npm result; fits the Napplet packaging requirement. **MEDIUM until conformance.** |
| Python | **3.13.x** | Isolated raster processor runtime | Conservative minor line compatible with the verified raster package requirements. The trace did not establish the current 3.13 patch reliably. **MEDIUM.** |
| `uv` | **0.11.32** | Python environment and lockfile | Exact PyPI result; keeps GDAL/raster dependencies outside the Node service. **MEDIUM.** |

### Napplet: Map, Bbox, Preview, and Viewer

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| MapLibre GL JS | **5.24.0 or 6.0.0** | OSM-compatible map and raster layers | **Prefer the exact version already pinned by the licensed 21maps base**; 5.24.0 was verified as the latest v5 and 6.0.0 as the current major in the trace. Do not upgrade the inherited major during the demo. For a clean fallback, test 6.0.0 under the real CSP first. |
| `terra-draw` | **1.32.2** | Draw/edit/clear bounded rectangle | Exact npm result; use only rectangle/bbox modes needed by the product. |
| `terra-draw-maplibre-gl-adapter` | **1.4.1** | Terra Draw ↔ MapLibre integration | Exact npm result; use with whichever MapLibre major the accepted 21maps base proves. Compatibility is a smoke-test gate. |
| three.js + `GLTFLoader` | **Exact package version unresolved** | Display delivered GLB or displacement plane | Add only in the artifact/viewer phase. Official loader behavior was inspected, but the exact npm result was truncated in the continuation trace; pin before implementation. |
| glTF Validator | **Exact package version unresolved** | Structural GLB validation | Validate the dummy and processor output for GLB v2 structure, references, buffers, and images before labeling bytes “delivered.” |

**Sandbox rule:** the Napplet runs in an opaque-origin iframe with `sandbox="allow-scripts"`. Do not add `allow-same-origin`, `window.nostr`, direct WebSocket, direct signing, browser secrets, or unrestricted network access. The verified SDK surface states that strict CSP blocks direct `fetch()` and external image URLs; route bytes through shell capabilities. MapLibre worker/tile behavior and ortho preview therefore require a production-sandbox spike before the UI stack is considered accepted. Reuse the existing 21maps implementation only after exact source and license provenance are verified.

### Protocol and DVM Service

| Technology | Version | Purpose | Recommendation |
|------------|---------|---------|----------------|
| `nostr-tools` | **2.23.3 minimum observed** | Nostr event parsing/signature verification and relay adapter | `@napplet/vite-plugin@0.12.0` declares `^2.23.3`; the trace did not preserve the current direct-package version. Pin one exact version in the workspace after testing. Keep signer and relay transport backend-only. |
| Zod | **Exact version unresolved** | Versioned request/result/artifact schemas | Use strict schemas at every adapter boundary; reject unknown, malformed, oversized, or unsafe values. Pin before implementation. |
| Pure TypeScript reducer | Workspace package | Deterministic job truth | Model `requested → invoiced → paid → processing → delivered/failed/fallback`; illegal transitions fail closed. No Nostr, Lightning, raster, or Blossom I/O inside the reducer. |
| SQLite via `better-sqlite3` | **Exact version unresolved** | Durable local job/invoice/artifact state | Appropriate for one-machine demo determinism. The prior query did not preserve an exact version; pin only after Node 24 native-module install is proven. An in-memory adapter is test-only, never production truth. |
| LNbits HTTP API | **Deployment version unresolved** | Create BOLT11 invoice and verify payment state | Preferred payment adapter because credentials and Phoenixd stay server-side. Treat pending/success/failure as backend state, never infer payment from a button click. |
| Phoenixd | **Deployment version unresolved** | Lightning backend behind LNbits | Existing local infrastructure candidate. The prior trace could not resolve current docs/version; verify the deployed instance and API before live integration. |
| `strfry` | **Deployment version unresolved** | Local relay fallback | Use for unreliable conference networking. Exact installed version remains an environment preflight item. |

**Protocol posture:** NIP-90 is currently draft, optional, and marked **unrecommended** in favor of use-case-specific microstandards. For the demo, choose and document one request kind in `5000–5999`, its result mapping, and kind-7000 feedback semantics. `payment-required` with amount and optional `bolt11` is the payment stop gate. Do not broaden this slice into protocol standardization.

### Processor (Add Only After Paid Dummy Delivery)

| Library | Version | Purpose | Constraint |
|---------|---------|---------|------------|
| `rasterio` | **1.5.0** | Read/crop/transform raster coverage | Verified as requiring Python `>=3.12`; bound bbox, dimensions, bytes, and compute before retrieval. |
| `pyproj` | **3.7.2** | Explicit CRS and axis-order transforms | Verified as requiring Python `>=3.11`; never infer CRS/axis order silently. |
| NumPy | **2.5.1** | Heightmap normalization and array operations | Verified as requiring Python `>=3.12`; keep memory budgets explicit. |
| HTTPX | **0.28.1** | Timeout-bounded WCS/ortho HTTP client | Verified as requiring Python `>=3.8`; set connect/read/total limits and reject redirects or hosts outside policy. |
| Pillow | **12.3.0** | Heightmap/texture image output | Verified as requiring Python `>=3.10`; use for the honest PNG/displacement fallback. |
| trimesh | **4.12.2** | Time-boxed mesh/GLB generation | Add only after Gate 2; abandon after the three-hour mesh timebox. |
| `pygltflib` | **1.16.5** | Low-level glTF/GLB assembly or inspection | Use only if trimesh output control is insufficient; avoid maintaining two production writers without need. |
| pytest | **9.1.1** | Bounded processor fixtures | Test CRS, axis order, dimensions, timeouts, corrupt raster, and deterministic fallback. |
| Ruff | **0.16.0** | Python lint/format | Pin in the processor dev group. |
| mypy | **2.3.0** | Processor type checking | Pin in the processor dev group; do not mistake typing for runtime validation. |

WCS is an OGC coverage protocol, not a tile-scraping shortcut. Call `GetCapabilities`/`DescribeCoverage` as needed, validate the coverage envelope and CRS, calculate expected pixels and bytes, then issue one bounded `GetCoverage`. Use 10 m DTM when 5 m retrieval exceeds the project timebox.

### Artifact Delivery

| Technology | Version | Purpose | Recommendation |
|------------|---------|---------|----------------|
| Blossom BUD-01/02/11 | Draft protocol revisions inspected 2026-07-26 | SHA-256 addressed retrieval, upload, optional Nostr authorization | Implement as a backend adapter over HTTP first; no browser credential or authorization token. Verify upload descriptor and downloaded bytes against SHA-256. |
| Local artifact server | Workspace adapter | Mandatory delivery fallback | Always retain. Bind narrowly, use opaque artifact IDs, validate paths, set correct MIME, and enforce paid-job authorization. |
| GLB 2.0 | glTF 2.0 container | Dummy and final terrain artifact | A dummy must have valid GLB magic/version/structure and pass validator + browser load; never put fake bytes behind `.glb`. |

## Development Tools and Gates

| Tool | Version / Purpose | Required Gate |
|------|-------------------|---------------|
| `@napplet/conformance-cli` | **0.2.16**; depends on Playwright `^1.59.1` and `@napplet/conformance ^0.14.0` | Run against `dist` after the production single-file build. |
| Typecheck/lint | TS strict mode plus the chosen pinned JS linter | Must pass before browser smoke; exact linter versions were not retained by the trace. |
| Browser smoke | Paja/Kehto and real Chromium | Prove bbox, shell resource access, CSP/worker behavior, invoice display, and actual delivered artifact load. |
| Protocol TDD | Unit/property tests around parsers and reducer | Prove malformed requests, oversized bboxes, replay/duplicate handling, unpaid retrieval denial, and illegal state transitions. |
| Secret scan and public diff review | Repository-wide | Required before publication; captured invoices/tokens and privileged URLs must not enter fixtures or commits. |

## Phase-Gated Installation

```bash
# Workspace baseline
corepack enable
pnpm add -D vite@8.1.5 typescript@7.0.2 \
  @napplet/vite-plugin@0.12.0 @napplet/conformance-cli@0.2.16

# Gate 1: sandboxed UI (preserve the licensed 21maps MapLibre pin if reused)
pnpm add @napplet/sdk@0.25.0 vite-plugin-singlefile@2.3.3 \
  terra-draw@1.32.2 terra-draw-maplibre-gl-adapter@1.4.1
# Add either maplibre-gl@5.24.0 or maplibre-gl@6.0.0 only after the 21maps decision.

# Gate 3 only — never run before paid dummy delivery passes
uv init --python 3.13 services/processor
cd services/processor
uv add rasterio==1.5.0 pyproj==3.7.2 numpy==2.5.1 \
  httpx==0.28.1 pillow==12.3.0
uv add --dev pytest==9.1.1 ruff==0.16.0 mypy==2.3.0

# Mesh path only after Gate 2, and only inside the three-hour timebox
uv add trimesh==4.12.2 pygltflib==1.16.5
```

Do not install unresolved DVM/viewer packages with floating ranges. Resolve and commit exact lockfile pins during the relevant phase after compatibility checks.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Preserve licensed 21maps MapLibre pin | Greenfield MapLibre 6.0.0 | Use only if 21maps provenance/license cannot be verified or its sandbox path fails. |
| Terra Draw rectangle mode | Hand-written bbox interaction | Use a minimal custom control only if adapter/MapLibre major compatibility blocks for over 30 minutes. |
| LNbits with Phoenixd behind it | Direct Phoenixd API | Use when the deployed LNbits API is unavailable but Phoenixd invoice and settlement verification are demonstrably supported. |
| NIP-90 kind-7000 payment feedback | LNURL-pay or BOLT11 QR + `lightning:` link | Required fallback when the complete kind-7000 flow exceeds the 30-minute blocker law; backend payment verification remains mandatory. |
| Structurally valid dummy GLB | Displacement plane/heightmap | Dummy GLB is the Gate-2 target; displacement is the honest processor fallback after the mesh timebox. |
| Blossom delivery | Local authenticated serving | Mandatory whenever upload/auth/readback fails; local serving must remain demonstrable. |
| SQLite local state | External database | Use an external DB only after the standalone demo needs multi-instance coordination. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Browser-held private keys, LNbits admin keys, Phoenixd credentials, Blossom auth, WCS secrets, or NIP-46 material | Violates the sandbox and public-repository boundary | Shell/backend adapters with local secret injection |
| Direct Napplet `fetch`, XHR, WebSocket, external image URLs, or `window.nostr` | Verified opaque-origin/CSP model mediates network, relay, signing, and storage through the shell | `@napplet/sdk` capability domains, especially shell resource access |
| `allow-same-origin` on the Napplet iframe | Breaks the load-bearing isolation boundary | `sandbox="allow-scripts"` plus postMessage capabilities |
| Terrain processing before payment/dummy delivery | Hides core product risk behind GIS work | Deterministic paid dummy-GLB vertical slice first |
| Bulk OSM tile scraping/prefetch or a custom tile server | Violates project scope and upstream policy | Licensed bounded 21maps/OSM-compatible base with attribution and caching |
| A general GIS workbench or GeoLibre runtime dependency | Expands the product and creates provenance/architecture risk | Narrow bbox, preview, status, payment, and artifact UI; GeoLibre as reference only |
| Automatic “paid” or “delivered” state from UI action | Creates false state and can leak unpaid artifacts | Verified Lightning settlement and cryptographic byte/hash readback |
| FIPS, Freenet, bridges, or Palace coupling | Explicitly out of scope | Standalone terrCVM package |

## Compatibility and Acceptance Matrix

| Pair / Boundary | Verified | Must Still Be Proven |
|-----------------|----------|----------------------|
| Node 24.18.0 ↔ Vite 8.1.5 | Node satisfies Vite `^20.19.0 || >=22.12.0` | Clean install, typecheck, build |
| Vite 8.1.5 ↔ Napplet Vite plugin 0.12.0 | Plugin declares Vite `>=5.0.0` | Real manifest, single-file build, conformance |
| Napplet SDK 0.25.0 ↔ shell | Resource/signing/relay capability model inspected | Installed shell capability set; no generic payment capability was found |
| MapLibre ↔ Terra Draw adapter | Exact package versions observed | Pick v5.24 or v6 based on 21maps pin; draw/edit/clear smoke |
| MapLibre/ortho ↔ Napplet CSP | Direct network access is blocked by design | Worker loading and shell-mediated tile/raster path in built artifact |
| Python 3.13 ↔ raster stack | All verified minimum Python requirements intersect | Platform wheels/GDAL availability in the locked environment |
| NIP-90 ↔ product protocol | Current draft feedback/payment shape inspected | Exact request/result kind and local relay interoperability |
| LNbits/Phoenixd ↔ reducer | API behavior supports invoice plus status states conceptually | Exact deployed versions, auth, callback/poll behavior, real settlement trace |
| Blossom ↔ viewer | BUD hash/upload/auth model inspected | Server URL/auth policy, upload/readback, CORS/resource path |

## Unresolved Gaps (Do Not Research During This Continuation)

- Exact 21maps v0 source, license/provenance, current MapLibre pin, and whether its tile/ortho path already respects the Napplet resource boundary.
- Exact current versions for three.js, glTF Validator, Zod, `nostr-tools` direct use, `better-sqlite3`, JS test/lint tools, LNbits, Phoenixd, Blossom server/client, and `strfry`; pin during phase planning rather than claiming currency.
- Whether MapLibre workers, OSM tiles, WMS/WCS previews, QR links, and GLB loading work under the actual built Napplet CSP and shell capabilities.
- No generic Lightning payment capability was found in the inspected Napplet SDK 0.25.0 surface; confirm installed shell capabilities or use the documented BOLT11/LNURL UI fallback.
- Exact NIP-90 request/result kinds remain a deliberate phase decision; current NIP-90 is draft and unrecommended.
- Live credentials, relay access, WCS/ortho usage policies, Blossom authorization, and public deployment approvals remain environment/integration prerequisites, never repository configuration.

## Sources from the Prior Trace

- npm registry metadata captured for Vite, TypeScript, single-file plugin, MapLibre, Terra Draw, Napplet SDK/plugin/conformance, and related packages — exact package versions above. **MEDIUM confidence.**
- PyPI metadata captured for `uv`, rasterio, pyproj, NumPy, HTTPX, trimesh, pygltflib, Pillow, pytest, Ruff, and mypy — exact versions and Python minimums above. **MEDIUM confidence.**
- `https://vite.dev/guide/` and Node.js release page — engine/LTS compatibility inspected. **MEDIUM confidence.**
- Napplet SDK 0.25.0 package surface and pinned NIP-5D — opaque-origin sandbox, shell capability, signing/relay/storage, and resource-fetch boundaries. **MEDIUM confidence.**
- Official NIP-90 text — request/result/feedback/payment shape and current draft/unrecommended status. **MEDIUM confidence.**
- Blossom BUD-01/02/11 and NIP-B7 text — hash-addressed bytes, upload descriptors, and optional signed authorization. **MEDIUM confidence.**
- OSMF Tile Usage Policy and OGC WCS material — attribution/caching/no-scraping and coverage/CRS requirements. **MEDIUM confidence.**
- Khronos glTF 2.0 and glTF Validator material; three.js GLTFLoader docs — GLB structure and browser validation expectations. **MEDIUM confidence.**
- LNbits docs/source and local project evidence — invoice/status adapter direction; current deployment/version was not verified. **LOW–MEDIUM confidence.**

---
*Stack research for: terrCVM*
*Materialized from the completed 2026-07-26 research trace; no new research performed.*
