#!/usr/bin/env node
// Live write-policy probe: the relay must accept an event signed by the crawler
// key and reject the same shape signed by any other key (VERTICAL-SLICE.md VS-1
// trust model, VS-3 exit condition "write path closed").
//
// Reads the crawler SECRET from a local file (default deploy/.local/dev-crawler.secret,
// override with CRAWLER_SECRET_FILE). The secret never travels anywhere: events are
// signed here and only signatures cross the wire.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Borrowed from the napplet's pinned dependency set rather than duplicating a
// crypto dependency for one probe script.
const nobleDir = join(here, '..', 'apps', 'napplet', 'node_modules', '@noble');
const { schnorr } = await import(pathToFileURL(join(nobleDir, 'curves', 'secp256k1.js')));
const { sha256 } = await import(pathToFileURL(join(nobleDir, 'hashes', 'sha2.js')));

const RELAY_URL = process.env.RELAY_URL ?? 'ws://127.0.0.1:7777';
const SECRET_FILE =
  process.env.CRAWLER_SECRET_FILE ?? join(here, '.local', 'dev-crawler.secret');

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (text) => Uint8Array.from(text.match(/../g), (pair) => parseInt(pair, 16));
const utf8 = (text) => new TextEncoder().encode(text);

function signedEvent(secretHex, content) {
  const secret = unhex(secretHex);
  const pubkey = hex(schnorr.getPublicKey(secret));
  const created_at = Math.floor(Date.now() / 1000);
  const kind = 1;
  const tags = [];
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = hex(sha256(utf8(serialized)));
  const sig = hex(schnorr.sign(unhex(id), secret));
  return { id, pubkey, created_at, kind, tags, content, sig };
}

function publish(event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('no OK frame within 8s'));
    }, 8000);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (msg) => {
      let frame;
      try {
        frame = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (frame[0] === 'OK' && frame[1] === event.id) {
        clearTimeout(timer);
        ws.close();
        resolve({ accepted: frame[2] === true, msg: frame[3] ?? '' });
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('websocket error'));
    };
  });
}

const crawlerSecret = readFileSync(SECRET_FILE, 'utf8').trim();
if (!/^[0-9a-f]{64}$/.test(crawlerSecret)) {
  console.error(`probe: ${SECRET_FILE} does not contain a 64-hex secret`);
  process.exitCode = 1;
} else {
  const results = [];

  const fromCrawler = await publish(signedEvent(crawlerSecret, 'corpus write-policy probe'));
  results.push({
    name: 'crawler-signed event accepted',
    pass: fromCrawler.accepted,
    detail: fromCrawler.accepted ? 'OK true' : `OK false: ${fromCrawler.msg}`,
  });

  const foreignSecret = hex(
    (schnorr.utils.randomSecretKey ?? schnorr.utils.randomPrivateKey)(),
  );
  const fromForeign = await publish(signedEvent(foreignSecret, 'corpus write-policy probe'));
  results.push({
    name: 'foreign-signed event rejected',
    pass: !fromForeign.accepted && fromForeign.msg.startsWith('blocked'),
    detail: fromForeign.accepted ? 'OK true — WRITE PATH OPEN' : `OK false: ${fromForeign.msg}`,
  });

  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed === 0 ? '\nwrite policy: enforcing' : '\nwrite policy: NOT enforcing');
  process.exitCode = failed === 0 ? 0 : 1;
}
