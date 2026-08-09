/**
 * What this client must be told, and what it refuses to guess.
 *
 * Two things cannot come from the corpus itself: the RELAY to ask (you cannot
 * learn a relay from events you have not fetched) and the PUBLISHER to trust
 * (the `authors` pin is the entire trust model — a client that accepts any
 * author has no trust model at all). Everything else — the blossom server, the
 * licence, the attribution, the extent — is read from the events.
 *
 * There is deliberately NO default publisher. A baked-in key would make the
 * demo start faster and would also mean the one security-relevant decision was
 * made by whoever wrote this file rather than by whoever runs it.
 */

import type { Tile } from '@terrcvm/geo-protocol';

export type CorpusConfig = {
  relay: string;
  /** 64-hex publisher key, or null when nobody has named one. */
  publisher: string | null;
  tile: Tile;
};

/** The slice's first tile: Funchal harbour, z14. */
export const DEFAULT_TILE: Tile = { z: 14, x: 7422, y: 6618 };

export const DEFAULT_RELAY = 'ws://127.0.0.1:7777';

const HEX64 = /^[0-9a-f]{64}$/;

/** Parse `z/x/y`, or null. */
export function parseTileParam(value: string | null): Tile | null {
  if (value === null) return null;
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  if (!parts.every((part) => /^(0|[1-9][0-9]*)$/.test(part))) return null;

  const [z, x, y] = parts.map(Number);
  if (z > 22) return null;
  const span = 2 ** z;
  if (x >= span || y >= span) return null;
  return { z, x, y };
}

/** Read the configuration out of a query string. */
export function readConfig(search: string): CorpusConfig {
  const params = new URLSearchParams(search);

  const publisher = (params.get('publisher') ?? '').toLowerCase();
  const relay = params.get('relay');

  return {
    relay: relay !== null && relay !== '' ? relay : DEFAULT_RELAY,
    publisher: HEX64.test(publisher) ? publisher : null,
    tile: parseTileParam(params.get('tile')) ?? DEFAULT_TILE,
  };
}
