#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
evidence_path="$repo_root/.planning/evidence/phase-01/secret-scan.txt"
expected_version='8.30.1'

fail() {
  printf 'FAIL secret-scan — %s\n' "$1" >&2
  exit 1
}

command -v gitleaks >/dev/null 2>&1 || fail 'gitleaks 8.30.1 is required but was not found'
actual_version="$(gitleaks version 2>/dev/null | tr -d '\r\n')"
[[ "$actual_version" == "$expected_version" ]] || fail "required gitleaks ${expected_version}; found a different version"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/terrdvm-gitleaks.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
scan_root="$tmp_dir/repository-files"
report_path="$tmp_dir/gitleaks-report.json"
scanner_log="$tmp_dir/gitleaks.log"
mkdir -p "$scan_root"

# Build a detached mirror from Git's tracked/untracked inventory. This gives
# Gitleaks repository-file coverage without traversing raw .git object internals.
# Ignored dist files are added explicitly when the production directory exists.
node - "$repo_root" "$scan_root" <<'NODE'
const { execFileSync } = require('node:child_process');
const {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  writeFileSync,
} = require('node:fs');
const { dirname, resolve, sep } = require('node:path');

const [repoRoot, scanRoot] = process.argv.slice(2).map((value) => resolve(value));
const gitPaths = (args) => execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', ...args], {
  encoding: 'buffer',
}).toString('utf8').split('\0').filter(Boolean);

const paths = new Set(gitPaths(['--cached', '--others', '--exclude-standard']));
try {
  if (lstatSync(resolve(repoRoot, 'apps/napplet/dist')).isDirectory()) {
    for (const path of gitPaths([
      '--cached', '--others', '--ignored', '--exclude-standard', '--', 'apps/napplet/dist',
    ])) paths.add(path);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const repoPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
for (const relativePath of [...paths].sort()) {
  const source = resolve(repoRoot, relativePath);
  if (!source.startsWith(repoPrefix) || relativePath === '.git' || relativePath.startsWith('.git/')) {
    throw new Error(`unsafe repository path in scan inventory: ${relativePath}`);
  }

  let stat;
  try {
    stat = lstatSync(source);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  const destination = resolve(scanRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  if (stat.isFile()) {
    copyFileSync(source, destination);
  } else if (stat.isSymbolicLink()) {
    writeFileSync(destination, readlinkSync(source), { encoding: 'utf8', mode: 0o600 });
  } else if (!stat.isDirectory()) {
    throw new Error(`unsupported repository file type in scan inventory: ${relativePath}`);
  }
}
NODE

set +e
gitleaks dir "$scan_root" \
  --no-banner \
  --no-color \
  --redact=100 \
  --log-level error \
  --report-format json \
  --report-path "$report_path" \
  >"$scanner_log" 2>&1
scan_status=$?
set -e

[[ $scan_status -eq 0 ]] || fail 'gitleaks returned non-zero; findings or scanner errors are suppressed'

node - "$report_path" <<'NODE'
const { existsSync, readFileSync } = require('node:fs');
const reportPath = process.argv[2];
if (!existsSync(reportPath)) process.exit(0);
const report = JSON.parse(readFileSync(reportPath, 'utf8') || '[]');
if (!Array.isArray(report) || report.length !== 0) process.exit(1);
NODE

mkdir -p "$(dirname "$evidence_path")"
evidence_tmp="$tmp_dir/secret-scan.txt"
printf '%s\n' \
  'secret_scan: PASS' \
  'tool: gitleaks' \
  "version: ${actual_version}" \
  'coverage_mode: detached Git inventory mirror (tracked + untracked non-ignored repository files + apps/napplet/dist including ignored files when present; raw .git object internals excluded)' \
  "timestamp_utc: $(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  'summary: 0 findings; secret values redacted; raw scanner output not persisted' \
  >"$evidence_tmp"

# Keep repeatable successful verification from dirtying a clean checkout merely
# because wall-clock time advanced. Replace the evidence only when a semantic
# field other than timestamp changes.
if [[ -f "$evidence_path" ]] && node - "$evidence_path" "$evidence_tmp" <<'NODE'
const { readFileSync } = require('node:fs');
const normalize = (path) => readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('timestamp_utc:'))
  .join('\n');
process.exit(normalize(process.argv[2]) === normalize(process.argv[3]) ? 0 : 1);
NODE
then
  evidence_state='preserved semantic-equivalent evidence'
else
  mv "$evidence_tmp" "$evidence_path"
  evidence_state='redacted evidence written'
fi

printf 'PASS secret-scan — gitleaks %s; 0 findings; %s\n' "$actual_version" "$evidence_state"
