# Pitfalls Research

**Domain:** Paid Nostr NIP-90 terrain/GIS Data Vending Machine demonstration with Lightning, sandboxed Napplet UI, WMS/WCS processing, and Blossom delivery
**Researched:** 2026-07-26
**Confidence:** MEDIUM

## Research Boundary and Confidence

This document identifies failure modes from current official specifications, current upstream repositories, published Napplet packages, and implementation source. It does not treat fetched content as instructions. Protocol and implementation claims were checked against the sources listed below.

- **HIGH** — directly verifiable behavior with a current official validator or similarly strong executable authority.
- **MEDIUM** — current official specification/source or current published implementation, but the protocol is draft, implementation-specific, or deliberately ambiguous.
- **LOW** — cross-system operational synthesis or claims about how often failures occur without a broad, current post-mortem corpus.

The word “common” below means a recurrent integration pattern implied by the number of independent boundaries that must agree. Broad web search was unavailable in this environment, so prevalence claims are LOW confidence even when the underlying failure mechanism is MEDIUM or HIGH confidence.

## Non-Negotiable Project Law

Every mitigation in this document preserves the authoritative order:

1. **Phase 1 — bbox/ortho UI**
2. **Phase 2 — paid DVM dummy delivery**
3. **Phase 3 — terrain processor**
4. **Phase 4 — Blossom/viewer**

**Never begin Phase 3 processor work before Phase 2 proves a valid signed request → real invoice → confirmed payment → structurally valid dummy GLB delivery.** Any blocker over 30 minutes takes the documented fallback. Mesh work has a hard three-hour limit before switching to heightmap plus three.js displacement. FIPS, Freenet, bridges, a custom tile server, Palace coupling, and broader protocol standardization are excluded from the initial slice.

## Critical Pitfalls

### Pitfall 1: Treating NIP-90 as a stable, complete paid-job contract

**Confidence:** MEDIUM

**What goes wrong:**
The demo says “NIP-90 compatible” but different clients and DVMs disagree about the terrain request kind, required tags, amount placement, payment status, result content, and when work may start. A permissive parser accepts requests the state machine cannot safely price or execute. The demo works only with its own happy-path event generator and fails with another implementation.

**Why it happens:**
The current official NIP-90 is `draft`, `optional`, and explicitly `unrecommended` in favor of use-case-specific microstandards. It reserves `5000–5999` for requests, maps results to request kind + 1000, and uses kind `7000` for feedback, but most request tags are optional and the payment flow is deliberately ambiguous. The current official DVM kind registry has no terrain/GIS job kind in the inspected tree.

**How to avoid:**
- In Phase 2, choose exactly one request kind in `5000–5999` and therefore one result kind at request + 1000. Record the rationale without attempting broader standardization.
- Define a small versioned terrDVM request profile: schema version, bbox order, bbox CRS, output MIME, resolution choice, maximum area/pixels, and optional provider target.
- Treat NIP-90 as the carrier and terrDVM’s strict schema as the executable contract.
- Reject unknown versions, duplicate singleton tags, unsupported input types, conflicting parameters, and unrecognized output MIME values.
- Emit kind `7000` `payment-required` before halting for payment, then explicit `processing`, `success`, or `error` feedback as applicable.
- If the implementation supports bolt11 only, state that honestly; do not imply generic zap-path interoperability.

**Warning signs:**
- “All NIP-90 tags are optional, so the backend can infer the rest.”
- More than one terrain kind appears in code or documentation.
- The result kind is independently configured instead of derived from the request kind.
- Tests construct unsigned internal objects rather than wire-format Nostr events.
- The UI has fewer states than requested, invoiced, paid, processing, delivered, failed, and local fallback.

**Phase to address:**
Phase 2 — paid DVM dummy delivery. Freeze this contract before the first real invoice. Do not defer it to processor work.

---

### Pitfall 2: Calling a request “signed” without validating the complete Nostr event

**Confidence:** MEDIUM

**What goes wrong:**
The DVM trusts `pubkey`, tags, or an SDK callback without independently checking canonical event ID and Schnorr signature. Modified parameters can be accepted under someone else’s pubkey. Malformed tags, future timestamps, oversized content, or unsupported kinds enter pricing and processing. A relay accepting an event is mistaken for application-level validity.

**Why it happens:**
A Nostr event has several separable checks: canonical serialization, SHA-256 event ID, BIP-340 signature, field shape, kind, timestamp policy, and application schema. Relay `OK` only reports that relay’s acceptance and can also return `duplicate`, `rate-limited`, `invalid`, or other machine-readable results.

**How to avoid:**
- Verify canonical NIP-01 serialization, event ID, signature, lowercase fixed-length IDs/pubkeys, integer timestamp/kind, and string-only tag elements in the DVM boundary.
- Derive requester identity only from the verified event pubkey, never from a `p` tag or client-supplied account field.
- Apply a narrow timestamp window suitable for local and public relays, with an explicit clock-skew error.
- Parse the verified event into an immutable application command, then apply terrDVM schema and resource limits before creating a job or invoice.
- Record the exact request event JSON/id used for result correlation; never reconstruct a “similar” request later.
- Test wrong ID, wrong signature, wrong kind, duplicate tags, future timestamp, oversized content, malformed bbox, and unknown schema version.

**Warning signs:**
- A job row can be created from `{ pubkey, bbox }` without a verified event ID.
- Validation tests mock `isValid = true` globally.
- Relay delivery is treated as proof of signature validity.
- The DVM reads customer identity from the first `p` tag.
- Error paths normalize malformed events into defaults instead of rejecting them.

**Phase to address:**
Phase 2 — paid DVM dummy delivery, before invoice creation.

---

### Pitfall 3: Relay fanout and retries create duplicate jobs, invoices, and deliveries

**Confidence:** MEDIUM

**What goes wrong:**
The same request arrives from several relays or after reconnect/replay. The DVM creates multiple invoices, starts multiple processors, or publishes multiple conflicting results. A `duplicate: already have this event` relay response is treated as failure even though the event is already stored. After restart, the backend replays old requests as new work.

**Why it happens:**
NIP-90 request/result/feedback kinds are regular events and may be stored and replayed. Multi-relay clients naturally see the same event more than once. Webhooks and status polling also repeat. Network delivery is at-least-once in practice; exactly-once behavior must be created by application state.

**How to avoid:**
- Use verified request event ID as the durable idempotency key.
- Make `request accepted`, `invoice created`, `payment confirmed`, `artifact committed`, and `result published` compare-and-set transitions.
- Persist invoice payment hash/checking ID and result event ID; never derive “not yet done” from transient process memory.
- Treat identical relay duplicates as idempotent observations. Treat a different event ID with the same semantic payload as a distinct request unless the product explicitly defines otherwise.
- On startup, resume only durable states that permit recovery; do not republish invoices or results blindly.
- Keep relay observation metadata separate from job truth.

**Warning signs:**
- A new UUID is generated before looking up the request event ID.
- Invoice creation is called directly from each relay subscription callback.
- The backend has no unique constraint on request event ID or invoice association.
- Replaying a captured event changes wallet balance or creates a new result.
- Job status lives only in the Napplet or websocket connection.

**Phase to address:**
Phase 2 — reducer and payment-gate TDD. Reuse the same idempotent job identity in Phases 3 and 4.

---

### Pitfall 4: Invoice display, callback receipt, or client claims are treated as payment

**Confidence:** MEDIUM

**What goes wrong:**
Scanning the QR, opening a `lightning:` URI, receiving an unsigned callback, seeing a pending invoice, or getting a client-side “paid” message unlocks the artifact. An unpaid user can force `paid` state. A transient payment backend error is interpreted as success. The UI says paid while the trusted wallet still says pending.

**Why it happens:**
Issuing an invoice and confirming settlement are distinct. LNbits models pending/success/failed states; Phoenixd exposes incoming-payment lookup and HMAC-signed webhooks. NIP-90’s `payment-required` event requests payment but is not itself settlement proof.

**How to avoid:**
- Store one invoice payment hash/checking ID, expected amount, unit, expiry, and request event ID in the job record.
- Advance to `paid` only from a trusted LNbits/Phoenixd settlement check. A webhook is a wake-up signal, not the sole source of truth; verify its signature where provided and confirm the referenced payment.
- Keep wallet credentials and webhook secrets in the backend. Use the least-privileged LNbits invoice key for incoming invoice operations; do not expose an admin key to the Napplet.
- Make polling and webhook handling idempotent and monotonic.
- On backend timeout or unknown state, remain pending and display an honest retry state. Fail closed.
- Exercise the documented bolt11 QR plus `lightning:` fallback after 30 minutes if full kind-7000 payment UX blocks progress; preserve the real settlement gate.

**Warning signs:**
- `POST /jobs/:id/paid` is callable by the Napplet.
- A browser wallet callback writes job state directly.
- Payment state is a boolean with no pending/failed/expired distinction.
- Webhook bodies are accepted without signature verification or payment lookup.
- The artifact route checks only whether an invoice exists.

**Phase to address:**
Phase 2 — this is the demo’s core acceptance gate.

---

### Pitfall 5: Millisatoshi/satoshi, expiry, and replacement-invoice races corrupt the gate

**Confidence:** MEDIUM

**What goes wrong:**
A NIP-90 `bid` or `amount` in millisatoshis is passed to a wallet API expecting satoshis, producing a 1000× pricing error. A late payment to an expired or replaced invoice unlocks the wrong job. Two invoices are considered interchangeable because they have the same amount. A zero-amount or amountless invoice bypasses expected-price checks.

**Why it happens:**
NIP-90 defines `bid` and result/feedback `amount` in millisatoshis. Phoenixd’s `createinvoice` uses `amountSat`; LNbits invoice creation defaults to `unit: "sat"` while its persisted payment amount is millisatoshis. Invoice lifecycle and application job lifecycle are not the same state machine.

**How to avoid:**
- Name every amount variable with a unit suffix (`amountMsat`, `amountSat`) and convert at one tested adapter boundary.
- Decode/read back the created BOLT11 and verify payment hash, amount, network, and expiry against the stored quote.
- Bind invoice identity, not just amount, to the request event ID and quote version.
- Decide and test expired, canceled, replaced, and late-paid invoice behavior before demo day. Never silently transfer payment to another request.
- Reject amountless or zero-value invoices unless explicitly required by the chosen fallback and still validated against a server-side quote.
- Keep pricing optimization/stretch logic out of the core paid dummy path.

**Warning signs:**
- Generic variable names such as `amount` cross protocol and wallet adapters.
- Tests use only `1000`, masking sat/msat mistakes.
- The paid lookup filters only by amount or customer pubkey.
- Invoice expiry is never displayed or tested.
- Reissuing an invoice overwrites the only payment hash.

**Phase to address:**
Phase 2 — before first real payment. Stretch sats/km² pricing comes only after the core loop.

---

### Pitfall 6: The artifact leaks before payment because delivery is public and content-addressed

**Confidence:** MEDIUM

**What goes wrong:**
The backend uploads the dummy GLB to Blossom, publishes its hash/URL in a result or feedback event, or exposes a predictable local path before settlement. Unpaid users retrieve it directly. A single shared dummy GLB has the same globally known SHA-256 for every job, making a supposedly hidden Blossom URL guessable or reusable.

**Why it happens:**
Nostr events and Blossom hash paths are distribution mechanisms, not payment authorization. A `p` tag does not make a public result private. Blossom blobs are addressed by SHA-256 and commonly retrievable by `GET /<sha256>`. Static local HTTP serving has the same problem if its URL is predictable or disclosed.

**How to avoid:**
- Do not publish the delivery hash, URL, or result event before trusted settlement.
- Make the dummy GLB structurally valid and job-specific, for example by embedding the verified request event ID in permitted GLB metadata, then validate the resulting bytes. This prevents every job from sharing one known content hash.
- Gate the local artifact route on durable paid state or issue a short-lived backend capability only after payment. Do not rely on URL obscurity alone.
- Treat Blossom as Phase 4 delivery. Phase 2 may use a payment-gated local path for dummy delivery.
- Keep preview/sample data explicitly separate from the paid final artifact.
- Test direct artifact retrieval before payment, after payment, after restart, and with another job’s URL/hash.

**Warning signs:**
- The artifact hash exists in a pre-payment kind-7000 event.
- Every dummy job returns the same hash.
- `/artifacts/<job-id>.glb` is a public static route.
- Code comments call a Blossom URL “private.”
- The only authorization check is a matching `p` tag.

**Phase to address:**
Phase 2 — local dummy delivery gate; Phase 4 — preserve the same rule when Blossom is added.

---

### Pitfall 7: Privileged operations are pushed into the Napplet to “make the demo easier”

**Confidence:** MEDIUM

**What goes wrong:**
The iframe contains a Nostr private key, LNbits/Phoenixd credential, Blossom authorization secret, WCS credential, unrestricted relay connection, or backend admin URL. Direct `fetch()` works in a development tab but fails in the real sandbox/CSP. A malicious dependency or injected script gains wallet, signer, or storage authority.

**Why it happens:**
The current published Napplet implementation runs under `sandbox="allow-scripts"` without `allow-same-origin`; strict CSP blocks direct fetch/XHR and external image URLs. Current SDK documentation assigns byte retrieval to the shell `resource` domain and signing/relay/upload policy to shell-owned capabilities. Domains may be absent at runtime.

**How to avoid:**
- Keep the Napplet an unprivileged UI. Compose event templates and request shell-mediated signing/publishing; validate again in the DVM.
- Fetch approved public bytes through `resource.bytes`/`resource.bytesMany` or a narrow backend adapter. Put credentialed WMS/WCS access only behind the backend.
- Declare required NAP domains and check their presence at runtime. Provide an exact degraded/fallback path when optional domains are absent.
- Use shell-mediated upload if available; Blossom auth tokens and upload credentials never enter the iframe.
- Add secret scanning for source, built `dist`, sourcemaps, manifests, captured traces, and documentation.
- Never use a real private key in `VITE_DEV_PRIVKEY_HEX`; the current Vite plugin explicitly describes this as a local test-key path, not production deployment.

**Warning signs:**
- `fetch(WCS_URL)` or `fetch(BLOSSOM_URL, { Authorization })` exists in Napplet code.
- `localStorage` stores a signer key or wallet API key.
- The app requires `allow-same-origin` to work.
- A missing `window.napplet` domain crashes boot.
- The same environment variable is used for Vite build and backend secrets.

**Phase to address:**
Phase 1 for ortho/resource access; Phase 2 for signing, relay, and payment; Phase 4 for upload/retrieval.

---

### Pitfall 8: A development page passes while the production single-file Napplet fails

**Confidence:** MEDIUM

**What goes wrong:**
The map, QR, status stream, or viewer works under Vite dev server but not when built into one `index.html`, loaded as opaque-origin `srcdoc`, or run without one optional shell domain. Local chunks, CSS, workers, fonts, map sprites, WASM, or dynamic imports remain external. Conformance passes envelope shape but the real business flow still fails.

**Why it happens:**
The current Napplet Vite plugin defaults to external assets unless `artifactMode: "single-file"` is selected. The conformance CLI runs real Chromium in the strict sandbox and includes a no-capability degradation pass. Manifest/envelope conformance does not validate payment, GIS correctness, or remote provider policy.

**How to avoid:**
- Build the production single-file artifact from Phase 1 onward; do not postpone this to Phase 4.
- Run the current conformance CLI against `dist`, not source or dev server, and keep the degraded-domain pass enabled.
- Run Paja/Kehto browser smoke on the built artifact for map interaction, QR/link, status transitions, and later the actual delivered viewer bytes.
- Audit output for extra local assets and network requests. Inline only assets whose license permits it.
- Treat conformance, browser behavior, and domain acceptance as three separate gates.
- Do not use `--allow-same-origin` except diagnosis; a conformant Napplet must not require it.

**Warning signs:**
- Verification instructions say only `npm run dev`.
- `dist` contains JS/CSS chunks despite the single-file requirement.
- MapLibre style references external fonts/sprites that were never tested in sandbox.
- Conformance is run with same-origin debug mode.
- A green manifest check is cited as evidence that unpaid delivery is blocked.

**Phase to address:**
Phase 1 establishes the production sandbox baseline; rerun in Phases 2 and 4.

---

### Pitfall 9: WMS portrayal and WCS coverage semantics are mixed, especially CRS axis order

**Confidence:** MEDIUM

**What goes wrong:**
The preview appears correct while the processor downloads a different location, a blank coverage, or transposed terrain. Longitude/latitude is sent to WMS 1.3.0 `EPSG:4326`, which defines latitude then longitude; a service expecting `CRS:84` receives the wrong axis order. The processor uses a WMS image as elevation data, ignores WCS axis labels/nodata, or treats XML exceptions as raster bytes.

**Why it happens:**
WMS is a map portrayal service; WCS retrieves coverages. OGC WMS 1.3.0 follows CRS-defined axis order: `CRS:84` is longitude/latitude, while `EPSG:4326` is latitude/longitude. WCS versions and coverage descriptions expose supported coverages, axes, bounds, native formats, and CRS semantics that cannot safely be guessed from the UI bbox.

**How to avoid:**
- Phase 1 owns a canonical bbox representation with explicit CRS and order. Display longitude/latitude labels; reject swapped, zero-area, out-of-range, non-finite, antimeridian-crossing, or unsupported boxes unless explicitly handled.
- Calculate area geodesically or in an appropriate projected CRS; do not multiply degree differences and label the result km².
- Negotiate/read `GetCapabilities`; for WCS also inspect `DescribeCoverage` before constructing the bounded crop.
- Use provider-specific, tested adapters that map canonical bbox to that service’s version, axis labels/order, subset syntax, output format, and nodata rules.
- Validate status, MIME, body signature/magic, raster driver, dimensions, bands, CRS, transform, bounds, and nodata before processing. Parse OGC service exceptions separately.
- Keep ortho preview and elevation coverage identifiers distinct in schema and code.

**Warning signs:**
- A helper named `bboxToString()` is shared across all WMS/WCS versions.
- Bbox is stored as an unlabeled four-number array.
- Area is calculated directly in EPSG:4326 degrees.
- The WCS response is accepted because the filename ends in `.tif`.
- Preview alignment is used as proof that elevation crop alignment is correct.

**Phase to address:**
Canonical bbox, area, and ortho policy in Phase 1. WCS adapter and real crop only in Phase 3, after Phase 2 acceptance.

---

### Pitfall 10: Remote raster inputs and compute are unbounded or trusted by extension

**Confidence:** MEDIUM

**What goes wrong:**
A tiny request causes a huge WCS response, memory exhaustion, disk fill, long CPU work, SSRF, local file access, or GDAL driver abuse. A malicious or misconfigured endpoint returns a VRT disguised as TIFF. A one-pixel Rasterio window still downloads a full unchunked source. User-controlled strings reach file paths or subprocess commands.

**Why it happens:**
Raster dimensions, compressed transfer size, decoded pixel count, bands, block layout, and processing cost are different limits. Rasterio documents that window reads operate at source block granularity and may read the entire unchunked dataset. GDAL’s security guidance treats opening a dataset as processing and highlights network-capable and indirection-capable drivers including VRT, WMS, and WCS.

**How to avoid:**
- Accept only configured WMS/WCS origins and coverage IDs; never fetch an arbitrary request `i` URL for this initial slice.
- Reject the bbox and resolution before network I/O using server-side area, dimension, pixel, byte, and time budgets.
- Enforce connect/read/total timeouts, redirect limits, maximum response bytes, allowed content types, and fixed output directory.
- Run GDAL/raster code in a dedicated low-privilege process/container with no signer, wallet, Blossom, or unrelated file access. Disable unneeded drivers and network features.
- Inspect driver, dimensions, bands, dtype, CRS, transform, bounds, and nodata immediately after open and before allocation.
- Pass subprocess arguments as arrays from validated enums/paths; never interpolate a shell command.
- Use the documented 10 m DTM fallback when 5 m is too slow. Do not weaken validation to meet the demo clock.

**Warning signs:**
- Request events contain arbitrary URLs that GDAL opens directly.
- Only bbox area is capped; pixel count and response bytes are not.
- Temporary filenames include raw pubkeys, tags, or path separators.
- `shell=True`, command strings, or broad filesystem mounts appear in processor code.
- The processor shares a process/environment with wallet or signing credentials.

**Phase to address:**
Design budgets during Phase 2 schema work, but implement processor isolation and raster checks only in Phase 3 after the paid dummy gate.

---

### Pitfall 11: Terrain work starts early and hides the real integration risk

**Confidence:** HIGH for project impact; MEDIUM for ecosystem prevalence

**What goes wrong:**
Days are spent on triangulation, UVs, textures, smoothing, or mesh quality while signed requests, invoices, payment confirmation, and delivery authorization remain unproven. The team has an attractive local model but no paid DVM demonstration.

**Why it happens:**
Terrain output is visually rewarding and self-contained; payment and relay state are less visible and involve more boundaries. A fake `.glb` or hard-coded “paid” flag can make the processor look integrated when the core product promise is not satisfied.

**How to avoid:**
- Make Phase 2’s acceptance trace the permission slip for creating `services/processor` implementation work.
- Deliver a structurally valid, job-specific dummy GLB only after real settlement.
- Record failure tests showing unpaid retrieval denied and payment retries idempotent.
- Time-box any Phase 2 blocker to 30 minutes and take the documented bolt11/LNURL/payment UX fallback rather than starting processor work.
- In Phase 3, enforce the separate three-hour mesh timebox and switch to honest heightmap plus three.js displacement.

**Warning signs:**
- Rasterio, trimesh, or pygltflib appears before a real paid trace exists.
- A processor screenshot is presented as milestone success.
- “Payment will be wired later” appears in the plan.
- Dummy delivery uses a text file renamed `.glb`.
- Mesh quality is on the critical path to the first conference demo.

**Phase to address:**
Roadmap ordering and Phase 2 gate. This pitfall is prevented by refusing to enter Phase 3 early.

---

### Pitfall 12: A `.glb` extension is mistaken for a valid, loadable artifact

**Confidence:** HIGH

**What goes wrong:**
The dummy or generated file has the right extension but invalid GLB header/chunks, broken accessors, NaNs, wrong buffer lengths, unsupported extensions, or external texture/buffer dependencies. It passes a superficial HTTP test but fails Khronos validation or three.js loading in the built sandbox.

**Why it happens:**
File existence, MIME, structural validity, semantic validity, and viewer compatibility are separate gates. Khronos glTF Validator checks GLBv2 container structure, schemas, references, binary buffers, accessors, images, and extensions. A GLB may still reference or require behavior unavailable in the Napplet sandbox.

**How to avoid:**
- Use a known generated minimal GLB pipeline, not manually concatenated placeholder bytes.
- Run Khronos glTF Validator with resource validation and fail on errors for every dummy fixture and generated artifact.
- Reject non-finite heights/transforms and verify declared lengths against exact bytes.
- Prefer a self-contained GLB with embedded buffers/textures; otherwise nested resource loading must use an explicitly supported shell path.
- Fetch final bytes through the Napplet resource capability, create a scoped object URL, load with GLTFLoader, and revoke it after use.
- Keep the displacement fallback labeled and typed as heightmap/metadata, not a failed GLB hidden behind the GLB MIME.

**Warning signs:**
- Validation is only `file`/extension or HTTP `Content-Type`.
- GLTFLoader works only against a public URL in a normal browser tab.
- External `.bin` or texture URLs appear inside the delivered GLB.
- Validator warnings/errors are ignored because three.js rendered once.
- The displacement fallback is returned with `.glb` extension.

**Phase to address:**
Phase 2 for structurally valid dummy GLB. Phase 3 for generated GLB or honest displacement fallback. Phase 4 for actual sandbox viewer smoke.

---

### Pitfall 13: Blossom success is trusted without exact-byte readback

**Confidence:** MEDIUM

**What goes wrong:**
A `200`/`201` upload response, `HEAD`, descriptor, or URL is treated as delivery. The server stored different bytes, normalized/transformed media, reported the wrong type/size/hash, redirected to a CORS-incompatible target, or later removed the blob. The result event binds to a hash that was never recomputed from retrieved bytes.

**Why it happens:**
Current Blossom BUDs are draft. BUD-02 requires servers not to modify upload bytes and to hash exact bytes; descriptors include URL, SHA-256, size, MIME, and timestamp. BUD-01 permits redirects and defines CORS/header behavior. These are protocol requirements, not proof that a particular server complied.

**How to avoid:**
- Compute SHA-256 and size over immutable final bytes before upload.
- Scope a short-lived kind-24242 upload token to action `upload`, the exact server domain, exact blob hash, and expiration. Signing remains shell/backend-owned.
- Verify descriptor hash/size/type, then retrieve through the returned BUD-01 URL, follow only safe redirects, and recompute SHA-256 over the body.
- Mark `delivered` only after exact-byte readback and built-Napplet load succeed.
- Record local and Blossom URLs as alternative locations for one content hash, not as separate artifact identities.
- If Blossom blocks progress for 30 minutes, serve the same verified bytes locally and label the fallback. Do not spend the demo window debugging retention or auth policy.

**Warning signs:**
- State advances to delivered immediately after upload HTTP status.
- Only `HEAD` is used for integrity verification.
- The upload auth token lacks `server`, `x`, or short expiration scope.
- Redirected retrieval drops the hash from the URL or fails CORS.
- The result event is published before readback.

**Phase to address:**
Phase 4 — Blossom/viewer, preserving Phase 2’s paid gate and artifact hash.

---

### Pitfall 14: “Offline/local-first” is claimed while critical dependencies still require a network

**Confidence:** LOW for prevalence; MEDIUM for the dependency analysis

**What goes wrong:**
A conference demo switches to local strfry but still depends on public WMS/WCS, external map styles/fonts, Blossom, DNS/TLS, a remote LNbits URL, or a Lightning route. The UI says offline-ready, then waits indefinitely. Operators bypass payment or substitute fake raster/output to save the presentation.

**Why it happens:**
Local relay operation removes only the relay dependency. Real Lightning settlement and live WCS retrieval may still require connectivity. The current fallback law explicitly names local strfry for unreliable conference Wi-Fi, local serving for Blossom failure, and 10 m DTM for a slow 5 m crop; it does not authorize fake payment, fake processor bytes, bulk OSM caching, or a custom tile server.

**How to avoid:**
- Define an event runbook that names which components are truly local and which still require connectivity.
- Preflight system clock, local strfry persistence/acceptance, Napplet shell capabilities, LNbits/Phoenixd health and route, invoice creation/settlement, provider DNS/TLS, WMS/WCS request, Blossom auth, and local artifact serving.
- Keep all state labels honest: offline relay, local artifact fallback, payment pending, provider unavailable, or 10 m fallback.
- Rehearse the real request → invoice → payment → dummy delivery trace from the actual conference laptop and payer device.
- Do not bulk-prefetch OSM tiles or add a custom tile server. Use the verified 21maps/licensed path and provider caching rules.
- Treat complete WCS outage as an unresolved conference gap unless an authoritative, licensed, real-WCS-derived fallback is documented during phase discussion. Never disguise a fixture as a live processor result.

**Warning signs:**
- “Offline mode” is a single checkbox with no dependency report.
- The local relay is tested, but payment settlement is not.
- Browser devtools show remote fonts/styles/resources during the built demo.
- A conference script writes `paid=true` or serves a prebuilt terrain as fresh output.
- The WCS outage plan is “rename the fixture.”

**Phase to address:**
Phase 1 for map/resource dependency inventory; Phase 2 for real payment and local relay runbook; Phase 3 for WCS outage decision; Phase 4 for local artifact fallback. Rehearse after every gate.

---

### Pitfall 15: Timeboxes are treated as suggestions, or fallbacks quietly change the product claim

**Confidence:** HIGH from the project brief

**What goes wrong:**
A blocker consumes the day because the team continues polishing the ideal path. Conversely, a fallback is activated silently and the UI still claims the primary path succeeded. Mesh generation exceeds three hours and prevents delivery. A new fallback introduces excluded architecture such as a bridge or custom tile server.

**Why it happens:**
Fallbacks are often implemented as ad hoc exception handling rather than explicit, tested state transitions with deadlines. Demo pressure encourages ambiguous labels.

**How to avoid:**
- Start a visible 30-minute blocker clock with owner, symptom, and required documented fallback.
- Encode fallback mode in job/artifact metadata and UI status.
- Enforce the three-hour mesh cutoff independently of the general blocker clock.
- Use only the authoritative fallbacks: local GLB serving, LNURL-pay or bolt11 QR plus `lightning:` link, displacement delivery, local strfry, and 10 m DTM.
- Keep exclusions excluded: no FIPS, Freenet, bridges, custom tile server, Palace coupling, or broader standardization work.
- Verify fallback output to the same integrity/payment standard as the primary output.

**Warning signs:**
- No timestamp marks when a blocker began.
- “Temporary” mesh work continues without a cutoff.
- Fallback output is not covered by tests or artifact hashing.
- UI says delivered without distinguishing local fallback or displacement.
- A workaround adds an excluded subsystem.

**Phase to address:**
All phases, with explicit fallback acceptance criteria in each plan.

## Technical Debt Patterns

Shortcuts that appear reasonable in a demo but undermine a paid, signed, verifiable flow.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| One shared dummy GLB for every job | Simplest delivery code | Public known hash; weak job binding; unpaid cross-job retrieval | Never for the paid acceptance trace; generate job-specific valid bytes |
| In-memory job/payment state | Fast prototype | Restart loses truth; duplicate invoices/results; conference recovery fails | Unit-test harness only, not the paid demo |
| Webhook-only payment confirmation | Low latency | Missed/forged/duplicate callbacks corrupt state | As a wake-up signal paired with trusted payment lookup |
| Polling-only with aggressive interval | Simple integration | Rate load, races, battery/UI churn | Acceptable fallback with bounded backoff and durable idempotency |
| Generic free-form `param` acceptance | Flexible client | Ambiguous pricing, unsafe processing, version drift | Never at the execution boundary; preserve unknown data only for diagnostics |
| Public static local artifact directory | Easy viewer URL | Unpaid retrieval and path guessing | Only behind a paid-state/capability gate |
| Trusting Blossom descriptor/HEAD | One less download | Delivered bytes never proven | Never for final delivered state |
| Processing arbitrary `i` URLs | Generic NIP-90 behavior | SSRF, credential/file exposure, unbounded formats | Out of scope for initial terrain slice; use configured providers |
| Running GDAL with backend secrets | Operational convenience | Parser exploit can reach signer/wallet/auth | Never |
| Dev-server-only UI verification | Fast feedback | Production sandbox/single-file failures appear late | Development only; each phase still needs built verification |
| Real key in Vite manifest build | One-step signing | Key leaks into environment/log/build chain | Never; dedicated test key only |
| Starting mesh code before payment gate | Visible progress | Core demo remains unproven | Never under this brief |
| Silent displacement fallback | Preserves screenshot | False GLB/mesh claim and viewer mismatch | Never silent; acceptable when explicit after three-hour cutoff |
| Solving offline mode with bulk OSM cache/custom tiles | Appears robust | Policy violation and excluded scope | Never in initial slice |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| NIP-01 signing | Trusting pubkey/tags or relay acceptance | Verify canonical ID and Schnorr signature, then strict terrDVM schema |
| NIP-90 | Treating optional/draft fields as stable business semantics | Freeze one request/result pair and versioned terrain profile in Phase 2 |
| Multi-relay subscriptions | Creating work per event callback | Dedupe by verified request event ID; persist idempotent state |
| Relay publish | Treating websocket send as stored | Inspect relay `OK`; accept identical `duplicate` as already stored; capture readback |
| LNbits | Mixing invoice key/admin key and sat/msat | Least-privileged invoice key; explicit units; confirm `success` for bound payment hash |
| Phoenixd | Accepting webhook without HMAC or external ID binding | Verify `X-Phoenix-Signature`, bind `externalId`/payment hash, confirm incoming payment |
| Bolt11 UI | Showing only QR or considering scan “paid” | Show QR plus `lightning:` link, expiry, pending state, trusted settlement result |
| Napplet SDK | Calling direct `fetch`, signer, or storage globals | Use available shell domains; test missing-domain degradation |
| Napplet build | Testing Vite dev server only | Single-file production build, current conformance CLI, real sandbox browser smoke |
| WMS 1.3.0 | Sending lon/lat with `EPSG:4326` | Use CRS-defined axis order; prefer explicit provider adapter and tested fixtures |
| WCS | Guessing subset axes/format from map bbox | Capabilities + DescribeCoverage; validate axis labels, CRS, dimensions, format, nodata |
| Rasterio/GDAL | Assuming a small window means a small transfer | Bound response bytes/pixels/time and account for source block layout |
| three.js GLTFLoader | Loading an external URL/secondary resources directly | Fetch verified bytes through shell resource; self-contained GLB; scoped object URL |
| Blossom upload | Unscoped auth token or trust in response descriptor | Scope verb/server/hash/expiry, upload, GET readback, recompute SHA-256 |
| Blossom retrieval | Treating public content address as authorization | Reveal/publish only after payment; paid local gate remains authoritative |
| strfry | Local relay starts but rejects clock-skewed events | Preflight clock, event limits, DB persistence, `OK`, and readback |
| OSM tiles | Prefetching/bypassing cache or missing attribution | Honor OSMF policy; no bulk scrape/custom tile server; verify ortho policy separately |
| Conference network | Testing components individually on office Wi-Fi | Rehearse full trace on actual laptop/payer with dependency health and fallbacks |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Degree-based bbox area | Wrong km²/pricing/caps by latitude | Geodesic or suitable projected area; explicit antimeridian policy | Immediately outside tiny local boxes |
| Pixel explosion | Small-looking bbox allocates huge raster/mesh | Compute projected width/height and pixel budget before fetch | When `ceil(width/resolution) × ceil(height/resolution)` exceeds configured budget |
| WCS block amplification | Tiny crop downloads large/full coverage | Inspect service behavior; bound bytes/time; use 10 m fallback when 5 m is slow | Blocked/unchunked or poorly configured sources |
| Full raster in RAM | Process swaps or is killed | Window/chunk processing plus hard decoded-byte and dimension caps | Any compressed source whose decoded size exceeds memory budget |
| Mesh vertex explosion | Long CPU, huge GLB, browser freeze | Derive vertex/triangle budget before processing; three-hour displacement cutoff | Resolution/bbox combination exceeds configured mesh budget |
| Oversized ortho texture | Slow upload, GPU memory pressure, mobile crash | Cap texture dimensions/bytes; downsample deterministically | Device-specific; test target conference hardware |
| Broad relay filters | Slow EOSE, duplicate flood, memory growth | Exact kinds, `#e`/`#p`, since/until, limit; close subscriptions | Busy/public relays or reconnect replay |
| Unbounded payment polling | API throttling and UI races | Backoff, jitter, deadline, one poller per invoice | Many tabs/reloads or weak conference network |
| Large single-file bundle | Slow parse/boot and conformance timeout | Audit dependencies; avoid unnecessary GIS/mesh libraries in Napplet | Built Chromium/Paja timeout on target laptop |
| Viewer on main thread | UI locks while parsing terrain | Cap artifact size, show progress, use supported worker strategy only if single-file/sandbox proven | Large GLB/texture on conference hardware |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting request `pubkey`/`p` without signature | Identity spoofing, unauthorized job | Full NIP-01 verification; requester is verified event pubkey |
| Arbitrary URL/coverage from request | SSRF, local/cloud metadata access, credential theft | Allowlist fixed provider origins and coverage identifiers |
| Wallet/admin credentials in Napplet | Theft of funds or invoice authority | Backend-only secrets; least-privileged LNbits invoice key |
| Signer private key in browser/build | Identity compromise | Shell-mediated signing; dedicated disposable dev manifest key only |
| Client-writable paid state | Free artifact retrieval | Trusted payment adapter controls monotonic state transition |
| Request-supplied webhook URL | SSRF/data exfiltration | Server-configured callbacks only; signed webhook verification |
| Unscoped Blossom token | Cross-server replay/upload/delete authority | Short expiry plus exact `t`, `server`, and `x` scope |
| Publishing hash/URL before payment | Public bypass of gate | Publish only after settlement and verified readback |
| Shared dummy content hash | Cross-job retrieval/replay | Job-specific structurally valid GLB bytes |
| Raw tags in paths/commands | Traversal/command injection | Internal IDs, fixed roots, argv arrays, no shell interpolation |
| GDAL in privileged process | Parser/driver exploit reaches secrets/files | Low-privilege isolated process, limited drivers/network/filesystem |
| Trusting extension/MIME | Polyglot or malicious driver selection | Magic/driver/schema/dimension validation, Khronos validator for GLB |
| Logging BOLT11/auth headers/keys | Secret and privacy leakage | Structured redaction; secret scan traces, docs, dist, and diffs |
| Broad local service bind | Conference LAN can reach admin interfaces | Bind privileged services to loopback/Tailscale-approved interface; expose only narrow demo routes |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| One generic “loading” state | User cannot tell relay, payment, compute, or delivery failure | Explicit requested → invoiced → paid → processing → delivered/failed/local fallback states |
| QR scan interpreted as paid | User sees delivery failure after paying or before settlement | Keep pending until trusted confirmation; show expiry and retry guidance |
| No `lightning:` link | Desktop/mobile handoff is awkward | QR plus clickable `lightning:` URI fallback |
| Swapped bbox/unclear coordinates | Wrong terrain purchased | Labeled lon/lat, editable bounds, visible area, clear/reset, pre-submit summary |
| Area shown from degree math | Misleading size/price and cap | Geodesic/projected km² with rounded display but exact server validation |
| Silent resolution downgrade | User thinks 5 m terrain was delivered | Show requested and delivered resolution plus 10 m fallback reason |
| Silent displacement fallback | User thinks a mesh GLB exists | Label heightmap/displacement mode and viewer behavior honestly |
| Blossom/local ambiguity | User cannot reproduce retrieval | Show delivery mode, hash, size, MIME, and verified status |
| Hash shown but not verified | False trust signal | Mark hash verified only after exact-byte readback and viewer load |
| “Offline-ready” marketing | Demo fails on residual network dependency | Show dependency health and precise local/degraded mode |
| Shell capability crash | Blank iframe in another host | Preflight required domains and render actionable fallback/unsupported message |
| Provider errors rendered as terrain | XML/error image appears as result | Parse and display service exception separately; never call it delivered |

## “Looks Done But Isn’t” Checklist

### Phase 1 — bbox/ortho UI

- [ ] **BBox drawing:** Draw/edit/clear works in the built single-file Napplet, not only Vite dev.
- [ ] **BBox semantics:** Canonical CRS, coordinate order, range, zero-area, antimeridian, and maximum extent are explicit and tested.
- [ ] **Area:** km² uses geodesic/projected calculation and server recomputation.
- [ ] **Ortho preview:** Exact source, license/provenance, attribution, cache, and use policy are recorded.
- [ ] **OSM use:** No bulk scraping, cache bypass, hidden attribution, or custom tile server.
- [ ] **Sandbox:** Direct fetch is absent; actual shell resource path or exact fallback works under CSP.
- [ ] **Build:** `dist` is single-file and passes current conformance plus no-capability degradation.

### Phase 2 — paid DVM dummy delivery

- [ ] **Signed request:** Canonical event ID and signature are independently verified.
- [ ] **Schema:** One documented request kind, derived result kind, versioned strict terrain profile, and fail-closed limits exist.
- [ ] **Idempotency:** Relay replay/reconnect produces one durable job and one active invoice.
- [ ] **Invoice:** Real BOLT11/LNURL fallback is bound to request ID, payment hash, amount/unit, and expiry.
- [ ] **Gate:** Unpaid, pending, failed, expired, and wrong-invoice jobs cannot retrieve bytes.
- [ ] **Settlement:** Trusted LNbits/Phoenixd state—not client callback—advances `paid`.
- [ ] **Dummy:** GLB is job-specific and passes Khronos validation.
- [ ] **Delivery:** Actual bytes are hash-verified and retrieved only after payment.
- [ ] **Trace:** Real request → invoice → payment → dummy delivery is captured with secrets redacted.
- [ ] **Negative cases:** Bad signature, bad kind, malformed bbox, oversized request, duplicate request, webhook replay, and restart are tested.

### Phase 3 — terrain processor (only after Phase 2 passes)

- [ ] **Provider contract:** WCS version, coverage ID, axis labels/order, CRS, format, nodata, and policy are pinned.
- [ ] **Bounds:** Projected dimensions, pixel/byte/time budgets, redirects, and allowed drivers are checked before allocation.
- [ ] **Isolation:** Processor has no wallet, signer, Blossom, or unrelated filesystem authority.
- [ ] **Real data:** Heightmap derives from a real bounded WCS crop; error XML/fixture bytes are never relabeled as production output.
- [ ] **Fallback:** 5 m slowness activates documented 10 m DTM; mesh exceeding three hours activates honest displacement delivery.
- [ ] **Determinism:** Artifact metadata records request ID, source/coverage, CRS, bbox, resolution, processor version, and hash.
- [ ] **Validation:** GLB passes validator or displacement package passes its own schema/browser smoke.

### Phase 4 — Blossom/viewer

- [ ] **Upload auth:** Kind-24242 token is short-lived and scoped to upload/server/hash.
- [ ] **Readback:** Descriptor, GET body, size, MIME, and SHA-256 all agree.
- [ ] **Payment privacy:** No hash/URL/result was published before settlement.
- [ ] **Viewer:** Built Napplet fetches verified bytes through the shell and loads the actual delivered artifact.
- [ ] **Nested resources:** GLB is self-contained or every secondary fetch path is explicitly proven in sandbox.
- [ ] **Fallback:** Blossom blocker over 30 minutes activates payment-gated local serving of the same verified bytes.
- [ ] **State:** `delivered` means bytes verified and viewer-loaded, not merely upload accepted.

### Conference/offline operation

- [ ] **Clock:** Laptop, relay, invoice, TLS, and auth-token time assumptions are preflighted.
- [ ] **Relay:** Local strfry persists events, returns `OK`, and readback succeeds with the actual shell routing.
- [ ] **Payment:** Actual payer-to-LNbits/Phoenixd settlement is rehearsed on the event connectivity path.
- [ ] **Providers:** WMS/WCS and ortho dependency health is checked; unresolved total-outage behavior is not hidden.
- [ ] **Processes:** DVM, payment backend, relay, local artifact server, and shell have health checks and restart instructions.
- [ ] **Fallback labels:** local artifact, 10 m DTM, displacement, and payment fallback are visible to the audience/operator.
- [ ] **No fake success:** No script or UI control can force paid/delivered without the trusted evidence chain.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong/ambiguous NIP-90 profile | MEDIUM | Stop accepting new jobs; freeze one kind/schema version; add strict migration/parser; replay captured fixtures; do not start processor |
| Duplicate invoices/jobs | MEDIUM | Disable subscription intake; reconcile by request event ID and payment hash; keep settled invoice association; add uniqueness/idempotent reducer |
| False paid transition | HIGH | Revoke artifact route/result publication if possible; reconcile wallet truth; invalidate delivery capabilities; audit logs; fix trusted transition before resuming |
| Pre-payment artifact leak | HIGH | Stop publishing/serving hash; rotate local capabilities; switch to job-specific dummy bytes; test direct unpaid access; assume leaked public Blossom blob remains public |
| Sat/msat error | HIGH | Halt invoices; decode/reconcile every issued invoice; do not auto-refund/transfer; correct unit adapter and add boundary tests |
| Sandbox/direct-fetch failure | LOW–MEDIUM | At 30 minutes use documented shell/backend path; rebuild single-file; rerun conformance and built-browser smoke |
| WMS/WCS CRS mismatch | MEDIUM | Discard artifact; inspect capabilities/coverage metadata; correct provider adapter/axis tests; rerun bounded crop before delivery |
| Raster budget overrun | MEDIUM | Kill isolated processor; preserve job as failed/retryable; activate 10 m fallback if applicable; lower budget before retry |
| Mesh timebox exceeded | LOW | Stop mesh path at three hours; emit honest heightmap/displacement package; validate and deliver under same hash/payment rules |
| Invalid GLB | MEDIUM | Do not upload/publish; validate report; regenerate from known minimal path or activate displacement fallback |
| Blossom upload/readback failure | LOW | After 30 minutes serve same verified bytes through paid local route; label local fallback; do not mark Blossom success |
| Local strfry failure | LOW–MEDIUM | Check clock/config/DB/bind/port; restore known config; verify `OK` and readback; keep public relay path out of “offline” claim |
| Conference network loss | MEDIUM–HIGH | Activate only documented local relay/local delivery fallbacks; keep payment/WCS status honest; do not fabricate settlement or processor output |
| Secret in source/dist/log | HIGH | Stop publication; rotate affected secret/key; remove artifact from distribution; scan full public diff; resume only after verified cleanup |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| NIP-90 ambiguity | Phase 2 | One request kind/profile fixture; result kind = request + 1000; strict parser tests |
| Incomplete signature validation | Phase 2 | Wrong ID/signature/pubkey/timestamp fixtures fail before job creation |
| Relay duplicate work | Phase 2 | Same event from multiple relays/restarts creates one job/invoice/result |
| False payment confirmation | Phase 2 | QR/callback/client claim cannot advance paid; wallet settlement can |
| Sat/msat and expiry races | Phase 2 | Adapter unit tests plus expired/replaced/late-payment cases |
| Pre-payment artifact leak | Phase 2, preserved in Phase 4 | Direct retrieval and hash/result query fail before payment |
| Privileged Napplet | Phase 1/2/4 | Built secret scan; no direct credentialed fetch/signing; shell capabilities only |
| Dev/prod sandbox mismatch | Phase 1, rerun every phase | Single-file `dist`, conformance, Paja/Kehto smoke, degraded-domain pass |
| WMS/WCS CRS confusion | Phase 1 then Phase 3 | Canonical bbox/area tests; provider axis/capabilities fixture; aligned real crop |
| Unbounded raster/GDAL | Phase 3 | Oversize/redirect/driver/timeout fixtures fail closed in isolated process |
| Processor-before-payment | Roadmap gate at Phase 2 | No processor implementation begins without real paid dummy trace |
| Invalid GLB | Phase 2 and Phase 3 | Khronos validator zero errors; actual GLTFLoader smoke |
| Blossom trust without readback | Phase 4 | Prehash = descriptor hash = retrieved-byte hash; viewer loads retrieved bytes |
| False offline claim | Phase 1/2/3/4 runbook | Actual conference-laptop end-to-end rehearsal and dependency report |
| Timebox/fallback drift | Every phase | Blocker timestamps; documented fallback state; three-hour mesh cutoff evidence |
| Upstream policy/license breach | Phase 1, reviewed Phase 3 | Exact 21maps/ortho/WMS/WCS provenance and policy record; no bulk scrape/custom tiles |

## Roadmap Research Flags

- **Phase 1 needs deeper research:** exact 21maps v0 source/license/provenance; exact orthophoto endpoint and terms; actual shell `resource` policy for map tiles/images/styles; antimeridian policy; built MapLibre behavior under opaque-origin single-file sandbox.
- **Phase 2 needs deeper research:** exact terrain request kind; terrDVM tag/schema profile; installed LNbits/Phoenixd version and least-privileged credential path; actual relay set; signer capability; bolt11 versus full kind-7000 UX; invoice replacement/late-payment policy.
- **Phase 3 must not be researched into implementation before Phase 2 acceptance:** after the paid dummy gate, resolve the exact WCS endpoint/version/coverage/CRS/format/nodata contract, hard byte/pixel/time budgets, and licensed bounded fixtures.
- **Phase 4 needs deeper research:** actual Blossom server BUD support, authorization/retention/CORS/redirect behavior, shell upload/resource capability, and viewer limits on target hardware.
- **Conference gap:** local strfry is documented, but total WCS outage and real Lightning settlement without usable connectivity do not have an authorized fake substitute. Resolve this explicitly in phase discussion and rehearsal; do not alter the fallback law silently.

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| NIP-01 event validity and relay responses | MEDIUM | Current official NIP inspected; relay/application policies still vary |
| NIP-90 kinds/payment semantics | MEDIUM | Current official source, but explicitly draft/unrecommended and deliberately ambiguous |
| Terrain kind availability | MEDIUM | Current official DVM kind registry inspected; absence may change later |
| LNbits/Phoenixd payment state | MEDIUM | Current official implementation source inspected; deployed versions/config remain unknown |
| Napplet sandbox/capabilities/conformance | MEDIUM | Current npm packages inspected; NIP-5D remains draft and actual installed shell is unverified |
| WMS/WCS CRS and service semantics | MEDIUM | Official OGC standards inspected; exact provider behavior remains endpoint-specific |
| Raster/GDAL security/performance | MEDIUM | Current official docs inspected; final risk depends on selected drivers/data/services |
| GLB structural validation | HIGH | Current official Khronos validator provides executable error gate |
| Blossom integrity/auth behavior | MEDIUM | Current official BUD repository inspected; BUDs are draft and server compliance varies |
| OSM tile policy | MEDIUM | Current OSMF policy inspected; orthophoto/21maps policies remain separate unknowns |
| Conference/offline prevalence | LOW | Operational synthesis; no broad current post-mortem corpus was available |

## Sources

All URLs were checked or their current repositories/packages were inspected on 2026-07-26. Confidence labels follow the GSD confidence seam and are intentionally conservative.

### Nostr and DVM

- **MEDIUM:** NIP-90, current official `nostr-protocol/nips` source at inspected commit `6d2979b3f503a8539c983efbcdcf901bbcf9ed23`: https://github.com/nostr-protocol/nips/blob/6d2979b3f503a8539c983efbcdcf901bbcf9ed23/90.md
- **MEDIUM:** NIP-01, same official commit: https://github.com/nostr-protocol/nips/blob/6d2979b3f503a8539c983efbcdcf901bbcf9ed23/01.md
- **MEDIUM:** Official DVM kind registry at inspected commit `d102c48472c739e0e94eb169c63206985a59da46`: https://github.com/nostr-protocol/data-vending-machines/tree/d102c48472c739e0e94eb169c63206985a59da46/kinds

### Lightning implementations

- **MEDIUM:** LNbits current official repository, payment API/model source at inspected commit `8723d327fe481102c39e74d4ea353e6de17c78b5`: https://github.com/lnbits/lnbits/tree/8723d327fe481102c39e74d4ea353e6de17c78b5/lnbits/core
- **MEDIUM:** Phoenixd current official repository/API source at inspected commit `c7abded8a1b6dbdfc3672a243edbd98dc24f2342`: https://github.com/ACINQ/phoenixd/tree/c7abded8a1b6dbdfc3672a243edbd98dc24f2342
- **MEDIUM:** Phoenixd official API landing page (repository-linked): https://phoenix.acinq.co/server/api

### Napplet runtime and build

- **MEDIUM:** `@napplet/sdk` 0.25.0 published package: https://www.npmjs.com/package/@napplet/sdk/v/0.25.0
- **MEDIUM:** `@napplet/vite-plugin` 0.12.0 published package: https://www.npmjs.com/package/@napplet/vite-plugin/v/0.12.0
- **MEDIUM:** `@napplet/conformance` 0.14.0 published package: https://www.npmjs.com/package/@napplet/conformance/v/0.14.0
- **MEDIUM:** `@napplet/conformance-cli` 0.2.16 published package: https://www.npmjs.com/package/@napplet/conformance-cli/v/0.2.16

### Geospatial standards and processing

- **MEDIUM:** OGC Web Map Service 1.3.0, OGC 06-042: https://docs.ogc.org/is/06-042/06-042.pdf
- **MEDIUM:** OGC Web Coverage Service 2.1 Core, OGC 17-089r1: https://docs.ogc.org/is/17-089r1/17-089r1.html
- **MEDIUM:** Rasterio 1.4.4 windowed read/write documentation: https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html
- **MEDIUM:** Rasterio reprojection documentation: https://rasterio.readthedocs.io/en/stable/topics/reproject.html
- **MEDIUM:** GDAL security considerations: https://gdal.org/en/stable/user/security.html
- **MEDIUM:** pyproj geodesic area API: https://pyproj4.github.io/pyproj/stable/api/geod.html

### Artifact and Blossom integrity

- **HIGH:** Khronos glTF Validator at inspected official commit `434283be08a668a8fb4e437145630ddbf93b0686`: https://github.com/KhronosGroup/glTF-Validator/tree/434283be08a668a8fb4e437145630ddbf93b0686
- **HIGH:** Khronos glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- **MEDIUM:** Blossom BUD-01 retrieval, BUD-02 upload, and BUD-11 authorization at inspected official repository commit `b5bd2801d1763aa635fc8fea7a76597e0eb18990`: https://github.com/hzrd149/blossom/tree/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds

### Relay and map policy

- **MEDIUM:** strfry current official source/default configuration at inspected commit `104a0846920bce188de52b5cc891746a924e04bf`: https://github.com/hoytech/strfry/tree/104a0846920bce188de52b5cc891746a924e04bf
- **MEDIUM:** OpenStreetMap Foundation tile usage policy: https://operations.osmfoundation.org/policies/tiles/

## Remaining Gaps

1. Exact terrDVM NIP-90 request kind and versioned tag schema are intentionally still open for Phase 2 discussion.
2. The exact 21maps v0 source, license, and provenance were not available in this repository.
3. The exact orthophoto and WMS/WCS endpoints, coverage IDs, CRS/axis conventions, data licenses, quotas, and CORS behavior remain unknown.
4. The installed Napplet shell/runtime capability set and exact production CSP were not exercised; only current published package behavior was verified.
5. Live LNbits/Phoenixd credentials, wallet route/liquidity, callback configuration, and deployed versions were not inspected.
6. The target Blossom server’s implemented BUD subset, authorization policy, retention, redirects, and CORS behavior remain unknown.
7. Full offline operation is not currently proven: local strfry and local artifact serving are defined, while real Lightning settlement and live WCS access may still require connectivity.
8. Broad current web search was unavailable, so claims about prevalence across third-party demos remain LOW confidence; the failure mechanisms themselves are grounded in official sources.

---
*Pitfalls research for: terrDVM paid Nostr terrain/GIS Data Vending Machine demo*
*Researched: 2026-07-26*
