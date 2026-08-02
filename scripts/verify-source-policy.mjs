#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = resolve(ROOT, 'packages/terrain-engine/src/config/source-policy.json');
const EVIDENCE_PATH = resolve(ROOT, '.planning/evidence/phase-01/source-candidates.json');
const REQUIRED_ROLES = ['basemap', 'imagery'];
const REQUIRED_FIELDS = [
  'scheme', 'host', 'port', 'path_template', 'layer', 'coverage_id', 'tile_matrix',
  'crs', 'bbox_order', 'format', 'auth', 'cors_shell_behavior', 'attribution',
  'dataset_terms', 'endpoint_terms', 'rate_limits', 'max_response_bytes',
  'timeout_ms', 'redirects', 'coverage_bounds', 'outage_behavior', 'capture_date', 'status',
];

function fail(message) {
  console.error(`source-policy: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assertPublic(value, context) {
  const text = JSON.stringify(value);
  if (/\/home\/[A-Za-z0-9._-]+\//.test(text)) fail(`${context} contains a private absolute path`);
  if (/(?:bearer|authorization)\s*[:=]\s*[^"\s]+/i.test(text)) fail(`${context} contains an authorization value`);
  if (/[?&](?:token|secret|password|api[_-]?key|access_token)=[^&"\s]+/i.test(text)) fail(`${context} contains a credential-bearing URL`);
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'));
const evidence = JSON.parse(await readFile(EVIDENCE_PATH, 'utf8'));
assertPublic(policy, 'policy');
if (policy.schema_version !== 1) fail('schema_version must be 1');
if (policy.requirement !== 'MAP-05/MAP-06') fail('requirement must be MAP-05/MAP-06');
if (!/madeira/i.test(policy.target_region ?? '')) fail('target_region must explicitly include Madeira');
if (!policy.roles || Object.keys(policy.roles).sort().join(',') !== REQUIRED_ROLES.join(',')) fail('policy must contain exactly basemap and imagery roles');

for (const role of REQUIRED_ROLES) {
  const entry = policy.roles[role];
  const evidenceRole = evidence.roles?.[role];
  if (!entry || !evidenceRole) fail(`${role} role missing`);
  if (!['live-verified', 'blocked'].includes(entry.status)) fail(`${role} status must be live-verified or blocked`);
  if (entry.contract?.status !== entry.status) fail(`${role} contract.status must match role status`);
  for (const field of REQUIRED_FIELDS) if (!(field in (entry.contract ?? {}))) fail(`${role} missing contract field ${field}`);
  if (entry.contract.max_response_bytes > 1_000_000 || entry.contract.timeout_ms > 15_000) fail(`${role} response/time bounds exceed Phase 1 maxima`);
  if (entry.contract.auth?.required === false && entry.contract.auth?.credential_reference) fail(`${role} has credential reference despite auth=false`);
  if (entry.status === 'live-verified' && (entry.failed_fields?.length ?? 0)) fail(`${role} live-verified role has failed_fields`);
  if (entry.status === 'blocked' && !(entry.failed_fields?.length)) fail(`${role} blocked role must name failed_fields`);
  const candidate = evidenceRole.candidates.find((item) => item.id === entry.evidence_candidate_id);
  if (!candidate) fail(`${role} evidence_candidate_id is absent from evidence`);
  if (candidate.status !== entry.status) fail(`${role} policy/evidence status mismatch`);
  if (stable(candidate.contract) !== stable(entry.contract)) fail(`${role} contract differs from candidate evidence`);
  if (entry.status === 'live-verified' && candidate.failed_fields.length) fail(`${role} live candidate retains failed fields`);
  if (entry.status === 'blocked' && !candidate.failed_fields.length) fail(`${role} blocked candidate has no named failures`);
}

const liveRoles = REQUIRED_ROLES.filter((role) => policy.roles[role].status === 'live-verified');
if (process.argv.includes('--require-live')) {
  if (liveRoles.length !== REQUIRED_ROLES.length) {
    for (const role of REQUIRED_ROLES) {
      if (policy.roles[role].status !== 'live-verified') console.error(`${role}: BLOCKED — ${policy.roles[role].failed_fields.join(', ')}`);
    }
    console.log(JSON.stringify({ outcome: 'blocked', live_roles: liveRoles, required_roles: REQUIRED_ROLES }));
    process.exitCode = 1;
  } else {
    console.log('source-policy --require-live: PASS (both roles live-verified)');
  }
} else {
  console.log(`source-policy: PASS (exactly two roles; live=${liveRoles.join(',') || 'none'}; blocked=${REQUIRED_ROLES.filter((role) => !liveRoles.includes(role)).join(',') || 'none'})`);
}
