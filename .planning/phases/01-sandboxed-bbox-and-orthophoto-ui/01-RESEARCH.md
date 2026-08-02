# Phase 1: Sandboxed Bbox and Orthophoto UI — Research

**Researched:** 2026-07-26  
**Domain:** Sandboxed single-file Napplet, MapLibre-compatible bbox interaction, geodesic area, orthophoto preview, and fail-closed shell capability boundary  
**Phase requirements:** MAP-01..MAP-08, SBOX-01..SBOX-04, VER-02, OPS-01; conditional early application of SBOX-05  
**Overall confidence:** MEDIUM — project scope and phase gates are HIGH-confidence local authority; published package surfaces and locally captured source are MEDIUM; 21maps provenance, the production orthophoto endpoint contract, and full Kehto/Paja built-artifact behavior remain open gates.

## User Constraints

**No Phase 1 `CONTEXT.md` exists.** The following binding decisions are copied from the authoritative roadmap, requirements, project brief, AGENTS.md, and the final roadmap review; the planner must treat them as locked rather than reopen them. [VERIFIED: `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `docs/PROJECT-BRIEF.md`, `AGENTS.md`, `.planning/reviews/roadmap-opus5-final.md`]

- The implementation order is fixed: **bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer**. Phase 1 contains no processor, payment, Nostr protocol, artifact, or viewer implementation. [VERIFIED: project authority]
- MAP-07 displays configured **fixed v1 resolution and output defaults** in the canonical request preview. Resolution is not user-selectable in Phase 1; selectable resolution and area/resolution pricing remain v2. [VERIFIED: roadmap recorded planning decision]
- MAP-08 clears before map code is written. Reuse 21maps only if its exact v0 source, version, license, provenance, and inherited MapLibre pin are proved. If any item is unresolved, record and use a clean policy-compliant fallback before implementation. Do not begin on an unverified base and reconcile later; do not upgrade an inherited MapLibre major during the demo. [VERIFIED: roadmap entry gate and final roadmap review]
- The Napplet is an unprivileged sandboxed UI. Signing, relay transport, external resource bytes, storage, payment administration, and upload are accessed only through feature-detected shell/backend capabilities. Browser assets contain no privileged credentials or token-bearing URLs. [VERIFIED: SBOX-03, SBOX-04]
- If the SBOX-02 fallback introduces any local shell/backend resource surface, the SBOX-05 boundary applies **from its first run**: loopback bind by default, a scoped local authentication token on every endpoint, narrow origin/capability policy, and failure on missing auth or unapproved non-loopback exposure. If no such surface is needed, record that no local surface exists. SBOX-05 remains owned by Phase 2. [VERIFIED: roadmap Phase 1 entry gate and Success Criterion 4]
- Produce a real production single-file `dist`, run `napplet-conformance` against `dist`, and run actual Paja/Kehto browser smoke of that built artifact. Development-server success alone is not evidence. [VERIFIED: SBOX-01, SBOX-02, VER-02]
- Phase 1 must produce the Phase 1 failure subset: **VER-04-T1 denied capability** and **VER-04-T3 resource timeout**. Negative-path evidence is not deferred to Phase 4. [VERIFIED: roadmap recurring exit gates]
- The OPS-01 fallback ledger is created as a real artifact in Phase 1 with a fixed location and schema. An empty but valid ledger may pass if no fallback activated; an undefined ledger may not. Every blocker lasting more than 30 minutes takes and records its documented fallback. [VERIFIED: OPS-01 and final roadmap review]
- The km² method and antimeridian policy are pinned and unit-tested. Area is geodesic or projected, never raw degree area. Non-finite, malformed, out-of-range, antimeridian-ambiguous, and over-limit bboxes fail closed. [VERIFIED: MAP-03, MAP-04 and final roadmap review]
- Map and ortho access is bounded and attributed: no bulk prefetch, scraping, disguised traffic, or custom tile server. Phase 1 makes no paid call and publishes nothing; VER-07 approval is not in scope. [VERIFIED: MAP-06 and project brief]
- The secret scan and public-diff review run over everything Phase 1 commits, including source, evidence, traces, fixtures, configuration, and planning documentation. Do not wait until Phase 4. [VERIFIED: roadmap standing rules]
- No Python, `uv`, GDAL, rasterio, pyproj, NumPy, trimesh, pygltflib, WCS processor, Nostr signing/relay code, invoice/payment code, artifact server, or retrieval endpoint is installed or implemented in Phase 1. [VERIFIED: final roadmap review]

## Summary

Phase 1 should be planned as an early production tracer, not as a conventional frontend prototype. The tracer begins with the MAP-08 provenance decision, establishes a minimal TypeScript/Vite Napplet, emits one self-contained production `index.html`, runs conformance against `dist`, and then proves bbox draw/edit/clear plus attributed orthophoto preview under the actual Kehto/Paja sandbox. The browser is not trusted with arbitrary network access: the preferred preview path is the shell `resource` capability, feature-detected at runtime; direct `fetch()` and external image URLs are not an acceptable production assumption. [VERIFIED: project authority; local `@napplet/sdk@0.25.0` and `@napplet/vite-plugin@0.12.0` package artifacts]

The safest map implementation is conditional. If 21maps evidence is still incomplete at implementation start, use a clean MapLibre-compatible fallback and record that decision before writing map code. A provisional greenfield candidate is MapLibre GL JS 5.24.0 with Terra Draw 1.32.2 and its MapLibre adapter 1.4.1, but every package marked SUS in the legitimacy audit requires a human verification checkpoint before lockfile mutation. Do not use MapLibre 6 merely because it was current in the trace; the trace did not prove its sandbox compatibility, and it is unnecessary to upgrade an inherited major. [VERIFIED: local trace and Terra Draw package source; project MAP-08 gate]

The exact production orthophoto source is not yet selected. Captured NLS Finland material establishes that its orthophoto dataset is open data under CC BY 4.0 and documents distribution channels, but the tested WMTS URL returned 401 and did not expose usable CORS. Kapsi documented NLS orthophoto attribution but redirected the tested tile to an unresolvable host. USGS service metadata established a bounded tiled imagery service but its exact terms page was not captured. Therefore none of these is approved as the production endpoint yet. The planner must insert a pre-implementation endpoint/policy/CORS gate and may use a local, small, licensed preview fixture for deterministic tests only—not as a claim of live production preview. [VERIFIED: timed-out trace captured outputs; endpoint conclusion is a fail-closed synthesis]

**Primary recommendation:** lead with one production-quality end-to-end tracer: provenance decision → single-file build → conformance → feature-detected resource path → one valid bbox and preview → built-artifact Paja smoke → denied/timeout evidence; expand validation cases only after that tracer passes.

## Scope and Requirement Interpretation

| Requirement | Prescriptive interpretation for planning | Evidence required at exit |
|---|---|---|
| MAP-01 | Exactly one rectangular bbox on an OSM-compatible map; no general drawing workbench. | Built-artifact browser trace showing rectangle creation. |
| MAP-02 | Edit the current rectangle and clear it; a second draw replaces or is rejected explicitly. | Browser assertions for edit and clear. |
| MAP-03 | Normalize to `[west, south, east, north]` in EPSG:4326 and calculate WGS84 geodesic polygon area in square metres, then divide by 1,000,000. Use `@turf/area` only after its audit gate; otherwise use another already-authoritatively verified geodesic library, not custom spherical math. | Unit fixtures at equator and high latitude; no degree-area calculation. |
| MAP-04 | Reject non-finite values, wrong arity/order, lon outside `[-180,180]`, lat outside `[-90,90]`, `west >= east`, `south >= north`, any antimeridian crossing/ambiguity in v1, zero area, and configured max-area exceedance. | Named unit tests for every clause plus UI error smoke. |
| MAP-05 | Preview imagery must correspond to the normalized bbox and active source; stale responses may not overwrite a newer selection. | Request correlation/cancellation test plus visual smoke. |
| MAP-06 | Render source attribution in the map UI; request only visible/selected bounded content, use normal caching, and perform no bulk prefetch. | Screenshot, request log, and source-policy record. |
| MAP-07 | Canonical preview is a pure DTO: bbox order, EPSG:4326, area km², fixed resolution, fixed output MIME, active source/fallback. It does not sign or publish. | Snapshot/unit test proving fixed defaults and source label. |
| MAP-08 | Decide 21maps reuse or clean-room fallback before map implementation. | Provenance record containing all five required fields, or explicit fallback decision. |
| SBOX-01 | Configure Napplet Vite plugin `artifactMode: 'single-file'`; assert `dist/index.html` is the production payload and run conformance against `dist`. | Build log, artifact inventory, conformance report and exit code 0. |
| SBOX-02 | Exercise the built artifact in actual Kehto/Paja, not only Vite dev mode. If resource transport fails, activate the named fallback and apply SBOX-05 immediately. | Browser evidence and exact active transport name. |
| SBOX-03 | One shell adapter owns capability discovery and resource retrieval. No map module reaches shell globals directly. | Unit test of adapter plus static search/public diff review. |
| SBOX-04 | No secret-like or privileged material in source, `dist`, logs, fixtures, evidence, or committed config. | Redacted scanner output and reviewed public diff. |
| VER-02 | Clean-checkout typecheck, lint, unit tests, production build, and conformance all pass. | Machine-readable logs from a clean worktree/checkout. |
| OPS-01 | Fixed append-only fallback ledger exists and validates. | Schema validation plus ledger review. |
| SBOX-05 early boundary | Applies only if a local resource fallback server exists. | Loopback socket assertion, auth-negative test, origin-negative test, or explicit “no local surface” record. |

[VERIFIED: requirements and roadmap; implementation prescriptions not fixed by authority are recommendations derived from captured package behavior and are MEDIUM confidence.]

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rule |
|---|---|---|---|
| Map rendering and gestures | `apps/napplet/src/map` | MapLibre/Terra Draw adapter | UI-only; no credentials or direct service authority. |
| Bbox normalization/validation | Pure domain module | UI presenter | No DOM or network; total result type, no silent coercion. |
| Geodesic area | Audited library wrapper | Domain fixtures | Never raw longitude×latitude degree arithmetic. |
| Canonical request preview | Pure domain projection | UI presenter | Fixed v1 defaults; no signing, relay, or payment behavior. |
| Ortho source selection | Checked-in source policy record | Shell resource adapter | Exact origin/layer/license/attribution/limits are configuration, not arbitrary user URL. |
| External bytes | `src/shell/resource-client.ts` | Host shell resource domain | Feature-detect; timeout/cancel; explicit denied/unavailable errors. |
| Optional local resource fallback | Loopback backend, only if required | Shell adapter | Scoped token every endpoint and fail closed from first run. |
| Build/conformance | Vite/Napplet plugin + conformance CLI | CI/verification scripts | Production `dist`, never dev-server-only evidence. |
| Paja smoke | Kehto/Paja runtime + Chromium | Test harness | Exercise built artifact and degraded modes. |
| Fallback audit | `.planning/evidence/fallback-ledger.jsonl` | Schema/check script | Append-only, redacted, shared by all phases. |

[VERIFIED: project architecture research and local package artifacts]

## Standard Stack

### Core Phase 1 Stack

All versions below are **candidate pins from the existing trace**, not blanket install authorization. Packages marked SUS require the human-verification checkpoint described in the Package Legitimacy Audit before installation. [VERIFIED: timed-out trace]

| Tool/library | Candidate pin | Purpose | Decision |
|---|---:|---|---|
| Node.js | Compatible installed runtime; package `engines` gate | Build/test runtime | Use one repository-pinned supported major after clean-install proof; do not assume the transient Node 25 host version is the deployment contract. |
| pnpm | Repository-pinned via Corepack | Deterministic lockfile | Use a workspace lockfile; the trace saw pnpm 10.8.0 locally. |
| TypeScript | **5.9.3**, not 7.0.2 | Strict browser code | The late trace found `typescript-eslint@8.46.4` requires TypeScript `<6`; selecting 7.0.2 would create a known incompatibility. |
| Vite | **8.1.5** | Production build/preview | Nominally compatible with Napplet plugin’s Vite `>=5` peer range; real build remains the gate. |
| `@napplet/sdk` | **0.25.0** | Shell capability wrapper | Use only through one adapter. |
| `@napplet/vite-plugin` | **0.12.0** | Napplet manifest/build and native single-file mode | Configure `artifactMode: 'single-file'`; do not add a second single-file plugin unless this proven path fails. |
| `@napplet/conformance-cli` | **0.2.16** | Real Chromium conformance | Run against `apps/napplet/dist`. |
| MapLibre GL JS | **5.24.0 candidate** | OSM-compatible map and raster layer | Pin only after MAP-08 fallback/21maps decision and package checkpoint. |
| `terra-draw` | **1.32.2** | Rectangle draw/edit/clear | Use only rectangle mode. |
| `terra-draw-maplibre-gl-adapter` | **1.4.1** | MapLibre integration | Local source declares MapLibre `>=4` and Terra Draw `^1`; browser smoke is authoritative. |
| `@turf/area` | **7.3.5** | Geodesic polygon area candidate | Audit verdict OK; wrap and unit-test. The research-plan’s 7.3.4 hypothesis was superseded by the trace’s captured 7.3.5 metadata. |
| Vitest | **4.1.10 candidate** | Unit tests | SUS checkpoint required. |
| ESLint stack | `eslint@9.39.2`, `@eslint/js@9.39.2`, `typescript-eslint@8.46.4` candidates | Lint | Keep TypeScript at 5.9.3; `eslint`, `typescript-eslint` checkpoints required. |
| Kehto/Paja | installed `@kehto/cli@0.2.16` → `@kehto/paja@0.8.0` | Actual sandbox smoke | Existing local install only; no project dependency install. Human-verify because `@kehto/cli` is SUS and version command is absent. |

### Deliberately Excluded in Phase 1

Do not install or scaffold `nostr-tools` for application use, Zod protocol schemas, SQLite drivers, LNbits/Phoenixd clients, three.js, glTF validators, Blossom clients, Python/uv, GDAL/rasterio, pyproj, NumPy, HTTPX, Pillow, trimesh, pygltflib, processor fixtures, or artifact servers. The Napplet plugin’s transitive dependencies do not authorize Phase 2 behavior. [VERIFIED: phase boundary]

### Installation Gate

There is intentionally **no unconditional `pnpm add` recommendation** in this research. The planner must first create `checkpoint:human-verify` tasks for all SUS packages, verify repository ownership/source, inspect the exact tarball and scripts, reconcile peer ranges, and then install exact accepted pins in one lockfile mutation. `vite-plugin-singlefile` has an OK audit verdict but is not selected because `@napplet/vite-plugin@0.12.0` already documents `artifactMode: 'single-file'`. [VERIFIED: package artifacts and legitimacy protocol]

## Package Legitimacy Audit

The audit below reproduces the existing trace’s package-level verdicts. “Too new” is a seam signal, not a claim that a package is malicious; nevertheless the role contract requires a human checkpoint before installing any SUS package. No package had a captured postinstall script in the trace. [VERIFIED: timed-out trace package-legitimacy output]

| Package | Exact candidate / role | Trace signal | Verdict | Disposition |
|---|---|---|---|---|
| `@napplet/sdk` | 0.25.0 | 137 weekly downloads; too-new + low-downloads; official repo field present; no postinstall | **SUS** | `checkpoint:human-verify`; inspect packed artifact and repo identity before install. |
| `@napplet/vite-plugin` | 0.12.0 | 82 weekly; too-new + low-downloads; official repo field; no postinstall | **SUS** | `checkpoint:human-verify`; also prove single-file Vite 8 build. |
| `@napplet/conformance-cli` | 0.2.16 | 105 weekly; too-new + low-downloads; official repo field; no postinstall | **SUS** | `checkpoint:human-verify`; inspect Playwright dependency and run local CLI help. |
| `vite` | 8.1.5 | high downloads; too-new; official repo; no postinstall | **SUS** | `checkpoint:human-verify`; prove Node and plugin compatibility. |
| `vite-plugin-singlefile` | 2.3.3 | high downloads; repo present; no postinstall | **OK** | **Not selected**; redundant with native Napplet plugin single-file mode. |
| `typescript` | 5.9.3 selected; initial audit observed package latest | high downloads; package-level audit was too-new | **SUS** | `checkpoint:human-verify`; select 5.9.3 because linter peer range excludes 7.x. |
| `maplibre-gl` | 5.24.0 candidate | high downloads; too-new; official repo; no postinstall | **SUS** | `checkpoint:human-verify`; install only after MAP-08 decision. |
| `terra-draw` | 1.32.2 | 198,304 weekly; too-new; official repo; no postinstall | **SUS** | `checkpoint:human-verify`; local source inspected, but checkpoint still required. |
| `terra-draw-maplibre-gl-adapter` | 1.4.1 | 113,890 weekly; repo present; no postinstall | **OK** | Approved only with accepted Terra Draw/MapLibre pins and smoke test. |
| `@turf/area` | 7.3.5 | 2,495,572 weekly; repo present; no postinstall | **OK** | Approved candidate; wrapper and geodesic fixtures still required. |
| `vitest` | 4.1.10 candidate | high downloads; too-new; repo present; no postinstall | **SUS** | `checkpoint:human-verify`. |
| `eslint` | 9.39.2 candidate | high downloads; too-new; repo present; no postinstall | **SUS** | `checkpoint:human-verify`. |
| `@eslint/js` | 9.39.2 candidate | high downloads; repo present; no postinstall | **OK** | Approved with accepted ESLint pin. |
| `typescript-eslint` | 8.46.4 candidate | high downloads; too-new; repo present; no postinstall | **SUS** | `checkpoint:human-verify`; enforce TS `<6` peer compatibility. |
| `@kehto/cli` | installed 0.2.16 | 69 weekly; too-new + low-downloads; repo present; no postinstall | **SUS** | Do not reinstall. Human-verify existing executable/source before accepting smoke evidence. |
| `@kehto/paja` | installed transitive 0.8.0 | No separate legitimacy verdict preserved; local package/source exists under Deno cache | **UNRESOLVED** | Inherit Kehto checkpoint; do not add direct dependency without a fresh authorized audit. |

**Packages removed due to SLOP verdict:** none in the captured Phase 1 audit.  
**Packages flagged as suspicious:** `@napplet/sdk`, `@napplet/vite-plugin`, `@napplet/conformance-cli`, `vite`, `typescript`, `maplibre-gl`, `terra-draw`, `vitest`, `eslint`, `typescript-eslint`, `@kehto/cli`.  
**Human checkpoint minimum evidence:** exact registry package name/version; source repository ownership; license; tarball integrity; absence or review of lifecycle scripts; dependency/peer-range reconciliation; packed-file review for the Napplet trio; local smoke from the accepted artifact. [VERIFIED: legitimacy role contract]

## Architecture Patterns

### System Architecture Diagram

```text
User gesture
   │
   ▼
Rectangle mode ──snapshot/change──▶ bbox normalizer/validator
                                         │ invalid
                                         ├────────────▶ actionable error (no preview request)
                                         │ valid
                                         ▼
                                  geodesic area + canonical DTO
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          request preview UI                         source policy lookup
          fixed v1 defaults                                  │
                                                              ▼
                                                shell resource capability?
                                                  │ yes              │ no
                                                  ▼                  ▼
                                       bounded shell byte path   named degradation
                                                  │                  │
                                                  ▼                  └─▶ optional local fallback
                                       object URL / raster layer       only with early SBOX-05
                                                  │
                                                  ▼
                                  attributed preview for current bbox
```

The map and preview never call Nostr, payment, artifact, processor, or public deployment surfaces. [VERIFIED: project phase boundary]

### Recommended Project Structure

```text
apps/napplet/
├── src/
│   ├── map/                 # MapLibre setup; rectangle adapter; no shell globals
│   ├── bbox/                # normalize, validate, geodesic area, canonical DTO
│   ├── ortho/               # source policy, preview correlation, attribution
│   ├── shell/               # sole feature-detected resource adapter
│   ├── ui/                  # errors, active source/fallback, request preview
│   └── main.ts
├── tests/
│   ├── unit/                # MAP-03/04/07 and adapter behavior
│   ├── smoke/               # built Paja/Kehto bbox/preview and failure paths
│   └── fixtures/            # small licensed preview fixture + provenance file
├── public/                  # only audited assets that are inlined at build
├── vite.config.ts
├── tsconfig.json
└── package.json
scripts/
├── verify-dist.mjs          # assert production artifact shape and forbidden refs
├── validate-fallback-ledger.mjs
└── verify-phase-01.sh       # ordered evidence runner
tests/security/
└── local-resource-boundary.* # only created if fallback server exists
.planning/evidence/
└── fallback-ledger.jsonl
```

### Pattern 1: Pure Bbox Domain Before Map Wiring

Normalize map output into one canonical shape and validate it before area or preview work. Return a discriminated result rather than throwing arbitrary UI-facing strings. [VERIFIED: MAP-03/04; implementation shape is recommended]

```ts
export type BBox4326 = readonly [west: number, south: number, east: number, north: number];
export type BBoxResult =
  | { ok: true; bbox: BBox4326; areaKm2: number }
  | { ok: false; code: 'MALFORMED' | 'NON_FINITE' | 'RANGE' | 'ORDER' | 'ANTIMERIDIAN' | 'AREA_LIMIT' };

// Planner-level contract: implementation must use an audited geodesic area library.
export function validateBBox(input: unknown, maxAreaKm2: number): BBoxResult;
```

### Pattern 2: One Feature-Detected Shell Adapter

The local SDK states that methods delegate to `window.napplet` and throw when the runtime/domain is unavailable. Keep this fact out of map/ortho modules by wrapping resource access once. [VERIFIED: local `@napplet/sdk@0.25.0` README]

```ts
import { resource } from '@napplet/sdk';

export async function loadApprovedBytes(url: string, signal: AbortSignal): Promise<Blob> {
  if (!window.napplet?.resource) throw new PreviewError('CAPABILITY_DENIED');
  // Enforce source allowlist and client deadline before calling the shell wrapper.
  return await resource.bytes(url);
}
```

The exact cancellation wiring must be validated against the accepted SDK types; do not invent unsupported SDK parameters. Client-side deadline and stale-response suppression are required even if the shell also exposes cancellation. [VERIFIED: local SDK and Kehto resource source; exact wrapper details remain an implementation gate]

### Pattern 3: Correlated Preview State

Assign a monotonically increasing selection revision. A preview result updates the UI only if its revision still matches the active bbox. Abort or ignore older requests. This prevents a slow response for bbox A from replacing bbox B. [ASSUMED: standard asynchronous UI safety pattern; verify with deterministic test]

### Pattern 4: Single-File Is a Build Invariant

Use `nip5aManifest({ artifactMode: 'single-file' })`. The captured plugin README says this mode inlines local JS/CSS, requests inline dynamic imports/no CSS split/static asset inlining, and fails if local external assets or extra emitted files remain. Add a repository script that independently inventories `dist` and rejects remote executable/style/font/worker references. [VERIFIED: local `@napplet/vite-plugin@0.12.0` README]

### Pattern 5: Explicit Transport State

Represent preview transport as one of `shell-resource`, `local-authenticated-fallback`, `fixture-test-only`, or `unavailable`. Render the active value next to attribution and include it in MAP-07’s request preview. Never silently fall back from live orthophoto to a stale screenshot. [VERIFIED: MAP-07 and truthful fallback rules]

### Pattern 6: Conditional Local Fallback Is Secure From Birth

If a backend fallback is needed, design its first executable version with:

- bind address exactly `127.0.0.1` and, if IPv6 is supported, explicit `::1`; no wildcard bind;
- a startup-generated scoped token supplied outside committed/browser build artifacts;
- token required for every request, including retrieval and health/state-changing routes;
- exact allowed Paja/Napplet origin/capability policy, not `*` for credentialed access;
- bounded URL/source allowlist, response bytes, timeout, redirects, methods, and content types;
- startup refusal for missing token or non-loopback bind unless a separately recorded approval exists;
- tests for no token, wrong token, wrong origin, wildcard bind, and unapproved external URL.

[VERIFIED: roadmap early SBOX-05 gate; specific control decomposition is prescriptive security design]

### Anti-Patterns to Avoid

- Direct `fetch`, XHR, WebSocket, remote `<img src>`, remote worker, remote font, or remote stylesheet assumptions inside the opaque-origin Napplet. [VERIFIED: local SDK/plugin docs]
- Adding `allow-same-origin` to make MapLibre work. [VERIFIED: conformance CLI uses `sandbox="allow-scripts"` without same-origin]
- Coding against 21maps before provenance closes. [VERIFIED: MAP-08]
- Using `vite dev` screenshots as production evidence. [VERIFIED: SBOX-01/02]
- Computing area as `(east-west)*(north-south)` or declaring all longitudes ordered after normalization. [VERIFIED: MAP-03/04]
- Letting users choose arbitrary source URLs, layers, CRS, resolution, or output in v1. [VERIFIED: source policy and fixed defaults]
- Introducing a local proxy without token auth because it “only listens locally.” [VERIFIED: early SBOX-05]
- Installing processor or Phase 2 packages while scaffolding the monorepo. [VERIFIED: phase boundary]

## Don't Hand-Roll

| Problem | Do not build | Use instead | Why |
|---|---|---|---|
| Geodesic area | Ad hoc spherical formula | Audited `@turf/area` wrapper after audit gate | Latitude and polygon semantics are easy to get wrong. |
| Rectangle editing | General custom GIS editor | Terra Draw rectangle mode + adapter after compatibility gate | Narrow feature set already exists; adapter smoke remains required. |
| Single-file bundling | Regex concatenation of JS/CSS | Napplet plugin `artifactMode: 'single-file'` | Plugin validates emitted artifact shape and hashes final files. |
| Napplet protocol | Private `postMessage` protocol | `@napplet/sdk` and declared shell domains | Runtime owns capability mediation and degraded behavior. |
| Conformance | Screenshot checklist only | `napplet-conformance ./dist` plus business smoke | Conformance provides real Chromium/opaque-origin/no-capability checks. |
| Resource proxy policy | Open URL fetch endpoint | Existing shell resource domain; narrowly allowlisted fallback only if forced | Prevents an unauthenticated proxy/SSRF surface. |
| Secret scanner | Home-grown regex as sole gate | Established scanner chosen in Wave 0 plus public diff review | Regex-only scanning misses encodings and context. |

## Common Pitfalls

### Pitfall 1: 21maps Provenance Is Treated as a Cleanup Task
**What goes wrong:** map code inherits unknown license/source/pin and becomes costly to replace.  
**Avoidance:** MAP-08 is Task 0; unresolved means clean-room fallback, recorded before code.  
**Warning sign:** a 21maps import or copied asset appears without a five-field provenance record. [VERIFIED: MAP-08]

### Pitfall 2: Dev Mode Hides Opaque-Origin Breakage
**What goes wrong:** workers, styles, tiles, or images work from a normal origin but fail in Paja’s `srcdoc` iframe and strict CSP.  
**Avoidance:** build/conformance/Paja smoke begins in the tracer plan; bundle workers/assets and mediate bytes through resource capability.  
**Warning sign:** acceptance evidence contains only localhost Vite dev screenshots. [VERIFIED: local plugin, conformance, and Paja docs]

### Pitfall 3: Orthophoto Licensing Is Confused With Endpoint Permission
**What goes wrong:** an open dataset is assumed to imply an unauthenticated, CORS-enabled, unlimited tile endpoint.  
**Avoidance:** separately pin dataset license/attribution and endpoint auth/CORS/usage/limits. The NLS WMTS test returned 401; therefore NLS dataset openness does not close the endpoint gate. [VERIFIED: captured NLS page and tested response]

### Pitfall 4: Bbox Semantics Drift
**What goes wrong:** map coordinates, request preview, and source URL use different order/CRS; crossing boxes produce absurd area.  
**Avoidance:** one EPSG:4326 `[west,south,east,north]` type; reject crossings and ambiguities in v1. [VERIFIED: MAP-03/04/07]

### Pitfall 5: Stale Preview Wins
**What goes wrong:** rapid edits issue overlapping requests and an old response becomes visible.  
**Avoidance:** selection revision plus abort/ignore; test out-of-order completion. [ASSUMED: standard asynchronous UI pattern]

### Pitfall 6: Capability Absence Becomes an Unhandled Exception
**What goes wrong:** SDK wrapper throws because `window.napplet.resource` is missing, leaving blank UI.  
**Avoidance:** feature-detect, normalize denied/unavailable/timeout errors, render exact fallback. Conformance’s default degraded pass must remain enabled. [VERIFIED: SDK and conformance README]

### Pitfall 7: “Loopback” Is Mistaken for Authentication
**What goes wrong:** another local process or browser context can use an unauthenticated proxy.  
**Avoidance:** scoped token and origin/capability policy from first run; no wildcard bind. [VERIFIED: roadmap]

### Pitfall 8: Package Freshness Bypasses Supply-Chain Review
**What goes wrong:** very recent, low-download Napplet/Kehto packages enter the public project without human provenance confirmation.  
**Avoidance:** enforce all SUS checkpoints before install/reinstall and preserve packed-artifact evidence. [VERIFIED: package legitimacy output]

### Pitfall 9: Secret Scan Ignores Evidence
**What goes wrong:** redacted application code passes while logs, screenshots, traces, manifests, or config expose privileged material.  
**Avoidance:** scan repository and `dist`; review public diff; all evidence uses `[REDACTED]`. [VERIFIED: standing rules]

## OPS-01 Fallback Ledger Contract

**Fixed location:** `.planning/evidence/fallback-ledger.jsonl`  
**Format:** UTF-8 JSON Lines, one immutable object per activation; append-only after review.  
**Repository policy:** committed entries contain no credentials, tokens, authenticated URLs, invoices, or authorization headers. Sensitive values are replaced with `[REDACTED]`. [VERIFIED: OPS-01/public repository rule; exact path/schema fixed by this research for planner use]

Required schema:

```json
{
  "schema_version": 1,
  "occurred_at": "RFC3339 UTC timestamp",
  "phase": "01",
  "requirement": "OPS-01",
  "blocker_id": "stable local identifier",
  "blocked_integration": "short name",
  "started_at": "RFC3339 UTC timestamp",
  "elapsed_minutes": 31,
  "trigger": "30-minute blocker law",
  "fallback_id": "documented fallback name",
  "reason": "redacted explanation",
  "decided_by": "operator role or redacted identifier",
  "user_visible_state": "exact label shown to user",
  "evidence_paths": ["relative/path/to/evidence"],
  "outcome": "activated|resolved|failed-closed"
}
```

Validation rules: timestamps parse and are ordered; `elapsed_minutes >= 30` for an OPS-01 time trigger; `fallback_id`, `reason`, `decided_by`, and `user_visible_state` are non-empty; evidence paths are repository-relative and cannot traverse; unknown schema versions fail; secret scan runs on every line. Create the file in Wave 0. If there are no activations, leave it zero-byte and record the passing schema/path check separately; do not add a fake activation. [VERIFIED: review allows empty-but-existing ledger; other schema rules are prescriptive]

## Validation Architecture

Nyquist validation and security enforcement are enabled in `.planning/config.json`; this section is mandatory and should be translated directly into `01-VALIDATION.md`. [VERIFIED: local config]

### Test Framework

| Property | Value |
|---|---|
| Unit runner | Vitest 4.1.10 candidate, pending SUS checkpoint |
| Browser/runtime | Chromium through `@napplet/conformance-cli@0.2.16` and installed Kehto/Paja |
| Config files | None exist yet — create in Wave 0 |
| Quick command | `pnpm --filter @terrcvm/napplet test:unit` |
| Full phase command | `pnpm verify:phase-01` |
| Production build | `pnpm --filter @terrcvm/napplet build` |
| Conformance | `pnpm --filter @terrcvm/napplet exec napplet-conformance ./dist --reporter json --out ../../.planning/evidence/phase-01/conformance.json` |
| Built Paja launch | `kehto paja --target-url http://127.0.0.1:4173 -- pnpm --filter @terrcvm/napplet exec vite preview --host 127.0.0.1 --port 4173` |
| Clean-checkout gate | repository script `pnpm verify:clean:phase-01` creates an isolated worktree and runs frozen install + full phase command |

The package script names are prescribed Wave 0 interfaces; no package files currently exist. Commands using candidate packages become executable only after package checkpoints pass. [VERIFIED: repository has no package.json; command design is prescriptive]

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command/evidence | Exists? |
|---|---|---|---|---|
| MAP-01 | Draw one rectangle | Paja built-browser | `pnpm --filter @terrcvm/napplet test:smoke:paja -- --case draw` | ❌ Wave 0 |
| MAP-02 | Edit and clear | Paja built-browser | same suite `--case edit-clear` | ❌ Wave 0 |
| MAP-03 | Geodesic km² | Unit | `pnpm ... test:unit -- bbox-area` with equator/high-latitude fixtures | ❌ Wave 0 |
| MAP-04 | Every malformed/range/order/antimeridian/limit clause | Unit + UI smoke | `pnpm ... test:unit -- bbox-validation`; Paja error assertion | ❌ Wave 0 |
| MAP-05 | Preview corresponds to active bbox; stale result ignored | Unit + Paja | `pnpm ... test:unit -- preview-correlation`; built smoke | ❌ Wave 0 |
| MAP-06 | Attribution and bounded request behavior | Unit + request-log inspection + screenshot | `pnpm ... test:unit -- source-policy`; `.planning/evidence/phase-01/network-log.json` | ❌ Wave 0 |
| MAP-07 | Canonical preview includes fixed defaults/source | Unit/snapshot | `pnpm ... test:unit -- request-preview` | ❌ Wave 0 |
| MAP-08 | Five-field provenance or fallback decision | Schema/static | `pnpm verify:map-provenance` | ❌ Wave 0 |
| SBOX-01 | One-file production build and conformance | Build/static/Chromium | build, `verify-dist`, conformance JSON exit 0 | ❌ Wave 0 |
| SBOX-02 | Actual Paja/Kehto built artifact | Paja Chromium | smoke JSON + screenshot + console log | ❌ Wave 0 |
| SBOX-03 | Feature-detected shell-only privileged access | Unit/static | adapter denied/unavailable tests; forbidden-global scan | ❌ Wave 0 |
| SBOX-04 | No secret-like material | Security/static | chosen scanner over repo and `dist`, redacted report, public diff review | ❌ Wave 0 |
| VER-02 | clean checkout typecheck/lint/build/conformance | Clean worktree | `pnpm verify:clean:phase-01` | ❌ Wave 0 |
| OPS-01 | fixed ledger validates and activation is honest | Schema/process | `pnpm verify:fallback-ledger` | ❌ Wave 0 |
| VER-04-T1 | denied resource capability is actionable | Paja degraded pass + browser assertion | launch with `--capability resource:off`; assert named state | ❌ Wave 0 |
| VER-04-T3 | resource timeout is actionable and stale result absent | Built-browser fault fixture | `pnpm ... test:smoke:paja -- --case resource-timeout` | ❌ Wave 0 |
| SBOX-05 conditional | local fallback rejects missing/wrong auth and non-loopback | Integration/socket | `pnpm test:local-resource-boundary`; or signed “no local surface” evidence | ❌ conditional |

### Required Named Unit Cases

1. `bbox_rejects_non_array_or_wrong_arity`
2. `bbox_rejects_non_finite_each_position`
3. `bbox_rejects_longitude_out_of_range`
4. `bbox_rejects_latitude_out_of_range`
5. `bbox_rejects_west_greater_or_equal_east`
6. `bbox_rejects_south_greater_or_equal_north`
7. `bbox_rejects_antimeridian_crossing_or_ambiguity`
8. `bbox_rejects_zero_area`
9. `bbox_rejects_configured_area_limit`
10. `bbox_area_is_geodesic_at_equator`
11. `bbox_area_is_geodesic_at_high_latitude`
12. `request_preview_uses_west_south_east_north_epsg4326`
13. `request_preview_uses_fixed_resolution_and_output`
14. `request_preview_names_active_source_or_fallback`
15. `resource_capability_absence_maps_to_actionable_denied_state`
16. `resource_timeout_maps_to_actionable_timeout_state`
17. `older_preview_response_cannot_replace_newer_selection`
18. `clear_aborts_or_invalidates_preview`
19. `source_policy_rejects_unapproved_origin_layer_or_scheme`
20. `attribution_is_present_for_active_source`

### Production Artifact Assertions

`verify-dist` must fail unless all are true:

- `apps/napplet/dist/index.html` exists and is non-empty;
- the Napplet build reports `artifactMode: 'single-file'` behavior;
- no local JS/CSS files remain as required runtime dependencies;
- no remote executable script, stylesheet, font, worker, or unaudited image URL appears;
- no source map is shipped unless explicitly approved and scanned;
- no credential/token/authenticated URL pattern appears;
- fixed defaults and source policy are represented by non-secret configuration;
- output can boot in conformance’s opaque-origin iframe without `allow-same-origin`.

[VERIFIED: local plugin/conformance docs; independent checks are prescriptive]

### Actual Paja/Kehto Smoke Protocol

1. Build `dist`; never point acceptance at Vite dev mode.
2. Start `vite preview` on `127.0.0.1:4173` via `kehto paja`; Paja itself defaults to `127.0.0.1:5197`. [VERIFIED: captured Kehto CLI help]
3. Use Chromium automation to load the Paja runtime, wait for shell ready, and capture console/network errors.
4. Draw, edit, and clear a bbox; assert area and request preview.
5. Grant only the exact resource origin and load bounded ortho/fixture bytes; assert attribution and active transport.
6. Repeat with `--capability resource:off`; assert actionable denied/fallback UI and no unhandled rejection.
7. Repeat with deterministic delayed resource fixture; exceed the client deadline; assert timeout state and that a late response cannot update the current preview.
8. Save redacted screenshot, browser console, network/request summary, and machine-readable result under `.planning/evidence/phase-01/`.
9. Human-check visual bbox/ortho correspondence; automation cannot by itself prove imagery semantics.

**Kehto/Paja gap:** the installed CLI has no `--version`; local package metadata indicates CLI 0.2.16/Paja 0.8.0. The trace proved CLI options and source behavior, but did not execute terrCVM’s built artifact. Wave 0 must create the smoke harness and prove exact package/runtime compatibility. [VERIFIED: local CLI/cache]

### Secret Scan and Public-Diff Review

Wave 0 must select and verify an established scanner available in the clean environment; the exact scanner command was not captured, so naming one here as authoritative would be an assumption. The stable interface is `pnpm scan:secrets`, and it must scan tracked/untracked Phase 1 files plus `dist`, redact output, and fail non-zero. [ASSUMED: scanner selection remains a Wave 0 gap]

Required companion commands/evidence:

```bash
git diff --check
git status --short
git diff -- .
git diff --cached -- .
```

The reviewer confirms no credentials, private keys, authorization headers, token-bearing URLs, captured invoices, hidden remote assets, generated blobs, or unexplained lockfile additions. Evidence reports themselves are rescanned. [VERIFIED: per-phase VER-06 standing rule]

### Sampling Rate

- **Per TDD cycle:** targeted named unit test.
- **Per task completion:** `pnpm --filter @terrcvm/napplet test:unit` plus typecheck for touched app.
- **Per production-build task:** build + `verify-dist` + conformance.
- **Per wave merge:** `pnpm verify:phase-01`, including current Paja smoke subset.
- **On any source/transport/package change:** rerun provenance/source policy, package checkpoint as applicable, build/conformance, denied and timeout smoke.
- **Phase gate:** clean-checkout full suite, Paja visual/manual checkpoint, fallback ledger review, secret scan, and public diff review.

### Wave 0 Gaps

- [ ] Create workspace/package manifests and frozen-lock verification.
- [ ] Complete all SUS `checkpoint:human-verify` tasks before first dependency installation.
- [ ] Create Vitest config and the 20 named unit tests above.
- [ ] Create `verify-dist`, provenance validator, fallback-ledger validator, and full phase runner.
- [ ] Create Paja built-artifact Chromium harness and deterministic denied/timeout fixtures.
- [ ] Select and prove the secret scanner behind `pnpm scan:secrets`.
- [ ] Create `.planning/evidence/fallback-ledger.jsonl` and `.planning/evidence/phase-01/` conventions.
- [ ] Resolve MAP-08 and orthophoto endpoint gates before map implementation.
- [ ] If local fallback is selected, create SBOX-05 security integration tests before its first run.

## Security Domain

### Applicable ASVS Categories

| ASVS category | Applies | Phase 1 control |
|---|---|---|
| V2 Authentication | Conditional | Scoped local token for every fallback endpoint; otherwise no local backend surface. |
| V3 Session Management | Conditional | Token scope/lifetime is explicit; no browser persistence of privileged token. |
| V4 Access Control | Yes | Shell capability discovery, exact origin/source policy, denied-capability test. |
| V5 Validation | Yes | Bbox/source/default validation before any resource request. |
| V6 Cryptography | No new crypto | Do not implement signing/hash protocols; use build/conformance tooling only. |
| V8 Data Protection | Yes | No secrets in browser, dist, evidence, config, or logs. |
| V10 Malicious Code | Yes | Package legitimacy checkpoints, exact pins, lockfile review, no remote executable assets. |
| V12 File/Resource | Yes | Bounded response size/type/time; no arbitrary URL proxy. |
| V13 API/Web Services | Conditional | Loopback/token/origin/fail-closed controls if fallback API exists. |
| V14 Configuration | Yes | Fixed defaults, exact source policy, production CSP/sandbox and clean build. |

[VERIFIED: `.planning/config.json` enables ASVS L1 enforcement; control mapping is prescriptive]

### Threat Patterns

| Pattern | STRIDE | Mitigation/test |
|---|---|---|
| Malicious/compromised frontend dependency | Tampering | SUS human checkpoints, exact pins, lockfile/public diff, no remote scripts. |
| Arbitrary URL through resource fallback | SSRF / information disclosure | exact source allowlist, no IP literals/private targets, token/origin policy, bounded redirects; prefer shell resource. |
| Local unauthenticated proxy | Spoofing/elevation | loopback + scoped token every endpoint; missing/wrong token tests. |
| Stale bbox/preview mismatch | Tampering | selection revision and out-of-order response test. |
| Secret in dist/evidence | Information disclosure | repository+dist scan, redaction, diff review. |
| Capability absence crash | Denial of service | feature detection, explicit degraded state, conformance no-capability pass. |
| Unbounded tile/ortho requests | DoS/policy abuse | visible/selected bounded requests, no prefetch/scraping, max bytes/time. |
| Sandbox weakened for compatibility | Elevation of privilege | no `allow-same-origin`; conformance and Paja evidence. |

## Open Gates Before Implementation

### Gate G1 — 21maps v0 Provenance (BLOCKING MAP CODE)

Required evidence: exact source location; immutable version/commit/archive identity; license text and reuse permission; provenance/author chain; inherited MapLibre package and exact pin. The existing trace did not identify a definitive 21maps repository or local source. **Status: OPEN, confidence LOW.** Default action if not closed before code: record clean-room fallback and do not copy 21maps code/assets/config. [VERIFIED: trace absence and MAP-08]

### Gate G2 — Orthophoto Endpoint/Policy/CORS (BLOCKING LIVE PREVIEW)

Pin one exact endpoint contract: scheme/host/port/path template; layer/coverage ID; tile matrix/CRS and bbox order; format; auth requirement; browser/shell CORS behavior; attribution text; dataset and endpoint terms; rate/request limits; max response bytes; timeout; redirects; coverage bounds; outage behavior.

Existing evidence is insufficient:

- NLS Finland dataset page: open orthophoto data, CC BY 4.0, EPSG:3067, documented attribution and channels. [VERIFIED: captured official NLS pages]
- Tested NLS WMTS capabilities URL: 401 and empty CORS allow-origin. [VERIFIED: captured response]
- Kapsi: page documents NLS orthophoto and CC BY 4.0 attribution, but tested tile redirected to a host that did not resolve in the trace. [VERIFIED: captured response]
- USGS imagery metadata: service/tile geometry and attribution text captured, but exact terms endpoint capture failed. [VERIFIED: captured official service metadata]

**Status: OPEN, confidence LOW for endpoint suitability.** Use a small licensed fixture only for deterministic tests while live source selection remains blocked; do not call fixture mode a live orthophoto preview. No new endpoint should be inferred from memory.

### Gate G3 — Kehto/Paja and Napplet Package Acceptance

Required: human approval of all SUS Napplet/Kehto packages; exact local version provenance; accepted Vite/TypeScript peer matrix; Playwright Chromium availability; single-file build; conformance; built-artifact Paja smoke; no-capability pass; resource timeout path; worker/style/image behavior. **Status: OPEN, confidence MEDIUM.** [VERIFIED: local artifacts and missing execution]

### Gate G4 — MapLibre/Terra Draw Compatibility

Required: final MapLibre pin after G1; package checkpoint; rectangle draw/edit/clear smoke; worker/assets embedded or shell-safe; no remote style/glyph/sprite dependency; high-DPI and resize sanity; clear cleanup on map destroy. **Status: OPEN, confidence MEDIUM.** [VERIFIED: package metadata only; no terrCVM runtime test]

### Gate G5 — Local Fallback Decision

If shell resource preview works, record `no local resource surface introduced` and do not build one. If it fails or blocks for 30 minutes, select the documented fallback, write the OPS-01 entry, and apply SBOX-05 before first run. The fallback may not start unauthenticated “temporarily.” **Status: CONDITIONAL.** [VERIFIED: roadmap]

## Assumptions Log

| ID | Assumption | Risk if wrong | Required resolution |
|---|---|---|---|
| A1 | Selection-revision suppression is sufficient to prevent stale preview UI. | Wrong image may appear for current bbox. | Deterministic out-of-order browser/unit test. |
| A2 | Vitest 4.1.10 is acceptable after supply-chain review. | Test setup or peer incompatibility blocks Wave 0. | SUS checkpoint and clean install. |
| A3 | A clean MapLibre 5.24.0 fallback can function in the opaque-origin single-file sandbox. | Map UI cannot ship under Paja CSP. | Built-artifact spike; take documented fallback if over 30 minutes. |
| A4 | An established secret scanner is available/selectable for `pnpm scan:secrets`. | SBOX-04/recurring VER-06 gate cannot pass. | Wave 0 tool discovery and pinned command. |
| A5 | Paja automation can deterministically inject a delayed resource response. | VER-04-T3 built-browser evidence cannot be produced. | Build a test-only shell/resource fixture or document the exact supported Paja mechanism before test implementation. |

No assumption may override G1 or G2; unresolved provenance or endpoint policy remains a gate, not an inferred default.

## Environment Availability

| Dependency | Trace observation | Availability | Gap |
|---|---|---|---|
| Node/npm | Node 25.7.0, npm 11.10.1 observed | Available | Repository-supported runtime pin still needed. |
| pnpm | 10.8.0 observed | Available | Corepack/repository pin required. |
| Chromium | Chromium 150 and Chrome 149 observed | Available | Conformance package’s Playwright browser install must still pass. |
| Kehto | `/home/flx/.deno/bin/kehto` | Available | No `--version`; package metadata says CLI 0.2.16. |
| Paja | `@kehto/paja@0.8.0` in Deno cache | Available locally | No terrCVM smoke executed. |
| Napplet packages | Packed under `/tmp/npm-packs/` | Evidence available | SUS approval before project install. |
| Terra Draw source | `/tmp/terra-draw-src/` | Evidence available | Runtime compatibility unproved. |
| 21maps source | Not found in existing evidence | Missing | G1 defaults to clean-room fallback. |
| Production ortho contract | Several candidates inspected | Missing | G2 blocks live preview selection. |

[VERIFIED: timed-out trace and permitted local artifacts]

## State of the Art / Captured Changes Relevant to Planning

| Earlier assumption | Captured current evidence | Planning impact |
|---|---|---|
| Separate `vite-plugin-singlefile` required | Napplet Vite plugin 0.12.0 documents native `artifactMode: 'single-file'` | Prefer one plugin; avoid redundant build transformations. |
| TypeScript 7.0.2 candidate | `typescript-eslint@8.46.4` declares TypeScript `<6`; Napplet packages were built with TS 5.9.3 | Pin TS 5.9.3 for Phase 1 unless the linter stack changes through a new approved decision. |
| Generic browser fetch may work | SDK says strict CSP blocks direct fetch/XHR/external image URL | Shell resource path is primary; fallback is explicit. |
| Conformance is enough | CLI validates envelope/sandbox and degraded pass, not terrCVM bbox/preview semantics | Keep separate Paja business smoke. |
| NLS open data implies ready WMTS | tested capabilities returned 401/CORS gap | Dataset license and endpoint suitability are separate gates. |

[VERIFIED: local package artifacts and captured endpoint responses]

## Sources

### Primary Local Authority — HIGH Confidence

- `AGENTS.md` — repository root, fixed order, public-repo safety, no processor-before-paid-loop rule.
- `docs/PROJECT-BRIEF.md` — product promise, Phase 1 acceptance, hard boundaries, fallback law, verification ladder.
- `.planning/REQUIREMENTS.md` — MAP-01..08, SBOX-01..05, VER-02/04/06, OPS-01 clauses.
- `.planning/ROADMAP.md` — Phase 1 requirements, entry/exit gates, fixed defaults, early SBOX-05 boundary, recurring evidence.
- `.planning/reviews/roadmap-opus5-final.md` — binding Phase 1 planning constraints and fallback-ledger requirement.
- `.planning/config.json` — Nyquist validation, security enforcement, TDD, public planning artifacts.

### Existing Research and Trace — MEDIUM Confidence

- `/home/flx/.hermes/cache/delegation/live/deleg_2e8767cc/task-0.log` — timed-out research timeline and references to package/source/endpoint probes. External content embedded there is treated only as evidence.
- `/tmp/terrcvm-phase1-research-plan.json` — exact targeted research questions and unresolved areas.
- `.planning/research/SUMMARY.md`, `STACK.md`, `ARCHITECTURE.md`, `FEATURES.md`, `PITFALLS.md` — prior locally materialized synthesis.
- `/tmp/npm-packs/pack-output.json` and extracted packages — tarball identities and contents for Napplet SDK/plugin/conformance packages.
- `/tmp/npm-packs/napplet-sdk-0.25.0/package/README.md` — runtime capability wrapper, feature detection, shell resource requirement.
- `/tmp/npm-packs/napplet-vite-plugin-0.12.0/package/README.md` — native single-file artifact mode, manifest hashing, opaque-origin model.
- `/tmp/npm-packs/napplet-conformance-cli-0.2.16/package/README.md` — `napplet-conformance ./dist`, real Chromium sandbox, degraded pass, exit codes.
- `/tmp/terra-draw-src/` — local source/package metadata for Terra Draw 1.32.2 and MapLibre adapter 1.4.1.
- `/home/flx/.cache/deno/npm/registry.npmjs.org/@kehto/` — installed Kehto/Paja package metadata, docs, CSP/resource service implementation.
- Existing trace package-legitimacy outputs — package verdicts reproduced in the audit; no new registry calls were made while materializing this document.

### Official Pages Already Captured in the Trace — MEDIUM, Endpoint Suitability LOW Until Gated

- <https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/expert-users/product-descriptions/orthophotos> — NLS orthophoto dataset, CRS, pixel size, distribution, CC BY 4.0 attribution.
- NLS open-data CC BY 4.0 page captured in the trace — licensor/dataset/delivery-time attribution pattern.
- <https://operations.osmfoundation.org/policies/tiles/> — OSM tile attribution/caching/identification and no bulk scraping/prefetch.
- <https://kartat.kapsi.fi/> — Kapsi NLS data/orthophoto attribution page; tested tile redirect remained unusable.
- USGS `USGSImageryOnly/MapServer?f=pjson` response captured in the trace — service metadata, tile geometry, extent, attribution; exact terms remained unresolved.

### Tertiary / LOW Confidence

- Any behavior not directly exercised in terrCVM’s built artifact, including MapLibre worker behavior, Paja delayed-resource injection, and a candidate endpoint’s live CORS/policy compatibility, is explicitly listed in assumptions/open gates rather than asserted as fact.

---

*Materialized solely from the timed-out Phase 1 trace and existing local artifacts. No new network research was performed. Ready for planning only after the Open Gates are represented as plan checkpoints; map implementation itself remains blocked on G1/G2 decisions.*
