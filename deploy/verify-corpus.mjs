#!/usr/bin/env node
// VS-3 exit probe (VERTICAL-SLICE.md §3): the corpus announcements are on the
// relay and consistent with the stored bytes.
//
//   1. {kinds:[30550], authors:[crawler]} → the dataset collections, each with
//      bbox, license and server tags.
//   2. {kinds:[30551], authors:[crawler], "#g":[cell]} → exactly the expected
//      items, and every item's `x` tag re-fetches from blossom-server with a
//      matching sha256 — announcements and bytes agree, verified end to end.
//
// The crawler pubkey comes from deploy/.env (the authors filter is the trust
// model on a public relay). Override RELAY_URL / BLOSSOM_URL / G_CELL to probe
// a remote deployment.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RELAY_URL = process.env.RELAY_URL ?? 'ws://127.0.0.1:7777';
const BLOSSOM_URL = process.env.BLOSSOM_URL ?? 'http://127.0.0.1:3000';
const G_CELL = process.env.G_CELL ?? 'etgc';
const TIMEOUT_MS = 10000;

function crawlerPubkey() {
  const text = readFileSync(join(here, '.env'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('CRAWLER_PUBKEY='));
  const value = line?.split('=')[1]?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('CRAWLER_PUBKEY missing from deploy/.env');
  return value;
}

function query(filter) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const events = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no EOSE within ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'corpus-probe', filter]));
    ws.onmessage = (msg) => {
      let frame;
      try {
        frame = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (frame[0] === 'EVENT' && frame[1] === 'corpus-probe') events.push(frame[2]);
      if (frame[0] === 'EOSE' && frame[1] === 'corpus-probe') {
        clearTimeout(timer);
        ws.close();
        resolve(events);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('websocket error'));
    };
  });
}

const tag = (event, name) => event.tags.filter((t) => t[0] === name).map((t) => t.slice(1));

const results = [];
const record = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

const author = crawlerPubkey();

const collections = await query({ kinds: [30550], authors: [author] });
const datasets = collections.map((c) => tag(c, 'd')[0]?.[0]).sort();
record(
  'collections announced',
  datasets.join(',') === 'dem,features',
  `datasets: ${datasets.join(', ') || 'none'}`,
);
for (const c of collections) {
  const d = tag(c, 'd')[0]?.[0];
  const complete = ['bbox', 'license', 'server', 'm'].every((n) => tag(c, n).length === 1);
  record(`collection ${d} carries bbox/license/server/m`, complete, complete ? 'all present' : 'missing tags');
}

const items = await query({ kinds: [30551], authors: [author], '#g': [G_CELL] });
const ids = items.map((i) => tag(i, 'd')[0]?.[0]).sort();
record(
  `items in cell ${G_CELL}`,
  items.length === 2,
  `${items.length} item(s): ${ids.join(', ') || 'none'}`,
);

for (const item of items) {
  const d = tag(item, 'd')[0]?.[0];
  const sha = tag(item, 'x')[0]?.[0] ?? '';
  try {
    const response = await fetch(`${BLOSSOM_URL}/${sha}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    record(
      `item ${d} bytes match announcement`,
      digest === sha,
      digest === sha ? `${bytes.length.toLocaleString()} B, sha ok` : `digest ${digest.slice(0, 12)}… != x tag`,
    );
  } catch (error) {
    record(`item ${d} bytes match announcement`, false, error.message);
  }
}

const failed = results.filter((p) => !p).length;
console.log(failed === 0 ? '\nVS-3 probe: all checks pass' : `\nVS-3 probe: ${failed} check(s) failing`);
process.exitCode = failed === 0 ? 0 : 1;
