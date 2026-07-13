import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'docs/README.md',
  'docs/getting-started.md',
  'docs/plugins.md',
  'docs/operations.md',
  'docs/http-and-mcp.md',
  'docs/troubleshooting.md',
  'docs/plugin-authoring/README.md',
  'docs/plugin-authoring/tutorial.md',
  'docs/plugin-authoring/configuration.md',
  'docs/plugin-authoring/versioning-and-migrations.md',
  'docs/plugin-authoring/testing-and-distribution.md',
  'docs/openapi.standard.json'
];

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(candidate);
    return entry.isFile() && entry.name.endsWith('.md') ? [candidate] : [];
  });
}

function headingSlugs(markdown) {
  const seen = new Map();
  const slugs = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (!match) continue;
    const base = match[1]
      .trim()
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

const issues = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) issues.push(`missing required documentation: ${relative}`);
}

const files = [
  path.join(root, 'README.md'),
  path.join(root, 'packages', 'plugin-sdk', 'README.md'),
  path.join(root, 'packages', 'plugin-testkit', 'README.md'),
  path.join(root, 'packages', 'create-agentcanvas-plugin', 'README.md'),
  ...markdownFiles(path.join(root, 'docs'))
];
const markdownByFile = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));

for (const [file, markdown] of markdownByFile) {
  const relativeFile = path.relative(root, file).replaceAll('\\', '/');
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:)/i.test(target) || target.startsWith('#')) continue;
    const [encodedPath, anchor] = target.split('#', 2);
    if (!encodedPath) continue;
    const decodedPath = decodeURIComponent(encodedPath);
    const resolved = path.resolve(path.dirname(file), decodedPath);
    if (!fs.existsSync(resolved)) {
      issues.push(`${relativeFile}: broken link ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith('.md')) {
      const targetMarkdown = markdownByFile.get(resolved) ?? fs.readFileSync(resolved, 'utf8');
      if (!headingSlugs(targetMarkdown).has(decodeURIComponent(anchor).toLowerCase())) {
        issues.push(`${relativeFile}: missing heading for ${target}`);
      }
    }
  }
}

const currentDocs = [
  'docs/README.md',
  'docs/getting-started.md',
  'docs/operations.md',
  'docs/http-and-mcp.md',
  'docs/troubleshooting.md',
  'docs/plugin-functionality-inventory.md',
  'docs/plugin-architecture-and-migration.md',
  'docs/release-notes-v0.2.0.md'
];
const stalePatterns = [/pre-cutover/i, /live database remains v0\.1/i, /does not claim.*migrat/i];
for (const relative of currentDocs) {
  const contents = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const pattern of stalePatterns) {
    if (pattern.test(contents)) issues.push(`${relative}: stale status text matches ${pattern}`);
  }
}

if (issues.length) {
  process.stderr.write(`${issues.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Documentation checks passed for ${files.length} Markdown files.\n`);
}
