import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAY, DEFAULT_TILE, parseTileParam, readConfig } from '../../src/config';
import { blobUrlAllowed } from '../../src/corpus/transport';

describe('readConfig', () => {
  it('falls back to the slice tile and the local relay', () => {
    const config = readConfig('');
    expect(config.tile).toEqual(DEFAULT_TILE);
    expect(config.relay).toBe(DEFAULT_RELAY);
  });

  it('has no publisher until one is named — the trust pin is never guessed', () => {
    expect(readConfig('').publisher).toBeNull();
    expect(readConfig('?publisher=notakey').publisher).toBeNull();
    expect(readConfig(`?publisher=${'A'.repeat(64)}`).publisher).toBe('a'.repeat(64));
  });

  it('takes relay and tile overrides', () => {
    const config = readConfig('?relay=wss://relay.test&tile=13/3711/3309');
    expect(config.relay).toBe('wss://relay.test');
    expect(config.tile).toEqual({ z: 13, x: 3711, y: 3309 });
  });
});

describe('parseTileParam', () => {
  it('rejects malformed, out-of-range and non-canonical tiles', () => {
    for (const bad of [null, '', '14/7422', '14/7422/6618/1', '14/-1/0', '1/2/9999', '99/0/0', '014/1/1']) {
      expect(parseTileParam(bad)).toBeNull();
    }
    expect(parseTileParam('14/7422/6618')).toEqual({ z: 14, x: 7422, y: 6618 });
  });
});

describe('blobUrlAllowed', () => {
  const servers = ['http://blossom.test'];
  const sha = 'a'.repeat(64);

  it('allows a 64-hex path on an announced origin', () => {
    expect(blobUrlAllowed(`http://blossom.test/${sha}`, servers)).toBe(true);
  });

  it('refuses another host, another path shape, and junk', () => {
    expect(blobUrlAllowed(`http://elsewhere.test/${sha}`, servers)).toBe(false);
    expect(blobUrlAllowed('http://blossom.test/admin', servers)).toBe(false);
    expect(blobUrlAllowed(`http://blossom.test/${sha}.png`, servers)).toBe(false);
    expect(blobUrlAllowed('not a url', servers)).toBe(false);
    expect(blobUrlAllowed(`http://blossom.test/${sha}`, [])).toBe(false);
  });
});
