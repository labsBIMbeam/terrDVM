# AGENTS.md — terrDVM

## Project root

This repository is the canonical project root for terrDVM. Run GSD and all project-scoped Hermes sessions from this directory. Do not create `.planning/` in a parent workspace or in PalaceOfCulture.

## Authoritative brief

Read `docs/PROJECT-BRIEF.md` before discussing, planning, implementing, reviewing, or shipping.

## Core invariant

The vertical-slice order is fixed:

```text
bbox/ortho UI → paid DVM dummy delivery → terrain processor → Blossom/viewer
```

Never start the terrain mesh processor before the invoice/payment/dummy-delivery loop works.

## Safety and scope

- Public repository: never commit credentials, private keys, invoices containing secrets, production URLs with embedded tokens, or captured authorization headers.
- Keep LNbits/Phoenixd, relay signer, Blossom auth, WCS credentials, and NIP-46 material local.
- Do not add FIPS, Freenet, bridges, a custom tile server, or Palace coupling to the initial slice.
- Any blocker over 30 minutes takes the documented fallback.
- Mesh work is time-boxed to 3 hours before displacement fallback.
- External paid calls and public publication require explicit approval.

## Engineering

- Use GSD for discuss → plan → execute → verify.
- Use TDD for protocol/job-state/payment gates.
- Keep app truth separate from Nostr, Lightning, raster, and Blossom adapters.
- Validate bounds, CRS, raster size, path safety, subprocess arguments, artifact hashes, and payment state fail-closed.
- Produce real executable evidence; never use fake processor output under a production artifact extension.
