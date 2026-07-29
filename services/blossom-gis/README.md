# blossom-gis

A GIS-grade [Blossom](https://github.com/hzrd149/blossom) blob server: content-addressed
storage with a real spatial index, plus the Nostr geo-announcement layer that makes blobs
discoverable through ordinary relays.

## Why the split

Blossom is **content-addressed blob storage**, not a geo database. A Blossom server has no
concept of a bounding box, and a "geo relay" is not a thing that exists in the protocol.
So this service separates the two concerns:

| Concern | Where it lives | Why |
|---|---|---|
| Blob bytes | This server, keyed by SHA-256 | Content addressing gives dedup, cache immutability, and free integrity checks |
| Exact spatial query | This server, `GET /geo` | Indexed bbox columns give a true overlap test |
| Public discovery | Any NIP-01 relay, via `g` tags | Relays match tags exactly; geohash prefixes turn that into a coarse geo index |

**There is deliberately no custom relay in this repo.** A relay only needs generic tag
indexing to serve as the geo index, and [strfry](https://github.com/hoytech/strfry)
already does that well — it is also the relay the project roadmap already names as the
local fallback (OPS-02). Writing another NIP-01 implementation would add risk without
adding capability. See [Relay setup](#relay-setup).

## Chunking: index tiles, not requests

Content addressing only pays off when chunk boundaries are deterministic. A blob shaped
like one user's bounding box is unique to that request and will never be requested again.
A blob shaped like a **slippy tile** (`z/x/y`) sits on a globally agreed grid, so every
overlapping job hits the same hash — one upload, unlimited cache hits, automatic dedup.

Store tiles. Derive bounding boxes.

## Endpoints

### Blossom (BUD-01 / BUD-02 subset)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/<sha256>[.ext]` | Serves the blob. Supports `Range`. |
| `HEAD` | `/<sha256>[.ext]` | Metadata only. |
| `PUT` | `/upload` | Requires a kind-24242 authorization event. |
| `GET` | `/list/<pubkey>` | Blobs uploaded by a pubkey. |
| `DELETE` | `/<sha256>` | Uploader only, kind-24242 authorized. |

Authorization is `Authorization: Nostr <base64 event>`. The event must be kind 24242, carry
a `t` tag matching the verb, exactly one future `expiration` tag, and — for upload and
delete — an `x` tag matching the blob hash. Every check fails closed.

### GIS extensions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/geo?bbox=w,s,e,n` | Exact overlap query against indexed footprints. |
| `GET` | `/tile/<z>/<x>/<y>` | Blobs bound to a slippy tile. |

Geo metadata is attached at upload time:

```
X-Geo-BBox: -17.05,32.70,-16.95,32.78
X-Geo-Tile: 11/927/826
```

Either header alone is enough — a tile implies its bounding box, and a bounding box is
bound to the zoom-14 tile containing its centre. Retrieval echoes `X-Geo-BBox` and
`X-Geo-Geohash`.

`Range` support is not decoration: it is what makes partial reads of cloud-optimised
rasters possible without downloading the whole file.

## Running

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
uv run uvicorn blossom_gis.app:app --port 8787
```

Configuration is environment-only:

| Variable | Default | Meaning |
|---|---|---|
| `BLOSSOM_GIS_DATA` | `./.local/blossom-gis` | Blob and index root |
| `BLOSSOM_GIS_BASE_URL` | `http://127.0.0.1:8787` | Base for descriptor URLs |
| `BLOSSOM_GIS_MAX_UPLOAD_BYTES` | `67108864` | Upload ceiling |

## Tests

```bash
uv run pytest
uv run ruff check .
```

The BIP-340 implementation is verified against the specification's own test vectors. It
**verifies only** — this service never holds a private key, and announcement events are
returned unsigned for the caller to sign with their own signer.

## Relay setup

Announcements are NIP-94 (kind 1063) events carrying `x` (hash), `url`, `m`, `size`, an
exact `bbox` tag, and one `g` tag per geohash precision level. Query a coarse cell with a
short prefix, a fine cell with a long one:

```jsonc
{ "kinds": [1063], "#g": ["etgfm"], "limit": 500 }
```

Because relays match tags exactly and not geometrically, a `#g` query returns a
**superset**. Clients must refine against the `bbox` tag — `bbox_from_tags()` does this.

Run strfry with generic tag indexing enabled (the default) and no protocol changes are
needed. For the project's local-relay fallback mode, point the publisher at
`ws://127.0.0.1:7777` and record the active relay mode in the trace evidence per OPS-02.

## Security notes

- The blob hash is validated as 64 lowercase hex characters before any path is built, so
  a request cannot traverse out of the blob root.
- Uploads are written to a temporary file and atomically renamed, so a crash can never
  leave truncated bytes at a valid hash path.
- Deletion is restricted to the original uploader.
- No credentials, keys, or signer material belong in this repository.

## Crawler

The crawler is the collection side: it walks a region tile by tile, encodes each
tile with the shared binary codec, and stores it content-addressed.

```bash
python -m blossom_gis.cli seed   --region madeira --zoom 13
python -m blossom_gis.cli run    --region madeira --max-tiles 5
python -m blossom_gis.cli status --region madeira
```

`run` is **bounded by design**. It processes at most `--max-tiles`, spaces
requests by `--min-interval` seconds, and checks the upstream slot count before
every fetch — if none is free it stops cleanly rather than queueing into a
timeout. Progress lives in SQLite, so it is fully resumable: kill it anywhere
and the next run continues.

Failures are retried up to four times, after which the tile is marked exhausted
so one bad tile can never block the queue.

### Scheduling

Nothing here needs a long-running process. Run it on a timer:

**Windows Task Scheduler**

```powershell
schtasks /Create /TN "terrdvm-crawl-madeira" /SC MINUTE /MO 10 ^
  /TR "G:\Github\terrDVM\services\blossom-gis\.venv\Scripts\python.exe -m blossom_gis.cli run --region madeira --max-tiles 5"
```

**cron**

```cron
*/10 * * * * cd /srv/blossom-gis && .venv/bin/python -m blossom_gis.cli run --region madeira --max-tiles 5
```

At five tiles per ten minutes a z13 region fills in gradually without ever
drawing attention from the upstream. Raise `--max-tiles` only if you run your
own Overpass instance.
