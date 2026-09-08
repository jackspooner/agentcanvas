import {
  isLocalContributionName,
  type BrowserCommandDescriptor,
  type BrowserElementRenderer,
  type PluginDiagnostic
} from '@agentcanvas/plugin-sdk';

const PLUGIN_MODULE_PATH = /^\/api\/v1\/plugin-modules\/([^/]+)\/([a-f0-9]{8,128})\/(.+)$/;

export interface BrowserCatalogElement {
  type: `${string}/${string}`;
  schemaVersion: number;
}

export interface BrowserCatalogPlugin {
  id: string;
  version: string;
  displayName: string;
  buildHash: string | null;
  browserEntryUrl: string | null;
  elements: readonly BrowserCatalogElement[];
  commands: readonly string[];
  diagnostics: readonly PluginDiagnostic[];
}

export interface BrowserPluginCatalog {
  plugins: readonly BrowserCatalogPlugin[];
}

export interface LoadedBrowserRegistry {
  plugins: BrowserPluginCatalog;
  renderers: ReadonlyMap<string, BrowserElementRenderer>;
  commands: ReadonlyMap<string, LoadedBrowserCommand>;
  diagnostics: readonly PluginDiagnostic[];
  dispose(): Promise<void>;
}

export interface LoadedBrowserCommand {
  id: string;
  pluginId: string;
  descriptor: BrowserCommandDescriptor;
}

export type BrowserModuleImporter = (url: string) => Promise<unknown>;

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  return Object.freeze({
    get size() {
      return source.size;
    },
    get: (key: K) => source.get(key),
    has: (key: K) => source.has(key),
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      const view = readonlyMap(source);
      source.forEach((value, key) => {
        callback.call(thisArg, value, key, view);
      });
    },
    [Symbol.iterator]: () => source[Symbol.iterator](),
    [Symbol.toStringTag]: 'Map'
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseDiagnostic(value: unknown): PluginDiagnostic {
  if (!isObject(value)) throw new TypeError('Plugin diagnostic must be an object');
  if (
    typeof value.code !== 'string' ||
    !['info', 'warning', 'error'].includes(String(value.severity)) ||
    typeof value.message !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) {
    throw new TypeError('Plugin diagnostic has an invalid shape');
  }
  return Object.freeze({
    code: value.code,
    severity: value.severity as PluginDiagnostic['severity'],
    message: value.message,
    retryable: value.retryable,
    ...(typeof value.pluginId === 'string' ? { pluginId: value.pluginId } : {}),
    ...(typeof value.elementId === 'string' ? { elementId: value.elementId } : {})
  });
}

function parseCatalog(value: unknown): BrowserPluginCatalog {
  if (!isObject(value) || !Array.isArray(value.plugins)) {
    throw new TypeError('Plugin catalog response must contain a plugins array');
  }
  const ids = new Set<string>();
  const types = new Set<string>();
  const plugins = value.plugins.map((candidate): BrowserCatalogPlugin => {
    if (
      !isObject(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.version !== 'string' ||
      typeof candidate.displayName !== 'string' ||
      !(candidate.buildHash === null || typeof candidate.buildHash === 'string') ||
      !(candidate.browserEntryUrl === null || typeof candidate.browserEntryUrl === 'string') ||
      !Array.isArray(candidate.elements) ||
      !(candidate.commands === undefined || Array.isArray(candidate.commands)) ||
      !Array.isArray(candidate.diagnostics)
    ) {
      throw new TypeError('Plugin catalog entry has an invalid shape');
    }
    if (ids.has(candidate.id)) throw new TypeError(`Duplicate browser plugin ${candidate.id}`);
    ids.add(candidate.id);
    const elements = candidate.elements.map((element): BrowserCatalogElement => {
      if (
        !isObject(element) ||
        typeof element.type !== 'string' ||
        !element.type.startsWith(`${candidate.id}/`) ||
        !Number.isSafeInteger(element.schemaVersion) ||
        Number(element.schemaVersion) < 1
      ) {
        throw new TypeError(`Invalid browser element declaration for ${candidate.id}`);
      }
      if (types.has(element.type)) throw new TypeError(`Duplicate browser element type ${element.type}`);
      types.add(element.type);
      return Object.freeze({
        type: element.type as `${string}/${string}`,
        schemaVersion: Number(element.schemaVersion)
      });
    });
    return Object.freeze({
      id: candidate.id,
      version: candidate.version,
      displayName: candidate.displayName,
      buildHash: candidate.buildHash,
      browserEntryUrl: candidate.browserEntryUrl,
      elements: Object.freeze(elements),
      commands: Object.freeze(
        (candidate.commands ?? []).map((command) => {
          if (typeof command !== 'string' || !isLocalContributionName(command)) {
            throw new TypeError(`Invalid browser command declaration for ${candidate.id}`);
          }
          return command;
        })
      ),
      diagnostics: Object.freeze(candidate.diagnostics.map(parseDiagnostic))
    });
  });
  return Object.freeze({ plugins: Object.freeze(plugins) });
}

export async function fetchBrowserPluginCatalog(
  fetcher: typeof fetch = globalThis.fetch
): Promise<BrowserPluginCatalog> {
  const response = await fetcher('/api/v1/plugins', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin'
  });
  if (!response.ok) throw new Error(`Failed to load plugin catalog: ${response.status}`);
  return parseCatalog(await response.json());
}

function validateModuleUrl(plugin: BrowserCatalogPlugin, baseUrl: string): string {
  if (!plugin.browserEntryUrl || !plugin.buildHash) {
    throw new TypeError(`${plugin.id} does not declare a browser module`);
  }
  const resolved = new URL(plugin.browserEntryUrl, baseUrl);
  const base = new URL(baseUrl);
  if (resolved.origin !== base.origin || resolved.username || resolved.password || resolved.search || resolved.hash) {
    throw new TypeError(`${plugin.id} browser module must be an unadorned same-origin URL`);
  }
  const match = resolved.pathname.match(PLUGIN_MODULE_PATH);
  if (!match || decodeURIComponent(match[1]) !== plugin.id || match[2] !== plugin.buildHash) {
    throw new TypeError(`${plugin.id} browser module URL does not match its catalog identity and build hash`);
  }
  return resolved.href;
}

const nativeImporter: BrowserModuleImporter = (url) => import(/* @vite-ignore */ url);

export async function loadBrowserPluginRegistry(options: {
  catalog: BrowserPluginCatalog;
  baseUrl?: string;
  importer?: BrowserModuleImporter;
}): Promise<LoadedBrowserRegistry> {
  const renderers = new Map<string, BrowserElementRenderer>();
  const commands = new Map<string, LoadedBrowserCommand>();
  const diagnostics: PluginDiagnostic[] = options.catalog.plugins.flatMap((plugin) => [...plugin.diagnostics]);
  const disposables: Array<() => void | Promise<void>> = [];
  const importer = options.importer ?? nativeImporter;
  const baseUrl = options.baseUrl ?? window.location.href;
  for (const plugin of options.catalog.plugins) {
    if (!plugin.browserEntryUrl) continue;
    let activationDispose: (() => void | Promise<void>) | null = null;
    try {
      const expected = new Map(plugin.elements.map((element) => [element.type, element]));
      const expectedCommands = new Set(plugin.commands);
      const registered = new Map<string, BrowserElementRenderer>();
      const registeredCommands = new Map<string, BrowserCommandDescriptor>();
      const moduleValue = await importer(validateModuleUrl(plugin, baseUrl));
      if (
        !isObject(moduleValue) ||
        !isObject(moduleValue.default) ||
        typeof moduleValue.default.activate !== 'function'
      ) {
        throw new TypeError(`${plugin.id} browser entry must default-export a browser plugin`);
      }
      const activated = await moduleValue.default.activate({
        registerRenderer(renderer: BrowserElementRenderer) {
          if (
            !renderer ||
            typeof renderer.type !== 'string' ||
            !Array.isArray(renderer.schemaVersions) ||
            renderer.schemaVersions.some((version) => !Number.isSafeInteger(version) || version < 1) ||
            !['node', 'world-underlay', 'world-overlay'].includes(renderer.placement) ||
            !(
              renderer.details === undefined ||
              (isObject(renderer.details) &&
                (renderer.details.label === undefined ||
                  (typeof renderer.details.label === 'string' && renderer.details.label.length > 0)) &&
                typeof renderer.details.open === 'function')
            ) ||
            typeof renderer.mount !== 'function'
          ) {
            throw new TypeError(`${plugin.id} registered an invalid browser renderer`);
          }
          const declaration = expected.get(renderer.type);
          if (!declaration) throw new TypeError(`${plugin.id} registered undeclared renderer ${renderer.type}`);
          if (registered.has(renderer.type) || renderers.has(renderer.type)) {
            throw new TypeError(`Duplicate browser renderer ${renderer.type}`);
          }
          if (!renderer.schemaVersions.includes(declaration.schemaVersion)) {
            throw new TypeError(
              `${renderer.type} does not support declared schema version ${declaration.schemaVersion}`
            );
          }
          registered.set(renderer.type, Object.freeze(renderer));
        },
        registerCommand(command: BrowserCommandDescriptor) {
          if (
            !command ||
            !isLocalContributionName(command.name) ||
            typeof command.title !== 'string' ||
            command.title.length === 0 ||
            !(command.category === undefined || typeof command.category === 'string') ||
            !(command.hidden === undefined || typeof command.hidden === 'boolean') ||
            !(command.isEnabled === undefined || typeof command.isEnabled === 'function') ||
            typeof command.execute !== 'function'
          ) {
            throw new TypeError(`${plugin.id} registered an invalid browser command`);
          }
          if (!expectedCommands.has(command.name)) {
            throw new TypeError(`${plugin.id} registered undeclared browser command ${command.name}`);
          }
          const id = `${plugin.id}.${command.name}`;
          if (registeredCommands.has(command.name) || commands.has(id)) {
            throw new TypeError(`Duplicate browser command ${id}`);
          }
          registeredCommands.set(command.name, Object.freeze(command));
        }
      });
      if (isObject(activated) && typeof activated.dispose === 'function') {
        const dispose = activated.dispose as () => void | Promise<void>;
        activationDispose = () => dispose.call(activated);
      } else if (activated !== undefined) {
        throw new TypeError(`${plugin.id} browser activation returned an invalid disposable`);
      }
      const missing = [...expected.keys()].filter((type) => !registered.has(type));
      if (missing.length) throw new TypeError(`${plugin.id} did not register browser renderers: ${missing.join(', ')}`);
      const missingCommands = [...expectedCommands].filter((name) => !registeredCommands.has(name));
      if (missingCommands.length) {
        throw new TypeError(`${plugin.id} did not register browser commands: ${missingCommands.join(', ')}`);
      }
      for (const [type, renderer] of registered) renderers.set(type, renderer);
      for (const [name, descriptor] of registeredCommands) {
        const id = `${plugin.id}.${name}`;
        commands.set(id, Object.freeze({ id, pluginId: plugin.id, descriptor }));
      }
      if (activationDispose) disposables.push(activationDispose);
    } catch {
      if (activationDispose) {
        try {
          await activationDispose();
        } catch (error) {
          void error;
        }
      }
      diagnostics.push({
        code: 'browser_plugin_activation_failed',
        severity: 'error',
        message: `Browser plugin activation failed for ${plugin.id}.`,
        retryable: false,
        pluginId: plugin.id
      });
    }
  }
  return Object.freeze({
    plugins: options.catalog,
    renderers: readonlyMap(renderers),
    commands: readonlyMap(commands),
    diagnostics: Object.freeze(diagnostics),
    async dispose() {
      const failures: unknown[] = [];
      for (const dispose of disposables.splice(0).reverse()) {
        try {
          await dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Browser extension disposal failed');
    }
  });
}
