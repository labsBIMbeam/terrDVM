import { splitLinkRecords, type RangeTestRecord } from './rangetest';

/**
 * One measurement window classified per FIELD-PROTOCOL.md §3.3 and §4.2.
 *
 * A null is a submitted record, structurally identical to a positive one:
 * `PRR = 0` is a positive datum. The 13 dB two-beacon amplitude ladder
 * turns silence into a graded, censored observation instead of missing
 * data — and the loopback check is what makes a null trustworthy at all,
 * because a dead receive chain reads identically to a refused link.
 */

/** LongFast sensitivity floor, dBm — MESH-CALCULATOR.md §5.3. */
export const LONGFAST_SENSITIVITY_DBM = -131;

/** Beacon A (20 dBm) minus beacon B (7 dBm): the exact ladder step. */
export const BEACON_LADDER_STEP_DB = 13;

/**
 * Window outcomes, §4.2. `void` and `integrity-fault` are not measurements:
 * one is a rig that cannot testify, the other a physically impossible
 * answer that indicts the rig rather than the path.
 */
export type WindowOutcome =
  | 'continuous'
  | 'interval-censored'
  | 'left-censored'
  | 'void'
  | 'integrity-fault';

export type SeqRange = {
  /** First sequence number the beacon emitted inside the window. */
  lo: number;
  /** Last sequence number the beacon emitted inside the window (inclusive). */
  hi: number;
};

export type WindowInputs = {
  records: readonly RangeTestRecord[];
  /** Node id of beacon A — the 20 dBm transmitter. */
  beaconA: string;
  /** Node id of beacon B — the 7 dBm transmitter. */
  beaconB: string;
  /** From the beacon's own log at ingest — never invented in the field. */
  expectedA: SeqRange;
  expectedB: SeqRange;
  /** All 3 loopback packets arrived when the window opened. */
  loopbackOpen: boolean;
  /** All 3 loopback packets arrived when the window closed. */
  loopbackClose: boolean;
};

export type BeaconReport = {
  expected: number;
  /** Distinct in-range sequence numbers received. */
  received: number[];
  /** Packet reception rate, 0..1. */
  prr: number;
  /** Sequence numbers outside the expected range — flagged, not counted. */
  outOfRange: number[];
};

export type WindowReport = {
  a: BeaconReport;
  b: BeaconReport;
  outcome: WindowOutcome;
  /**
   * What the outcome brackets the received power to, in dBm, per the §4.2
   * ladder. Null when the window is not a measurement (`void`,
   * `integrity-fault`) or is continuous (the RSSI series itself answers).
   */
  censorBracketDbm: { lo: number | null; hi: number } | null;
  /** Why this outcome, in words a field sheet can carry. */
  note: string;
};

function expectedCount(range: SeqRange): number {
  return range.hi - range.lo + 1;
}

function beaconReport(
  records: readonly RangeTestRecord[],
  beacon: string,
  range: SeqRange,
): BeaconReport {
  const inRange = new Set<number>();
  const outOfRange = new Set<number>();
  for (const record of records) {
    if (record.from !== beacon || record.seq === null) continue;
    if (record.seq >= range.lo && record.seq <= range.hi) inRange.add(record.seq);
    else outOfRange.add(record.seq);
  }
  const expected = expectedCount(range);
  return {
    expected,
    received: [...inRange].sort((left, right) => left - right),
    prr: inRange.size / expected,
    outOfRange: [...outOfRange].sort((left, right) => left - right),
  };
}

/**
 * Classify one site window. Only link-clean records (hop limit 0, seq
 * payload) count — the relay gate is applied here so no caller can forget
 * it.
 */
export function classifyWindow(inputs: WindowInputs): WindowReport {
  const { beaconA, beaconB, expectedA, expectedB, loopbackOpen, loopbackClose } = inputs;
  if (expectedA.hi < expectedA.lo || expectedB.hi < expectedB.lo) {
    throw new RangeError('expected sequence range is empty — hi must be >= lo');
  }
  if (beaconA === beaconB) {
    throw new RangeError('beacon A and beacon B must be distinct node ids');
  }

  const { link } = splitLinkRecords(inputs.records);
  const a = beaconReport(link, beaconA, expectedA);
  const b = beaconReport(link, beaconB, expectedB);
  const heardA = a.received.length > 0;
  const heardB = b.received.length > 0;

  if (!loopbackOpen || !loopbackClose) {
    return {
      a,
      b,
      outcome: 'void',
      censorBracketDbm: null,
      note:
        'Loopback failed — a dead receive chain reads identically to a refused link. ' +
        'Not a null. Discard and re-do the visit.',
    };
  }
  if (heardB && !heardA) {
    return {
      a,
      b,
      outcome: 'integrity-fault',
      censorBracketDbm: null,
      note:
        'Beacon B (7 dBm) heard but beacon A (20 dBm) not — physically impossible. ' +
        'Investigate the rig; this is a data-integrity fault, not a measurement.',
    };
  }
  if (heardA && heardB) {
    return {
      a,
      b,
      outcome: 'continuous',
      censorBracketDbm: null,
      note: 'Both beacons heard: two RSSI series 13 dB apart, plus a free linearity check.',
    };
  }
  if (heardA) {
    return {
      a,
      b,
      outcome: 'interval-censored',
      censorBracketDbm: {
        lo: LONGFAST_SENSITIVITY_DBM,
        hi: LONGFAST_SENSITIVITY_DBM + BEACON_LADDER_STEP_DB,
      },
      note:
        'Beacon A heard, beacon B not: received power bracketed to ' +
        `[${LONGFAST_SENSITIVITY_DBM}, ${LONGFAST_SENSITIVITY_DBM + BEACON_LADDER_STEP_DB}] dBm.`,
    };
  }
  return {
    a,
    b,
    outcome: 'left-censored',
    censorBracketDbm: { lo: null, hi: LONGFAST_SENSITIVITY_DBM },
    note:
      'Neither beacon heard, loopback passed: a verified null, ' +
      `left-censored below ${LONGFAST_SENSITIVITY_DBM} dBm. A positive datum.`,
  };
}
