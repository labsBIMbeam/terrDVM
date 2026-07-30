#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const DEFAULTS_PATH = new URL('../.planning/evidence/phase-01/v1-defaults.json', import.meta.url);
const expected = {
  schema_version: 1,
  requirement: 'MAP-07',
  status: 'immutable-v1',
  human_decision_status: 'approved',
  RES_M: 5,
  OUTPUT_MIME: 'model/gltf-binary',
  MAX_AREA_KM2: 100,
  TIMEOUT_S: 15,
};

function fail(errors) {
  for (const error of errors) console.error(`v1 defaults invalid: ${error}`);
  process.exitCode = 1;
}

let defaults;
try {
  defaults = JSON.parse(await readFile(DEFAULTS_PATH, 'utf8'));
} catch (error) {
  fail([`cannot read or parse v1-defaults.json: ${error.message}`]);
  process.exit();
}

const errors = [];
for (const [field, value] of Object.entries(expected)) {
  if (defaults[field] !== value) {
    errors.push(`${field}: expected ${JSON.stringify(value)}, got ${JSON.stringify(defaults[field])}`);
  }
}

if (
  typeof defaults.decided_at !== 'string' ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(defaults.decided_at) ||
  Number.isNaN(Date.parse(defaults.decided_at))
) {
  errors.push(`decided_at: expected parseable RFC3339 UTC seconds, got ${JSON.stringify(defaults.decided_at)}`);
}

if (typeof defaults.source !== 'string' || defaults.source.trim() === '') {
  errors.push('source: expected a non-empty planning source');
}

const expectedApprovedValues = {
  RES_M: 5,
  OUTPUT_MIME: 'model/gltf-binary',
  MAX_AREA_KM2: 100,
  TIMEOUT_S: 15,
};
const expectedApprovalKeys = ['recorded_at', 'source', 'response', 'scope', 'approved_values'];
if (!defaults.approval || typeof defaults.approval !== 'object' || Array.isArray(defaults.approval)) {
  errors.push('approval: expected exact human approval record');
} else {
  if (JSON.stringify(Object.keys(defaults.approval)) !== JSON.stringify(expectedApprovalKeys)) {
    errors.push(`approval keys drifted: ${Object.keys(defaults.approval).join(', ')}`);
  }
  if (
    typeof defaults.approval.recorded_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(defaults.approval.recorded_at) ||
    Number.isNaN(Date.parse(defaults.approval.recorded_at))
  ) {
    errors.push('approval.recorded_at: expected parseable RFC3339 UTC seconds');
  }
  if (defaults.approval.source !== 'Telegram human checkpoint') {
    errors.push('approval.source: expected Telegram human checkpoint');
  }
  if (defaults.approval.response !== 'approved') errors.push('approval.response: expected approved');
  if (defaults.approval.scope !== 'fixed-v1-defaults') {
    errors.push('approval.scope: expected fixed-v1-defaults');
  }
  if (JSON.stringify(defaults.approval.approved_values) !== JSON.stringify(expectedApprovedValues)) {
    errors.push('approval.approved_values: exact approved defaults drifted');
  }
}

const noteFields = ['RES_M', 'OUTPUT_MIME', 'MAX_AREA_KM2', 'TIMEOUT_S'];
if (!defaults.notes || typeof defaults.notes !== 'object' || Array.isArray(defaults.notes)) {
  errors.push('notes: expected rationale object');
} else {
  for (const field of noteFields) {
    if (typeof defaults.notes[field] !== 'string' || defaults.notes[field].trim() === '') {
      errors.push(`notes.${field}: expected non-empty rationale`);
    }
  }
}

if (
  typeof defaults.change_control !== 'string' ||
  !defaults.change_control.includes('must not choose or drift') ||
  !defaults.change_control.includes('new explicit human checkpoint')
) {
  errors.push('change_control: expected immutable-v1 executor prohibition and new-human-checkpoint requirement');
}

if (errors.length) {
  fail(errors);
} else {
  console.log('v1 defaults valid and human-approved via Telegram human checkpoint: RES_M=5 OUTPUT_MIME=model/gltf-binary MAX_AREA_KM2=100 TIMEOUT_S=15; immutable-v1');
}
