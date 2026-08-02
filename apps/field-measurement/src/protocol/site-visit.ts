/**
 * The per-site field sheet — FIELD-PROTOCOL.md §3.1, raw observables only.
 *
 * Deliberately absent from this type, by construction rather than by
 * discipline: excess loss, estimated range, distance, path-loss numbers,
 * and any judgement about WHY something was or was not heard. Cause is a
 * model determination; recording it in the field imports the model's
 * assumption into its own validation data. "I made a mistake" is likewise
 * not a selectable category — it is excluded mechanically by the loopback
 * and the config hash, or the record is void.
 */

export const SITE_VISIT_SCHEMA = 'terrcvm-field-site-visit@1';

/** The pole mark every rig uses; recorded anyway so a deviation is visible. */
export const POLE_MARK_M = 2.0;

export type LeafState = 'in-leaf' | 'bare' | 'transitional';
export type Precip = 'dry' | 'wet-foliage' | 'raining';
export type Wind = 'calm' | 'moderate' | 'strong';
export type PoleFoot = 'soil' | 'rock' | 'snow' | 'other';

export type SiteVisit = {
  /** Pre-assigned by the site selector (§9) — never invented in the field. */
  siteId: string;
  /** Pre-assigned; the random-effect key (§6). */
  operatorId: string;
  /** ISO date of the visit. */
  date: string;
  /** Local arrival wall-clock, HH:MM. */
  arrivalLocal: string;
  windowStartUtc: string;
  windowEndUtc: string;
  /** Transect stations occupied (§5). */
  stationMarks: number;
  /** All 3 loopback packets arrived at window open / close. */
  loopbackOpen: boolean;
  loopbackClose: boolean;
  /** Always 2.00 — recorded anyway, so a deviation is visible. */
  poleMarkM: number;
  /** Worst bubble-level reading during the window, degrees from vertical. */
  antennaTiltDeg: number;
  poleFoot: PoleFoot;
  nodeSerial: string;
  antennaSerial: string;
  /** From `meshtastic --info`, §2.3 — the mechanical mistake gate. */
  configHash: string;
  /** 60 s stationary average at the transect midpoint — an arrival check. */
  gnssLat: number;
  gnssLon: number;
  gnssAccM: number;
  /** Stddev of the 60 s of 1 Hz fixes: a measured error, not an unknown one. */
  gnssScatterM: number;
  leafState: LeafState;
  precip: Precip;
  wind: Wind;
  /** N, S, E, W, straight up, and the rig. Geotagged. */
  photoCount: number;
  notes: string;
};

export type SiteVisitValidation =
  | { ok: true }
  | { ok: false; problems: string[] };

const LEAF_STATES: readonly LeafState[] = ['in-leaf', 'bare', 'transitional'];
const PRECIPS: readonly Precip[] = ['dry', 'wet-foliage', 'raining'];
const WINDS: readonly Wind[] = ['calm', 'moderate', 'strong'];
const POLE_FEET: readonly PoleFoot[] = ['soil', 'rock', 'snow', 'other'];

function parseUtc(value: string): number {
  return Date.parse(value);
}

/**
 * Validate a field sheet. Everything checked here is a recording problem an
 * operator can fix on the spot; nothing here judges the measurement.
 */
export function validateSiteVisit(visit: SiteVisit): SiteVisitValidation {
  const problems: string[] = [];
  const requireText = (value: string, name: string): void => {
    if (value.trim().length === 0) problems.push(`${name} is required`);
  };

  requireText(visit.siteId, 'site_id');
  requireText(visit.operatorId, 'operator_id');
  requireText(visit.date, 'date');
  requireText(visit.nodeSerial, 'node_serial');
  requireText(visit.antennaSerial, 'antenna_serial');
  requireText(visit.configHash, 'config_hash');

  const start = parseUtc(visit.windowStartUtc);
  const end = parseUtc(visit.windowEndUtc);
  if (!Number.isFinite(start)) problems.push('window_start_utc is not a valid ISO-8601 time');
  if (!Number.isFinite(end)) problems.push('window_end_utc is not a valid ISO-8601 time');
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    problems.push('window_end_utc must be after window_start_utc');
  }

  if (!Number.isInteger(visit.stationMarks) || visit.stationMarks < 1) {
    problems.push('station_marks must be a positive integer');
  }
  if (!Number.isFinite(visit.poleMarkM) || visit.poleMarkM <= 0) {
    problems.push('pole_mark must be a positive height in metres');
  }
  if (!Number.isFinite(visit.antennaTiltDeg) || visit.antennaTiltDeg < 0 || visit.antennaTiltDeg > 90) {
    problems.push('antenna_tilt must be between 0 and 90 degrees');
  }
  if (!Number.isFinite(visit.gnssLat) || visit.gnssLat < -90 || visit.gnssLat > 90) {
    problems.push('gnss_lat must be a latitude in decimal degrees');
  }
  if (!Number.isFinite(visit.gnssLon) || visit.gnssLon < -180 || visit.gnssLon > 180) {
    problems.push('gnss_lon must be a longitude in decimal degrees');
  }
  if (!Number.isFinite(visit.gnssAccM) || visit.gnssAccM < 0) {
    problems.push('gnss_acc_m must be a non-negative distance in metres');
  }
  if (!Number.isFinite(visit.gnssScatterM) || visit.gnssScatterM < 0) {
    problems.push('gnss_scatter_m must be a non-negative distance in metres');
  }
  if (!LEAF_STATES.includes(visit.leafState)) problems.push('leaf_state is not a known value');
  if (!PRECIPS.includes(visit.precip)) problems.push('precip is not a known value');
  if (!WINDS.includes(visit.wind)) problems.push('wind is not a known value');
  if (!POLE_FEET.includes(visit.poleFoot)) problems.push('pole_foot is not a known value');
  if (!Number.isInteger(visit.photoCount) || visit.photoCount < 0) {
    problems.push('photos must be a non-negative count');
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}
