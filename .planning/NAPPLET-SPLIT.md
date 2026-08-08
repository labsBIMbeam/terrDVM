# The napplet split — executed

HANDOFF §3 decided it ("NAP spec wants one app doing one thing; `app.ts` was 1737 lines
because it did five"); HANDOFF §6 item 5 recorded it as not executed. This note records the
execution: which of the monolith's responsibilities went where, and why.

## Responsibility assignment

| Responsibility | Napplet | Why there |
|---|---|---|
| Map (basemap, tiles, coverage overlay) | shared — `packages/napplet-kit/map/map-view` | Both terrain and player need the same shell-routed map; markers and placement-picking are injected by the caller, so the terrain app gets a map with no social surface |
| Select (draw, edit, coordinates form, clear/undo, request DTO) | **terrain** | The selection workbench is the product's front door. The player keeps only draw/clear (its world needs a stage and the corpus loop that would replace local generation does not exist yet) |
| Generate (preflight gate, elevation chain, features, ortho bake) | **terrain** owns the product flow; the pipeline itself is shared — `napplet-kit/scene/build-scene` | The player builds its walkable stage with the identical sequence; a second copy of the fallback-chain logic is how the two would drift |
| 3D preview | **terrain** (stats, attributions, layers, export) and **player** (walk, avatars, NPCs, crab, place-here) | The honest inspection of a model and the inhabitation of a world are different jobs over the same renderer |
| nostr presence (presence, geo notes, globe, placement/status/calendar publishing) | **player** | The whole social layer, including the start ceremony, sound and the globe console |
| Field measurement (FIELD-PROTOCOL §3.1 sheet, §2.4 rangetest ingest, §4.2 window classification) | **field-measurement** | New and deliberately thin: no corpus client — fetching tiles by hash needs the corpus loop, which does not exist yet |

Shared code went to `packages/napplet-kit` (shell adapter, verification, collection/ortho/
preflight clients, elevation pipeline, buildScene, map view, selection reducer, job-flow
reducer, copy, curated places, tokens.css). Nothing engine- or protocol-shaped moved:
`terrain-engine` and `geo-protocol` are unchanged.

## Capability and conformance facts

- The monolith was **NON-CONFORMANT**: `boot/no-forbidden-globals` flagged `window.nostr`,
  `fetch`, `WebSocket`, `sessionStorage` in its artifact. All four were the social layer's
  documented dev paths plus one library surface.
- All three napplets are **CONFORMANT** (napplet-conformance 0.2.16 against each `dist`).
  Two mechanisms made that true honestly:
  1. `scripts/vite-strip-maplibre-fetch.mjs` replaces maplibre-gl's single `fetch()` call
     site (unreachable here: inline style, `terrcvm://` protocol tiles, no glyph/sprite
     server) with a named rejection at build time, so the artifact genuinely lacks direct
     network capability instead of merely not using it.
  2. `apps/player/src/nostr/transport.ts` puts every dev-path authority (relay WebSockets,
     `window.nostr`, the local placements POST, the intro's sessionStorage flag) behind
     `import.meta.env.DEV`. `vite dev` keeps the full working demo; the production artifact
     compiles them out and degrades to named absences until the shell OUTBOX/signer domains
     land. `scripts/verify-dist.mjs` re-scans every built artifact for the same forbidden
     surfaces on every build.
- Capabilities declared: terrain `['resource']`, player `['resource']` (its artifact cannot
  publish, so it declares no publish capability), field-measurement `[]`.

## Known leftovers

- The coverage THRESHOLDS in the vitest configs were already stale on main: running
  `vitest --coverage` in main's `apps/napplet` fails its own 85/80/85/85 gate at
  72.85/73.98/61.94/73.33 (measured on commit 4996554). The kit inherits the same include
  list, the same tests and therefore the same numbers (72.41/73.65/61.26/72.84) — carried
  over unchanged because papering over a pre-existing gap inside a refactor would hide it.
  The enforced gate (`pnpm -r test:unit`, which does not enable coverage — same as CI)
  passes everywhere. The new `apps/field-measurement` protocol layer meets its thresholds
  for real: 91.87/90.32/93.33/95.13.

- `scripts/verify-lock-approved.mjs` still parses the phase-01 package-audit ledger whose
  location column predates the split. Updating the ledger is a `.planning/evidence` edit
  that was out of scope for this refactor; the split introduced no new third-party pins —
  the same approved name@version pairs are just spread across the new packages.
- `docs/PROJECT-BRIEF.md` still says `apps/napplet`: it is the original brief and is left
  as history, the same way the README's Deviations section treats it.
