import { describe, expect, it } from 'vitest';

import {
  RANGETEST_HEADER,
  RangeTestFormatError,
  parseRangeTestCsv,
  splitLinkRecords,
} from '../../src/protocol/rangetest';

/**
 * The fixture reproduces the firmware's write order byte for byte
 * (RangeTestModule.cpp): eleven comma-terminated fields, a quoted payload
 * with the newline INSIDE the printf, then the row's RSSI printed after the
 * terminator — so it lands at the head of the next physical line, and the
 * file ends with a dangling `<rssi>,` fragment. FIELD-PROTOCOL.md §2.4:
 * "Parses cleanly, wrong by one, everywhere."
 */
const ROW1 = '09:00:01,631724152,Beacon A,47.100000,9.500000,47.101000,9.501000,812,11.250000,812.000000,0,"seq 1"';
const ROW2 = '09:00:16,631724152,Beacon A,47.100000,9.500000,47.101000,9.501000,812,10.500000,812.000000,0,"seq 2"';
const ROW3 = '09:00:31,999888777,Beacon B,47.100000,9.500000,47.101000,9.501000,812,-3.750000,812.000000,0,"seq 5"';

const WELL_FORMED = [RANGETEST_HEADER, ROW1, `-91,${ROW2}`, `-88,${ROW3}`, '-97,', ''].join('\n');

describe('parseRangeTestCsv', () => {
  it('reunites every RSSI with the row it belongs to', () => {
    const { records, rejections } = parseRangeTestCsv(WELL_FORMED);
    expect(rejections).toEqual([]);
    expect(records.map((record) => record.rxRssiDbm)).toEqual([-91, -88, -97]);
    expect(records.map((record) => record.seq)).toEqual([1, 2, 5]);
  });

  it('parses the fixed fields positionally', () => {
    const [first] = parseRangeTestCsv(WELL_FORMED).records;
    expect(first).toMatchObject({
      rxTime: '09:00:01',
      from: '631724152',
      senderName: 'Beacon A',
      senderLat: 47.1,
      senderLon: 9.5,
      rxLat: 47.101,
      rxLon: 9.501,
      rxElevationM: 812,
      rxSnrDb: 11.25,
      distanceM: 812,
      hopLimit: 0,
      payload: 'seq 1',
    });
  });

  it('keeps a comma inside the sender long name where it belongs', () => {
    const row = '09:00:01,42,Beacon A, hilltop,47.1,9.5,47.1,9.5,812,1.0,10.0,0,"seq 3"';
    const { records } = parseRangeTestCsv(`${RANGETEST_HEADER}\n${row}\n-80,\n`);
    expect(records[0].senderName).toBe('Beacon A, hilltop');
    expect(records[0].seq).toBe(3);
    expect(records[0].rxRssiDbm).toBe(-80);
  });

  it('leaves the last row RSSI-less when the file was cut mid-write', () => {
    const truncated = [RANGETEST_HEADER, ROW1, `-91,${ROW2}`].join('\n');
    const { records } = parseRangeTestCsv(truncated);
    expect(records[0].rxRssiDbm).toBe(-91);
    expect(records[1].rxRssiDbm).toBeNull();
  });

  it('does not mistake an RTC-less ??:??:?? time for a leading RSSI', () => {
    const rtcless = '??:??:??,42,Beacon A,47.1,9.5,47.1,9.5,812,1.0,10.0,0,"seq 9"';
    const { records, rejections } = parseRangeTestCsv(
      `${RANGETEST_HEADER}\n${rtcless}\n-77,\n`,
    );
    expect(rejections).toEqual([]);
    expect(records[0].rxTime).toBe('??:??:??');
    expect(records[0].rxRssiDbm).toBe(-77);
  });

  it('flags a file that starts mid-stream instead of guessing', () => {
    const midStream = [RANGETEST_HEADER, `-70,${ROW1}`, '-71,'].join('\n');
    const { records, rejections } = parseRangeTestCsv(midStream);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toContain('mid-stream');
    // The row itself still parses; only the orphaned RSSI is unattributable.
    expect(records[0].seq).toBe(1);
    expect(records[0].rxRssiDbm).toBe(-71);
  });

  it('rejects malformed lines with their line number, never silently', () => {
    const broken = [RANGETEST_HEADER, ROW1, '-91,this is not a row', '-90,'].join('\n');
    const { records, rejections } = parseRangeTestCsv(broken);
    expect(records).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].line).toBe(3);
    expect(rejections[0].reason).toContain('quoted payload');
  });

  it('refuses an unknown header outright', () => {
    expect(() => parseRangeTestCsv('time,rssi\n1,2\n')).toThrow(RangeTestFormatError);
  });

  it('refuses an empty file', () => {
    expect(() => parseRangeTestCsv('')).toThrow(RangeTestFormatError);
  });

  it('rejects rows with non-numeric numeric fields', () => {
    const bad = '09:00:01,42,Beacon A,47.1,9.5,47.1,9.5,eight,1.0,10.0,0,"seq 1"';
    const { records, rejections } = parseRangeTestCsv(`${RANGETEST_HEADER}\n${bad}\n-80,\n`);
    expect(records).toEqual([]);
    expect(rejections[0].reason).toContain('non-numeric');
  });
});

describe('splitLinkRecords', () => {
  it('excludes relayed packets with the reason the protocol gives', () => {
    const relayed = '09:00:01,42,Node,47.1,9.5,47.1,9.5,812,1.0,10.0,3,"seq 4"';
    const { records } = parseRangeTestCsv(`${RANGETEST_HEADER}\n${relayed}\n-60,\n`);
    const { link, excluded } = splitLinkRecords(records);
    expect(link).toEqual([]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toContain('relayed');
    expect(excluded[0].reason).toContain('last hop');
  });

  it('excludes non-sequence payloads — they are not beacon packets', () => {
    const chatter = '09:00:01,42,Node,47.1,9.5,47.1,9.5,812,1.0,10.0,0,"hello there"';
    const { records } = parseRangeTestCsv(`${RANGETEST_HEADER}\n${chatter}\n-60,\n`);
    const { link, excluded } = splitLinkRecords(records);
    expect(link).toEqual([]);
    expect(excluded[0].reason).toContain('not a range-test sequence');
  });

  it('passes direct sequence packets through untouched', () => {
    const { records } = parseRangeTestCsv(WELL_FORMED);
    const { link, excluded } = splitLinkRecords(records);
    expect(link).toHaveLength(3);
    expect(excluded).toEqual([]);
  });
});
