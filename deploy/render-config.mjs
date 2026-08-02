#!/usr/bin/env node
// Render blossom-server/config.template.yml with values from deploy/.env into
// deploy/.local/blossom-server.config.yml (gitignored). Kept out of compose so a
// concrete pubkey never lands in a committed file by accident.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function parseEnvFile(path) {
  const values = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`missing ${path} — copy .env.example to .env and fill it in`);
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

function fail(message) {
  console.error(`render-config: ${message}`);
  process.exit(1);
}

const env = parseEnvFile(join(here, '.env'));

const crawlerPubkey = (env.CRAWLER_PUBKEY ?? '').toLowerCase();
if (!/^[0-9a-f]{64}$/.test(crawlerPubkey)) {
  fail('CRAWLER_PUBKEY must be 64 lowercase hex characters (the PUBLIC key — never the secret)');
}
if (/^0{64}$/.test(crawlerPubkey)) {
  fail('CRAWLER_PUBKEY is still the .env.example placeholder');
}

const publicUrl = env.PUBLIC_URL ?? 'http://127.0.0.1:3000';

const template = readFileSync(join(here, 'blossom-server', 'config.template.yml'), 'utf8');
const rendered = template
  .replaceAll('__CRAWLER_PUBKEY__', crawlerPubkey)
  .replaceAll('__PUBLIC_URL__', publicUrl);

const outDir = join(here, '.local');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'blossom-server.config.yml');
writeFileSync(outPath, rendered);
console.log(`render-config: wrote ${outPath}`);
