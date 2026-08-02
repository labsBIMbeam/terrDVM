# European orthophoto sources

> Elevation is surveyed separately in [`ELEVATION-SOURCES.md`](ELEVATION-SOURCES.md).
> Different question, different answer: an orthophoto service says nothing
> about whether the same authority publishes a bare-earth DTM.


Survey of aerial-imagery services at architectural resolution (≤0.30 m/px),
researched 2026-07-29 for filling the gaps the z7 coverage sweep measured:
Esri's z19 is city-centric, and only 43 of 218 European land cells qualify.

**Verification status matters.** `[V]` means confirmed against official
documentation or a live request; `[S]` means secondary sources — verify with
one `source_check.probe` request before adding to a region. DROTe (Madeira)
has already been probed live and promoted into `texture.py`.

## Already qualified in this repo

swisstopo (CH), Luxembourg Ortho (CC0), PDOK Luchtfoto (NL), Esri World
Imagery (global fallback), DGT OrtoSat (PT mainland), IGN PNOA (ES), IGN BD
ORTHO (FR), Geobasis NRW (DE-NW), IRIG Südtirol (CC0), **DROTe RAM 2023
(Madeira incl. Porto Santo, 10 cm)** `[V]`.

## Best free additions, by gap filled

| Source | Fills | Resolution | Access | Licence | Status |
|---|---|---|---|---|---|
| basemap.at Orthofoto | AT, complete | 29 cm / 15 cm urban | WMTS/XYZ `mapsneu.wien.gv.at` | CC-BY 4.0 | `[V]` |
| GUGiK Ortofotomapa | PL, complete | 25 cm, cities 5–10 cm | WMTS/WMS `mapy.geoportal.gov.pl` | open by statute (2020) | `[V]` |
| ČÚZK Ortofoto | CZ, complete | 12.5–20 cm | WMTS `ags.cuzk.gov.cz` | CC-BY 4.0 | `[V]` |
| GKÚ Ortofotomozaika | SK, complete | 20–25 cm | WMS `zbgisws.skgeodesy.sk` | CC-BY 4.0 | `[V]` |
| GeoDanmark Ortofoto | DK, complete | 10–12.5 cm | WMTS via Datafordeler (free token) | open, attribution | `[V]` |
| Lantmäteriet Ortofoto | SE, complete | 16 cm south, 25–50 cm north | STAC/COG download + WMS | **CC0** | `[V]` |
| Digitaal Vlaanderen | BE-VL | 10–15 cm | WMTS `geo.api.vlaanderen.be` | Open Data Licentie | `[V]` |
| SPW Ortho | BE-WA | 25 cm | WMS geoportail.wallonie.be | CC-BY 4.0 | `[V]` |
| GURS DOF025 | SI, complete | 25 cm | WMS e-prostor | CC-BY 4.0 | `[V]` |
| Maa-amet | EE, complete | 10–40 cm | WMS `kaart.maaamet.ee` | free w/ attribution | `[V]` |
| LĢIA Ortofoto | LV, complete | 25 cm | WMTS `wms.lgia.gov.lv` | open data | `[V/S]` |
| German Länder DOP20 | DE beyond NRW | 20 cm | per-Land WMS (BY, NI, BE, RP, BW `[V]`; BB, HE, HH, SN, TH, ST, SH, SL, MV `[S]`) | CC-BY / dl-de/by-2-0 / HE: dl-de/zero | mixed |

All of the above permit server-side storage and redistribution with
attribution — compatible with the Blossom store, provided the attribution
travels as per-blob metadata.

## Remaining gaps and the honest options

- **NO** — Norge i bilder is Norge-digitalt-partner-only; commercial use needs
  Kartverket approval. Do not crawl. `[V]`
- **IE** — Tailte Éireann orthos are proprietary; no open service. `[V]`
- **UK** — APGB imagery is public-sector-only; private licences via
  Bluesky/Getmapping. `[V]`
- **IT beyond Südtirol** — regional WMS are reachable but licences are
  inconsistent: Emilia-Romagna is CC-BY, Piemonte's AGEA record says "tutti i
  diritti riservati", old Lombardia is CC-BY-**NC**-SA. Only add regions with
  an explicit CC-BY record. `[V]`
- **FI, LT** — open, but 0.5 m: below the architectural bar. `[V]`
- **RO, GR, HU** — no usable open service found. `[S]`

For those, the commercial shortlist ordered by fit for *rural* coverage:

1. **Hexagon HxGN Content Program** — aerial 30 cm across large parts of
   Europe, 15 cm cities; WMS/WMTS plus a download product, AOI-year
   subscription. Storage rights are negotiable because download is a listed
   product. `[V]`
2. **Vexcel Data Program** — 20 cm wide-area across Western Europe, 7.5 cm
   urban; subscription; redistribution must be negotiated explicitly. `[V]`
3. **Maxar Vivid / Airbus OneAtlas** — satellite 30–50 cm, truly everywhere,
   but streaming licences prohibit persistent storage by default; useful for
   single AOIs, not for the store. `[V]`

## Licence traps

1. **Google Map Tiles, Mapbox, Azure Maps: storing tiles is prohibited by
   ToS.** Content-addressed persistence in Blossom would be a breach, not a
   grey area. Azure additionally stops at z19 — no gain over Esri. `[V]`
2. **Esri World Imagery — the current fallback — is itself a grey area for
   persistent rehosting.** The source policy's own terms say "no bulk
   prefetch or scraping"; per-selection texture bakes are defensible,
   crawling tiles into the corpus is not. Prefer the open national services
   above wherever one covers the region.
3. **BKG's federal DOP20 WMS is paid for third parties** despite the
   "open data" rhetoric — use the individual Länder services.
4. **Attribution is infectious.** CC-BY, dl-de/by-2-0 and OGD-AT all require
   attribution on redistribution. The store must carry attribution as per-blob
   metadata or redistribution silently voids the licence.
5. **Estonia's services are currently "unlicensed"** — usable, but record the
   retrieval date and terms; this can change.
6. **DROTe (Madeira)** is free with mandatory "© DROTe" attribution but not a
   standard CC licence; redistribution terms are unconfirmed — ask before
   serving the bakes publicly.

## Suggested next steps

Each addition is one `TextureSource` entry plus one `source_check.probe`
verification — clerical, not architectural. Priority by coverage gained:
basemap.at (AT), GUGiK (PL), ČÚZK (CZ), Lantmäteriet (SE, CC0 — fetch COGs
via STAC rather than crawling the WMS), then the German Länder one by one.
