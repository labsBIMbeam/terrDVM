/**
 * Lightning payment placeholder.
 *
 * NOT wired into the job flow: the demo runs bbox → terrain → 3D preview with
 * the payment gate skipped. This module is kept ready for the phase that adds
 * the real invoice/payment/delivery loop, per the repository's core invariant.
 *
 * There is no Lightning node, LNbits or Phoenixd connection, and no payment
 * behind any value produced here.
 */

/** Demo tariff. Deterministic on purpose: no clock, no randomness. */
export const DEMO_SATS_PER_KM2 = 21;
export const DEMO_MIN_SATS = 210;

export type LightningInvoicePlaceholder = {
  readonly placeholder: true;
  readonly amountSats: number;
  readonly memo: string;
  /** Deliberately not BOLT11-shaped, so no wallet can act on it. */
  readonly paymentRequest: string;
};

/** Quote the demo price for an area. Throws rather than quoting a bogus amount. */
export function demoPriceSats(areaKm2: number): number {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
    throw new RangeError('Demo price requires a finite, positive area in km².');
  }
  return Math.max(DEMO_MIN_SATS, Math.ceil(areaKm2 * DEMO_SATS_PER_KM2));
}

export function createInvoicePlaceholder(areaKm2: number): LightningInvoicePlaceholder {
  const amountSats = demoPriceSats(areaKm2);
  return {
    placeholder: true,
    amountSats,
    memo: `terrDVM terrain job — ${areaKm2.toFixed(1)} km²`,
    paymentRequest: `ln-invoice-placeholder-${amountSats}sats-terrdvm-demo-not-payable`,
  };
}
