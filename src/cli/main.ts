import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JsonObject, PluginMigrationDescriptor } from '@agentcanvas/plugin-sdk';
import {
  applyMigration,
  applyPluginSchemaMigrations,
  inspectMigrationDatabase,
  LEGACY_TYPE_DEFINITIONS,
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
import { runPluginCli } from './plugins.js';
import { inspectDatabaseVersion } from '../store/version.js';
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

async function run(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === 'plugins') {
    await runPluginCli(args.slice(1));
    return 0;
  }
  return runMigrationCli(args, undefined, {
    inspect: (databasePath) => inspectMigrationDatabase(databasePath),
    apply: async ({ databasePath, backupDir, pluginsPath }) => {
      const registry = await loadOfflineRegistry(pluginsPath);
      const db = new DatabaseSync(path.resolve(databasePath));
      const state = inspectDatabaseVersion(db);
      db.close();
      if (state.kind === 'v2') {
        return applyPluginSchemaMigrations({
          databasePath,
          backupDir,
          registry,
          toolVersion: AGENTCANVAS_VERSION
        });
      }
      const validator = new PluginElementValidator(registry);
      return applyMigration({
        databasePath,
        backupDir,
        importers: migrationImporters(registry),
        validateElement: (element) => validator.normalizeForWrite(element),
        toolVersion: AGENTCANVAS_VERSION
      });
    },
    verify: async ({ databasePath, pluginsPath }) => {
      const registry = await loadOfflineRegistry(pluginsPath);
      const validator = new PluginElementValidator(registry);
      return verifyMigrationDatabase({
        databasePath,
        validateElement: (element) => validator.validatePersisted(element, { allowMissingPlugin: false })
      });
    },
    restore: ({ databasePath, backupPath }) => restoreMigration({ databasePath, backupPath })
  });
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
