# TerrCVM: ContextVM adoption plan

Status: **proposal — not approved, nothing implemented.**

## 0. The premise correction

This is not a migration. **There is no DVM to migrate from.**

Verified by search across `apps/`, `services/`, `packages/`, `scripts/`: zero occurrences of
NIP-90, kind 5xxx/6xxx/7000, job-request or job-result in code. `services/dvm`,
`services/processor` and `packages/protocol` do not exist. The only DVM-adjacent artifact is
[`apps/napplet/src/job/invoice.ts`](../apps/napplet/src/job/invoice.ts), an explicitly inert
Lightning placeholder whose `paymentRequest` is deliberately not BOLT11-shaped.

Consequence for the brief's last instruction: *"Alten DVM-Pfad nicht löschen, sondern hinter ein
Flag legen"* — there is no old path, so a flag over it would guard an empty branch. **What the
flag must actually guard is the current in-browser terrain generation**, which is the working
demo. See §5.

The upside: no NIP-90 migration debt. ContextVM is adopted greenfield, which is the easy case —
and DVMCP, the NIP-90/MCP bridge ContextVM replaced, is
[archived](https://github.com/gzuuus/dvmcp) with the note *"superseeded by ContextVM/sdk"*.

---

## 1. The finding that decides the architecture

**The napplet shell's `cvm` capability domain already *is* ContextVM.** From the installed
`@napplet/nap@0.29.0` typings, verbatim:

> NAP-CVM gives napplets native access to **ContextVM servers** through the shell. ContextVM
> transports Model Context Protocol (MCP) JSON-RPC messages over Nostr relays using public-key
> addressing and encrypted relay events (**kind 25910**). The shell owns all ContextVM transport
> details — relay routing, signing, encryption, JSON-RPC correlation, initialization, policy, and
> **optional payment prompts**.

So the browser client implements **no ContextVM code at all**, adds **no `@contextvm/sdk`
dependency**, and never touches BOLT11. The whole job flow becomes:

```ts
const result = await cvmCallTool(server, 'generate_terrain',
  { bbox, lod, texture },
  { initialize: true, payment: 'prompt', timeoutMs: 120_000 });
```

The shell prompts for the 21 sats from the user's own wallet. This also preserves the sandbox
invariant: Nostr goes through `cvm`, the resulting artifact through the existing `resource`
domain. Both shell-mediated, no ambient network.

---

## 2. The constraint that decides the topology

**One MCP `Server` instance cannot serve stdio and Nostr simultaneously.** Verified in
`@contextvm/mcp-sdk` `protocol.ts`: `_transport` is a single field that `connect()` overwrites
unconditionally. One server, one transport, chosen at connect time.

The documented answer is `NostrMCPGateway`, and it fits this project exactly — the ContextVM docs
say it is for when *"you already have a working MCP server built with another framework (like the
official Python or TypeScript SDKs)"*.

It also solves the language problem. **There is no Python ContextVM SDK.** `@contextvm/sdk` is
ESM-only with `engines: { bun: ">=1.2.0" }` and no `node` field. The Rust SDK has UniFFI Python
bindings, but they are unpublished — you build the native lib and generate the binding yourself,
in version lockstep. Not worth it.

```
services/blossom-gis          Python, unchanged, still keyless
        ▲ direct import
services/terrain-mcp          Python, `mcp` PyPI pkg, STDIO
        │   tool: generate_terrain(bbox, lod, texture) -> Blossom descriptor
        ├────────────► local stdio clients (Claude Desktop, CLI)   ← stdio requirement met
        │
        ▼ StdioClientTransport
services/cvm-gateway          bun, ~100 LOC, HOLDS THE NOSTR KEY
        │   NostrMCPGateway + paymentOptions (CEP-8)
        ▼ kind 25910
   napplet shell → apps/napplet via the `cvm` domain
        ▼ `resource` domain
   Blossom artifact, sha256-verified
```

`NostrMCPGateway` accepts `paymentOptions`, forwarded verbatim to `withServerPayments`. **CEP-8
payments therefore work without the Python server knowing payments exist** — which CEP-8 itself
endorses: *"Payment processing is a transport concern; underlying MCP handlers MAY remain unaware
of CEP-8 payments."*

**This does move a boundary.** `services/blossom-gis` never holds a private key — a documented,
load-bearing invariant. The gateway *must* hold one. It stays a separate service with its own key;
`blossom-gis` stays keyless. That is a real architectural change and needs to be recorded, not
slipped in.

---

## 3. The mapping, corrected

| Brief said | Reality |
|---|---|
| Kinds 5xxx/6xxx/7000 → 25910 | ✅ Confirmed. 25910 is ephemeral and carries **all** traffic — requests, responses, notifications, progress, payment, CEP-22 chunks. |
| Job-tags → `tools/call` params, schema in `tools/list` | ✅ Confirmed. The **entire** JSON-RPC message is stringified into `content`; nothing is unpacked into tags. Tags carry only `p` (routing), `e` (correlation) and CEP extensions. |
| NIP-89 announcement → CEP-6 | ⚠️ Right CEP, **wrong shape**. CEP-6 is *not* NIP-89 — no kind 31989/31990, no `d` tag. It is a bespoke **replaceable** family: **11316** (announcement), **11317** (tools list), 11318–11320. |
| Relay list → CEP-17 | ✅ And it is literally **NIP-65 kind 10002**, with the profile note that servers SHOULD publish *unmarked* `r` tags. |
| amount-tag/Bid → CEP-8, 21 sats per area | ✅ Shape is a `cap` tag on 11317: `["cap","tool:generate_terrain","21-21000","sats"]`. A **range** is correct here because the price is per-area and quoted per request. Payment is **per-call**, not per-session. |
| Kind 7000 partial → `notifications/progress` | ✅ One signed, published event **per progress tick**, correlated by `progressToken`. Throttle it. |
| Result payload → check CEP-22, else keep Blossom | ➡️ **Keep Blossom.** See §4. |

---

## 4. CEP-22 vs Blossom — keep Blossom

CEP-22 is in-band chunking through `notifications/progress` frames, not an external URL. SDK
defaults: 48,000-byte chunks, 5-minute total timeout, 21-chunk out-of-order window.

For a multi-MB GLB this is the wrong mechanism:

- **Inflation.** Binary → base64 (×1.333) → JSON string escaping → per-chunk again. A 20 MB GLB
  becomes ~27 MB across **~570 signed events**.
- **No repair.** Quoted: *"This CEP does not define selective retransmission or repair"* and *"if
  `end` arrives while provisional gaps remain unresolved, the transfer MUST fail."* One lost chunk
  in 570 kills the whole transfer.
- **Relay hostility.** 570 × 48 KB events in a burst is exactly the shape relays rate-limit, and
  thresholds are not uniform across relays.
- **You already have the better mechanism.** A Blossom URL + sha256 is ~100 bytes, fits in one
  event, is content-deduplicated, resumable over HTTP range, and independently verifiable.
- **The `cvm` domain has no oversized-transfer surface**, so a chunked response may not even
  reassemble in the shell.

**Ruling:** `generate_terrain` returns a small MCP result — a Blossom descriptor (`url`, `sha256`,
`size`, `mimeType`, bbox/LOD metadata), far under the 48 KB threshold. Leave CEP-22 enabled as a
safety net for a fat manifest or error payload. Do **not** build on CEP-41 open streams: the last
four SDK releases are all CEP-41 bug fixes.

---

## 5. What the flag actually guards

Since no DVM path exists, the flag protects the **working demo**: today the napplet generates
terrain in-browser from `@terrdvm/terrain-engine`. That path stays default until CVM is proven.

```
terrainSource: 'local'   (default)  → today's in-browser generation, unchanged
terrainSource: 'cvm'                → cvmCallTool(...) → Blossom descriptor → fetch → render
```

Flip the default only once the CVM path renders a real tile end to end. `invoice.ts` stays on disk
but unreferenced until then; it is **deleted, not ported** — the shell owns payment.

---

## 6. File list

### New

| Path | What |
|---|---|
| `services/terrain-mcp/pyproject.toml` | uv/hatchling, depends on `mcp` + `blossom-gis` |
| `services/terrain-mcp/src/terrain_mcp/server.py` | MCP server, stdio entrypoint |
| `services/terrain-mcp/src/terrain_mcp/tools/generate_terrain.py` | the one tool; JSON Schema for `bbox`, `lod`, `texture`; returns a Blossom descriptor |
| `services/terrain-mcp/tests/test_generate_terrain.py` | schema validation, bbox rejection, descriptor shape |
| `services/cvm-gateway/package.json` | bun, `@contextvm/sdk` |
| `services/cvm-gateway/src/index.ts` | `NostrMCPGateway` + `paymentOptions`, ~100 LOC |
| `services/cvm-gateway/src/pricing.ts` | `resolvePrice` — 21 sats/km², min 210, from `invoice.ts`'s demo tariff |
| `services/cvm-gateway/.env.example` | `NOSTR_NSEC`, `NWC_CONNECTION_STRING`, relay list |
| `apps/napplet/src/shell/cvm-client.ts` | the **only** file importing `cvm` from `@napplet/sdk` |
| `apps/napplet/src/job/cvm-terrain.ts` | call the tool, verify sha256, hand bytes to the viewer |

### Changed

| Path | Change |
|---|---|
| `apps/napplet/vite.config.ts` | add `'cvm'` to `requires` |
| `apps/napplet/src/job/job-flow.ts` | branch on the `terrainSource` flag |
| `scripts/verify-shell-boundary.mjs` | `cvm-client.ts` sits under `src/shell/`, already permitted — confirm no new root needed |
| `deploy/docker-compose.yml` | add `cvm-gateway`; it needs the relay reachable |
| `docs/ARCHITECTURE.md` | record the key-holding boundary move |
| `AGENTS.md` / `README.md` | record this as a further deviation from the payment-first invariant |
| `package.json` | `test:all` to include `services/terrain-mcp` |

### Deleted (only after the flag flips)

- `apps/napplet/src/job/invoice.ts` and `apps/napplet/tests/unit/invoice.test.ts`

---

## 7. Risks

| | Risk | Cheapest retirement |
|---|---|---|
| R1 | **ContextVM is alpha.** v0.13.10, 12 stars, only CEP-4/6/16 are Final. CEP-8, CEP-17, CEP-22 — everything this plan needs — are **Draft**. CEP-8 changed behaviour in 0.13.0 (payment-interaction default flip). | Confine ContextVM to the ~100-line gateway. When it breaks you fix the bridge, not the product. Never let a Draft payment spec become load-bearing across three languages. |
| R2 | **`cvmDiscover` is shell-defined, not spec-defined.** Whether a shell actually queries kind 11316 across relays or serves a curated local list is unverified. | Address the server by explicit `{ pubkey, relays }` as the primary path. Treat discovery as a bonus. |
| R3 | ~~`@contextvm/sdk` declares bun only.~~ **RETIRED — bun is not required.** | Spiked `0.13.10` on plain **Node v24.15.0**: imports, and `PrivateKeySigner` + `ApplesauceRelayPool` + `NostrServerTransport` + `NostrMCPGateway` all construct. Real BIP-340 signing produced a valid 128-char signature (pubkey matched the spec test vector). No bun in the deploy image. |
| R4 | **The gateway holds a private key**, breaking a documented project invariant. | Separate service, separate key, own secret handling. Record in ARCHITECTURE.md in the same commit. |
| R5 | **LGPL-3.0.** Fine for a separate process; think before bundling into a single-file napplet. | Non-issue given the gateway topology — flag only if that changes. |
| R6 | Napplet SDK version skew: brief cited `@napplet/sdk@0.25.0`, installed `@napplet/nap` is 0.29.0. | Confirm the deployed shell implements the `cvm` domain before building against it. |

---

## 8. Decisions

**Adopt now, confined to the gateway.** The alpha risk (R1) is accepted *because* of the topology:
ContextVM lives in one ~100-line bridge process. It does not enter the napplet — the shell's `cvm`
domain absorbs it — and it does not enter the Python service. When the SDK breaks, one file changes.

**Server-side for paid; the browser stays a free preview.** The napplet keeps generating terrain
locally from `@terrdvm/terrain-engine` (flag default `local`, today's working demo). The CVM path
returns a higher-quality server-built artifact for 21 sats. Both consume the same engine.

This settles a question the plan could not answer on its own: **what is actually being sold.** Not
"terrain" — the browser already does terrain for free, and a user who reads the source would rightly
object to paying for it. What is sold is what the sandbox genuinely cannot do: higher-resolution
orthophoto bakes, larger areas than a 512 KB quota and a single-file bundle allow, and DEM sources
that need server-side credentials or licensing. `resolvePrice` must therefore price on *area and
quality*, not on "a terrain happened".

Consequence for the free tier: it must stay genuinely useful, not crippled. The moment the local
path is degraded to make the paid path look better, the honesty the project trades on is gone.

**Rename: product strings only; `nappletType` stays `terrdvm`.** The four product-meaning `DVM`
strings become CVM. Protocol prose in `PROJECT-BRIEF.md` and `AGENTS.md` is untouched. The NIP-5D
`d` tag does not change, so the napplet keeps its published addressable identity; renaming it is a
separate, deliberate act tied to a deploy.

### Settled by spike

**Node, not bun.** `@contextvm/sdk@0.13.10` declares `engines: { bun: ">=1.2.0" }` and no `node`
field, but it runs on plain Node v24.15.0 — construct *and* sign. The gateway is an ordinary Node
service; nothing new enters the deploy image. Pin the SDK version, because "works despite the
declared engine" is a fact about 0.13.10, not a promise.

**ContextVM's relay layer is applesauce.** `@contextvm/sdk/relay` exports `ApplesauceRelayPool` —
hzrd149's client library. Adopting ContextVM transitively adopts that stack, which is worth knowing
before the ecosystem review recommends applesauce as if it were a separate decision.

Kind constants read from the SDK source, confirming the spec: `CTXVM_MESSAGES_KIND = 25910`,
`SERVER_ANNOUNCEMENT_KIND = 11316`, `TOOLS_LIST_KIND = 11317`.

Minor: `package.json` declares `"license": "LGPL-3.0-1"`, which is not a valid SPDX identifier
(GitHub says `LGPL-3.0`). Harmless for a separate process; worth a glance if that ever changes.

### Still open

- **The key-holding boundary move** (R4) is accepted implicitly by adopting, but must be *recorded*
  in `docs/ARCHITECTURE.md` and the README deviation list in the same commit that introduces it.
