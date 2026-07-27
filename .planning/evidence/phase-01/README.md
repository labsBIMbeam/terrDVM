# Phase 01 Evidence Conventions

Everything in this directory is committed to a public repository.

- Never record credentials, private keys, tokens, authorization headers, captured invoices containing secrets, or token-bearing URLs.
- Replace every sensitive value with the literal marker `[REDACTED]` before commit.
- Keep evidence truthful: an unavailable result stays unavailable, and an unused fallback is not represented by a fake activation.
- Once the Plan 02 secret scanner exists, rescan the evidence reports themselves as part of every recurring secret/public-diff gate.
