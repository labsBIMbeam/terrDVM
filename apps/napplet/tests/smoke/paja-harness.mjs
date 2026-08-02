import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, existsSync, readFileSync } from 'node:fs';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidenceRoot = join(repositoryRoot, '.planning', 'evidence', 'phase-01');
const contractPath = join(evidenceRoot, 'kehto-cli-contract.json');
const provisioningPath = join(evidenceRoot, 'chromium-provisioning.json');
const distIndexPath = join(repositoryRoot, 'apps', 'napplet', 'dist', 'index.html');
const verifyDistPath = join(repositoryRoot, 'scripts', 'verify-dist.mjs');
const sourcePolicyPath = join(repositoryRoot, 'apps', 'napplet', 'src', 'config', 'source-policy.json');
const sourcePolicy = JSON.parse(readFileSync(sourcePolicyPath, 'utf8'));
const supportedCases = new Set(['boot', 'boot-denied', 'draw', 'edit-clear', 'coords-keyboard']);
const requiredHostOverride = 'ubuntu24.04-x64';
const requiredChromiumRevision = 1217;
const startupTimeoutMs = 45_000;
const assertionTimeoutMs = 15_000;
const cleanupTimeoutMs = 10_000;
const maxProcessLogBytes = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function parseCase(argv) {
  if (argv.length !== 2 || argv[0] !== '--case' || !supportedCases.has(argv[1])) {
    fail('usage: node apps/napplet/tests/smoke/paja-harness.mjs --case boot|boot-denied|draw|edit-clear|coords-keyboard');
  }
  return argv[1];
}

function runChecked(command, args, description, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
    fail(`${description} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function resolveKehto() {
  const executable = runChecked(
    '/bin/sh',
    ['-c', 'command -v kehto'],
    'command -v kehto',
  );
  if (!executable.startsWith('/') || !executable.endsWith('/kehto')) {
    fail('command -v kehto did not return an absolute kehto executable path');
  }
  return executable;
}

async function readJson(path, description) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`${description} is not readable valid JSON: ${error.message}`);
  }
  return parsed;
}

function validateContract(contract, caseName, kehtoPath) {
  if (
    contract.schema_version !== 1 ||
    contract.status !== 'compatible' ||
    contract.compatibility?.result !== 'PASS' ||
    contract.executable?.path !== '[USER_DENO_BIN]/kehto' ||
    contract.observed_contract?.target_url_supported !== true ||
    contract.observed_contract?.argv_after_double_dash_supported !== true ||
    contract.observed_contract?.preview_origin !== 'http://127.0.0.1:4173' ||
    contract.observed_contract?.runtime_origin !== 'http://127.0.0.1:5197'
  ) {
    fail('kehto CLI contract is missing the compatible loopback Paja launch contract');
  }

  const templateName = caseName === 'boot' ? 'normal' : 'resource_off';
  const template = contract.launch_argv_templates?.[templateName];
  if (!Array.isArray(template) || template.length < 2) {
    fail(`kehto CLI contract has no ${templateName} argv template`);
  }
  if (template[0] !== '[USER_DENO_BIN]/kehto') {
    fail(`${templateName} argv template does not start with the recorded kehto placeholder`);
  }
  if (template.slice(1).some((argument) => argument.includes('[USER_DENO_BIN]'))) {
    fail(`${templateName} argv template contains an unexpected executable placeholder`);
  }

  const expectedCapability = caseName === 'boot' ? 'resource:on' : 'resource:off';
  const capabilityIndex = template.indexOf('--capability');
  if (capabilityIndex < 0 || template[capabilityIndex + 1] !== expectedCapability) {
    fail(`${templateName} argv template does not record ${expectedCapability}`);
  }
  const separatorIndex = template.indexOf('--');
  const previewArgv = template.slice(separatorIndex + 1);
  if (
    separatorIndex < 0 ||
    !previewArgv.includes('vite') ||
    !previewArgv.includes('preview') ||
    !previewArgv.includes('--strictPort')
  ) {
    fail(`${templateName} argv template does not contain the recorded strict Vite preview argv`);
  }

  return {
    templateName,
    capability: expectedCapability,
    command: kehtoPath,
    args: template.slice(1),
  };
}

function appendBoundedLog(state, streamName, chunk) {
  const text = chunk.toString('utf8');
  state[streamName] += text;
  if (Buffer.byteLength(state[streamName], 'utf8') > maxProcessLogBytes) {
    state.logOverflow = true;
  }
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function httpReady(url) {
  return new Promise((resolvePromise) => {
    const request = http.get(url, { timeout: 1000 }, (response) => {
      response.resume();
      resolvePromise(Boolean(response.statusCode && response.statusCode < 500));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolvePromise(false));
  });
}

async function waitForRuntime(child, previewOrigin, runtimeOrigin) {
  const deadline = Date.now() + startupTimeoutMs;
  let previewReady = false;
  let runtimeReady = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(`Kehto/Paja exited before readiness (exit ${child.exitCode}, signal ${child.signalCode})`);
    }
    [previewReady, runtimeReady] = await Promise.all([
      httpReady(`${previewOrigin}/`),
      httpReady(`${runtimeOrigin}/`),
    ]);
    if (previewReady && runtimeReady) return;
    await wait(200);
  }
  fail(
    `timed out waiting for loopback listeners (preview=${previewReady}, runtime=${runtimeReady})`,
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function snapshotDescendants(rootPid) {
  const output = runChecked('ps', ['-eo', 'pid=,ppid='], 'process tree snapshot');
  const childrenByParent = new Map();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.shift();
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!predicate()) return true;
    await wait(100);
  }
  return !predicate();
}

async function terminateProcessTree(child) {
  if (!child?.pid) {
    return {
      process_group_gone: true,
      tracked_process_count: 0,
      tracked_processes_gone: true,
    };
  }

  const descendants = snapshotDescendants(child.pid);
  if (isProcessGroupAlive(child.pid)) {
    process.kill(-child.pid, 'SIGTERM');
  }
  let processGroupGone = await waitUntil(
    () => isProcessGroupAlive(child.pid),
    cleanupTimeoutMs / 2,
  );
  if (!processGroupGone) {
    process.kill(-child.pid, 'SIGKILL');
    processGroupGone = await waitUntil(
      () => isProcessGroupAlive(child.pid),
      cleanupTimeoutMs / 2,
    );
  }
  const trackedProcessesGone = await waitUntil(
    () => descendants.some((pid) => isProcessAlive(pid)),
    cleanupTimeoutMs,
  );

  return {
    process_group_gone: processGroupGone,
    tracked_process_count: descendants.length,
    tracked_processes_gone: trackedProcessesGone,
  };
}

function portClosed(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(closed);
    };
    socket.setTimeout(500, () => finish(true));
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
  });
}

async function waitForClosedPorts() {
  const deadline = Date.now() + cleanupTimeoutMs;
  let previewClosed = false;
  let runtimeClosed = false;
  while (Date.now() < deadline) {
    [previewClosed, runtimeClosed] = await Promise.all([portClosed(4173), portClosed(5197)]);
    if (previewClosed && runtimeClosed) break;
    await wait(100);
  }
  return { previewClosed, runtimeClosed };
}

function redactText(value, replacements) {
  let redacted = String(value);
  for (const [privateValue, marker] of replacements) {
    if (privateValue) redacted = redacted.split(privateValue).join(marker);
  }
  redacted = redacted.replace(
    /([?&](?:access_token|api_key|apikey|auth_token|client_secret|token)=)[^&#\s]+/gi,
    '$1[REDACTED]',
  );
  redacted = redacted.replace(/(authorization\s*[:=]\s*)(?:basic|bearer)\s+\S+/gi, '$1[REDACTED]');
  return redacted;
}

function redactRequestUrl(rawUrl) {
  if (rawUrl.startsWith('data:')) return 'data:[BROWSER_INTERNAL]';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = '[REDACTED]';
    if (parsed.password) parsed.password = '[REDACTED]';
    for (const key of parsed.searchParams.keys()) {
      if (/^(?:access_token|api_key|apikey|auth_token|client_secret|token)$/i.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function classifyRequest(rawUrl, allowedOrigins) {
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return { classification: 'browser-internal-non-network', origin: null, allowed: true };
  }
  if (rawUrl.startsWith('terrcvm://')) {
    return { classification: 'browser-internal-custom-protocol', origin: null, allowed: true };
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (isApprovedSourceNetwork(parsed)) {
        return {
          classification: 'allowlisted-approved-source-network',
          origin: parsed.origin,
          allowed: true,
        };
      }
      const allowed = allowedOrigins.has(parsed.origin);
      return {
        classification: allowed ? 'allowlisted-loopback-network' : 'external-network',
        origin: parsed.origin,
        allowed,
      };
    }
  } catch {
    // The fail-closed classification below handles malformed URLs.
  }
  return { classification: 'unsupported-or-external', origin: null, allowed: false };
}

function isApprovedSourceNetwork(parsed) {
  return Object.values(sourcePolicy.roles ?? {}).some((role) => {
    const contract = role?.contract;
    if (!contract || `${contract.scheme}:` !== parsed.protocol || contract.host !== parsed.hostname) {
      return false;
    }
    const expectedPort = Number(contract.port);
    const actualPort = parsed.port === ''
      ? (parsed.protocol === 'https:' ? 443 : 80)
      : Number(parsed.port);
    if (actualPort !== expectedPort) return false;

    const pathPattern = String(contract.path_template)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[a-z]+\\\}/gi, '[^/]+');
    return new RegExp(`^${pathPattern}$`).test(parsed.pathname);
  });
}

function attachPageErrorCapture(page, consoleErrors, pageErrors, replacements) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(redactText(message.text(), replacements));
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(redactText(error.message, replacements));
  });
}

async function locateNappletFrame(page, previewOrigin) {
  const deadline = Date.now() + assertionTimeoutMs;
  while (Date.now() < deadline) {
    const candidates = page.frames().filter((frame) => frame !== page.mainFrame());
    for (const frame of candidates) {
      if (!(await frame.locator('#empty-state-title').count())) continue;
      const frameElement = await frame.frameElement();
      const metadata = await frameElement.evaluate((element) => ({
        id: element.id,
        title: element.getAttribute('title'),
        sandbox: element.getAttribute('sandbox'),
        target_url: element.getAttribute('data-target-url'),
      }));
      if (
        frame.url() !== 'about:srcdoc' ||
        metadata.id !== 'napplet-frame' ||
        metadata.target_url !== `${previewOrigin}/` ||
        metadata.sandbox !== 'allow-scripts'
      ) {
        fail(`unexpected Paja napplet iframe metadata: ${JSON.stringify(metadata)}`);
      }
      return { frame, metadata };
    }
    await wait(100);
  }
  const observed = page.frames().map((frame) => frame.url());
  fail(`could not locate built napplet frame; observed frames: ${JSON.stringify(observed)}`);
}

async function exactText(locator, expected, name) {
  await locator.waitFor({ state: 'attached', timeout: assertionTimeoutMs });
  const actual = (await locator.textContent())?.trim();
  if (actual !== expected) fail(`${name} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return { expected, actual, result: 'PASS' };
}

async function assertNappletUi(frame) {
  const firstFocusable = await frame.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[tabindex]',
      '[contenteditable="true"]',
    ].join(',');
    const elements = [...document.querySelectorAll(selector)];
    const focusable = elements.filter((element) => {
      const style = window.getComputedStyle(element);
      const disabled = 'disabled' in element && element.disabled;
      return !disabled && element.tabIndex >= 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const first = focusable[0];
    if (!first) return null;
    return {
      tag: first.tagName.toLowerCase(),
      text: first.textContent?.trim() ?? '',
      href: first.getAttribute('href'),
      class_name: first.getAttribute('class'),
    };
  });
  if (
    firstFocusable?.tag !== 'a' ||
    firstFocusable.text !== 'Skip to request panel' ||
    firstFocusable.href !== '#request-panel' ||
    !firstFocusable.class_name?.split(/\s+/).includes('skip-link')
  ) {
    fail(`skip link is not the first focusable element: ${JSON.stringify(firstFocusable)}`);
  }

  return {
    skip_link_first_focusable: {
      expected: {
        tag: 'a',
        text: 'Skip to request panel',
        href: '#request-panel',
        class_name: 'skip-link',
      },
      actual: firstFocusable,
      result: 'PASS',
    },
    heading: await exactText(
      frame.locator('#empty-state-title'),
      'No area selected',
      'empty-state heading',
    ),
    resolution: await exactText(
      frame.locator('.request-value.fixed-default').filter({ hasText: 'Resolution:' }),
      'Resolution: 5 m/px — fixed for v1',
      'resolution',
    ),
    output: await exactText(
      frame.locator('.request-value.fixed-default').filter({ hasText: 'Output:' }),
      'Output: model/gltf-binary — fixed for v1',
      'output',
    ),
    source: await exactText(
      frame.locator('.request-value').filter({ hasText: 'Source:' }),
      'Source: — unavailable',
      'source',
    ),
  };
}

async function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  JSON.parse(await readFile(temporaryPath, 'utf8'));
  await rename(temporaryPath, path);
}

const caseName = parseCase(process.argv.slice(2));
const evidencePath = join(evidenceRoot, `paja-${caseName}.json`);
const startedAt = new Date().toISOString();
let child;
let browser;
let primaryError;
let uiAssertions;
let browserVersion;
let playwrightVersion;
let executablePathRedacted;
let targetFrameUrl;
let targetFrameMetadata;
let targetProxyResponseHash;
let cleanup = {
  browser_closed: false,
  process_group_gone: false,
  tracked_process_count: 0,
  tracked_processes_gone: false,
  preview_listener_closed: false,
  runtime_listener_closed: false,
};
const requests = [];
const consoleErrors = [];
const pageErrors = [];
const processLogs = { stdout: '', stderr: '', logOverflow: false };
let contract;
let provisioning;
let launch;
let distHash;
let verifyDistOutput;
let kehtoPath;
let redactionReplacements = [[repositoryRoot, '[REPO_ROOT]']];

try {
  if (!existsSync(distIndexPath)) {
    fail('apps/napplet/dist/index.html is missing; refusing to use a development server');
  }
  verifyDistOutput = runChecked(process.execPath, [verifyDistPath], 'verify-dist');
  distHash = createHash('sha256').update(await readFile(distIndexPath)).digest('hex');

  contract = await readJson(contractPath, 'kehto CLI contract');
  provisioning = await readJson(provisioningPath, 'Chromium provisioning evidence');
  kehtoPath = resolveKehto();
  await access(kehtoPath, fsConstants.X_OK);
  redactionReplacements = [
    [repositoryRoot, '[REPO_ROOT]'],
    [dirname(kehtoPath), '[USER_DENO_BIN]'],
    [process.env.HOME, '[USER_HOME]'],
  ];
  launch = validateContract(contract, caseName, kehtoPath);

  if (
    provisioning.playwright_version !== '1.59.1' ||
    provisioning.chromium_revision !== requiredChromiumRevision ||
    provisioning.host_platform_override !== requiredHostOverride
  ) {
    fail('Chromium provisioning evidence is incompatible with the approved revision 1217 fallback');
  }
  if (
    process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE &&
    process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE !== requiredHostOverride
  ) {
    fail('PLAYWRIGHT_HOST_PLATFORM_OVERRIDE conflicts with the approved ubuntu24.04-x64 value');
  }
  process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = requiredHostOverride;
  if (process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE !== requiredHostOverride) {
    fail('failed to set PLAYWRIGHT_HOST_PLATFORM_OVERRIDE before importing Playwright');
  }

  const playwright = await import('playwright');
  const playwrightPackage = await readJson(
    join(dirname(fileURLToPath(import.meta.resolve('playwright'))), 'package.json'),
    'direct Playwright package metadata',
  ).catch(async () => {
    const resolvedPackagePath = fileURLToPath(import.meta.resolve('playwright/package.json'));
    return readJson(resolvedPackagePath, 'direct Playwright package metadata');
  });
  playwrightVersion = playwrightPackage.version;
  if (playwrightVersion !== provisioning.playwright_version) {
    fail(`direct Playwright version ${playwrightVersion} does not match provisioning evidence`);
  }

  const executablePath = playwright.chromium.executablePath();
  const revisionSuffix = '/chromium-1217/chrome-linux64/chrome';
  if (!executablePath.endsWith(revisionSuffix)) {
    fail('direct Playwright Chromium executable is not the approved revision 1217');
  }
  await access(executablePath, fsConstants.X_OK);
  executablePathRedacted = `[PLAYWRIGHT_CACHE]${revisionSuffix}`;

  child = spawn(launch.command, launch.args, {
    cwd: repositoryRoot,
    detached: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendBoundedLog(processLogs, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendBoundedLog(processLogs, 'stderr', chunk));
  child.on('error', (error) => {
    if (!primaryError) primaryError = error;
  });

  const previewOrigin = contract.observed_contract.preview_origin;
  const runtimeOrigin = contract.observed_contract.runtime_origin;
  await waitForRuntime(child, previewOrigin, runtimeOrigin);
  if (processLogs.logOverflow) fail('Kehto/Paja process output exceeded the bounded capture limit');

  browser = await playwright.chromium.launch({ headless: true });
  browserVersion = browser.version();
  const context = await browser.newContext();
  const allowedOrigins = new Set([previewOrigin, runtimeOrigin]);
  const responseCaptures = [];
  context.on('request', (request) => {
    const classification = classifyRequest(request.url(), allowedOrigins);
    requests.push({
      sequence: requests.length + 1,
      url: redactRequestUrl(request.url()),
      method: request.method(),
      resource_type: request.resourceType(),
      frame_url: redactRequestUrl(request.frame().url()),
      ...classification,
    });
  });
  context.on('response', (response) => {
    if (response.url() !== `${runtimeOrigin}/__kehto/target.html`) return;
    responseCaptures.push(
      response.body().then((body) => {
        targetProxyResponseHash = createHash('sha256').update(body).digest('hex');
      }),
    );
  });
  context.on('page', (newPage) => {
    attachPageErrorCapture(newPage, consoleErrors, pageErrors, redactionReplacements);
  });

  const page = await context.newPage();
  attachPageErrorCapture(page, consoleErrors, pageErrors, redactionReplacements);
  const response = await page.goto(`${runtimeOrigin}/`, {
    waitUntil: 'domcontentloaded',
    timeout: assertionTimeoutMs,
  });
  if (!response?.ok()) fail(`Paja runtime navigation failed with status ${response?.status()}`);
  const located = await locateNappletFrame(page, previewOrigin);
  const { frame } = located;
  targetFrameMetadata = located.metadata;
  targetFrameUrl = redactRequestUrl(frame.url());
  uiAssertions = await assertNappletUi(frame);
  await page.waitForTimeout(500);
  await Promise.all(responseCaptures);

  if (consoleErrors.length > 0) fail(`browser console errors: ${JSON.stringify(consoleErrors)}`);
  if (pageErrors.length > 0) fail(`browser page errors: ${JSON.stringify(pageErrors)}`);
  const externalRequests = requests.filter((request) => !request.allowed);
  if (externalRequests.length > 0) {
    fail(`request-log egress assertion failed: ${JSON.stringify(externalRequests)}`);
  }
  if (!requests.some((request) => request.origin === runtimeOrigin)) {
    fail('complete request log contains no Paja runtime request');
  }
  if (!requests.some((request) => request.url === `${runtimeOrigin}/__kehto/target.html`)) {
    fail('complete request log contains no Paja target proxy request');
  }
  if (targetProxyResponseHash !== distHash) {
    fail('Paja target proxy response does not match the verified dist/index.html bytes');
  }
} catch (error) {
  primaryError = primaryError ?? error;
} finally {
  if (browser) {
    try {
      await browser.close();
      cleanup.browser_closed = true;
    } catch (error) {
      primaryError = primaryError ?? error;
    }
  } else {
    cleanup.browser_closed = true;
  }

  try {
    cleanup = { ...cleanup, ...(await terminateProcessTree(child)) };
  } catch (error) {
    primaryError = primaryError ?? error;
  }

  try {
    const ports = await waitForClosedPorts();
    cleanup.preview_listener_closed = ports.previewClosed;
    cleanup.runtime_listener_closed = ports.runtimeClosed;
  } catch (error) {
    primaryError = primaryError ?? error;
  }

  if (
    !cleanup.browser_closed ||
    !cleanup.process_group_gone ||
    !cleanup.tracked_processes_gone ||
    !cleanup.preview_listener_closed ||
    !cleanup.runtime_listener_closed
  ) {
    primaryError = primaryError ?? new Error(`cleanup assertion failed: ${JSON.stringify(cleanup)}`);
  }
}

const previewOrigin = contract?.observed_contract?.preview_origin ?? 'http://127.0.0.1:4173';
const runtimeOrigin = contract?.observed_contract?.runtime_origin ?? 'http://127.0.0.1:5197';
const externalRequests = requests.filter((request) => !request.allowed);
const internalRequests = requests.filter(
  (request) => request.classification === 'browser-internal-non-network',
);
const originSummary = {};
for (const request of requests) {
  const key = request.origin ?? request.classification;
  originSummary[key] = (originSummary[key] ?? 0) + 1;
}
const passed = !primaryError;
const completedAt = new Date().toISOString();
const evidence = {
  schema_version: 1,
  case: caseName,
  requirement: 'SBOX-02',
  result: passed ? 'PASS' : 'FAIL',
  timestamps: {
    started_at: startedAt,
    completed_at: completedAt,
  },
  cli_runtime: {
    kehto_cli: contract?.provenance?.kehto_cli ?? null,
    paja: contract?.provenance?.paja ?? null,
    deno_runtime: contract?.runtime ?? null,
    executable: '[USER_DENO_BIN]/kehto',
    launch_template: launch?.templateName ?? null,
  },
  browser: {
    playwright_version: playwrightVersion ?? null,
    host_platform_override: requiredHostOverride,
    chromium_revision: requiredChromiumRevision,
    chromium_executable: executablePathRedacted ?? null,
    browser_version: browserVersion ?? null,
    headless: true,
  },
  built_artifact: {
    path: 'apps/napplet/dist/index.html',
    sha256: distHash ?? null,
    verify_dist: verifyDistOutput ? 'PASS' : 'FAIL',
    verify_dist_output: verifyDistOutput ?? null,
    raw_preview_navigation_used: false,
    paja_runtime_origin: runtimeOrigin,
    napplet_frame_url: targetFrameUrl ?? null,
    napplet_frame: targetFrameMetadata ?? null,
    paja_target_proxy_response_sha256: targetProxyResponseHash ?? null,
    paja_target_proxy_matches_dist: targetProxyResponseHash === distHash ? 'PASS' : 'FAIL',
    proof:
      targetFrameUrl === 'about:srcdoc' &&
      targetFrameMetadata?.target_url === `${previewOrigin}/` &&
      targetProxyResponseHash === distHash
      ? 'Paja fetched the strict Vite preview through its loopback target proxy and injected those verified dist bytes into its sandboxed srcdoc napplet frame.'
      : null,
  },
  capability: {
    domain: 'resource',
    state: launch?.capability?.endsWith(':on') ? 'on' : 'off',
    recorded_argv_template: launch?.templateName ?? null,
    result: launch ? 'PASS' : 'FAIL',
  },
  ui_assertions: uiAssertions ?? null,
  error_assertions: {
    console_errors: consoleErrors,
    page_errors: pageErrors,
    zero_console_errors: consoleErrors.length === 0 ? 'PASS' : 'FAIL',
    zero_page_errors: pageErrors.length === 0 ? 'PASS' : 'FAIL',
  },
  request_log: {
    capture: 'Playwright BrowserContext request event registered before page creation; includes the Paja page and every frame.',
    complete: true,
    allowlisted_origins: [previewOrigin, runtimeOrigin],
    urls: requests.map((request) => request.url),
    requests,
    origin_summary: originSummary,
    browser_internal_non_network_requests: internalRequests,
    external_requests: externalRequests,
    assertions: {
      complete_request_events: 'PASS',
      paja_runtime_origin_observed: requests.some((request) => request.origin === runtimeOrigin)
        ? 'PASS'
        : 'FAIL',
      paja_target_proxy_observed: requests.some(
        (request) => request.url === `${runtimeOrigin}/__kehto/target.html`,
      )
        ? 'PASS'
        : 'FAIL',
      paja_frame_declares_preview_target:
        targetFrameMetadata?.target_url === `${previewOrigin}/` ? 'PASS' : 'FAIL',
      paja_target_proxy_matches_verified_dist:
        targetProxyResponseHash === distHash ? 'PASS' : 'FAIL',
      loopback_only_network: externalRequests.length === 0 ? 'PASS' : 'FAIL',
      no_external_hostname_or_nonloopback_address: externalRequests.length === 0 ? 'PASS' : 'FAIL',
      no_tile_glyph_or_source_request: requests.some((request) =>
        /(?:tile|glyph|sprite|wms|wcs|orthophoto)/i.test(request.url),
      )
        ? 'FAIL'
        : 'PASS',
    },
  },
  process_logs: {
    capture_complete: !processLogs.logOverflow,
    stdout: redactText(processLogs.stdout, redactionReplacements),
    stderr: redactText(processLogs.stderr, redactionReplacements),
  },
  cleanup: {
    browser_closed: cleanup.browser_closed ? 'PASS' : 'FAIL',
    managed_process_group_gone: cleanup.process_group_gone ? 'PASS' : 'FAIL',
    tracked_child_process_count: cleanup.tracked_process_count,
    tracked_child_processes_gone: cleanup.tracked_processes_gone ? 'PASS' : 'FAIL',
    preview_listener_127_0_0_1_4173_closed: cleanup.preview_listener_closed ? 'PASS' : 'FAIL',
    paja_listener_127_0_0_1_5197_closed: cleanup.runtime_listener_closed ? 'PASS' : 'FAIL',
    result:
      cleanup.browser_closed &&
      cleanup.process_group_gone &&
      cleanup.tracked_processes_gone &&
      cleanup.preview_listener_closed &&
      cleanup.runtime_listener_closed
        ? 'PASS'
        : 'FAIL',
  },
  failure: primaryError
    ? {
        message: redactText(primaryError.message, redactionReplacements),
      }
    : null,
};

await atomicWriteJson(evidencePath, evidence);
if (!passed) {
  console.error(`paja-${caseName}: FAIL — ${evidence.failure.message}`);
  process.exit(1);
}
console.log(
  `paja-${caseName}: PASS (${requests.length} requests; origins ${JSON.stringify(originSummary)}; cleanup PASS)`,
);
