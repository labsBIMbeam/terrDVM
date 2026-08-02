import { describe, expect, it } from 'vitest';

import type { RangeTestRecord } from '../../src/protocol/rangetest';
import {
  BEACON_LADDER_STEP_DB,
  LONGFAST_SENSITIVITY_DBM,
  classifyWindow,
  type WindowInputs,
} from '../../src/protocol/window';

const A = '631724152';
const B = '999888777';

function packet(from: string, seq: number, overrides: Partial<RangeTestRecord> = {}): RangeTestRecord {
  return {
    rxTime: '09:00:00',
    from,
    senderName: from === A ? 'Beacon A' : 'Beacon B',
    senderLat: 47.1,
    senderLon: 9.5,
    rxLat: 47.101,
    rxLon: 9.501,
    rxElevationM: 812,
    rxSnrDb: 4,
    distanceM: 812,
    hopLimit: 0,
    payload: `seq ${seq}`,
    seq,
    rxRssiDbm: -95,
    ...overrides,
  };
}

function inputs(records: RangeTestRecord[], overrides: Partial<WindowInputs> = {}): WindowInputs {
  return {
    records,
    beaconA: A,
    beaconB: B,
    expectedA: { lo: 1, hi: 4 },
    expectedB: { lo: 1, hi: 4 },
    loopbackOpen: true,
    loopbackClose: true,
    ...overrides,
  };
}

describe('classifyWindow', () => {
  it('classifies both beacons heard as continuous', () => {
    const report = classifyWindow(inputs([packet(A, 1), packet(A, 2), packet(B, 1)]));
    expect(report.outcome).toBe('continuous');
    expect(report.censorBracketDbm).toBeNull();
    expect(report.a.prr).toBe(0.5);
    expect(report.b.prr).toBe(0.25);
  });

  it('brackets A-only to the 13 dB ladder interval', () => {
    const report = classifyWindow(inputs([packet(A, 1)]));
    expect(report.outcome).toBe('interval-censored');
    expect(report.censorBracketDbm).toEqual({
      lo: LONGFAST_SENSITIVITY_DBM,
      hi: LONGFAST_SENSITIVITY_DBM + BEACON_LADDER_STEP_DB,
    });
  });

  it('treats a verified silence as a left-censored positive datum', () => {
    const report = classifyWindow(inputs([]));
    expect(report.outcome).toBe('left-censored');
    expect(report.censorBracketDbm).toEqual({ lo: null, hi: LONGFAST_SENSITIVITY_DBM });
    expect(report.a.prr).toBe(0);
    expect(report.note).toContain('positive datum');
  });

  it('voids the window when either loopback fails, packets or not', () => {
    for (const failed of [{ loopbackOpen: false }, { loopbackClose: false }]) {
      const report = classifyWindow(inputs([packet(A, 1), packet(B, 1)], failed));
      expect(report.outcome).toBe('void');
      expect(report.note).toContain('Not a null');
    }
  });

  it('flags B-without-A as a data-integrity fault, not a measurement', () => {
    const report = classifyWindow(inputs([packet(B, 2)]));
    expect(report.outcome).toBe('integrity-fault');
    expect(report.note).toContain('physically impossible');
  });

  it('deduplicates sequence numbers and flags out-of-range ones', () => {
    const report = classifyWindow(
      inputs([packet(A, 2), packet(A, 2), packet(A, 99)]),
    );
    expect(report.a.received).toEqual([2]);
    expect(report.a.prr).toBe(0.25);
    expect(report.a.outOfRange).toEqual([99]);
  });

  it('never counts relayed packets — the §1.1 gate is applied inside', () => {
    const report = classifyWindow(inputs([packet(A, 1, { hopLimit: 3 })]));
    expect(report.outcome).toBe('left-censored');
    expect(report.a.received).toEqual([]);
  });

  it('refuses an empty expected range instead of dividing by nothing', () => {
    expect(() => classifyWindow(inputs([], { expectedA: { lo: 5, hi: 4 } }))).toThrow(RangeError);
  });

  it('refuses identical beacon ids — the ladder needs two rungs', () => {
    expect(() => classifyWindow(inputs([], { beaconB: A }))).toThrow(RangeError);
  });
});
