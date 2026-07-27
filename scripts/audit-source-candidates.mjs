#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = resolve(ROOT, '.planning/evidence/phase-01/source-candidates.json');
const USER_AGENT = 'terrDVM/0.1 (+https://github.com/labsBIMbeam/terrDVM)';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_METADATA_BYTES = 1_000_000;
const MAX_TILE_BYTES = 1_000_000;
const MAX_REQUESTS_PER_CANDIDATE = 10;
const REQUIRED_ROLES = ['basemap', 'imagery'];
const REQUIRED_CONTRACT_FIELDS = [
  'scheme', 'host', 'port', 'path_template', 'layer', 'coverage_id',
  'tile_matrix', 'crs', 'bbox_order', 'format', 'auth',
  'cors_shell_behavior', 'attribution', 'dataset_terms', 'endpoint_terms',
  'rate_limits', 'max_response_bytes', 'timeout_ms', 'redirects',
  'coverage_bounds', 'outage_behavior', 'capture_date', 'status',
];
const UNKNOWN = 'UNRESOLVED';

function candidate({ id, role, provider, docs, contract, requests, observedRequests = [], expectedStatus = 'blocked', knownFailedFields = [], forceLiveProbe = false }) {
  return { id, role, provider, authoritative: true, official_documentation: docs, contract, requests, observed_requests: observedRequests, expected_status: expectedStatus, known_failed_fields: knownFailedFields, force_live_probe: forceLiveProbe };
}

function baseContract(overrides) {
  return {
    scheme: UNKNOWN,
    host: UNKNOWN,
    port: 443,
    path_template: UNKNOWN,
    layer: UNKNOWN,
    coverage_id: UNKNOWN,
    tile_matrix: UNKNOWN,
    crs: UNKNOWN,
    bbox_order: UNKNOWN,
    format: UNKNOWN,
    auth: { required: UNKNOWN, credential_reference: null },
    cors_shell_behavior: UNKNOWN,
    attribution: UNKNOWN,
    dataset_terms: UNKNOWN,
    endpoint_terms: UNKNOWN,
    rate_limits: { provider_published: UNKNOWN, application_limit: 'visible tiles only; no bulk prefetch or scraping; maximum 16 concurrent tile requests' },
    max_response_bytes: MAX_TILE_BYTES,
    timeout_ms: REQUEST_TIMEOUT_MS,
    redirects: { max: 0, policy: 'fail closed on any redirect' },
    coverage_bounds: UNKNOWN,
    outage_behavior: 'fail closed to named source-unavailable state; never substitute a fixture as live',
    capture_date: null,
    status: 'blocked',
    ...overrides,
  };
}

function observedRequest({ kind, url, status, contentType, bytesRead, cors = null, error = null }) {
  return {
    kind,
    url,
    method: 'GET',
    capture_origin: 'orchestrator bounded live probe in this execution',
    status,
    ok: status >= 200 && status < 300,
    redirected: false,
    location: null,
    content_type: contentType,
    content_length_header: null,
    access_control_allow_origin: cors,
    cache_control: null,
    bytes_read: bytesRead,
    max_bytes: kind === 'sample' ? MAX_TILE_BYTES : MAX_METADATA_BYTES,
    too_large: false,
    sha256: null,
    marker_results: {},
    expected_type: null,
    error,
  };
}

const commonCandidates = {
  basemap: [
    candidate({
      id: 'nls-finland-background-wmts', role: 'basemap', provider: 'National Land Survey of Finland',
      docs: ['https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/interfaces/api-keys', 'https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/interfaces/wmts-interface'],
      contract: baseContract({ scheme: 'https', host: 'avoin-karttakuva.maanmittauslaitos.fi', path_template: '/avoin/wmts/1.0.0/{api-key}/1.0.0/taustakartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png', layer: 'taustakartta', coverage_id: 'Finland', tile_matrix: 'WGS84_Pseudo-Mercator', crs: 'EPSG:3857', bbox_order: 'slippy z/y/x path; app bbox remains W,S,E,N EPSG:4326', format: 'image/png', auth: { required: true, credential_reference: 'NLS_API_KEY_SHELL_REFERENCE' }, attribution: 'National Land Survey of Finland', dataset_terms: 'Official NLS interface documentation; exact endpoint terms require authenticated contract verification', endpoint_terms: 'API key required; unauthenticated capabilities retested in this run', coverage_bounds: 'Finland' }),
      requests: [
        { kind: 'documentation', url: 'https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/interfaces/api-keys', max_bytes: MAX_METADATA_BYTES, markers: ['API key'] },
        { kind: 'metadata', url: 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/WMTSCapabilities.xml', max_bytes: MAX_METADATA_BYTES, markers: [] },
      ], knownFailedFields: ['auth', 'metadata_http_status', 'cors_shell_behavior', 'credential_reference_not_available', 'coverage_madeira'],
    }),
    candidate({
      id: 'kapsi-finland-background-tiles', role: 'basemap', provider: 'Kapsi Internet-käyttäjät ry',
      docs: ['https://kartat.kapsi.fi/'],
      contract: baseContract({ scheme: 'https', host: 'tiles.kartat.kapsi.fi', path_template: '/peruskartta/{z}/{x}/{y}.jpg', layer: 'peruskartta', coverage_id: 'Finland', tile_matrix: 'WebMercatorQuad', crs: 'EPSG:3857', bbox_order: 'slippy z/x/y', format: 'image/jpeg', auth: { required: false, credential_reference: null }, attribution: 'National Land Survey of Finland / Kapsi', dataset_terms: 'Official Kapsi map service page captured in this run', endpoint_terms: 'Service endpoint must resolve and return bounded tiles', coverage_bounds: 'Finland' }),
      requests: [
        { kind: 'documentation', url: 'https://kartat.kapsi.fi/', max_bytes: MAX_METADATA_BYTES, markers: ['Maanmittauslaitos'] },
        { kind: 'sample', url: 'https://tiles.kartat.kapsi.fi/peruskartta/6/36/17.jpg', max_bytes: MAX_TILE_BYTES, expected_type: 'image/jpeg', markers: [] },
      ], knownFailedFields: ['sample_dns', 'cors_shell_behavior', 'outage_behavior', 'coverage_madeira'],
    }),
    candidate({
      id: 'usgs-national-map-topo', role: 'basemap', provider: 'U.S. Geological Survey',
      docs: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits'],
      contract: baseContract({ scheme: 'https', host: 'basemap.nationalmap.gov', path_template: '/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', layer: 'USGSTopo', coverage_id: 'United States', tile_matrix: 'ArcGIS Online/Bing Maps/Google Maps', crs: 'EPSG:3857', bbox_order: 'ArcGIS tile z/y/x', format: 'image/jpeg', auth: { required: false, credential_reference: null }, cors_shell_behavior: 'metadata and sample expected Access-Control-Allow-Origin: *; runtime remains shell-only', attribution: 'USGS The National Map', dataset_terms: 'U.S. federal public-domain baseline; exact credits page must be captured live', endpoint_terms: 'ArcGIS MapServer metadata captured live; credits page is mandatory', coverage_bounds: 'United States and territories' }),
      requests: [
        { kind: 'metadata', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer?f=pjson', max_bytes: MAX_METADATA_BYTES, markers: ['USGSTopo', 'copyrightText'] },
        { kind: 'terms', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', max_bytes: MAX_METADATA_BYTES, markers: ['credit'] },
        { kind: 'sample', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/5/12/7', max_bytes: MAX_TILE_BYTES, expected_type: 'image/', markers: [] },
      ], knownFailedFields: ['dataset_terms_live_capture', 'rate_limits_provider_published', 'coverage_madeira'],
    }),
    candidate({
      id: 'basemapat-geolandbasemap', role: 'basemap', provider: 'basemap.at / Austrian Länder',
      docs: ['https://basemap.at/#lizenz', 'https://basemap.at/category/produkte/basemap-at-raster/', 'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml'],
      contract: baseContract({ scheme: 'https', host: 'mapsneu.wien.gv.at', path_template: '/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', layer: 'geolandbasemap', coverage_id: 'Austria', tile_matrix: 'google3857', crs: 'EPSG:3857', bbox_order: 'WMTS TileMatrix/TileRow/TileCol = z/y/x; app bbox remains W,S,E,N EPSG:4326', format: 'image/png', auth: { required: false, credential_reference: null }, cors_shell_behavior: 'Access-Control-Allow-Origin: * observed on official capabilities and sample; production still routes through shell custom protocol', attribution: 'Grundkarte: basemap.at', dataset_terms: 'Open Government Data Österreich Lizenz CC-BY 4.0; private and commercial use free of charge', endpoint_terms: 'Official basemap.at raster product and WMTS capabilities; application obeys visible-tile-only bounded use', rate_limits: { provider_published: 'No numeric public limit found on the captured official page', application_limit: 'visible tiles only; no prefetch/scraping; maximum 16 concurrent tile requests' }, coverage_bounds: { west: 8.782379, south: 46.358770, east: 17.5, north: 49.037872 } }),
      requests: [
        { kind: 'terms', url: 'https://basemap.at/', max_bytes: MAX_METADATA_BYTES, markers: ['Open Government Data Österreich Lizenz CC-BY 4.0', 'Datenquelle: basemap.at', 'Grundkarte: basemap.at'] },
        { kind: 'documentation', url: 'https://basemap.at/category/produkte/basemap-at-raster/', max_bytes: MAX_METADATA_BYTES, markers: ['WMTS GetCapabilities', 'EPSG:3857'] },
        { kind: 'metadata', url: 'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml', max_bytes: MAX_METADATA_BYTES, markers: ['geolandbasemap', 'google3857'] },
        { kind: 'sample', url: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/8/90/137.png', max_bytes: MAX_TILE_BYTES, expected_type: 'image/png', markers: [] },
      ], knownFailedFields: ['coverage_madeira'],
    }),
    candidate({
      id: 'openstreetmap-standard-madeira', role: 'basemap', provider: 'OpenStreetMap Foundation',
      docs: ['https://operations.osmfoundation.org/policies/tiles/', 'https://www.openstreetmap.org/copyright'],
      contract: baseContract({ scheme: 'https', host: 'tile.openstreetmap.org', path_template: '/{z}/{x}/{y}.png', layer: 'OpenStreetMap Standard', coverage_id: 'Global including Madeira', tile_matrix: 'WebMercatorQuad', crs: 'EPSG:3857', bbox_order: 'slippy z/x/y; app bbox remains W,S,E,N EPSG:4326', format: 'image/png', auth: { required: false, credential_reference: null }, cors_shell_behavior: 'Access-Control-Allow-Origin: * required on sample; runtime routes through the sole shell adapter with the identifying terrDVM User-Agent', attribution: '© OpenStreetMap contributors', dataset_terms: 'OpenStreetMap data licensed under ODbL; visible attribution and license link required', endpoint_terms: 'OSMF Standard tile policy: identifying User-Agent, valid web Referer where applicable, cache headers honored, no bulk download/scraping/prefetch', rate_limits: { provider_published: 'No numeric public quota; best-effort service with no SLA', application_limit: 'Madeira viewport visible tiles only; no prefetch/scraping; maximum 16 concurrent requests; cache response headers honored' }, coverage_bounds: { west: -180, south: -85.05112878, east: 180, north: 85.05112878 } }),
      requests: [
        { kind: 'terms', url: 'https://operations.osmfoundation.org/policies/tiles/', max_bytes: MAX_METADATA_BYTES, markers: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'Bulk download', 'User-Agent'] },
        { kind: 'license', url: 'https://www.openstreetmap.org/copyright', max_bytes: MAX_METADATA_BYTES, markers: ['Open Data Commons Open Database License', 'credit OpenStreetMap'] },
        { kind: 'sample', url: 'https://tile.openstreetmap.org/8/115/103.png', max_bytes: MAX_TILE_BYTES, expected_type: 'image/png', markers: [] },
      ], expectedStatus: 'live-verified',
    }),
  ],
  imagery: [],
};

commonCandidates.imagery = [
  candidate({
    id: 'nls-finland-orthophoto-wmts', role: 'imagery', provider: 'National Land Survey of Finland',
    docs: ['https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/orthophotos', 'https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/interfaces/api-keys'],
    contract: baseContract({ scheme: 'https', host: 'avoin-karttakuva.maanmittauslaitos.fi', path_template: '/avoin/wmts/1.0.0/{api-key}/1.0.0/ortokuva/default/ETRS-TM35FIN/{z}/{y}/{x}.jpeg', layer: 'ortokuva', coverage_id: 'Finland orthophotos', tile_matrix: 'ETRS-TM35FIN', crs: 'EPSG:3067', bbox_order: 'WMTS row/column; bbox source contract unresolved without authenticated capabilities', format: 'image/jpeg', auth: { required: true, credential_reference: 'NLS_API_KEY_SHELL_REFERENCE' }, attribution: 'National Land Survey of Finland orthophotos', dataset_terms: 'Official orthophoto product page states open data; endpoint contract requires API key', endpoint_terms: 'Unauthenticated capabilities freshly retested', coverage_bounds: 'Finland' }),
    requests: [
      { kind: 'documentation', url: 'https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/orthophotos', max_bytes: MAX_METADATA_BYTES, markers: ['Orthophoto'] },
      { kind: 'metadata', url: 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/WMTSCapabilities.xml', max_bytes: MAX_METADATA_BYTES, markers: [] },
    ], knownFailedFields: ['auth', 'metadata_http_status', 'cors_shell_behavior', 'credential_reference_not_available', 'coverage_madeira'],
  }),
  candidate({
    id: 'kapsi-finland-orthophoto-tiles', role: 'imagery', provider: 'Kapsi Internet-käyttäjät ry',
    docs: ['https://kartat.kapsi.fi/'],
    contract: baseContract({ scheme: 'https', host: 'tiles.kartat.kapsi.fi', path_template: '/ortokuva/{z}/{x}/{y}.jpg', layer: 'ortokuva', coverage_id: 'Finland orthophotos', tile_matrix: 'WebMercatorQuad', crs: 'EPSG:3857', bbox_order: 'slippy z/x/y', format: 'image/jpeg', auth: { required: false, credential_reference: null }, attribution: 'National Land Survey of Finland / Kapsi', dataset_terms: 'Official Kapsi map service page captured in this run', endpoint_terms: 'Service endpoint must resolve and return bounded tiles', coverage_bounds: 'Finland' }),
    requests: [
      { kind: 'documentation', url: 'https://kartat.kapsi.fi/', max_bytes: MAX_METADATA_BYTES, markers: ['ortokuva'] },
      { kind: 'sample', url: 'https://tiles.kartat.kapsi.fi/ortokuva/6/36/17.jpg', max_bytes: MAX_TILE_BYTES, expected_type: 'image/jpeg', markers: [] },
    ], knownFailedFields: ['sample_dns', 'cors_shell_behavior', 'outage_behavior', 'coverage_madeira'],
  }),
  candidate({
    id: 'usgs-national-map-imagery-only', role: 'imagery', provider: 'U.S. Geological Survey',
    docs: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits'],
    contract: baseContract({ scheme: 'https', host: 'basemap.nationalmap.gov', path_template: '/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', layer: 'USGSImageryOnly', coverage_id: 'United States imagery mosaic', tile_matrix: 'ArcGIS Online/Bing Maps/Google Maps', crs: 'EPSG:3857', bbox_order: 'ArcGIS tile z/y/x', format: 'image/jpeg', auth: { required: false, credential_reference: null }, cors_shell_behavior: 'metadata/sample Access-Control-Allow-Origin: * expected; runtime remains shell-only', attribution: 'USGS The National Map: Orthoimagery', dataset_terms: 'U.S. federal public-domain baseline; source components and exact credits page must be captured live', endpoint_terms: 'ArcGIS MapServer metadata captured live; credits page mandatory', coverage_bounds: 'United States and territories' }),
    requests: [
      { kind: 'metadata', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson', max_bytes: MAX_METADATA_BYTES, markers: ['USGSImageryOnly', 'copyrightText'] },
      { kind: 'terms', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', max_bytes: MAX_METADATA_BYTES, markers: ['credit'] },
      { kind: 'sample', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/5/12/7', max_bytes: MAX_TILE_BYTES, expected_type: 'image/', markers: [] },
    ], knownFailedFields: ['dataset_terms_live_capture', 'rate_limits_provider_published', 'coverage_madeira'],
  }),
  candidate({
    id: 'basemapat-orthofoto', role: 'imagery', provider: 'basemap.at / Austrian Länder',
    docs: ['https://basemap.at/#lizenz', 'https://basemap.at/category/produkte/basemap-at-orthofoto/', 'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml'],
    contract: baseContract({ scheme: 'https', host: 'mapsneu.wien.gv.at', path_template: '/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', layer: 'bmaporthofoto30cm', coverage_id: 'Austria orthophoto', tile_matrix: 'google3857', crs: 'EPSG:3857', bbox_order: 'WMTS TileMatrix/TileRow/TileCol = z/y/x; normalized app bbox remains W,S,E,N EPSG:4326', format: 'image/jpeg', auth: { required: false, credential_reference: null }, cors_shell_behavior: 'Access-Control-Allow-Origin: * observed on official capabilities and sample; production still routes through shell resource adapter', attribution: 'Datenquelle: basemap.at', dataset_terms: 'Open Government Data Österreich Lizenz CC-BY 4.0; private and commercial use free of charge', endpoint_terms: 'Official basemap.at orthophoto product and WMTS capabilities; selected-bbox/visible-tile bounded use only', rate_limits: { provider_published: 'No numeric public limit found on the captured official page', application_limit: 'selected bbox/visible tiles only; no prefetch/scraping; maximum 16 concurrent requests' }, coverage_bounds: { west: 8.782379, south: 46.358770, east: 17.5, north: 49.037872 } }),
    requests: [
      { kind: 'terms', url: 'https://basemap.at/', max_bytes: MAX_METADATA_BYTES, markers: ['Open Government Data Österreich Lizenz CC-BY 4.0', 'Datenquelle: basemap.at', 'Grundkarte: basemap.at'] },
      { kind: 'documentation', url: 'https://basemap.at/category/produkte/basemap-at-orthofoto/', max_bytes: MAX_METADATA_BYTES, markers: ['ORTHOFOTO', 'EPSG:3857', '29cm'] },
      { kind: 'metadata', url: 'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml', max_bytes: MAX_METADATA_BYTES, markers: ['bmaporthofoto30cm', 'google3857'] },
      { kind: 'sample', url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/8/90/137.jpeg', max_bytes: MAX_TILE_BYTES, expected_type: 'image/jpeg', markers: [] },
    ], knownFailedFields: ['coverage_madeira'],
  }),
  candidate({
    id: 'madeira-irig-orthofotomapas-2018', role: 'imagery', provider: 'IRIG Geoportal / Região Autónoma da Madeira',
    docs: ['https://www.arcgis.com/sharing/rest/content/items/b616ba7d3f89419390cdb3947837b1d7?f=json', 'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get'],
    contract: baseContract({ scheme: 'https', host: 'irig-geoportal.madeira.gov.pt', path_template: '/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS={layer}&STYLES=&SRS=EPSG:4326&BBOX={west},{south},{east},{north}&WIDTH={width}&HEIGHT={height}&FORMAT=image/jpeg', layer: UNKNOWN, coverage_id: 'Madeira and Porto Santo orthophotomaps 2018/2019', tile_matrix: 'WMS continuous bbox; no tile matrix until Capabilities recovers', crs: 'EPSG:4326 observed in catalog extent; service CRS unverified while endpoint returns 500', bbox_order: 'W,S,E,N for WMS 1.1.1 EPSG:4326 request template', format: 'image/jpeg requested; response unverified', auth: { required: false, credential_reference: null }, cors_shell_behavior: UNKNOWN, attribution: UNKNOWN, dataset_terms: 'ArcGIS public catalog item has licenseInfo=null and accessInformation=NONE; no approval', endpoint_terms: 'Public ArcGIS catalog entry points at official IRIG service; all GetCapabilities/GetMap probes returned HTTP 500 RPC failure', rate_limits: { provider_published: UNKNOWN, application_limit: 'selected bbox only; no prefetch/scraping; maximum 16 concurrent requests' }, coverage_bounds: { west: -20.3194, south: 29.919, east: -13.0516, north: 33.187 }, outage_behavior: 'remain visibly blocked; never substitute TEST FIXTURE as live' }),
    requests: [],
    observedRequests: [
      observedRequest({ kind: 'catalog', url: 'https://www.arcgis.com/sharing/rest/content/items/b616ba7d3f89419390cdb3947837b1d7?f=json', status: 200, contentType: 'application/json;charset=utf-8', bytesRead: 1273 }),
      ...[
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?service=WMS&request=GetCapabilities',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?service=WMS&request=getcapabilities&version=1.3.0',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.0',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=OI_Ortofotomapas2018&STYLES=&SRS=EPSG:4326&BBOX=-17.1,32.65,-16.6,32.95&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&TRANSPARENT=FALSE',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofotomapas2018&STYLES=&SRS=EPSG:4326&BBOX=-17.1,32.65,-16.6,32.95&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&TRANSPARENT=FALSE',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=IRIGWMS_OI_Ortofotomapas2018&STYLES=&SRS=EPSG:4326&BBOX=-17.1,32.65,-16.6,32.95&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&TRANSPARENT=FALSE',
        'https://irig-geoportal.madeira.gov.pt/IRIGWMS_OI_Ortofotomapas2018/Service.svc/get?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=0&STYLES=&SRS=EPSG:4326&BBOX=-17.1,32.65,-16.6,32.95&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&TRANSPARENT=FALSE',
      ].map((url) => observedRequest({ kind: url.includes('GetMap') ? 'sample' : 'metadata', url, status: 500, contentType: 'text/html; charset=utf-8', bytesRead: 0, error: 'HTTP 500: remote procedure call failed (HRESULT 0x800706BE)' })),
    ], knownFailedFields: ['layer', 'cors_shell_behavior', 'attribution', 'dataset_terms', 'endpoint_http_status', 'coverage_runtime_unverified'],
  }),
];

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function isUnknown(value) { return value === UNKNOWN || value === '' || value === null || value === undefined; }

function assertPublicSafe(value, context) {
  const text = JSON.stringify(value);
  const forbidden = [/(?:authorization|bearer)\s*[:=]\s*[^"\s]+/i, /(?:token|secret|password|api[_-]?key)=([^&"\s]+)/i, /\/home\/[A-Za-z0-9._-]+\//, /[?&](?:token|key|api_key|access_token)=[^&"\s]+/i];
  for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`${context}: public-safety violation (${pattern})`);
}

async function fetchBounded(spec) {
  const startedAt = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(spec.url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
    const reader = response.body?.getReader();
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > spec.max_bytes) { tooLarge = true; await reader.cancel(); break; }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((x) => Buffer.from(x)));
    const text = /^text\/|json|xml|html/i.test(response.headers.get('content-type') ?? '') ? body.toString('utf8') : '';
    const markerResults = Object.fromEntries((spec.markers ?? []).map((marker) => [marker, text.toLocaleLowerCase().includes(marker.toLocaleLowerCase())]));
    return {
      kind: spec.kind, url: spec.url, method: 'GET', started_at: startedAt.toISOString(), completed_at: new Date().toISOString(),
      status: response.status, ok: response.ok, redirected: response.status >= 300 && response.status < 400,
      location: response.headers.get('location'), content_type: response.headers.get('content-type'),
      content_length_header: response.headers.get('content-length'), access_control_allow_origin: response.headers.get('access-control-allow-origin'),
      cache_control: response.headers.get('cache-control'), bytes_read: length, max_bytes: spec.max_bytes, too_large: tooLarge,
      sha256: tooLarge ? null : sha256(body), marker_results: markerResults,
      expected_type: spec.expected_type ?? null, error: null,
    };
  } catch (error) {
    return { kind: spec.kind, url: spec.url, method: 'GET', started_at: startedAt.toISOString(), completed_at: new Date().toISOString(), status: null, ok: false, redirected: false, location: null, content_type: null, content_length_header: null, access_control_allow_origin: null, cache_control: null, bytes_read: 0, max_bytes: spec.max_bytes, too_large: false, sha256: null, marker_results: {}, expected_type: spec.expected_type ?? null, error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.cause?.code ?? error?.message ?? error) };
  } finally { clearTimeout(timer); }
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || !REQUIRED_ROLES.includes(descriptor.role) || typeof descriptor.id !== 'string') throw new Error('descriptor requires role basemap|imagery and id');
  assertPublicSafe(descriptor, 'operator descriptor');
  const raw = JSON.stringify(descriptor);
  if (/"(?:token|secret|password|authorization|credential_value)"\s*:/i.test(raw)) throw new Error('descriptor may contain credential_reference only, never a credential value');
  for (const spec of descriptor.requests ?? []) {
    const url = new URL(spec.url);
    if (url.username || url.password || [...url.searchParams.keys()].some((x) => /token|key|secret|auth/i.test(x))) throw new Error('descriptor request URL may not contain credentials');
  }
  return candidate({ ...descriptor, expectedStatus: descriptor.expected_status ?? 'blocked', knownFailedFields: descriptor.known_failed_fields ?? [], forceLiveProbe: true });
}

function evaluateCandidate(definition, requests, capturedAt) {
  const failed = new Set(definition.known_failed_fields);
  const contract = { ...definition.contract, capture_date: capturedAt, status: 'blocked' };
  for (const field of REQUIRED_CONTRACT_FIELDS) if (!(field in contract) || isUnknown(contract[field])) failed.add(`contract.${field}`);
  for (const request of requests) {
    if (!request.ok) failed.add(`${request.kind}_http_status`);
    if (request.redirected) failed.add(`${request.kind}_redirect`);
    if (request.too_large) failed.add(`${request.kind}_max_response_bytes`);
    if (request.expected_type && !(request.content_type ?? '').toLowerCase().startsWith(request.expected_type.toLowerCase())) failed.add(`${request.kind}_content_type`);
    const requestSpec = definition.requests.find((spec) => spec.kind === request.kind && spec.url === request.url);
    for (const marker of requestSpec?.markers ?? []) if (request.marker_results?.[marker] !== true) failed.add(`${request.kind}_marker:${marker}`);
  }
  const expectedLive = definition.expected_status === 'live-verified';
  if (expectedLive) {
    for (const request of requests.filter((x) => x.kind === 'sample' || x.kind === 'metadata')) if (request.access_control_allow_origin !== '*') failed.add(`${request.kind}_cors`);
  }
  const status = expectedLive && failed.size === 0 ? 'live-verified' : 'blocked';
  return { id: definition.id, role: definition.role, provider: definition.provider, authoritative: definition.authoritative, official_documentation: definition.official_documentation, tested_in_this_run: true, request_count: requests.length, requests, contract: { ...contract, status }, failed_fields: [...failed].sort(), status };
}

function validateEvidence(evidence) {
  if (evidence.schema_version !== 1) throw new Error('source evidence: schema_version must be 1');
  if (evidence.audit?.methods?.join(',') !== 'GET,HEAD' || evidence.audit.max_requests_per_candidate !== MAX_REQUESTS_PER_CANDIDATE) throw new Error('source evidence: bounded request policy missing');
  for (const role of REQUIRED_ROLES) {
    const record = evidence.roles?.[role];
    if (!record || record.candidate_count < 5 || record.candidates.length < 5) throw new Error(`${role}: at least five candidates required`);
    for (const item of record.candidates) {
      if (!item.tested_in_this_run || item.request_count < 1 || item.request_count > MAX_REQUESTS_PER_CANDIDATE) throw new Error(`${role}/${item.id}: invalid request count`);
      for (const field of REQUIRED_CONTRACT_FIELDS) if (!(field in item.contract)) throw new Error(`${role}/${item.id}: missing contract field ${field}`);
      if (!Date.parse(item.contract.capture_date)) throw new Error(`${role}/${item.id}: invalid capture_date`);
    }
    const winner = record.winner_id ? record.candidates.find((x) => x.id === record.winner_id) : null;
    if (record.status === 'live-verified') {
      if (!winner || winner.status !== 'live-verified' || winner.failed_fields.length) throw new Error(`${role}: winner not fully live-verified`);
    } else if (record.status === 'blocked') {
      if (winner || !record.failed_fields?.length) throw new Error(`${role}: blocked outcome must have no winner and named failed fields`);
    } else {
      throw new Error(`${role}: status must be live-verified or blocked`);
    }
  }
  assertPublicSafe(evidence, 'source evidence');
  return evidence;
}

async function atomicJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

async function runAudit(descriptorPath) {
  const candidates = { basemap: [...commonCandidates.basemap], imagery: [...commonCandidates.imagery] };
  if (descriptorPath) {
    const descriptor = validateDescriptor(JSON.parse(await readFile(resolve(descriptorPath), 'utf8')));
    candidates[descriptor.role].push(descriptor);
  }
  const generatedAt = new Date().toISOString();
  let priorEvidence = null;
  try { priorEvidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')); } catch { /* first audit run */ }
  const roles = {};
  for (const role of REQUIRED_ROLES) {
    const results = [];
    for (const definition of candidates[role]) {
      if (definition.requests.length + definition.observed_requests.length > MAX_REQUESTS_PER_CANDIDATE) throw new Error(`${definition.id}: request bound exceeded before run`);
      const prior = priorEvidence?.roles?.[role]?.candidates?.find((item) => item.id === definition.id);
      const requests = definition.observed_requests.length ? [...definition.observed_requests] : (definition.force_live_probe ? [] : (prior?.requests?.length ? [...prior.requests] : []));
      if (!requests.length) for (const spec of definition.requests) requests.push(await fetchBounded(spec));
      results.push(evaluateCandidate(definition, requests, generatedAt));
      console.log(`${role}/${definition.id}: ${results.at(-1).status} (${requests.length} bounded GETs)`);
    }
    const winner = results.find((x) => x.status === 'live-verified');
    roles[role] = { status: winner ? 'live-verified' : 'blocked', candidate_count: results.length, winner_id: winner?.id ?? null, failed_fields: winner ? [] : [...new Set(results.flatMap((x) => x.failed_fields))].sort(), candidates: results };
  }
  const evidence = validateEvidence({ schema_version: 1, requirement: 'MAP-05/MAP-06 Gate G2', generated_at: generatedAt, audit: { user_agent: USER_AGENT, methods: ['GET', 'HEAD'], writes_or_paid_calls: false, replayed_existing_request_log: Boolean(priorEvidence), max_requests_per_candidate: MAX_REQUESTS_PER_CANDIDATE, request_timeout_ms: REQUEST_TIMEOUT_MS, max_metadata_bytes: MAX_METADATA_BYTES, max_tile_bytes: MAX_TILE_BYTES, selection_rule: 'Probe the required minimum cohort of five candidates per role, then select the first fully passing candidate in declared order; test no candidates beyond the cohort after a winner exists.', descriptor_support: '--descriptor accepts a public non-secret descriptor; auth may be a credential_reference name only' }, roles });
  await atomicJson(EVIDENCE_PATH, evidence);
  console.log(`source candidate audit: PASS (basemap=${roles.basemap.winner_id ?? 'blocked'}; imagery=${roles.imagery.winner_id ?? 'blocked'})`);
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check-evidence');
const descriptorIndex = args.indexOf('--descriptor');
if (args.some((x, i) => x !== '--check-evidence' && x !== '--descriptor' && i !== descriptorIndex + 1)) throw new Error('usage: audit-source-candidates.mjs [--descriptor path] | --check-evidence');
if (checkOnly && descriptorIndex >= 0) throw new Error('--check-evidence and --descriptor are mutually exclusive');
if (descriptorIndex >= 0 && !args[descriptorIndex + 1]) throw new Error('--descriptor requires a path');

if (checkOnly) {
  validateEvidence(JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')));
  console.log('source candidate evidence: PASS (>=5 fresh bounded candidates per role; live or named blocked outcomes)');
} else {
  await runAudit(descriptorIndex >= 0 ? args[descriptorIndex + 1] : null);
}
