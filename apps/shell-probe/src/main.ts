// R2 spike probe (VERTICAL-SLICE.md §6): one outbox REQ and one resource.bytes()
// through the REAL shell — no fallbacks, no direct network. Run under kehto/Paja
// on a host that reaches the corpus stack, BEFORE VS-4 opens. Defaults target the
// local dev stack; override any field via a URL-encoded JSON location hash, e.g.
//   #%7B%22relay%22%3A%22wss%3A%2F%2Falflx.example.ts.net%3A7777%22%7D

import { outbox, resource } from '@napplet/sdk';

type ProbeConfig = { relay: string; blossom: string; sha: string };

const DEFAULTS: ProbeConfig = {
  relay: 'ws://127.0.0.1:7777',
  blossom: 'http://127.0.0.1:3000',
  // The corpus dem blob, dem:13/3711/3309 — 43,014 bytes when it round-trips.
  sha: '87719b68d24463b569fbee9a14282dae2f7763c19412b09c09ccfbbf894d29bc',
};

const out = document.getElementById('out') ?? document.body;
const line = (text: string): void => {
  out.textContent = `${out.textContent ?? ''}${text}\n`;
};

function probeConfig(): ProbeConfig {
  try {
    const override: unknown = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    return { ...DEFAULTS, ...(override as Partial<ProbeConfig>) };
  } catch {
    return DEFAULTS;
  }
}

async function main(): Promise<void> {
  const { relay, blossom, sha } = probeConfig();
  const shell = (window as Window & { napplet?: Record<string, unknown> }).napplet;
  line(`shell bridge: ${shell ? 'present' : 'ABSENT'}`);
  line(`shell outbox: ${shell?.outbox ? 'present' : 'ABSENT'}`);
  line(`shell resource: ${shell?.resource ? 'present' : 'ABSENT'}`);

  try {
    const started = performance.now();
    const result = await outbox.query([{ kinds: [30550] }], {
      relays: [relay],
      timeoutMs: 8000,
    });
    const elapsed = Math.round(performance.now() - started);
    line(`outbox REQ ${relay}: EOSE after ${elapsed} ms, ${result.events.length} event(s)`);
  } catch (error) {
    line(`outbox REQ ${relay}: FAILED ${String(error)}`);
  }

  try {
    const blob = await resource.bytes(`${blossom}/${sha}`);
    line(`resource.bytes ${blossom}/${sha.slice(0, 12)}…: ${blob.size} bytes`);
  } catch (error) {
    line(`resource.bytes ${blossom}: FAILED ${String(error)}`);
  }

  line('probe complete — record this output in .planning/research/spike-verdicts.md');
}

void main();
