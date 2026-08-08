/**
 * The Meshtastic `rangetest.csv` ingest — FIELD-PROTOCOL.md §2.4 and §3.2.
 *
 * The firmware writes each row's RSSI *after* the row terminator
 * (`RangeTestModule.cpp`: `printf("\"%s\"\n", payload)` then
 * `printf("%i,", rx_rssi)`), so every physical line after the first data
 * line starts with the PREVIOUS packet's RSSI, the first data line has no
 * leading RSSI at all, and the file ends with a dangling `<rssi>,`
 * fragment. Parsed naively the file looks clean and every RSSI is wrong by
 * one row — the protocol's words: "Parses cleanly, wrong by one,
 * everywhere." This parser shifts the leading field back to the row it
 * belongs to and refuses files whose header is not the layout it knows.
 *
 * Nothing here computes excess loss, distance corrections or any derived
 * quantity: raw observables only, per the protocol's provenance rule.
 */

/** The exact header the supported firmware writes. */
export const RANGETEST_HEADER =
  'time,from,sender name,sender lat,sender long,rx lat,rx long,rx elevation,rx snr,distance,hop limit,payload,rx rssi';

/** One received packet, fields as recorded, RSSI reunited with its row. */
export type RangeTestRecord = {
  /** `HH:MM:SS` from the radio RTC — diagnostic only, never a join key. */
  rxTime: string;
  /** Sender node id. Which beacon this was. */
  from: string;
  /** Sender long name; may itself contain commas, parsed positionally. */
  senderName: string;
  senderLat: number;
  senderLon: number;
  rxLat: number;
  rxLon: number;
  rxElevationM: number;
  /** SNR in dB, 0.25 steps; saturates high — RSSI is the usable observable. */
  rxSnrDb: number;
  distanceM: number;
  /** Must be 0 for a direct range-test packet (§1.1 switch 1). */
  hopLimit: number;
  /** Raw payload, quotes stripped. Range test emits `seq %u`. */
  payload: string;
  /** Monotonic sequence number, or null when the payload is not `seq N`. */
  seq: number | null;
  /**
   * RSSI in dBm, de-shifted from the FOLLOWING physical line. Null only for
   * the final row of a file cut off mid-write — a missing observable stays
   * missing rather than borrowing a neighbour's.
   */
  rxRssiDbm: number | null;
};

export type RangeTestRejection = {
  /** 1-based physical line number in the file. */
  line: number;
  reason: string;
  raw: string;
};

export type RangeTestParse = {
  records: RangeTestRecord[];
  /** Lines that are not well-formed rows. Counted, never silently dropped. */
  rejections: RangeTestRejection[];
};

export class RangeTestFormatError extends Error {
  constructor(detail: string) {
    super(`rangetest.csv: ${detail}`);
    this.name = 'RangeTestFormatError';
  }
}

const LEADING_RSSI = /^(-?\d+),(.*)$/;
const DANGLING_RSSI = /^(-?\d+),?$/;
const SEQ_PAYLOAD = /^seq (\d+)$/;

/** Fields that follow the sender name, in order, ending with the payload. */
const TRAILING_NUMERIC_FIELDS = 8;

type RowBody = { line: number; raw: string };

function parseBody(body: RowBody): RangeTestRecord | RangeTestRejection {
  const { raw, line } = body;
  const reject = (reason: string): RangeTestRejection => ({ line, reason, raw });

  // The payload is the quoted tail; everything the firmware writes after it
  // lands on the next physical line.
  const payloadMatch = raw.match(/^(.*),"(.*)"$/);
  if (!payloadMatch) return reject('row does not end in a quoted payload');
  const [, head, payload] = payloadMatch;

  const cells = head.split(',');
  // time + from + at-least-one-name-cell + the eight numerics.
  if (cells.length < 2 + 1 + TRAILING_NUMERIC_FIELDS) {
    return reject('row has fewer fields than the rangetest layout');
  }

  const rxTime = cells[0];
  const from = cells[1];
  const numericCells = cells.slice(cells.length - TRAILING_NUMERIC_FIELDS);
  // The sender long name is free text and may contain commas: it is exactly
  // the cells between the fixed left fields and the fixed numeric tail.
  const senderName = cells.slice(2, cells.length - TRAILING_NUMERIC_FIELDS).join(',');

  const numbers = numericCells.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    return reject('row has a non-numeric value in a numeric field');
  }
  const [senderLat, senderLon, rxLat, rxLon, rxElevationM, rxSnrDb, distanceM, hopLimit] = numbers;
  if (!Number.isInteger(hopLimit) || hopLimit < 0) {
    return reject('hop limit is not a non-negative integer');
  }

  const seqMatch = payload.match(SEQ_PAYLOAD);
  return {
    rxTime,
    from,
    senderName,
    senderLat,
    senderLon,
    rxLat,
    rxLon,
    rxElevationM,
    rxSnrDb,
    distanceM,
    hopLimit,
    payload,
    seq: seqMatch ? Number.parseInt(seqMatch[1], 10) : null,
    rxRssiDbm: null,
  };
}

/**
 * Parse a whole `rangetest.csv`, de-shifting every leading RSSI back onto
 * the preceding row. Throws {@link RangeTestFormatError} when the header is
 * not the known layout — a silently different column order is precisely the
 * failure this parser exists to refuse.
 */
export function parseRangeTestCsv(text: string): RangeTestParse {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) throw new RangeTestFormatError('file is empty');

  const header = lines[0].trim();
  if (header !== RANGETEST_HEADER) {
    throw new RangeTestFormatError(
      `unknown header — expected "${RANGETEST_HEADER}", got "${header}"`,
    );
  }

  const records: RangeTestRecord[] = [];
  const rejections: RangeTestRejection[] = [];
  const bodies: RowBody[] = [];
  const shiftedRssi: (number | null)[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (raw.trim() === '') continue;

    const dangling = raw.match(DANGLING_RSSI);
    if (dangling && index === lines.length - 1) {
      // The file's final fragment: the last row's RSSI, not a row.
      shiftedRssi[bodies.length - 1] = Number.parseInt(dangling[1], 10);
      continue;
    }

    const led = raw.match(LEADING_RSSI);
    // A row body always starts with the time field (`HH:MM:SS` or the
    // RTC-less `??:??:??`), which cannot match a bare leading integer — so a
    // leading-integer match IS the previous row's RSSI, unambiguously.
    if (led && bodies.length > 0) {
      shiftedRssi[bodies.length - 1] = Number.parseInt(led[1], 10);
      bodies.push({ line: lineNumber, raw: led[2] });
    } else if (led && bodies.length === 0) {
      rejections.push({
        line: lineNumber,
        reason: 'leading RSSI with no preceding row — file starts mid-stream',
        raw,
      });
      bodies.push({ line: lineNumber, raw: led[2] });
    } else {
      bodies.push({ line: lineNumber, raw });
    }
  }

  bodies.forEach((body, index) => {
    const parsed = parseBody(body);
    if ('reason' in parsed) {
      rejections.push(parsed);
      return;
    }
    records.push({ ...parsed, rxRssiDbm: shiftedRssi[index] ?? null });
  });

  return { records, rejections };
}

/**
 * The §1.1 relay gate: keep only records that can be link measurements.
 *
 * Range Test emits with `hop_limit = 0`, so a nonzero hop limit means the
 * packet was relayed and its RSSI describes the LAST hop — "a plausible
 * number for a path nobody measured". Non-`seq` payloads are not beacon
 * packets. Both are returned with named reasons, never silently dropped:
 * a relayed packet in the log is a data-integrity finding in itself.
 */
export function splitLinkRecords(records: readonly RangeTestRecord[]): {
  link: RangeTestRecord[];
  excluded: { record: RangeTestRecord; reason: string }[];
} {
  const link: RangeTestRecord[] = [];
  const excluded: { record: RangeTestRecord; reason: string }[] = [];
  for (const record of records) {
    if (record.hopLimit !== 0) {
      excluded.push({
        record,
        reason: `hop limit ${record.hopLimit} — relayed packet, RSSI describes the last hop only`,
      });
    } else if (record.seq === null) {
      excluded.push({ record, reason: 'payload is not a range-test sequence packet' });
    } else {
      link.push(record);
    }
  }
  return { link, excluded };
}
