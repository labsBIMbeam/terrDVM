import { outbox } from '@napplet/sdk';

/**
 * The shell OUTBOX seam — relay reads without the app holding a socket.
 *
 * Sibling of `resource-client.ts` and here for the same reason: this directory
 * is the ONE place `@napplet/sdk` may be imported (`verify-shell-boundary.mjs`
 * enforces it), so an app that wants relay events asks the kit rather than
 * opening its own transport.
 *
 * Absence is reported, never faked. A shell without the OUTBOX domain returns
 * null from `getOutboxCapability()` and the caller degrades to a named state —
 * the same rule the resource client follows for denied capabilities.
 */

export type RelayFilter = {
  kinds: number[];
  authors?: string[];
  '#d'?: string[];
  '#g'?: string[];
  '#a'?: string[];
  limit?: number;
};

export type RelayEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

type NappletWindow = Window & {
  napplet?: {
    outbox?: unknown;
  };
};

/** The shell's outbox domain, or null when the shell does not offer one. */
export function getOutboxCapability(): typeof outbox | null {
  const shellOutbox = (window as NappletWindow).napplet?.outbox;
  return shellOutbox === undefined ? null : outbox;
}

/**
 * One-shot query through the shell.
 *
 * Returns null — not an empty array — when the capability is absent, because
 * "no shell outbox here" and "this publisher has nothing" must never collapse
 * into the same answer. An empty array is a real result about the corpus; null
 * is the absence of a way to ask.
 */
export async function queryThroughShell(
  filters: RelayFilter[],
  options: { relays?: string[]; timeoutMs?: number } = {},
): Promise<RelayEvent[] | null> {
  const capability = getOutboxCapability();
  if (capability === null) return null;

  const result = await capability.query(filters, {
    ...(options.relays ? { relays: options.relays } : {}),
    timeoutMs: options.timeoutMs ?? 8000,
  });
  // The shell hands back `{ event, sidecar }` per hit — the sidecar carries
  // relay hints this client has no use for. Unwrapping here keeps the app on
  // plain nostr events, and means the app never learns which relay answered,
  // which is the shell's business and not the corpus reader's.
  return (result?.events ?? []).map((hit) => hit.event as RelayEvent);
}
