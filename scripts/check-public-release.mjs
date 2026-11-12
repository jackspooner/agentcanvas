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
  'docs/openapi.standard.json',
  'docs/deployment.md',
  'compose.yaml',
  'deploy/docker/Dockerfile',
  'deploy/windows/AgentCanvasServiceHost.cs',
  'deploy/windows/manage-service.ps1'
]) {
  requireFile(required);
}

const rootManifest = readJson('package.json');
const pluginBuildCommand = rootManifest.scripts?.['plugins:build'];
if (
  typeof pluginBuildCommand !== 'string' ||
  !/^npm run build:packages && npm run build:plugins && /.test(pluginBuildCommand)
) {
  failures.push('plugins:build must compile public packages before first-party plugins and catalog assembly.');
}
const browserTestCommand = rootManifest.scripts?.['test:e2e'];
const browserBuildsPackages =
  typeof browserTestCommand === 'string' &&
  (browserTestCommand.startsWith('npm run build:packages && ') ||
    browserTestCommand.startsWith('npm run plugins:build && '));
if (!browserBuildsPackages) {
  failures.push('test:e2e must build public packages before the source-based browser fixture starts.');
}
if (rootManifest.scripts?.['check:extension-packages'] !== 'node scripts/verify-extension-package-artifacts.mjs') {
  failures.push('check:extension-packages must verify the packed extension authoring toolchain.');
}

const readme = read('README.md');
if (!readme.includes('https://github.com/jackspooner/assets2')) {
  failures.push('README must link to the public Assets-2 installation source.');
}
if (!/No media service is required\./.test(readme)) {
  failures.push('README must state that AgentCanvas core requires no media service.');
}
const gettingStarted = read('docs/getting-started.md');
if (!/physical schema 5 \/ document schema 2/.test(gettingStarted)) {
  failures.push('Getting started must state the current physical/document database version.');
}

const securityPolicy = read('SECURITY.md');
const releaseChecklist = read('PUBLIC_RELEASE_CHECKLIST.md');
if (/Assets-2 service is a required local dependency/i.test(`${securityPolicy}\n${releaseChecklist}`)) {
  failures.push('Current security and release documentation must not describe Assets-2 as required.');
}
if (!/physical schema 5 \/ document schema 2/.test(releaseChecklist)) {
  failures.push('Release checklist must state the current physical/document database contract.');
}

const ciWorkflow = read('.github/workflows/ci.yml');
for (const workspace of [
  '@agentcanvas/extension-sdk',
  '@agentcanvas/extension-testkit',
  'create-agentcanvas-extension'
]) {
  if (!ciWorkflow.includes(`npm publish --dry-run --tag next --workspace ${workspace}`)) {
    failures.push(`CI must dry-run the prerelease package ${workspace} with the next tag.`);
  }
}
if (!ciWorkflow.includes('npm run check:extension-packages')) {
  failures.push('CI must independently install and exercise packed extension packages.');
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

if (fs.existsSync(absolute('service'))) {
  failures.push('Public source must not contain private deployment artifacts under service/.');
}

const repositoryUrls = new Set([
  'https://github.com/jackspooner/agentcanvas.git',
  'git+https://github.com/jackspooner/agentcanvas.git'
]);
for (const packageDirectory of [
  'plugin-sdk',
  'plugin-testkit',
  'create-agentcanvas-plugin',
  'extension-sdk',
  'extension-testkit',
  'create-agentcanvas-extension'
]) {
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

for (const scaffolderName of ['create-agentcanvas-plugin', 'create-agentcanvas-extension']) {
  const scaffolder = readJson(`packages/${scaffolderName}/package.json`);
  const scaffoldBin = scaffolder.bin?.[scaffolderName];
  if (typeof scaffoldBin !== 'string' || scaffoldBin.startsWith('./')) {
    failures.push(`${scaffolderName} bin path must be a normalized package-relative path.`);
  }
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
