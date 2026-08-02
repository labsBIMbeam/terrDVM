/// <reference types="vite/client" />

/**
 * The dev-path transport seam, made literal.
 *
 * presence.ts and publish.ts have carried the same DEV-PATH NOTE since they
 * were written: direct relay WebSockets and the `window.nostr` NIP-07 signer
 * are the plain-browser development path, and inside a real napplet shell
 * both must route through shell domains (signer capability, OUTBOX publish)
 * instead. This module is that seam. Every direct browser authority the
 * player uses lives behind `import.meta.env.DEV`, so:
 *
 *  - `vite dev` keeps the full working demo — live relays, NIP-07 signing,
 *    the local placements mirror — byte for byte as before the split;
 *  - the production single-file artifact contains NONE of it. The guarded
 *    branches are dead code under `import.meta.env.DEV === false` and the
 *    bundler removes them, which `scripts/verify-dist.mjs` and
 *    `napplet-conformance`'s forbidden-surface scan both verify from the
 *    outside. In the artifact these functions return null/false and their
 *    callers degrade to named absences: presence lists stay empty, publish
 *    fails with a reason, nothing pretends to have looked.
 *
 * When the shell OUTBOX/signer domains land, they slot in here — the
 * callers already handle both answers.
 */

export type Nip07Signer = {
  signEvent: (event: {
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
  }) => Promise<{
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
    id: string;
    pubkey: string;
    sig: string;
  }>;
};

/**
 * Open a relay socket — development only. In the production artifact there
 * is no socket to open and callers must treat `null` as "this transport
 * does not exist here", not as an error to retry.
 */
export function openRelaySocket(url: string): WebSocket | null {
  if (import.meta.env.DEV) {
    try {
      return new WebSocket(url);
    } catch {
      return null;
    }
  }
  return null;
}

/** The NIP-07 browser-extension signer — development only. */
export function devSigner(): Nip07Signer | null {
  if (import.meta.env.DEV) {
    const candidate = (window as Window & { nostr?: unknown }).nostr;
    if (
      candidate &&
      typeof (candidate as Record<string, unknown>).signEvent === 'function'
    ) {
      return candidate as Nip07Signer;
    }
  }
  return null;
}

/**
 * POST to the local collection mirror — development only. Local sync is dev
 * convenience; the signed event is the truth, so the artifact simply skips
 * this and loses nothing it is entitled to claim.
 */
export async function devPostJson(url: string, body: unknown): Promise<boolean> {
  if (import.meta.env.DEV) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
