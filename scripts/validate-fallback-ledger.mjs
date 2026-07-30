#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(repoRoot, '.planning/evidence/fallback-ledger.jsonl');
const requiredKeys = [
  'schema_version',
  'occurred_at',
  'phase',
  'requirement',
  'blocker_id',
  'blocked_integration',
  'started_at',
  'elapsed_minutes',
  'trigger',
  'fallback_id',
  'reason',
  'decided_by',
  'user_visible_state',
  'evidence_paths',
  'outcome',
];
const allowedKeys = new Set(requiredKeys);
const outcomes = new Set(['activated', 'resolved', 'failed-closed']);

function isRfc3339Utc(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRepoRelativePath(value) {
  if (!isNonEmptyString(value) || isAbsolute(value) || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..' || segment === '' || segment === '.')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

function validateEntry(entry, lineNumber) {
  const errors = [];
  const at = (field, detail) => errors.push(`line ${lineNumber}: ${field} ${detail}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`line ${lineNumber}: root must be a JSON object`];
  }

  for (const key of requiredKeys) {
    if (!(key in entry)) at(key, 'is missing');
  }
  for (const key of Object.keys(entry)) {
    if (!allowedKeys.has(key)) at(key, 'is not part of schema_version 1');
  }

  if (entry.schema_version !== 1) at('schema_version', 'must equal 1');
  if (!isRfc3339Utc(entry.occurred_at)) at('occurred_at', 'must be an RFC3339 UTC timestamp');
  if (!isRfc3339Utc(entry.started_at)) at('started_at', 'must be an RFC3339 UTC timestamp');
  if (
    isRfc3339Utc(entry.occurred_at) &&
    isRfc3339Utc(entry.started_at) &&
    Date.parse(entry.started_at) > Date.parse(entry.occurred_at)
  ) {
    at('started_at', 'must be less than or equal to occurred_at');
  }

  if (entry.phase !== '01') at('phase', 'must equal "01"');
  if (entry.requirement !== 'OPS-01') at('requirement', 'must equal OPS-01');
  for (const field of [
    'blocker_id',
    'blocked_integration',
    'trigger',
    'fallback_id',
    'reason',
    'decided_by',
    'user_visible_state',
  ]) {
    if (!isNonEmptyString(entry[field])) at(field, 'must be a non-empty string');
  }

  if (!Number.isFinite(entry.elapsed_minutes) || entry.elapsed_minutes < 0) {
    at('elapsed_minutes', 'must be a non-negative finite number');
  }
  if (entry.trigger === '30-minute blocker law' && entry.elapsed_minutes < 30) {
    at('elapsed_minutes', 'must be at least 30 for the 30-minute blocker law');
  }

  if (!Array.isArray(entry.evidence_paths)) {
    at('evidence_paths', 'must be an array');
  } else {
    entry.evidence_paths.forEach((evidencePath, index) => {
      if (!isRepoRelativePath(evidencePath)) {
        at(`evidence_paths[${index}]`, 'must be a normalized repository-relative POSIX path without traversal');
      }
    });
  }

  if (!outcomes.has(entry.outcome)) {
    at('outcome', 'must be activated, resolved, or failed-closed');
  }

  return errors;
}

let contents;
try {
  contents = await readFile(ledgerPath, 'utf8');
} catch (error) {
  console.error(`ledger invalid: file (${error.message})`);
  process.exit(1);
}

if (contents.length === 0) {
  console.log('ledger valid: 0 entries');
  process.exit(0);
}

const lines = contents.split('\n');
if (lines.at(-1) === '') lines.pop();
const errors = [];
for (const [index, line] of lines.entries()) {
  if (line.trim() === '') {
    errors.push(`line ${index + 1}: blank lines are not valid JSONL entries`);
    continue;
  }
  try {
    errors.push(...validateEntry(JSON.parse(line), index + 1));
  } catch (error) {
    errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
  }
}

if (errors.length > 0) {
  console.error('ledger invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`ledger valid: ${lines.length} entries`);
