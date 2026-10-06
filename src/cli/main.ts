import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { JsonObject, PluginMigrationDescriptor } from '@agentcanvas/plugin-sdk';
import {
  applyMigration,
  applyCanvasThemeSchemaMigration,
  applyMacroStorageSchemaMigration,
  applyCanvasDeletionSchemaMigration,
  applyPluginSchemaMigrations,
  inspectMigrationDatabase,
  LEGACY_TYPE_DEFINITIONS,
  repairCreatedBy,
  restoreMigration,
  type LegacyElementImporter,
  verifyMigrationDatabase
} from '../migrations/index.js';
import {
  loadOfflinePluginRegistry,
  PluginElementValidator,
  type FrozenPluginRegistry
} from '../plugin-runtime/index.js';
import { runMigrationCli } from './migrate.js';
import { assertAgentCanvasStopped, runPluginCli } from './plugins.js';
import { runExtensionCli } from './extensions.js';
import { inspectDatabaseVersion, type DatabaseVersionState } from '../store/version.js';
import { AGENTCANVAS_VERSION } from '../version.js';

async function loadOfflineRegistry(pluginsPath?: string): Promise<FrozenPluginRegistry> {
  return (await loadOfflinePluginRegistry({ pluginsRoot: pluginsPath ? path.resolve(pluginsPath) : undefined }))
    .registry;
}

function migrationImporters(registry: FrozenPluginRegistry): LegacyElementImporter[] {
  const importers: LegacyElementImporter[] = [];
  for (const plugin of registry.plugins) {
    for (const descriptor of plugin.migrations) {
      for (const legacyType of descriptor.legacyTypes) {
        importers.push(adaptMigration(plugin.plugin.manifest.id, descriptor, legacyType));
      }
    }
  }
  return importers;
}

function adaptMigration(
  pluginId: string,
  descriptor: PluginMigrationDescriptor,
  legacyType: string
): LegacyElementImporter {
  const targetType = LEGACY_TYPE_DEFINITIONS[legacyType]?.targetType;
  if (!targetType || !targetType.startsWith(`${pluginId}/`)) {
    throw new Error(`${pluginId}/${descriptor.name} declares unsupported legacy type ${legacyType}`);
  }
  return {
    legacyType,
    targetType,
    schemaVersion: 1,
    import: (legacy, context) => {
      const result = descriptor.importLegacy(legacy, context);
      if (!result.element.type.startsWith(`${pluginId}/`)) {
        throw new Error(`${pluginId}/${descriptor.name} returned an element owned by another plugin`);
      }
      return {
        data: result.element.data as JsonObject,
        ...(result.element.style !== undefined ? { style: result.element.style } : {})
      };
    }
  };
}

export async function applyMigrationCli(input: {
  databasePath: string;
  backupDir?: string;
  pluginsPath?: string;
}): Promise<unknown> {
  const db = new DatabaseSync(path.resolve(input.databasePath));
  let state: DatabaseVersionState;
  try {
    state = inspectDatabaseVersion(db);
  } finally {
    db.close();
  }
  if (state.kind === 'v2' && state.physicalVersion === 4) {
    return applyCanvasDeletionSchemaMigration({ ...input, toolVersion: AGENTCANVAS_VERSION });
  }
  if (state.kind === 'v2' && state.physicalVersion === 3) {
    const preceding = await applyMacroStorageSchemaMigration({
      databasePath: input.databasePath,
      ...(input.backupDir ? { backupDir: input.backupDir } : {}),
      toolVersion: AGENTCANVAS_VERSION
    });
    return {
      ...(await applyCanvasDeletionSchemaMigration({ ...input, toolVersion: AGENTCANVAS_VERSION })),
      precedingMigrations: [preceding]
    };
  }
  if (state.kind === 'v2-theme-migration-required') {
    const preceding = await applyCanvasThemeSchemaMigration({
      databasePath: input.databasePath,
      ...(input.backupDir ? { backupDir: input.backupDir } : {}),
      toolVersion: AGENTCANVAS_VERSION
    });
    return {
      ...(await applyCanvasDeletionSchemaMigration({ ...input, toolVersion: AGENTCANVAS_VERSION })),
      precedingMigrations: [preceding]
    };
  }

  const registry = await loadOfflineRegistry(input.pluginsPath);
  if (state.kind === 'v2') {
    return applyPluginSchemaMigrations({
      databasePath: input.databasePath,
      backupDir: input.backupDir,
      registry,
      toolVersion: AGENTCANVAS_VERSION
    });
  }
  const validator = new PluginElementValidator(registry);
  const preceding = await applyMigration({
    databasePath: input.databasePath,
    backupDir: input.backupDir,
    importers: migrationImporters(registry),
    validateElement: (element) => validator.normalizeForWrite(element),
    toolVersion: AGENTCANVAS_VERSION
  });
  return {
    ...(await applyCanvasDeletionSchemaMigration({ ...input, toolVersion: AGENTCANVAS_VERSION })),
    precedingMigrations: [preceding]
  };
}

async function run(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'plugins') {
    await runPluginCli(args.slice(1));
    return 0;
  }
  if (args[0] === 'extension') {
    await runExtensionCli(args.slice(1));
    return 0;
  }
  return runMigrationCli(args, undefined, {
    inspect: (databasePath) => inspectMigrationDatabase(databasePath),
    apply: applyMigrationCli,
    verify: async ({ databasePath, pluginsPath }) => {
      const registry = await loadOfflineRegistry(pluginsPath);
      const validator = new PluginElementValidator(registry);
      return verifyMigrationDatabase({
        databasePath,
        validateElement: (element) => validator.validatePersisted(element, { allowMissingPlugin: false })
      });
    },
    restore: ({ databasePath, backupPath }) => restoreMigration({ databasePath, backupPath }),
    repairCreatedBy: async ({ databasePath, backupDir }) => {
      await assertAgentCanvasStopped();
      return repairCreatedBy({ databasePath, backupDir, toolVersion: AGENTCANVAS_VERSION });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
