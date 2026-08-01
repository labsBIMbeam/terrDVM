import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every source root that must respect the boundary.
 *
 * Apps get one privileged directory — `<root>/shell` — where `window.napplet`
 * and `@napplet/sdk` may be touched. Shared packages get none at all: they are
 * transport-free by construction, so a shell import there is always a bug.
 */
const sourceRoots = [
  { root: join(repositoryRoot, 'apps', 'napplet', 'src'), shell: 'shell' },
  { root: join(repositoryRoot, 'packages', 'terrain-engine', 'src'), shell: null },
];
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

let scanned = 0;
for (const { root, shell } of sourceRoots) {
  const shellRoot = shell === null ? null : join(root, shell);
  const permitted =
    shellRoot === null
      ? 'nowhere in a shared package — it is transport-free by construction'
      : `only under ${relative(repositoryRoot, shellRoot).split(sep).join('/')}/`;

  let files;
  try {
    files = await inventory(root);
  } catch (error) {
    console.error('verify-shell-boundary: FAILED');
    console.error(`- SOLE_SHELL_BOUNDARY_SCAN_ERROR: ${String(error)}`);
    process.exit(1);
  }
  scanned += files.length;

  for (const path of files) {
    const normalizedPath = resolve(path);
    const insideShell =
      shellRoot !== null &&
      (normalizedPath === shellRoot || normalizedPath.startsWith(`${shellRoot}${sep}`));
    if (insideShell) continue;

    const source = stripComments(await readFile(path, 'utf8'));
    addMatches(
      path,
      source,
      /\bwindow\s*\.\s*napplet\b/g,
      `window.napplet access is permitted ${permitted}`,
    );
    addMatches(
      path,
      source,
      /\bimport\s*(?:\(\s*)?['"]@napplet\/sdk(?:\/[^'"]*)?['"]/g,
      `@napplet/sdk import is permitted ${permitted}`,
    );
    addMatches(
      path,
      source,
      /\b(?:import|export)\b[\s\S]{0,500}?\bfrom\s*['"]@napplet\/sdk(?:\/[^'"]*)?['"]/g,
      `@napplet/sdk import is permitted ${permitted}`,
    );
  }
}

if (findings.length > 0) {
  console.error('verify-shell-boundary: FAILED');
  console.error('SOLE_SHELL_BOUNDARY_VIOLATION');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(
  `verify-shell-boundary: PASS (${scanned} source files across ${sourceRoots.length} roots scanned; shell is the sole privileged boundary)`,
);
