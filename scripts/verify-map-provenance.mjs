#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const recordPath = join(repoRoot, '.planning/evidence/phase-01/map-provenance.json');
const evidenceFields = [
  'source_location',
  'version_identity',
  'license',
  'provenance_chain',
  'maplibre_pin',
];
const expectedConsequence =
  'The Napplet uses a clean MapLibre-compatible implementation; 21maps code, assets, styles, and configuration are not copied.';
const expectedReuseCondition =
  'if immutable 21maps provenance is independently found during execution BEFORE any map code exists, the decision may be flipped to "verified-reuse" only when all five evidence fields are non-empty and pass; the plan does not depend on that happening.';

function fail(field, detail) {
  console.error(`map provenance invalid: ${field}${detail ? ` (${detail})` : ''}`);
  process.exitCode = 1;
}

function isRfc3339Utc(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

let record;
try {
  record = JSON.parse(await readFile(recordPath, 'utf8'));
} catch (error) {
  fail('file', error.message);
  process.exit();
}

if (!record || typeof record !== 'object' || Array.isArray(record)) {
  fail('root', 'must be a JSON object');
} else {
  if (record.requirement !== 'MAP-08') fail('requirement', 'expected MAP-08');
  if (!isRfc3339Utc(record.decided_at)) fail('decided_at', 'expected RFC3339 UTC');
  if (typeof record.reason !== 'string' || record.reason.trim() === '') fail('reason', 'must be non-empty');
  if (record.consequence !== expectedConsequence) fail('consequence', 'unexpected clean-room boundary');
  if (record.reuse_condition !== expectedReuseCondition) fail('reuse_condition', 'unexpected exception clause');

  if (!record.evidence || typeof record.evidence !== 'object' || Array.isArray(record.evidence)) {
    fail('evidence', 'must be an object');
  } else if (record.decision === 'clean-room-fallback') {
    for (const field of evidenceFields) {
      if (!(field in record.evidence)) fail(`evidence.${field}`, 'missing');
      else if (record.evidence[field] !== null) fail(`evidence.${field}`, 'fallback evidence must be null');
    }
  } else if (record.decision === 'verified-reuse') {
    for (const field of evidenceFields) {
      const value = record.evidence[field];
      if (typeof value !== 'string' || value.trim() === '') {
        fail(`evidence.${field}`, 'verified reuse requires a non-empty string');
      }
    }
  } else {
    fail('decision', 'expected clean-room-fallback or verified-reuse');
  }
}

if (process.exitCode !== 1) {
  console.log(`map provenance valid: ${record.decision}`);
}
