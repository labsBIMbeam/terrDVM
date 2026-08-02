import { describe, expect, it } from 'vitest';

import {
  DEMO_MIN_SATS,
  DEMO_SATS_PER_KM2,
  createInvoicePlaceholder,
  demoPriceSats,
} from '../../src/job/invoice';

const AREA_KM2 = 83.2;

describe('demo Lightning placeholder', () => {
  it('prices deterministically per km² above a floor', () => {
    expect(demoPriceSats(100)).toBe(100 * DEMO_SATS_PER_KM2);
    expect(demoPriceSats(AREA_KM2)).toBe(Math.ceil(AREA_KM2 * DEMO_SATS_PER_KM2));
    expect(demoPriceSats(0.01)).toBe(DEMO_MIN_SATS);
    // Deterministic: no clock, no randomness.
    expect(demoPriceSats(AREA_KM2)).toBe(demoPriceSats(AREA_KM2));
  });

  it('refuses to price a non-finite or empty area', () => {
    expect(() => demoPriceSats(Number.NaN)).toThrow(RangeError);
    expect(() => demoPriceSats(0)).toThrow(RangeError);
    expect(() => demoPriceSats(-5)).toThrow(RangeError);
  });

  it('is marked as a placeholder and is not a payable invoice', () => {
    const invoice = createInvoicePlaceholder(AREA_KM2);
    expect(invoice.placeholder).toBe(true);
    expect(invoice.amountSats).toBe(demoPriceSats(AREA_KM2));
    // Must never look like a spendable BOLT11 request.
    expect(invoice.paymentRequest).not.toMatch(/^lnbc/i);
    expect(invoice.paymentRequest.toLowerCase()).toContain('placeholder');
  });
});
