# terrDVM

Public, local-first demo of a paid terrain Data Vending Machine:

```text
select bbox → preview ortho → submit job → receive invoice
→ pay → receive terrain artifact → inspect in browser
```

The demo core is **payment plus delivery**. Terrain mesh quality is secondary and must never block the paid job loop.

## Status

Greenfield project prepared for GSD planning. The authoritative product and execution brief is [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md).

## Start with Hermes GSD

Run Hermes from this repository root, then use:

```text
/gsd_new_project --auto @docs/PROJECT-BRIEF.md
/gsd_next
```

On Telegram, Hermes skill commands use underscores because Telegram command names do not support hyphens.

## Reference

GeoLibre is an optional upstream design/implementation reference only: <https://github.com/opengeos/geolibre>. terrDVM remains an independent, narrowly scoped Napplet/DVM project.
