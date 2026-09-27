import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { CANVAS_THEME_V1_SCHEMA } from '@agentcanvas/plugin-sdk';
import { coreOpenApiPaths } from './api-v2/core-paths.js';
import {
  CANVAS_BOUNDS_SCHEMA,
  CANVAS_RECORD_SCHEMA,
  createRegistryOpenApiDocument,
  SHARE_LINK_SCHEMA,
  VIEWPORT_SCHEMA
} from './api-v2/index.js';
import { type AgentCanvasConfig, loadConfig } from './config.js';
import { EmbedSessionRegistry } from './embed-sessions.js';
import { MacroRuntime } from './macros/index.js';
import { assertPluginSchemasReady } from './migrations/plugin-schema.js';
import {
  type BrowserPluginCatalog,
  createBrowserPluginCatalog,
  type FrozenPluginRegistry,
  PluginElementValidator,
  type PreparedPluginRuntime,
  preparePluginRuntime
} from './plugin-runtime/index.js';
import type { ResourceBroker } from './resources/broker.js';
import { V2SqliteCanvasStore } from './store/v2.js';
import { AGENTCANVAS_VERSION } from './version.js';
import { ViewerPresenceRegistry } from './viewer-presence.js';
export interface V2Runtime {
  config: AgentCanvasConfig;
  plugins: PreparedPluginRuntime;
  registry: FrozenPluginRegistry;
  browserCatalog: BrowserPluginCatalog;
  resources: ResourceBroker;
  store: V2SqliteCanvasStore;
  macros: MacroRuntime;
  embedSessions: EmbedSessionRegistry;
  viewerPresence: ViewerPresenceRegistry;
  openapi: JsonObject;
  developmentReloadVersion?: string;
  dispose(): void;
}

export interface CreateV2RuntimeOptions {
  config?: Partial<AgentCanvasConfig>;
  pluginsRoot?: string;
  databasePath?: string;
  developmentReloadVersion?: string;
}

export async function createV2Runtime(options: CreateV2RuntimeOptions = {}): Promise<V2Runtime> {
  const config = loadConfig({ ...options.config, databasePath: options.databasePath ?? options.config?.databasePath });
  const plugins = await preparePluginRuntime(options.pluginsRoot);
  const store = new V2SqliteCanvasStore(new PluginElementValidator(plugins.registry), config.databasePath, config);
  const macros = new MacroRuntime(store, plugins.registry);
  const embedSessions = new EmbedSessionRegistry(config.publicBaseUrl);
  const viewerPresence = new ViewerPresenceRegistry();
  plugins.bindDatabase(store.db);
  assertPluginSchemasReady(store.db, plugins.registry, config.databasePath, plugins.pluginsRoot);
  const browserCatalog = await createBrowserPluginCatalog(plugins.registry);
  const openapi = createRegistryOpenApiDocument(plugins.registry, {
    title: 'AgentCanvas API',
    version: AGENTCANVAS_VERSION,
    description: 'Registry-derived AgentCanvas HTTP contract.',
    serverUrls: [config.publicBaseUrl],
    corePaths: coreOpenApiPaths(),
    additionalSchemas: {
      CanvasBounds: CANVAS_BOUNDS_SCHEMA,
      CanvasThemeV1: CANVAS_THEME_V1_SCHEMA,
      CanvasRecord: CANVAS_RECORD_SCHEMA,
      Viewport: VIEWPORT_SCHEMA,
      ShareLink: SHARE_LINK_SCHEMA
    }
  });
  return {
    config,
    plugins,
    registry: plugins.registry,
    browserCatalog,
    resources: plugins.resources,
    store,
    macros,
    embedSessions,
    viewerPresence,
    openapi,
    dispose() {
      plugins.resources.dispose();
      store.close();
    },
    ...(options.developmentReloadVersion ? { developmentReloadVersion: options.developmentReloadVersion } : {})
  };
}
