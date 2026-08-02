#!/usr/bin/env node
// VS-1 exit-condition probe (VERTICAL-SLICE.md §3, §5.3): a REQ over the wire
// returns EOSE, and HEAD /<64 hex> on blossom-server returns a well-formed 404 —
// plus a liveness check on blossom-gis. Exits non-zero if any check fails.

const RELAY_URL = process.env.RELAY_URL ?? 'ws://127.0.0.1:7777';
const BLOSSOM_URL = process.env.BLOSSOM_URL ?? 'http://127.0.0.1:3000';
const GIS_URL = process.env.GIS_URL ?? 'http://127.0.0.1:8787';
const TIMEOUT_MS = 8000;

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function checkRelayEose() {
  const name = `relay REQ→EOSE (${RELAY_URL})`;
  try {
    const detail = await new Promise((resolve, reject) => {
      const ws = new WebSocket(RELAY_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`no EOSE within ${TIMEOUT_MS} ms`));
      }, TIMEOUT_MS);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', 'vs1-probe', { kinds: [30550], limit: 1 }]));
      };
      ws.onmessage = (msg) => {
        let frame;
        try {
          frame = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (frame[0] === 'EOSE' && frame[1] === 'vs1-probe') {
          clearTimeout(timer);
          ws.close();
          resolve('EOSE received');
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('websocket error'));
      };
    });
    record(name, true, detail);
  } catch (error) {
    record(name, false, error.message);
  }
}

async function checkBlossom404() {
  const zeros = '0'.repeat(64);
  const name = `blossom HEAD /<64 hex> (${BLOSSOM_URL})`;
  try {
    const response = await fetch(`${BLOSSOM_URL}/${zeros}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) {
      record(name, true, 'well-formed 404 for an unknown hash');
    } else {
      record(name, false, `expected 404, got ${response.status}`);
    }
  } catch (error) {
    record(name, false, error.message);
  }
}

async function checkGisRoot() {
  const name = `blossom-gis GET / (${GIS_URL})`;
  try {
    const response = await fetch(`${GIS_URL}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.ok) {
      record(name, true, `HTTP ${response.status}`);
    } else {
      record(name, false, `HTTP ${response.status}`);
    }
  } catch (error) {
    record(name, false, error.message);
  }
}

await checkRelayEose();
await checkBlossom404();
await checkGisRoot();

const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? '\nVS-1 probe: all checks pass' : `\nVS-1 probe: ${failed.length} check(s) failing`);
process.exit(failed.length === 0 ? 0 : 1);
