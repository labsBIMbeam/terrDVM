/// <reference types="vite/client" />

/**
 * The transport seam, with the same discipline as the player's.
 *
 * In a shell: relay reads go through the OUTBOX domain and blob reads through
 * RESOURCE, both via the kit's privileged adapter. In `vite dev` there is no
 * shell, so a direct WebSocket and a direct fetch stand in — and both live
 * behind `import.meta.env.DEV`, so the production single-file artifact
 * contains neither. That is not a stylistic preference: `verify-dist.mjs` and
 * `napplet-conformance`'s forbidden-surface scan both fail the build if a
 * `WebSocket(` or `fetch(` survives into the artifact.
 *
 * Absence is always named. Without a shell and without dev, the functions here
 * report that they have no way to ask — never an empty result, which would be
 * a claim about the corpus rather than about this client.
 */

import {
  queryThroughShell,
  type RelayEvent,
  type RelayFilter,
} from '@terrcvm/napplet-kit/shell/outbox-client';
import { loadApprovedBytes } from '@terrcvm/napplet-kit/shell/resource-client';
import type { CorpusTransport } from './load';

export class TransportUnavailable extends Error {
  constructor(what: string) {
    super(
      `${what} is unavailable here: this napplet needs a shell that grants it, ` +
        'and there is no fallback in the built artifact.',
    );
    this.name = 'TransportUnavailable';
  }
}

/** Only blobs from the announced server, addressed by a 64-hex name. */
export function blobUrlAllowed(url: string, servers: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^\/[0-9a-f]{64}$/.test(parsed.pathname)) return false;
  return servers.some((server) => {
    try {
      return new URL(server).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

export class RelayUnreachable extends Error {
  constructor(relay: string) {
    super(`the relay ${relay} refused the connection or dropped it before answering`);
    this.name = 'RelayUnreachable';
  }
}

/** Is the development transport compiled into this build at all? */
export function devTransportAvailable(): boolean {
  return import.meta.env.DEV;
}

/**
 * One REQ over a plain socket — development only.
 *
 * Collects EVENTs until EOSE, then closes. THROWS on a socket error rather
 * than reporting absence: "there is no way to ask" and "the relay would not
 * talk to me" are different facts, and the first version of this function
 * returned the former for both — so a dead relay produced a message blaming a
 * missing shell capability. Caught live on the first run against the stack.
 */
async function devQuery(
  relay: string,
  filters: RelayFilter[],
  timeoutMs: number,
): Promise<RelayEvent[]> {
  // The guard must WRAP the socket, not merely precede it. Hoisting this check
  // into a helper left `new WebSocket(` reachable in the bundle, and both
  // verify-dist and conformance's forbidden-globals scan failed the build —
  // working exactly as intended. `if (import.meta.env.DEV)` becomes
  // `if (false)` at build time and the whole block is eliminated.
  if (!import.meta.env.DEV) throw new TransportUnavailable('the shell OUTBOX capability');

  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(relay);
    } catch {
      reject(new RelayUnreachable(relay));
      return;
    }

    const collected: RelayEvent[] = [];
    const subscription = `corpus-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    const finish = (value: RelayEvent[] | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (error !== undefined) reject(error);
      else resolve(value ?? []);
    };
    // A timeout is not a failure here: EOSE may simply be slow, and the events
    // already collected are real. An unreachable relay errors instead.
    const timer = setTimeout(() => finish(collected), timeoutMs);

    socket.onopen = () => socket.send(JSON.stringify(['REQ', subscription, ...filters]));
    socket.onerror = () => finish(null, new RelayUnreachable(relay));
    socket.onmessage = (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      if (frame[0] === 'EVENT' && frame[1] === subscription) collected.push(frame[2] as RelayEvent);
      else if (frame[0] === 'EOSE' && frame[1] === subscription) finish(collected);
      else if (frame[0] === 'CLOSED' && frame[1] === subscription) finish(collected);
    };
  });
}

/** One blob over a plain fetch — development only. */
async function devBytes(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!import.meta.env.DEV) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`blob fetch failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export type CorpusTransportOptions = {
  relay: string;
  /** Blossom origins learned from collection events; the allowlist for bytes. */
  servers: () => readonly string[];
  timeoutMs?: number;
};

/**
 * The transport the app runs on: shell first, dev fallback, then a named
 * absence.
 */
export function createCorpusTransport(options: CorpusTransportOptions): CorpusTransport {
  const timeoutMs = options.timeoutMs ?? 8000;

  return {
    query: async (filters) => {
      const viaShell = await queryThroughShell(filters, {
        relays: [options.relay],
        timeoutMs,
      });
      if (viaShell !== null) return viaShell;

      if (!devTransportAvailable()) throw new TransportUnavailable('the shell OUTBOX capability');
      return await devQuery(options.relay, filters, timeoutMs);
    },

    bytes: async (url) => {
      const servers = options.servers();
      if (!blobUrlAllowed(url, servers)) {
        throw new Error(`refusing to fetch ${url}: not an announced blossom server`);
      }

      try {
        const blob = await loadApprovedBytes(url, {
          deadlineMs: timeoutMs,
          isAllowed: (candidate) => blobUrlAllowed(candidate, servers),
        });
        return new Uint8Array(await blob.arrayBuffer());
      } catch (error) {
        const viaDev = await devBytes(url);
        if (viaDev !== null) return viaDev;
        throw error;
      }
    },
  };
}
