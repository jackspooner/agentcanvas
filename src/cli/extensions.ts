import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { discoverPluginDirectory } from '../plugin-runtime/index.js';
import { createV2Runtime } from '../runtime.js';
import { createV2ServiceHandler } from '../server-v2.js';

const DEFAULT_PLUGIN_IDS = ['agentcanvas.primitives', 'agentcanvas.markdown', 'agentcanvas.table'] as const;

interface RunningDevelopmentHost {
  server: Server;
  close(): Promise<void>;
}

function installationRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..');
}

async function runPackageScript(extensionRoot: string, script: string): Promise<void> {
  const packagePath = path.join(extensionRoot, 'package.json');
  const packageJson = JSON.parse(await fs.promises.readFile(packagePath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Extension package does not define npm script ${script}`);
  }
  if (!/^[a-z][a-z0-9:-]*$/.test(script)) throw new Error(`Invalid npm script name: ${script}`);
  await new Promise<void>((resolve, reject) => {
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const command = fs.existsSync(npmCli) ? process.execPath : 'npm';
    const args = fs.existsSync(npmCli) ? [npmCli, 'run', script] : ['run', script];
    const child = spawn(command, args, {
      cwd: extensionRoot,
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${script} failed${signal ? ` with signal ${signal}` : ` with code ${code}`}`));
    });
  });
}

function copyDirectory(source: string, destination: string, sourceExtension = false): void {
  fs.cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (candidate) => {
      if (!sourceExtension) return true;
      const relative = path.relative(source, candidate);
      const first = relative.split(path.sep)[0];
      return !['.git', 'node_modules', 'plugin-dist', 'tests', 'src'].includes(first);
    }
  });
}

async function materializeDevelopmentPlugins(extensionRoot: string, pluginsRoot: string): Promise<string> {
  fs.mkdirSync(pluginsRoot, { recursive: true });
  const catalogRoot = path.join(installationRoot(), 'dist', 'plugin-catalog');
  for (const id of DEFAULT_PLUGIN_IDS) {
    const source = path.join(catalogRoot, id);
    if (!fs.existsSync(source)) {
      throw new Error(`Built default extension is missing: ${source}. Run npm run plugins:build first.`);
    }
    copyDirectory(source, path.join(pluginsRoot, id));
  }
  const extension = await discoverPluginDirectory(extensionRoot);
  copyDirectory(extensionRoot, path.join(pluginsRoot, extension.manifest.id), true);
  await discoverPluginDirectory(path.join(pluginsRoot, extension.manifest.id));
  return extension.manifest.id;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startDevelopmentGeneration(options: {
  extensionRoot: string;
  sessionRoot: string;
  databasePath: string;
  port: number;
  generation: number;
}): Promise<RunningDevelopmentHost> {
  const generationRoot = path.join(options.sessionRoot, `generation-${options.generation}`);
  let runtime: Awaited<ReturnType<typeof createV2Runtime>> | null = null;
  let server: Server | null = null;
  try {
    const pluginsRoot = path.join(generationRoot, 'plugins');
    const extensionId = await materializeDevelopmentPlugins(options.extensionRoot, pluginsRoot);
    const reloadVersion = `${options.generation}-${randomUUID()}`;
    runtime = await createV2Runtime({
      pluginsRoot,
      databasePath: options.databasePath,
      developmentReloadVersion: reloadVersion,
      config: {
        host: '127.0.0.1',
        port: options.port,
        publicBaseUrl: `http://127.0.0.1:${options.port}`
      }
    });
    let canvas = runtime.store.listCanvases({ limit: 1 })[0];
    if (!canvas) {
      canvas = runtime.store.createCanvas({
        title: `${extensionId} development`,
        description: 'Disposable AgentCanvas extension development canvas.',
        createdBy: 'system',
        bounds: { mode: 'unlimited' }
      });
    }
    server = createServer(createV2ServiceHandler(runtime));
    await listen(server, options.port);
    const runningServer = server;
    const runningRuntime = runtime;
    process.stdout.write(
      `AgentCanvas extension dev generation ${options.generation}: http://127.0.0.1:${options.port}/canvases/${canvas.id}\n`
    );
    return {
      server: runningServer,
      async close() {
        await closeServer(runningServer);
        runningRuntime.store.close();
        fs.rmSync(generationRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (server) await closeServer(server);
    runtime?.store.close();
    fs.rmSync(generationRoot, { recursive: true, force: true });
    throw error;
  }
}

function watchExtension(extensionRoot: string, onChange: () => void): fs.FSWatcher {
  return fs.watch(extensionRoot, { recursive: true }, (_event, filename) => {
    const normalized = String(filename ?? '').replaceAll('\\', '/');
    if (
      normalized === 'agentcanvas.plugin.json' ||
      normalized.startsWith('.git/') ||
      normalized.startsWith('node_modules/') ||
      normalized.startsWith('dist/') ||
      normalized.startsWith('plugin-dist/')
    ) {
      return;
    }
    onChange();
  });
}

export async function runExtensionDevelopmentHost(
  extensionRoot: string,
  port: number,
  signal: AbortSignal
): Promise<void> {
  const sessionRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentcanvas-extension-dev-'));
  const databasePath = path.join(sessionRoot, 'development.sqlite');
  let running: RunningDevelopmentHost | null = null;
  let generation = 0;
  let rebuilding = false;
  let queued = false;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;

  const rebuild = async () => {
    if (stopping) return;
    if (rebuilding) {
      queued = true;
      return;
    }
    rebuilding = true;
    try {
      await runPackageScript(extensionRoot, 'build');
      const previous = running;
      running = null;
      await previous?.close();
      generation += 1;
      running = await startDevelopmentGeneration({
        extensionRoot,
        sessionRoot,
        databasePath,
        port,
        generation
      });
    } catch (error) {
      process.stderr.write(`Extension rebuild failed: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      rebuilding = false;
      if (queued && !stopping) {
        queued = false;
        void rebuild();
      }
    }
  };

  await rebuild();
  if (!running) {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    throw new Error('The initial extension development build failed.');
  }
  const watcher = watchExtension(extensionRoot, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 150);
  });
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
  stopping = true;
  watcher.close();
  if (timer) clearTimeout(timer);
  while (rebuilding) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await (running as RunningDevelopmentHost).close();
  fs.rmSync(sessionRoot, { recursive: true, force: true });
}

function parsePort(args: readonly string[]): number {
  const index = args.indexOf('--port');
  const value = index === -1 ? 23083 : Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) {
    throw new Error('--port must be an integer from 1024 to 65535');
  }
  return value;
}

export async function runExtensionCli(args: string[]): Promise<void> {
  const [command, rootArgument, ...rest] = args;
  if (!command || !rootArgument) {
    throw new Error('Usage: extension <dev|pack|verify> <extension-root> [--port <port>]');
  }
  const extensionRoot = path.resolve(rootArgument);
  if (command === 'dev') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await runExtensionDevelopmentHost(extensionRoot, parsePort(rest), controller.signal);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  } else if (command === 'pack') {
    await runPackageScript(extensionRoot, 'pack:extension');
  } else if (command === 'verify') {
    await runPackageScript(extensionRoot, 'pack:extension');
    await runPackageScript(extensionRoot, 'agentcanvas:verify');
  } else {
    throw new Error('Usage: extension <dev|pack|verify> <extension-root> [--port <port>]');
  }
}
