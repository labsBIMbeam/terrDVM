import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repositoryRoot, 'apps', 'napplet', 'src');
const shellRoot = join(sourceRoot, 'shell');
const findings = [];

async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await inventory(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    } else {
      throw new Error(
        `unsupported source entry: ${relative(repositoryRoot, absolutePath)}`,
      );
    }
  }

  return files;
}

function stripComments(source) {
  let result = '';
  let state = 'code';

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') {
        state = 'code';
        result += character;
      } else {
        result += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else {
        result += character === '\n' || character === '\r' ? character : ' ';
      }
      continue;
    }

    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      result += character;
      if (character === '\\' && next !== undefined) {
        result += next;
        index += 1;
      } else if (
        (state === 'single-quote' && character === "'") ||
        (state === 'double-quote' && character === '"') ||
        (state === 'template' && character === '`')
      ) {
        state = 'code';
      }
      continue;
    }

    if (character === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
    } else {
      result += character;
      if (character === "'") state = 'single-quote';
      else if (character === '"') state = 'double-quote';
      else if (character === '`') state = 'template';
    }
  }

  return result;
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function addMatches(path, source, pattern, description) {
  for (const match of source.matchAll(pattern)) {
    findings.push(
      `${relative(repositoryRoot, path).split(sep).join('/')}:${lineAt(source, match.index)}: ${description}`,
    );
  }
}

let files;
try {
  files = await inventory(sourceRoot);
} catch (error) {
  console.error('verify-shell-boundary: FAILED');
  console.error(`- SOLE_SHELL_BOUNDARY_SCAN_ERROR: ${String(error)}`);
  process.exit(1);
}

for (const path of files) {
  const normalizedPath = resolve(path);
  const insideShell =
    normalizedPath === shellRoot || normalizedPath.startsWith(`${shellRoot}${sep}`);
  if (insideShell) continue;

  const source = stripComments(await readFile(path, 'utf8'));
  addMatches(
    path,
    source,
    /\bwindow\s*\.\s*napplet\b/g,
    'window.napplet access is permitted only under apps/napplet/src/shell/',
  );
  addMatches(
    path,
    source,
    /\bimport\s*(?:\(\s*)?['"]@napplet\/sdk(?:\/[^'"]*)?['"]/g,
    '@napplet/sdk import is permitted only under apps/napplet/src/shell/',
  );
  addMatches(
    path,
    source,
    /\b(?:import|export)\b[\s\S]{0,500}?\bfrom\s*['"]@napplet\/sdk(?:\/[^'"]*)?['"]/g,
    '@napplet/sdk import is permitted only under apps/napplet/src/shell/',
  );
}

if (findings.length > 0) {
  console.error('verify-shell-boundary: FAILED');
  console.error('SOLE_SHELL_BOUNDARY_VIOLATION');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `verify-shell-boundary: PASS (${files.length} source files scanned; shell is the sole privileged boundary)`,
);
