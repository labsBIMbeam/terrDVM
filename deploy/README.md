# deploy — the corpus stack

VS-1 of [VERTICAL-SLICE.md](../.planning/VERTICAL-SLICE.md): one compose file bringing up
the three services of the public corpus path.

| Service | Role | Port |
|---|---|---|
| `strfry` | Announcements. Write policy accepts the crawler pubkey **only** | 7777 |
| `blossom-server` (hzrd149, pinned 6.2.0) | Owns blob bytes. Upload allowlisted to the crawler pubkey via `requirePubkeyInRule` | 3000 |
| `blossom-gis` | Spatial index + crawler HTTP side. Blob ownership migrated to blossom-server | 8787 |

Both write paths enforce the same trust model: **the crawler key is the only writer of the
corpus**. Reads are public — events by filter, bytes by hash.

## Bring-up

```bash
cd deploy
cp .env.example .env        # set CRAWLER_PUBKEY (the PUBLIC key, 64 hex)
node render-config.mjs      # writes .local/blossom-server.config.yml (gitignored)
docker compose up -d --build
node verify-stack.mjs       # VS-1 exit conditions
```

`verify-stack.mjs` checks the two VS-1 observables plus one liveness probe:

1. A `REQ` against `ws://127.0.0.1:7777` answers `EOSE`.
2. `HEAD /<64 hex>` on blossom-server answers a well-formed `404` — a Blossom route,
   not a router error.
3. `GET /` on blossom-gis answers `200`.

`probe-write-policy.mjs` proves the trust model live rather than by configuration
review: an event signed by the crawler key gets `OK true`, the same shape signed by a
throwaway key gets `OK false` with the policy's `blocked:` message. It reads the
crawler secret from `deploy/.local/dev-crawler.secret` (override:
`CRAWLER_SECRET_FILE`) and signs locally — only signatures cross the wire. This is
VS-3's "write path closed" observable, runnable from day one.

Override targets with `RELAY_URL` / `BLOSSOM_URL` / `GIS_URL` when probing a remote host.

## Key handling

The stack never holds a private key. `CRAWLER_PUBKEY` in `.env` is the *public* key; the
secret stays with the operator and is used by the crawler CLI to sign kind-24242 uploads
and kind-30550/30551 announcements locally (AGENTS.md safety rules). Committing any
`.env` is blocked by `.gitignore`; the committed template carries only `__TOKENS__`.

## Target host: alflx, with TLS in front (risk R3)

The compose file is host-agnostic; alflx is the intended home. A shell served over
`https` refuses plain `ws://` and `http://`, so front both public services with TLS on
the tailnet before any real-shell client test:

```bash
tailscale serve --bg --tcp 7777 tcp://127.0.0.1:7777     # or an HTTPS proxy per service:
tailscale serve --bg --https=8443 http://127.0.0.1:3000
```

(Exact `tailscale serve` syntax varies by version — the requirement is: `wss://` for
strfry, `https://` for blossom-server/blossom-gis, certificates from the tailnet. Record
the chosen front in this file when it lands; VS-1 is not closed on alflx without it.)

Migration from a local proof run: `docker compose down`, move the named volumes (or
re-crawl — the corpus is reproducible by design), `docker compose up -d --build` on alflx,
re-run `verify-stack.mjs` against the tailnet URLs.

## Iteration notes

Pinned images: `dockurr/strfry:1.1.1`, `ghcr.io/hzrd149/blossom-server:6.2.0`.

**Confirmed at first bring-up (2026-08-02, WSL2 docker):** the blossom-server config
schema in `config.template.yml` and the `/app/config.yml` mount path are correct — the
booted server logs `storage rules active (1 rules …)` and BUD-11 auth required, and the
container's `/app/config.yml` shows the rendered pubkey. strfry loads `/etc/strfry.conf`
and the python3 plugin runs in the `dockurr/strfry` (alpine) image.

**WSL2 quirk:** the WSL VM idles out between interactions; the next `wsl` call revives
it and docker's `restart: unless-stopped` brings all three containers back within
seconds. Probes that hit a dead socket mean the VM is waking — `docker compose up -d`
first, then probe. Irrelevant on alflx.
