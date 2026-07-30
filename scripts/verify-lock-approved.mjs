import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = resolve(repoRoot, '.planning/evidence/phase-01/package-audit.md');
const audit = readFileSync(auditPath, 'utf8');

const approvalMatch = audit.match(
  /<!-- package-audit:approval:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- package-audit:approval:end -->/,
);
if (!approvalMatch) {
  throw new Error('package audit approval JSON block is missing');
}

const approval = JSON.parse(approvalMatch[1]);
if (approval.status !== 'approved' || !Array.isArray(approval.project_pins)) {
  throw new Error('package audit is not human-approved with project pins');
}

const rowsMatch = audit.match(
  /<!-- package-audit:rows:start -->([\s\S]*?)<!-- package-audit:rows:end -->/,
);
if (!rowsMatch) {
  throw new Error('package audit rows block is missing');
}

const approved = new Map();
for (const line of rowsMatch[1].split('\n')) {
  if (!line.startsWith('| project-install |')) continue;
  const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
  const pinMatch = cells[1]?.match(/^`(.+)@([^@]+)`$/);
  if (!pinMatch) throw new Error(`cannot parse approved pin row: ${line}`);
  const [, name, version] = pinMatch;
  const locationCell = cells[8] ?? '';
  const location = locationCell.startsWith('root ')
    ? '.'
    : locationCell.startsWith('`apps/napplet` ')
      ? 'apps/napplet'
      : null;
  if (!location) throw new Error(`cannot parse install location for ${name}@${version}`);
  approved.set(`${location}:${name}`, version);
}

const approvedPins = new Set(approval.project_pins);
const rowPins = new Set([...approved.entries()].map(([key, version]) => {
  const name = key.slice(key.indexOf(':') + 1);
  return `${name}@${version}`;
}));
if (approved.size !== approval.project_pins.length ||
    [...approvedPins].some((pin) => !rowPins.has(pin))) {
  throw new Error('approval JSON pins and audited project-install rows differ');
}

const listing = JSON.parse(execFileSync(
  'pnpm',
  ['ls', '-r', '--depth', '0', '--json'],
  { cwd: repoRoot, encoding: 'utf8' },
));

const installed = new Map();
for (const importer of listing) {
  const importerPath = relative(repoRoot, importer.path || repoRoot).replaceAll('\\', '/') || '.';
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, record] of Object.entries(importer[group] ?? {})) {
      if (record?.version == null) throw new Error(`missing installed version for ${importerPath}:${name}`);
      installed.set(`${importerPath}:${name}`, String(record.version));
    }
  }
}

const errors = [];
for (const [key, version] of approved) {
  const actual = installed.get(key);
  if (actual == null) errors.push(`missing approved direct dependency ${key}@${version}`);
  else if (actual !== version) errors.push(`version drift for ${key}: expected ${version}, got ${actual}`);
}
for (const [key, version] of installed) {
  if (!approved.has(key)) errors.push(`extra direct dependency ${key}@${version}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`approved lock valid: ${installed.size} exact direct dependencies across ${listing.length} importers`);
