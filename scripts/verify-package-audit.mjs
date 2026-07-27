#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const AUDIT_PATH = new URL('../.planning/evidence/phase-01/package-audit.md', import.meta.url);
const START = '<!-- package-audit:rows:start -->';
const END = '<!-- package-audit:rows:end -->';

const projectPins = new Map([
  ['eslint@9.39.2', ['SUS', 'root `devDependencies`']],
  ['@eslint/js@9.39.2', ['OK', 'root `devDependencies`']],
  ['typescript-eslint@8.46.4', ['SUS', 'root `devDependencies`']],
  ['@napplet/sdk@0.25.0', ['SUS', '`apps/napplet` dependencies']],
  ['maplibre-gl@5.24.0', ['SUS', '`apps/napplet` dependencies']],
  ['terra-draw@1.32.2', ['SUS', '`apps/napplet` dependencies']],
  ['terra-draw-maplibre-gl-adapter@1.4.1', ['OK', '`apps/napplet` dependencies']],
  ['@turf/area@7.3.5', ['OK', '`apps/napplet` dependencies']],
  ['@napplet/vite-plugin@0.12.0', ['SUS', '`apps/napplet` devDependencies']],
  ['@napplet/conformance-cli@0.2.16', ['SUS', '`apps/napplet` devDependencies']],
  ['playwright@1.59.1', ['UNRESOLVED', '`apps/napplet` devDependencies']],
  ['vite@8.1.5', ['SUS', '`apps/napplet` devDependencies']],
  ['typescript@5.9.3', ['SUS', '`apps/napplet` devDependencies']],
  ['vitest@4.1.10', ['SUS', '`apps/napplet` devDependencies']],
]);

const existingPins = new Map([
  ['@kehto/cli@0.2.16', 'SUS'],
  ['@kehto/paja@0.8.0', 'UNRESOLVED'],
]);

const expectedHeader = [
  'Scope',
  'Exact pin',
  'Registry URL',
  'Official repository / ownership',
  'License',
  'Tarball identity',
  'Lifecycle findings',
  'Peer / engine reconciliation',
  'Install location',
  'Plan use',
  'Research verdict',
  'Human decision',
];

function fail(errors) {
  for (const error of errors) console.error(`package audit invalid: ${error}`);
  process.exitCode = 1;
}

function cells(line) {
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

function uncode(value) {
  return value.replace(/^`|`$/g, '');
}

let text;
try {
  text = await readFile(AUDIT_PATH, 'utf8');
} catch (error) {
  fail([`cannot read package-audit.md: ${error.message}`]);
  process.exit();
}

const errors = [];
const startIndex = text.indexOf(START);
const endIndex = text.indexOf(END);
if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  fail(['missing or misordered package row markers']);
  process.exit();
}

const tableLines = text
  .slice(startIndex + START.length, endIndex)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('|') && line.endsWith('|'));

if (tableLines.length < 2) {
  fail(['audited package table is missing']);
  process.exit();
}

const header = cells(tableLines[0]);
if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
  errors.push(`unexpected table columns: ${header.join(', ')}`);
}

const separator = cells(tableLines[1]);
if (separator.length !== expectedHeader.length || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
  errors.push('malformed Markdown table separator');
}

const rows = new Map();
for (const line of tableLines.slice(2)) {
  const row = cells(line);
  if (row.length !== expectedHeader.length) {
    errors.push(`row has ${row.length} cells instead of ${expectedHeader.length}: ${line}`);
    continue;
  }
  const pin = uncode(row[1]);
  if (!pin) {
    errors.push('row has an empty exact pin');
    continue;
  }
  if (rows.has(pin)) errors.push(`duplicate row: ${pin}`);
  rows.set(pin, row);
}

const allowed = new Set([...projectPins.keys(), ...existingPins.keys()]);
for (const pin of rows.keys()) {
  if (!allowed.has(pin)) errors.push(`extra dependency row outside approved-plus-Kehto set: ${pin}`);
}
for (const pin of allowed) {
  if (!rows.has(pin)) errors.push(`missing required row: ${pin}`);
}

for (const [pin, row] of rows) {
  if (row.slice(2).some((value) => value.length === 0)) errors.push(`required evidence cell is empty: ${pin}`);
  const expectedRegistry = `https://www.npmjs.com/package/${pin.slice(0, pin.lastIndexOf('@'))}/v/${pin.slice(pin.lastIndexOf('@') + 1)}`;
  if (row[2] !== expectedRegistry) errors.push(`registry URL mismatch for ${pin}`);
  if (!/^https:\/\/github\.com\//.test(row[3])) errors.push(`official repository/ownership is not a GitHub source for ${pin}`);
  if (!/shasum `?[a-f0-9]{40}`?; integrity `sha512-[A-Za-z0-9+/=]+`/.test(row[5])) {
    errors.push(`tarball identity lacks shasum and sha512 integrity for ${pin}`);
  }
  if (!/No preinstall\/install\/postinstall/.test(row[6])) errors.push(`lifecycle finding missing for ${pin}`);
  if (row[11] !== 'PENDING HUMAN APPROVAL') errors.push(`human decision must remain explicit and pending at Task 2: ${pin}`);

  if (projectPins.has(pin)) {
    const [verdict, location] = projectPins.get(pin);
    if (row[0] !== 'project-install') errors.push(`wrong scope for project pin ${pin}: ${row[0]}`);
    if (row[8] !== location) errors.push(`wrong install location for ${pin}: ${row[8]}`);
    if (row[10] !== verdict) errors.push(`research verdict drift for ${pin}: expected ${verdict}, got ${row[10]}`);
  } else {
    if (row[0] !== 'not-project-installed') errors.push(`Kehto/Paja row is not marked not-project-installed: ${pin}`);
    if (!/NEVER package\.json\/lockfile/.test(row[8])) errors.push(`Kehto/Paja install exclusion missing: ${pin}`);
    if (row[10] !== existingPins.get(pin)) errors.push(`existing-install verdict drift for ${pin}`);
  }
}

const requiredText = [
  '## Direct Playwright and Chromium provisioning',
  '`"playwright": "^1.59.1"`',
  'pnpm --filter @terrdvm/napplet exec playwright install chromium',
  '`playwright install --with-deps`',
  '**NOT APPROVED**',
  '## Existing Kehto/Paja installation (audited, NOT project-installed)',
  '## Excluded — zero packages outside the list',
  '`vite-plugin-singlefile`',
  'shadcn or any component registry',
  'every Phase 2+ package or stack',
];
for (const required of requiredText) {
  if (!text.includes(required)) errors.push(`missing required dossier content: ${required}`);
}

if (rows.size !== 16) errors.push(`expected exactly 16 audited rows, found ${rows.size}`);
if ([...rows.values()].filter((row) => row[0] === 'project-install').length !== 14) {
  errors.push('expected exactly 14 project-install rows');
}
if ([...rows.values()].filter((row) => row[0] === 'not-project-installed').length !== 2) {
  errors.push('expected exactly 2 not-project-installed rows');
}

if (errors.length) {
  fail(errors);
} else {
  console.log('package audit valid: 14 project pins, 2 existing-install audit rows; approval pending');
}
