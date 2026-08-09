import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RelayUnreachable,
  TransportUnavailable,
  createCorpusTransport,
} from '../../src/corpus/transport';

/**
 * The shell adapter reads `window.napplet`, so a window has to exist for the
 * "no shell here" branch to be reachable at all. An empty object IS the case
 * under test: a page with no shell bridge.
 */
const hadWindow = 'window' in globalThis;

beforeAll(() => {
  if (!hadWindow) (globalThis as { window?: unknown }).window = {};
});

afterAll(() => {
  if (!hadWindow) delete (globalThis as { window?: unknown }).window;
});

describe('createCorpusTransport', () => {
  it('blames the relay, not a missing capability, when the relay will not talk', async () => {
    // The regression this pins: the first version reported the dev socket's
    // failure as "the shell OUTBOX capability is unavailable", so a dead relay
    // produced a message about a missing shell. Two different facts.
    const transport = createCorpusTransport({
      relay: 'ws://127.0.0.1:1',
      servers: () => [],
      timeoutMs: 3000,
    });

    await expect(transport.query([{ kinds: [30550] }])).rejects.toBeInstanceOf(RelayUnreachable);
    await expect(transport.query([{ kinds: [30550] }])).rejects.not.toBeInstanceOf(
      TransportUnavailable,
    );
  });

  it('refuses a blob from a host no collection announced', async () => {
    const transport = createCorpusTransport({
      relay: 'ws://127.0.0.1:1',
      servers: () => ['http://blossom.test'],
    });

    await expect(transport.bytes(`http://elsewhere.test/${'a'.repeat(64)}`)).rejects.toThrow(
      /announced blossom server/,
    );
  });
});
