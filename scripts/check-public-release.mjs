import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

function absolute(relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function requireFile(relativePath) {
  const filePath = absolute(relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    failures.push(`Missing required public-release file: ${relativePath}`);
    return undefined;
  }
  return filePath;
}

function read(relativePath) {
  const filePath = requireFile(relativePath);
  return filePath ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(relativePath) {
  const text = read(relativePath);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

for (const required of [
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.github/workflows/ci.yml',
  'docs/README.md',
  'docs/openapi.standard.json'
]) {
  requireFile(required);
}

const readme = read('README.md');
if (!readme.includes('https://github.com/jackspooner/Assets-2')) {
  failures.push('README must link to the public Assets-2 installation source.');
}

const migrationGuide = read('docs/v0.1-to-v0.2-migration.md');
const releaseNotes = read('docs/release-notes-v0.2.0.md');
const publicHistory = `${migrationGuide}\n${releaseNotes}`;
for (const [label, pattern] of [
  ['stale incomplete-migration status', /inspected but not migrated|not migrated by this documentation change/i],
  ['private migration run identifier', /migration_[0-9a-f]{12,}/i],
  ['private backup filename', /agent-canvas\.v0\.1-backup-\d{4}/i],
  ['private database fingerprint', /sha-256[^\n`]*[0-9a-f]{64}/i],
  ['private Workspace2 dataset count', /\b(?:94 canvases|1,?860 elements|7,?045 events|135 share links)\b/i]
]) {
  if (pattern.test(publicHistory)) failures.push(`Public history contains ${label}.`);
}
if (/^agentcanvas migrate /m.test(migrationGuide)) {
  failures.push('Migration guide contains a bare agentcanvas command that a source checkout does not install on PATH.');
}

const mcpDocs = `${read('docs/http-and-mcp.md')}\n${read('docs/troubleshooting.md')}`;
if (!/(?:restart|reload)[^\n]{0,80}MCP|MCP[^\n]{0,80}(?:restart|reload)/i.test(mcpDocs)) {
  failures.push('MCP documentation must tell upgrade users to restart or reload their client tool catalog.');
}

const service = readJson('service/Workspace2AgentCanvas.servy.json');
if (service.RunAsLocalSystem === true) {
  failures.push('The public Servy template must not run trusted plugins as LocalSystem.');
}

const repositoryUrls = new Set([
  'https://github.com/jackspooner/AgentCanvas.git',
  'git+https://github.com/jackspooner/AgentCanvas.git'
]);
for (const packageDirectory of ['plugin-sdk', 'plugin-testkit', 'create-agentcanvas-plugin']) {
  const base = `packages/${packageDirectory}`;
  const manifest = readJson(`${base}/package.json`);
  requireFile(`${base}/README.md`);
  requireFile(`${base}/LICENSE`);
  if (manifest.private === true) failures.push(`${manifest.name ?? base} must be publishable.`);
  if (manifest.license !== 'MIT') failures.push(`${manifest.name ?? base} must declare MIT.`);
  if (manifest.publishConfig?.access !== 'public') failures.push(`${manifest.name ?? base} must publish with public access.`);
  if (!repositoryUrls.has(manifest.repository?.url)) failures.push(`${manifest.name ?? base} has no canonical repository URL.`);
  if (!manifest.bugs?.url || !manifest.homepage) failures.push(`${manifest.name ?? base} needs bugs and homepage metadata.`);
  if (!Array.isArray(manifest.files) || !manifest.files.includes('LICENSE')) {
    failures.push(`${manifest.name ?? base} must include LICENSE in its tarball.`);
  }
  const packageReadme = read(`${base}/README.md`);
  if (/\]\(\.\.\//.test(packageReadme)) failures.push(`${manifest.name ?? base} README contains package-breaking relative links.`);
}

const scaffolder = readJson('packages/create-agentcanvas-plugin/package.json');
const scaffoldBin = scaffolder.bin?.['create-agentcanvas-plugin'];
if (typeof scaffoldBin !== 'string' || scaffoldBin.startsWith('./')) {
  failures.push('create-agentcanvas-plugin bin path must be a normalized package-relative path.');
}

for (const pluginDirectory of [
  'assets2',
  'glb-viewer',
  'image-overlays',
  'markdown',
  'primitives',
  'table',
  'video'
]) {
  requireFile(`plugin-packages/${pluginDirectory}/README.md`);
  requireFile(`plugin-packages/${pluginDirectory}/LICENSE`);
}
requireFile('plugin-packages/glb-viewer/THIRD_PARTY_NOTICES.md');

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Public release checks passed.\n');
}
