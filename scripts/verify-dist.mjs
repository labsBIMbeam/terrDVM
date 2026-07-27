import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(repositoryRoot, 'apps', 'napplet', 'dist');
const indexPath = join(distRoot, 'index.html');
const findings = [];

async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await inventory(absolutePath)));
    } else if (entry.isFile()) {
      files.push(relative(distRoot, absolutePath).split(sep).join('/'));
    } else {
      findings.push(`unsupported dist entry: ${relative(distRoot, absolutePath)}`);
    }
  }

  return files;
}

function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isEmbeddedReference(value) {
  return value.startsWith('data:') || value.startsWith('#');
}

function addTagReferenceFindings(html) {
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const source = attribute(match[0], 'src');
    if (source !== undefined) {
      findings.push(`external script dependency: ${source}`);
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const relation = attribute(match[0], 'rel')?.toLowerCase() ?? '';
    const destination = attribute(match[0], 'href');
    const kind = attribute(match[0], 'as')?.toLowerCase() ?? '';
    const executableRelations = new Set([
      'modulepreload',
      'preload',
      'prefetch',
      'stylesheet',
    ]);
    if (
      destination !== undefined &&
      (relation.split(/\s+/).some((item) => executableRelations.has(item)) ||
        ['font', 'script', 'style', 'worker'].includes(kind))
    ) {
      findings.push(`external link dependency: ${destination}`);
    }
  }

  for (const match of html.matchAll(/<(?:img|input|source|video)\b[^>]*>/gi)) {
    for (const name of ['src', 'srcset', 'poster']) {
      const destination = attribute(match[0], name);
      if (destination !== undefined && !isEmbeddedReference(destination)) {
        findings.push(`external media reference: ${destination}`);
      }
    }
  }
}

function addPatternFinding(content, pattern, description) {
  if (pattern.test(content)) {
    findings.push(description);
  }
}

let files;
try {
  files = (await inventory(distRoot))
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .sort();
} catch (error) {
  console.error(`verify-dist: cannot inventory ${distRoot}:`, error);
  process.exit(1);
}

if (files.length !== 1 || files[0] !== 'index.html') {
  findings.push(
    `dist must contain only index.html; found: ${files.length === 0 ? '(none)' : files.join(', ')}`,
  );
}

let html = '';
try {
  const metadata = await stat(indexPath);
  if (!metadata.isFile() || metadata.size === 0) {
    findings.push('dist/index.html must be a non-empty regular file');
  }
  html = await readFile(indexPath, 'utf8');
} catch (error) {
  findings.push(`dist/index.html is unreadable: ${String(error)}`);
}

const nonCommentHtml = html
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
if (nonCommentHtml.trim() === '') {
  findings.push('dist/index.html has no non-comment content');
}

addTagReferenceFindings(html);

for (const match of html.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) {
  const destination = match[2];
  if (!isEmbeddedReference(destination)) {
    findings.push(`external CSS asset reference: ${destination}`);
  }
}

addPatternFinding(
  html,
  /\b(?:importScripts|new\s+(?:Shared)?Worker)\s*\(\s*['"`](?:https?:|\/\/|\/|\.)/i,
  'external worker dependency detected',
);
addPatternFinding(
  html,
  /\bimport\s*\(\s*['"`](?:https?:|\/\/|\/|\.)/i,
  'external dynamic import detected',
);
addPatternFinding(
  html,
  /\bsourceMappingURL\s*=|<script\b[^>]*\btype\s*=\s*['"]application\/json['"][^>]*\bdata-source-map/i,
  'source map detected without approval',
);
addPatternFinding(
  html,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b/i,
  'private-key material detected',
);
addPatternFinding(
  html,
  /\bVITE_DEV_PRIVKEY_HEX\b|\b(?:authorization|proxy-authorization)\s*[:=]\s*['"]?(?:basic|bearer)\b/i,
  'authorization credential pattern detected',
);
addPatternFinding(
  html,
  /https?:\/\/[^\s/'"<>]+:[^\s/@'"<>]+@/i,
  'authenticated URL detected',
);
addPatternFinding(
  html,
  /[?&](?:access_token|api_key|apikey|auth_token|client_secret|token)=[^&#\s'"<>]+/i,
  'token-bearing URL detected',
);

if (findings.length > 0) {
  console.error('verify-dist: FAILED');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`verify-dist: PASS (${files.length} file, dist/index.html is self-contained)`);
