# Architecture Research

**Domain:** Local-first paid geospatial Data Vending Machine in a sandboxed Napplet
**Researched:** 2026-07-26
**Confidence:** MEDIUM

## Recommendation in One Sentence

Build terrCVM as a small ports-and-adapters system whose only mutable authority is a deterministic, durable DVM job state machine: the sandboxed Napplet requests capabilities through the shell, the DVM verifies signed requests and Lightning settlement, the processor is invoked only after payment, and verified artifact bytes are stored locally before optional Blossom replication.

## Non-Negotiable Build Order

```text
bbox/ortho UI
    → paid DVM dummy delivery
        → terrain processor
            → Blossom/viewer
```

This is an architectural dependency order, not merely a roadmap preference. Each stage must pass its acceptance gate before the next stage becomes an implementation dependency:

1. **BBox/ortho gate:** bounded draw/edit/clear, area display, policy-compliant preview, and a production Napplet that works under the actual sandbox/CSP or uses the documented shell/backend fallback.
2. **Paid dummy gate:** valid signed request, real invoice, independently confirmed payment, and delivery of a structurally valid, hash-verified dummy GLB. This is the product's core proof.
3. **Processor gate:** only after gate 2, replace the dummy artifact producer behind the same port with a bounded CRS-aware terrain producer. Time-box mesh work and retain an honestly labeled displacement fallback.
4. **Distribution/viewer gate:** keep verified local storage as the required path; add Blossom as optional replication and make the built Napplet view the exact delivered bytes.

Do not let processor, mesh, Blossom, or viewer complexity enter the critical path for proving the paid delivery loop.

## Standard Architecture

### System Overview

```text
┌──────────────────────────── UNTRUSTED / SANDBOXED ────────────────────────────┐
│ apps/napplet                                                                 │
│ ┌──────────────┐ ┌───────────────┐ ┌────────────┐ ┌──────────────────────┐   │
│ │ bbox + area  │ │ ortho preview │ │ job status │ │ invoice + viewer UI  │   │
│ └──────┬───────┘ └───────┬───────┘ └─────┬──────┘ └──────────┬───────────┘   │
│        └──────────────────┴───────────────┴────────────────────┘               │
│                         shell-facing client                                  │
└────────────────────────────────┬──────────────────────────────────────────────┘
                                 │ typed capability calls only
                                 │ no private keys, admin tokens, or global truth
┌──────────────────────── HOST SHELL CAPABILITY BOUNDARY ───────────────────────┐
│ identity/sign │ relay transport │ resource fetch │ storage/config │ notices   │
└───────────────┬─────────────────┬────────────────┬────────────────────────────┘
                │ signed Nostr    │ hash-addressed │
                │ events/status   │ artifact bytes │
┌───────────────▼─────────────────▼──────── TRUSTED SERVICE ────────────────────┐
│ services/dvm                                                                 │
│ ┌────────────────┐   ┌────────────────────┐   ┌────────────────────────────┐  │
│ │ Nostr adapter  │──▶│ command handler +  │──▶│ durable job/event store    │  │
│ │ verify/correlate│  │ deterministic      │◀──│ idempotency + audit facts  │  │
│ └────────────────┘   │ state reducer      │   └────────────────────────────┘  │
│                      └───────┬────────────┘                                   │
│               ┌──────────────┼──────────────────────┐                         │
│               ▼              ▼                      ▼                         │
│      Lightning port   Artifact producer port   Artifact repository port       │
│      LNbits/Phoenixd   dummy first, processor   local bytes + SHA-256          │
└───────────────┬──────────────┬──────────────────────┬─────────────────────────┘
                │              │                      │ optional replication
┌───────────────▼──────┐ ┌─────▼────────────────┐ ┌──▼─────────────────────────┐
│ Lightning adapter   │ │ services/processor    │ │ Blossom adapter            │
│ invoice + settlement│ │ bounded WCS/ortho     │ │ upload/auth/readback       │
│ verification        │ │ CRS/raster/GLB        │ │ never sole source of bytes │
└─────────────────────┘ └──────────┬─────────────┘ └────────────────────────────┘
                                  │
                         external geodata services
                         (untrusted, bounded inputs)
```

### Core Architectural Rule

`packages/protocol` defines the domain language and transition rules. Nostr, Lightning, raster services, subprocesses, local HTTP serving, and Blossom are adapters. None of those adapters may directly mutate job status or become an alternative source of truth.

## Component and Trust Boundaries

| Component | Responsibility | Trust classification | Communicates with |
|---|---|---|---|
| `apps/napplet` | BBox gestures, area display, preview presentation, request composition, invoice/status display, artifact rendering | Sandboxed and unprivileged; all inputs and returned data treated as untrusted | Host shell SDK/capabilities only, plus bundled static assets |
| Host shell adapter | Capability discovery, signing, identity, relay I/O, policy-controlled resource retrieval, storage/config | Privileged boundary controlled by host policy | Napplet, relays, DVM endpoints, artifact endpoints |
| `packages/protocol` | Versioned schemas, canonical parsing, job commands/events, pure reducer, artifact descriptors | Trusted pure code; no I/O, secrets, signer, or mutable global state | Napplet DTOs and DVM application layer |
| `services/dvm` application core | Accept/reject commands, enforce payment gate, dispatch artifact producer, publish status/result after durable facts | Authoritative application boundary | Protocol package and ports only |
| Job/event store | Durable idempotency records, payment facts, state revisions, artifact metadata, audit trail | Authoritative mutable state | DVM core; not Napplet or adapters directly |
| Nostr adapter | Verify NIP-01 event structure/signature, enforce selected NIP-90-compatible kind/profile, correlate request/feedback/result | Network adapter; relay contents remain untrusted | Relays and DVM core |
| Lightning adapter | Create invoice, map provider identifiers, poll/receive callback, verify settlement | Privileged secret-bearing adapter | LNbits or Phoenixd and DVM core |
| Dummy producer | Return known structurally valid GLB bytes for paid-flow proof | Trusted build/test fixture | Artifact producer port |
| `services/processor` | Validate bbox/CRS/budget, retrieve bounded coverage, normalize heightmap, produce GLB or honest displacement bundle | Privileged compute process; remote raster and subprocess outputs are untrusted until checked | DVM producer port, WCS/ortho adapters, local workspace |
| Local artifact repository | Atomically store exact bytes, SHA-256, size, MIME type, producer/version, and path-safe identifier | Required delivery authority | DVM, local serving adapter, Blossom adapter |
| Blossom adapter | Upload exact bytes, optionally authorize, verify descriptor and read-back hash | Optional external distribution adapter | Local artifact repository and Blossom server |
| Viewer | Parse and render only the descriptor's verified bytes; report type mismatch or parse failure | Sandboxed consumer of untrusted binary data | Shell resource capability/local artifact endpoint |

### Boundary Rules

1. **Napplet → shell:** typed capability calls only. Feature-detect every capability and degrade explicitly. Do not add a private `postMessage` protocol when a published shell domain exists.
2. **Shell → DVM:** signed request events are transport envelopes, not accepted jobs. The DVM verifies signature, kind, tags, payload schema, bbox, area, and limits before recording acceptance.
3. **Adapter → core:** adapters emit facts such as `InvoiceCreated`, `PaymentSettled`, `ArtifactProduced`, or `UploadVerified`; they never set `job.state = ...` themselves.
4. **DVM → processor:** dispatch only from a durable paid fact and with a versioned, bounded processing manifest. Never pass unchecked paths or shell command strings.
5. **Processor → repository:** artifact bytes are not deliverable until format checks, size bounds, and SHA-256 calculation succeed.
6. **Repository → Blossom:** Blossom receives already verified local bytes. A successful upload is not delivery proof until URL/descriptor and downloaded bytes match the expected hash.
7. **Viewer boundary:** the viewer loads the same content-addressed artifact recorded by the DVM; it must not silently substitute generated demo geometry.

## Recommended Project Structure

```text
apps/
└── napplet/
    ├── src/map/                  # bbox controls, area calculation, preview layer
    ├── src/jobs/                 # request composition and status projection
    ├── src/payment/              # bolt11/QR/lightning: presentation only
    ├── src/viewer/               # GLB/displacement loaders and error states
    ├── src/shell/                # the single shell capability adapter
    └── tests/                    # reducer projections and built-browser smoke
services/
├── dvm/
│   ├── src/application/          # commands, orchestration, idempotency
│   ├── src/adapters/nostr/       # relay subscription, signature/kind correlation
│   ├── src/adapters/lightning/   # LNbits and Phoenixd implementations
│   ├── src/adapters/artifacts/   # local repository, local HTTP, Blossom
│   ├── src/adapters/persistence/ # durable job/event store
│   └── tests/                    # paid gate, replay, callback, failure tests
└── processor/
    ├── src/domain/               # bbox, CRS, raster budget, processing manifest
    ├── src/adapters/wcs/         # capabilities/describe/get coverage client
    ├── src/adapters/ortho/       # bounded licensed imagery retrieval
    ├── src/pipeline/              # crop, normalize, mesh/texture, package
    ├── src/formats/               # GLB validation and displacement fallback
    └── tests/fixtures/            # small bounded licensed/public samples
packages/
└── protocol/
    ├── src/schemas/               # request, feedback, result, artifact versions
    ├── src/state/                 # pure reducer and transition table
    ├── src/canonical/             # canonical IDs/hashes/serialization
    └── tests/                     # exhaustive transition and parser tests
ops/
├── local/                         # local strfry, service config templates
└── demo/                          # preflight and health checks; no secrets
```

### Structure Rationale

- **`packages/protocol`:** dependency-free domain truth can be tested without relays, wallets, geodata, browsers, or subprocesses.
- **`services/dvm`:** owns orchestration and durable state while keeping external systems replaceable behind ports.
- **`services/processor`:** isolates Python/raster/native dependencies from the TypeScript UI and payment path.
- **`apps/napplet/src/shell`:** prevents privileged behavior and direct network assumptions from leaking throughout UI code.
- **`ops/local`:** makes the local-first path a maintained deployment mode rather than an emergency collection of ad hoc commands.

## Deterministic Job State

### Canonical State Projection

Use an append-only domain event history (or an equivalent transactional record plus audit events) and derive the displayed state through a pure reducer. A compact initial model is:

```text
REQUESTED
  ├─ invalid/unsafe ───────────────────────────────▶ REJECTED [terminal]
  └─ accepted + invoice durably recorded ─────────▶ INVOICED

INVOICED
  ├─ verified settlement for matching invoice ────▶ PAID
  ├─ provider-declared failure/expiry ─────────────▶ FAILED [terminal]
  └─ UI click, callback receipt alone, or relay text ─X─ no transition

PAID
  ├─ producer dispatch durably recorded ──────────▶ PROCESSING
  └─ no processor in gate 2: dummy producer is the producer implementation

PROCESSING
  ├─ checked bytes atomically stored + hashed ────▶ ARTIFACT_READY
  └─ bounded failure ─────────────────────────────▶ FAILED [terminal/retry policy]

ARTIFACT_READY
  ├─ local descriptor/readback verified ──────────▶ DELIVERED_LOCAL [terminal]
  └─ Blossom upload + readback hash verified ─────▶ DELIVERED_BLOSSOM [terminal]

DELIVERED_BLOSSOM may retain local bytes; local delivery remains available.
```

The Napplet can project these domain states into the required user labels: `requested`, `invoiced`, `paid`, `processing`, `delivered`, `failed`, and `local fallback`. `REJECTED` should be displayed distinctly even if represented under the broader failed UI style.

### Transition Invariants

- A job identity is derived from a canonical accepted request/event identity; replaying the same request is idempotent and cannot create multiple payable jobs accidentally.
- `INVOICED` requires a persisted provider invoice identifier, BOLT11 string, expected amount, and expiry.
- `PAID` requires provider-verified settlement for the exact stored invoice/payment identifier and amount policy. A presented QR, browser return, webhook arrival, or Nostr feedback event is insufficient by itself.
- `PROCESSING` is unreachable from `REQUESTED` or `INVOICED`.
- `ARTIFACT_READY` requires bytes, media type, size, SHA-256, producer type (`dummy-glb`, `terrain-glb`, or `displacement-bundle`), and producer version.
- `DELIVERED_*` requires successful readback of the exact bytes and hash advertised to the client.
- Duplicate relay events, payment callbacks, polling results, processor completion messages, and Blossom responses are safe to replay.
- Terminal transitions are monotonic. Late or contradictory adapter messages are recorded for audit but cannot regress or overwrite state.
- Every outward Nostr feedback/result event is generated from durable state and contains request correlation; relay publication success is not itself the job authority.

### Commands and Facts

Keep imperative commands separate from verified facts:

| Command | Required precondition | Durable fact on success |
|---|---|---|
| `AcceptRequest` | Signature, selected kind, schema, bbox and policy limits valid | `RequestAccepted` |
| `IssueInvoice` | Accepted and no active invoice | `InvoiceCreated` |
| `ConfirmPayment` | Provider lookup proves exact settlement | `PaymentSettled` |
| `StartProduction` | Paid and no active/completed attempt | `ProductionStarted` |
| `RecordArtifact` | Format/size/hash checks pass | `ArtifactStored` |
| `PublishBlossom` | Local artifact exists and auth scope is valid | `BlossomUploadVerified` |
| `DeliverLocal` | Local readback hash matches | `LocalDeliveryVerified` |

This separation makes TDD straightforward: feed commands and facts to the reducer and assert allowed/denied transitions without running any external service.

## Key Data Flows

### 1. BBox and Orthophoto Preview

```text
user gesture
  → Napplet bbox model
  → normalize coordinate order and compute area
  → reject/disable request if outside configured bounds
  → shell resource capability or narrow backend preview adapter
  → policy-compliant preview bytes/tiles
  → render with attribution and explicit unavailable/degraded state
```

The Napplet may manage ephemeral map state, but the signed job payload must use the versioned protocol schema. Direct raster/WCS retrieval from the iframe must not be assumed: current Napplet evidence indicates strict CSP can block direct fetch and external image URLs, so preview transport belongs behind shell resource capabilities or a narrow backend adapter. Do not proxy arbitrary URLs supplied by the Napplet.

### 2. Signed Request and Invoice

```text
canonical request DTO
  → shell signer
  → selected Nostr request event kind
  → relay(s)
  → DVM Nostr adapter verifies event and correlation fields
  → protocol parser and bounds policy
  → RequestAccepted
  → Lightning adapter creates invoice
  → InvoiceCreated
  → kind-7000-compatible payment-required feedback or documented QR fallback
  → Napplet displays amount, expiry, BOLT11/QR, and status
```

NIP-90 is currently draft, optional, and marked unrecommended upstream. Therefore keep its event mapping in the Nostr adapter and versioned schema, not spread through business logic. Select one request kind in `5000–5999`, document its matching result convention, and treat future protocol change as an adapter/schema migration.

### 3. Payment Gate and Dummy Delivery

```text
wallet payment
  → LNbits/Phoenixd settlement state
  → callback and/or poll triggers provider readback
  → Lightning adapter returns verified settlement fact
  → PaymentSettled
  → dummy artifact producer invoked
  → official GLB structural validation
  → local repository atomic write + SHA-256
  → local readback verification
  → result descriptor/status publication
  → shell resource fetch
  → Napplet verifies expected hash and loads actual GLB
```

This complete trace must work before a terrain processor exists. The dummy must be a real valid GLB, not JSON, text, or generated UI geometry using a `.glb` filename.

### 4. Terrain Processor

```text
paid processing manifest
  → validate bbox, area, CRS, axis order, resolution, pixel count, byte/CPU/time budget
  → WCS capabilities/coverage metadata check
  → bounded GetCoverage crop
  → verify raster dimensions, CRS, nodata, and file type
  → heightmap normalization
  → time-boxed mesh/texture/GLB path
      ├─ success: validate GLB and return exact bytes
      └─ timebox/failure: return honestly typed displacement bundle
  → same ArtifactStored and delivery path used by dummy producer
```

The processor is a replaceable implementation of the artifact producer port. It must not know Lightning credentials, publish Nostr events, mutate job state, or upload directly to Blossom.

### 5. Blossom Replication and Viewer

```text
verified local artifact
  → Blossom PUT exact bytes (scoped signed auth if required)
  → validate returned descriptor: URL, SHA-256, size, type
  → GET/HEAD/readback through policy-approved path
  → recompute SHA-256
  ├─ match: BlossomUploadVerified and publish Blossom descriptor
  └─ failure/mismatch: retain and publish local delivery fallback
  → Napplet shell resource fetch by hash
  → viewer parses exact verified bytes
```

Blossom is a distribution replica, not the only artifact store and not the authority for job completion. A URL without content verification is not delivery.

## Architectural Patterns

### Pattern 1: Functional Core, Imperative Adapters

**What:** Keep parsing, policy checks, IDs, state transitions, and result descriptors pure; put relays, wallets, raster I/O, files, HTTP, and subprocesses at the edge.

**When to use:** Everywhere a retry, callback, duplicated event, or external outage can occur.

**Trade-offs:** Adds explicit ports and DTOs, but sharply reduces integration ambiguity and permits exhaustive unit tests.

```typescript
type JobEvent =
  | { type: 'RequestAccepted'; requestId: string }
  | { type: 'InvoiceCreated'; paymentId: string; amountMsat: number }
  | { type: 'PaymentSettled'; paymentId: string }
  | { type: 'ProductionStarted'; attempt: string }
  | { type: 'ArtifactStored'; sha256: string; mediaType: string; producer: string }
  | { type: 'LocalDeliveryVerified'; sha256: string };

function reduceJob(state: JobState, event: JobEvent): JobState {
  // Total, deterministic transition table; reject impossible transitions.
  return transition(state, event);
}
```

### Pattern 2: Capability-Based UI Boundary

**What:** The Napplet asks the shell for narrowly scoped identity, signing, relay, storage, and resource operations after feature detection.

**When to use:** Any operation that crosses iframe CSP or needs credentials, network policy, persistent storage, or privileged access.

**Trade-offs:** The UI must support unavailable capabilities and async failure, but secrets and unrestricted networking remain outside browser code.

### Pattern 3: Content-Addressed Artifact Lifecycle

**What:** Store bytes locally first, calculate SHA-256, produce a typed descriptor, and require readback verification at every distribution location.

**When to use:** Dummy GLB, terrain GLB, heightmap, texture, and displacement bundles.

**Trade-offs:** Requires local disk management and duplicate reads, but gives an auditable definition of “delivered” and clean Blossom fallback.

### Pattern 4: Idempotent Inbox/Outbox

**What:** Deduplicate incoming request/callback events by stable external IDs and persist intended Nostr feedback/result publication before sending. Retries publish the same logical event rather than advancing state twice.

**When to use:** Relays, wallet callbacks/polls, processor messages, and Blossom upload retries.

**Trade-offs:** Slightly more persistence machinery, but protects paid jobs from duplicate charges, duplicate processing, and relay reconnect behavior.

### Pattern 5: Bounded Processing Manifest

**What:** Convert a paid request into a closed, versioned manifest containing normalized bbox, source identifier, explicit CRS/axis order, target resolution, pixel/byte/CPU/time ceilings, output type, and safe working identifier.

**When to use:** Before any WCS/ortho download or subprocess invocation.

**Trade-offs:** Rejects ambiguous requests instead of guessing, which is the intended fail-closed behavior.

## Local-First and Offline Fallback Architecture

The fallback modes must use the same ports and state semantics as live services:

| Dependency | Primary path | Required fallback | State/UX rule |
|---|---|---|---|
| Public/conference relay | Approved relay set | Local `strfry` | Label relay mode; do not change request validation or correlation |
| Blossom | Hash-verified upload and readback | Local artifact HTTP/resource serving | `DELIVERED_LOCAL`, never pretend Blossom succeeded |
| Full NIP-90 payment UX | Payment-required feedback with amount/BOLT11 | LNURL-pay or BOLT11 QR plus `lightning:` URI | Settlement still must be verified by backend |
| Mesh/texture generation | Validated terrain GLB | Heightmap plus three.js displacement bundle | Descriptor and UI must say displacement fallback, not GLB |
| 5 m WCS crop | Bounded 5 m request | 10 m DTM | Record actual source/resolution in artifact metadata |
| Conference network | Live dependencies | Prestarted local relay and artifact server; warm bounded licensed raster fixture where permitted | Never fake Lightning settlement or live WCS provenance |
| Missing shell capability/CSP denial | Shell resource/sign/relay path | Explicitly documented backend/local path | Disable unsupported action and show degraded mode |

### Demo Preflight

Before a local or conference run, verify clocks, DNS/TLS where required, relay health, wallet health, credential presence, shell capability support, local artifact serving, bounded data availability, disk space, and process supervision. Do not place secrets in the preflight output. Real Lightning settlement and live WCS may still require connectivity unless those services are actually local; the UI must identify unavailable dependencies instead of advancing state optimistically.

## Scaling Considerations

| Scale | Architecture adjustment |
|---|---|
| Demo to ~1k jobs | One DVM process, a transactional local database/event log, local artifact directory, one bounded processor worker, local-first adapters. Prefer observability and replay safety over distributed infrastructure. |
| Sustained queue or multiple workers | Add a durable producer queue/lease keyed by job and attempt; keep reducer and payment gate unchanged; isolate processor workspaces; introduce artifact retention policy. |
| Public multi-instance service | Shared transactional store, outbox publisher, horizontally scalable stateless Nostr listeners, wallet webhook verification plus reconciliation polling, per-source rate limits, object storage behind the artifact repository port. |

### Scaling Priorities

1. **First bottleneck: raster source limits and processor cost.** Enforce per-job and global area/pixel/concurrency budgets before adding workers.
2. **Second bottleneck: artifact storage and transfer.** Use content addressing, retention policy, cache headers, and replicas behind the repository port.
3. **Third bottleneck: relay and callback duplication.** Stable idempotency keys and durable inbox/outbox solve this before horizontal scaling.

Do not introduce microservices, a custom tile server, or distributed queues for the initial demonstration.

## Anti-Patterns

### Processor-First Development

**What people do:** Start terrain mesh work because it is visually compelling.
**Why it is wrong:** It hides the highest-risk product integration—signed request, real invoice, verified settlement, and gated bytes—and can consume the demo schedule.
**Do this instead:** Complete bbox/ortho and the paid valid dummy GLB trace first; plug the processor into the existing artifact producer port afterward.

### Browser as Privileged Backend

**What people do:** Put signer keys, LNbits/Phoenixd admin credentials, Blossom auth, arbitrary fetch proxies, or direct WCS logic in the Napplet.
**Why it is wrong:** It violates the sandbox boundary, leaks secrets, fails under CSP, and makes network policy unenforceable.
**Do this instead:** Use shell capabilities or narrow backend adapters; the Napplet owns presentation and user gestures only.

### Adapter-Owned Job Truth

**What people do:** Let relay messages, wallet callbacks, processor processes, or Blossom responses directly write a status field.
**Why it is wrong:** Duplicate, stale, reordered, or forged external messages produce impossible state and can bypass payment.
**Do this instead:** Translate adapter observations into verified facts and apply them through one deterministic reducer with transactional persistence.

### Optimistic Payment

**What people do:** Mark paid when the QR is shown, when a user returns from a wallet, or when an unauthenticated callback arrives.
**Why it is wrong:** Unpaid jobs can reach processor and artifact delivery.
**Do this instead:** Reconcile the exact stored provider payment identifier and expected amount; only a verified settlement fact opens the producer gate.

### URL Equals Delivery

**What people do:** Save a Blossom/local URL and call the job delivered.
**Why it is wrong:** The URL may return missing, changed, truncated, or wrong-type bytes.
**Do this instead:** Store bytes locally, hash them, read back each advertised location, and compare SHA-256 before publishing delivery.

### Fake Artifact Extension

**What people do:** Put placeholder text/JSON under `.glb`, or render generated geometry unrelated to downloaded bytes.
**Why it is wrong:** It creates false executable evidence and masks integration failures.
**Do this instead:** Run a real glTF structural validator on the dummy GLB and load the exact hash-addressed bytes in the built viewer. Label displacement fallback honestly.

### Unbounded or Ambiguous Geodata Requests

**What people do:** Trust browser bbox ordering, infer CRS/axis order, download first and validate later, or permit arbitrary source URLs.
**Why it is wrong:** It enables excessive upstream use, memory/disk exhaustion, wrong-location output, SSRF, and path/subprocess injection.
**Do this instead:** Normalize and validate bounds, explicit CRS, source allowlist, expected dimensions, byte and compute ceilings before retrieval.

### Blossom as Required Source of Truth

**What people do:** Delete or ignore local bytes after upload and block the demo on Blossom.
**Why it is wrong:** An optional external distribution outage destroys demonstrability and auditability.
**Do this instead:** Keep local verified bytes as the required repository; Blossom is optional replication with local fallback.

### Protocol Semantics Spread Across the Codebase

**What people do:** Hard-code NIP-90 kinds, tags, feedback strings, and correlation logic in UI, service handlers, and tests independently.
**Why it is wrong:** NIP-90 is draft and currently unrecommended; drift causes incompatible behavior and broad rewrites.
**Do this instead:** Isolate selected event profile and versioned schemas in `packages/protocol` plus the Nostr adapter.

### Hidden Online Dependency in “Offline” Mode

**What people do:** Start local strfry but still depend silently on remote wallet, WCS, tiles, CDN modules, or Blossom.
**Why it is wrong:** The local demo fails unpredictably and may claim payment or provenance it did not verify.
**Do this instead:** Preflight every dependency, bundle app code, use approved warm bounded data only where licensing permits, and display exact degraded mode.

## Integration Points

### External Services

| Service | Integration pattern | Critical checks |
|---|---|---|
| Nostr relay / local strfry | Reconnecting subscription and idempotent publication adapter | NIP-01 event verification, selected kind, request/result correlation, replay safety |
| LNbits | Server-side invoice creation and payment lookup/callback reconciliation | Secret isolation, exact payment ID, amount/expiry, pending/success/failure mapping |
| Phoenixd | Alternative Lightning adapter behind the same port | Auth isolation, create-invoice response, settlement lookup/reconciliation |
| WCS | Allowlisted server adapter using capabilities/coverage metadata then bounded GetCoverage | CRS and axis order, bbox envelope, pixel/byte limits, timeout, content validation |
| Orthophoto/base map | Policy-specific preview/retrieval adapter | Attribution, cache behavior, no bulk scraping/prefetch, source/license provenance |
| Blossom | Exact-byte upload with optional scoped signed authorization, then readback | Expected SHA-256, size, MIME type, auth expiry/action/server/hash scope, CORS/resource path |
| Local artifact server | Content-addressed GET/HEAD over loopback or shell resource domain | Path safety, immutable URLs, MIME type, cache policy, readback hash |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| Napplet ↔ shell | Published SDK/capability envelopes | Feature-detect; no private privileged protocol or secrets |
| Shell/Nostr ↔ DVM | Signed request and feedback/result events | Transport is not authority; verify before command creation |
| DVM core ↔ adapters | Typed ports returning domain facts | No adapter state mutation |
| DVM ↔ processor | Versioned bounded manifest and typed result descriptor | Paid precondition, idempotent attempt, safe paths/arguments |
| DVM ↔ artifact repository | Exact bytes plus metadata | Atomic write, SHA-256, immutable identity |
| Repository ↔ Blossom/local serving | Replication/readback | Local remains required fallback |
| Napplet viewer ↔ artifact | Descriptor plus expected hash through shell resource path | Render only verified actual bytes |

## Verification Architecture

The architecture is accepted by executable evidence in this order:

1. Protocol parser and reducer tests cover every allowed and forbidden transition, duplicate fact, late callback, and unpaid artifact attempt.
2. Napplet bbox/area/preview behavior is exercised in the built sandbox, not only the Vite development server.
3. A real signed request produces a real invoice; provider readback proves settlement; a structurally valid dummy GLB is stored, hashed, retrieved, and loaded.
4. Failure traces prove malformed/oversized requests, unpaid access, incorrect payment IDs, artifact hash mismatch, and adapter outages fail closed.
5. Processor fixture tests use small bounded licensed/public raster data and assert CRS, dimensions, timeout, and honest fallback metadata.
6. Blossom success includes upload and cryptographic readback; Blossom failure demonstrates local delivery without changing artifact identity.
7. Production single-file build, Napplet conformance, browser smoke, secret scan, and public diff review complete the ladder.

## Open Gaps and Phase-Specific Decisions

These are unresolved inputs, not reasons to weaken the boundaries above:

- Select and document the exact request kind in `5000–5999`, matching result convention, and the minimal terrCVM event profile. NIP-90's draft/unrecommended status makes this a versioned adapter decision.
- Verify the installed Napplet SDK/shell versions and exact available resource, relay, signing, storage, and payment-related capability surfaces. Current evidence found no generic Lightning payment domain.
- Prove whether ortho preview can use a shell resource domain directly in the production CSP; otherwise define the narrow backend preview adapter and its allowlist/cache policy.
- Confirm 21maps source, exact version, license, and provenance before reuse.
- Confirm exact WMS/WCS/orthophoto endpoints, coverage identifiers, CRS/axis semantics, authentication, limits, attribution, and offline fixture permissions.
- Choose LNbits versus Phoenixd as primary and define the exact create-invoice, settlement readback, callback authentication, and reconciliation behavior using local credentials.
- Choose the durable job-store implementation and transaction boundaries; the reducer/event contract should remain storage-independent.
- Decide `trimesh`/`pygltflib` GLB generation versus displacement-only after the paid dummy gate, subject to the three-hour mesh timebox.
- Confirm Blossom server, authorization requirements, shell retrieval path, and CORS behavior; local delivery remains mandatory regardless.
- Define pricing amount/minimum/caps only after the fixed-price paid loop works; pricing optimization must not alter payment-gate semantics.
- Document which dependencies are truly local for conference mode. Local relay and artifact serving alone do not make Lightning settlement or live WCS offline.

## Sources

Evidence below was already collected in the prior research trace; no additional research was performed while materializing this artifact.

- Nostr NIP-90, current upstream text: <https://raw.githubusercontent.com/nostr-protocol/nips/master/90.md> — request kinds `5000–5999`, corresponding result range, kind `7000` feedback, amount/BOLT11 gating, and current draft/unrecommended warning. **Confidence: MEDIUM**
- Nostr NIP-01, upstream repository at researched HEAD `6d2979b3f503a8539c983efbcdcf901bbcf9ed23` — event structure/signature and relay transport boundary. **Confidence: MEDIUM**
- Pinned NIP-5D reference: <https://raw.githubusercontent.com/dskvr/nips/d80d7b25f9c4331acbeb40dbeb3b077caa80e885/5D.md> — sandboxed iframe/shell message model. **Confidence: MEDIUM**
- Local Napplet starter boundary/design/package-surface documentation inspected at local source commit `ba107bde3402b05364f0d128e69724dae9a36ed0` — capability boundary, strict sandbox/CSP behavior, shell resource use, and conformance expectations. **Confidence: MEDIUM**
- Blossom BUD-01, BUD-02, BUD-03, BUD-07, and BUD-11: <https://github.com/hzrd149/blossom/tree/master/buds> — content-addressed retrieval/upload, descriptors, server lists, paid endpoints, and scoped Nostr authorization. Researched repository HEAD `b5bd2801d1763aa635fc8fea7a76597e0eb18990`. **Confidence: MEDIUM**
- LNbits current source inspected at commit `8723d327fe481102c39e74d4ea353e6de17c78b5` — invoice/payment API and pending/success/failure semantics. **Confidence: MEDIUM**
- Phoenixd current source inspected at commit `c7abded8a1b6dbdfc3672a243edbd98dc24f2342` — create-invoice and server API adapter surface. **Confidence: MEDIUM**
- OGC WCS 2.0.1 Core, document `09-110r4`: <https://docs.ogc.org/is/09-110r4/09-110r4.pdf> — GetCoverage domain subsetting, coverage envelopes, and CRS semantics. **Confidence: MEDIUM**
- OpenStreetMap Foundation tile usage policy: <https://operations.osmfoundation.org/policies/tiles/> — attribution, caching, valid client behavior, and prohibition on bulk scraping/prefetch. **Confidence: MEDIUM**
- MapLibre GL JS documentation, researched repository HEAD `ca1684351dc154bd5da000863afd081bc78c8972` — CSP/worker/bundler considerations for map rendering. **Confidence: MEDIUM**
- Khronos glTF 2.0 specification and official glTF Validator, researched specification HEAD `77b44be7bef26e01fb0b140e3d5bb1716421c5e9` and validator HEAD `434283be08a668a8fb4e437145630ddbf93b0686` — GLB structure/media type and validation. **Confidence: MEDIUM**
- strfry current source, researched HEAD `104a0846920bce188de52b5cc891746a924e04bf` — local filesystem-backed Nostr relay deployment. **Confidence: MEDIUM**
- terrCVM `.planning/PROJECT.md`, `docs/PROJECT-BRIEF.md`, and `AGENTS.md` — project invariants, scope, fallbacks, acceptance gates, and required execution order. **Confidence: HIGH (project authority)**

---
*Architecture research for: terrCVM*
*Researched: 2026-07-26*
