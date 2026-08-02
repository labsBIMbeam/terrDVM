#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

pass() {
  printf 'PASS %s\n' "$1"
}

skip() {
  printf 'SKIP %s — %s\n' "$1" "$2"
}

fail() {
  printf 'FAIL %s — %s\n' "$1" "$2" >&2
  exit 1
}

run_step() {
  local name="$1"
  shift
  if "$@"; then
    pass "$name"
  else
    local status=$?
    fail "$name" "command exited ${status}"
  fi
}

verify_manifest_cases() {
  node <<'NODE'
const { existsSync, readFileSync } = require('node:fs');
const { isAbsolute, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const manifestPath = resolve(repoRoot, 'apps/terrain/tests/smoke/cases.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`manifest-cases: cannot parse cases.json: ${error.message}`);
  process.exit(1);
}

if (manifest.schema_version !== 1 || !Array.isArray(manifest.cases)) {
  console.error('manifest-cases: cases.json requires schema_version 1 and a cases array');
  process.exit(1);
}

const repoPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
const isRepoRelative = (value) => {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) return false;
  const absolute = resolve(repoRoot, value);
  return absolute.startsWith(repoPrefix);
};

for (const entry of manifest.cases) {
  const id = entry && typeof entry.id === 'string' ? entry.id : '<unnamed>';
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) ||
      typeof entry.requirement !== 'string' || entry.requirement.length === 0 ||
      !isRepoRelative(entry.script) ||
      !Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== 'string') ||
      !isRepoRelative(entry.evidence)) {
    console.error(`manifest case ${id}: invalid schema`);
    process.exit(1);
  }

  const scriptPath = resolve(repoRoot, entry.script);
  if (!existsSync(scriptPath)) {
    console.error(`manifest case ${entry.id}: missing script ${entry.script}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...entry.args], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit ${result.status}`;
    console.error(`manifest case ${entry.id}: runner failed (${detail})`);
    process.exit(1);
  }
}
NODE
}

run_step unit pnpm --filter @terrcvm/napplet-terrain test:unit
run_step typecheck pnpm --filter @terrcvm/napplet-terrain typecheck
run_step lint pnpm lint

build_ran=false
if [[ -f apps/terrain/vite.config.ts ]]; then
  run_step build pnpm --filter @terrcvm/napplet-terrain build
  build_ran=true
else
  skip build 'apps/terrain/vite.config.ts does not exist yet'
fi

if [[ -f scripts/verify-dist.mjs ]]; then
  if [[ "$build_ran" != true ]]; then
    fail verify-dist 'scripts/verify-dist.mjs exists but build did not run'
  fi
  run_step verify-dist node scripts/verify-dist.mjs apps/terrain
elif [[ "$build_ran" == true ]]; then
  fail verify-dist 'build exists but scripts/verify-dist.mjs is missing'
else
  skip verify-dist 'scripts/verify-dist.mjs does not exist yet'
fi

if [[ -f apps/terrain/vite.config.ts ]]; then
  run_step conformance pnpm --filter @terrcvm/napplet-terrain exec napplet-conformance ./dist --reporter json --out ../../.planning/evidence/phase-01/conformance.json
else
  skip conformance 'apps/terrain/vite.config.ts does not exist yet'
fi

run_step manifest-cases verify_manifest_cases

if [[ -f scripts/verify-shell-boundary.mjs ]]; then
  run_step shell-boundary node scripts/verify-shell-boundary.mjs
else
  skip shell-boundary 'scripts/verify-shell-boundary.mjs does not exist yet'
fi

run_step map-provenance node scripts/verify-map-provenance.mjs

if [[ -f scripts/verify-source-policy.mjs ]]; then
  run_step source-policy node scripts/verify-source-policy.mjs
else
  skip source-policy 'scripts/verify-source-policy.mjs does not exist yet'
fi

run_step ledger node scripts/validate-fallback-ledger.mjs

if [[ -f scripts/verify-no-local-surface.mjs ]]; then
  run_step local-surface node scripts/verify-no-local-surface.mjs
else
  skip local-surface 'scripts/verify-no-local-surface.mjs does not exist yet'
fi

run_step lock-approved node scripts/verify-lock-approved.mjs
run_step secret-scan bash scripts/scan-secrets.sh
run_step public-diff git diff --check
