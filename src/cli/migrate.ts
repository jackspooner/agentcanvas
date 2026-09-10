import { inspectMigrationDatabase } from '../migrations/inspect';
import type { MigrationInspectionReport } from '../migrations/types';

export interface MigrationCliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface MigrationCliHooks {
  inspect(databasePath: string, pluginsPath?: string): MigrationInspectionReport | Promise<MigrationInspectionReport>;
  apply?(input: { databasePath: string; backupDir?: string; pluginsPath?: string }): unknown | Promise<unknown>;
  verify?(input: { databasePath: string; pluginsPath?: string }): unknown | Promise<unknown>;
  restore?(input: { databasePath: string; backupPath: string }): unknown | Promise<unknown>;
  repairCreatedBy?(input: { databasePath: string; backupDir: string }): unknown | Promise<unknown>;
}

interface ParsedArguments {
  command: 'inspect' | 'apply' | 'verify' | 'restore' | 'repair-created-by';
  databasePath: string;
  pluginsPath?: string;
  backupDir?: string;
  backupPath?: string;
  json: boolean;
}

const USAGE = `Usage:
  agentcanvas migrate inspect --database <path> [--json]
  agentcanvas migrate apply --database <path> [--backup-dir <path>] [--plugins <path>]
  agentcanvas migrate verify --database <path> [--plugins <path>]
  agentcanvas migrate repair-created-by --database <path> --backup-dir <path>
  agentcanvas migrate restore --database <path> --backup <path>`;

function parseArguments(args: string[]): ParsedArguments {
  if (
    args[0] !== 'migrate' ||
    !['inspect', 'apply', 'verify', 'restore', 'repair-created-by'].includes(args[1] ?? '')
  ) {
    throw new Error(USAGE);
  }
  const command = args[1] as ParsedArguments['command'];
  const values = new Map<string, string>();
  let json = false;
  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--json') {
      json = true;
      continue;
    }
    if (!['--database', '--plugins', '--backup-dir', '--backup'].includes(flag))
      throw new Error(`unknown option: ${flag}\n${USAGE}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}\n${USAGE}`);
    values.set(flag, value);
    index += 1;
  }
  const databasePath = values.get('--database');
  if (!databasePath) throw new Error(`--database is required\n${USAGE}`);
  if (command === 'restore' && !values.get('--backup')) throw new Error(`--backup is required for restore\n${USAGE}`);
  if (command === 'repair-created-by' && !values.get('--backup-dir'))
    throw new Error(`--backup-dir is required for repair-created-by\n${USAGE}`);
  return {
    command,
    databasePath,
    ...(values.get('--plugins') ? { pluginsPath: values.get('--plugins') } : {}),
    ...(values.get('--backup-dir') ? { backupDir: values.get('--backup-dir') } : {}),
    ...(values.get('--backup') ? { backupPath: values.get('--backup') } : {}),
    json
  };
}

function renderInspection(report: MigrationInspectionReport): string {
  const blockers = report.issues.filter((issue) => issue.severity === 'blocker');
  const lines = [
    `Database: ${report.databasePath}`,
    `Versions: physical=${report.versions.physicalVersion}, document=${report.versions.documentVersions.join(',') || 'unknown'}`,
    `Counts: canvases=${report.counts.canvases}, elements=${report.counts.elements}, shares=${report.counts.shareLinks}, events=${report.counts.events}, idempotency=${report.counts.idempotencyRows}`,
    `Runtime-only fields to strip: ${report.runtimeFieldsToStrip.length}`,
    `Group blockers: ${report.groupBlockers.length}`,
    `Backup: ${report.intendedBackupPath}`,
    `Can apply: ${report.canApply ? 'yes' : 'no'}`
  ];
  for (const blocker of blockers) lines.push(`BLOCKER ${blocker.code}: ${blocker.message}`);
  return lines.join('\n');
}

const defaultHooks: MigrationCliHooks = {
  inspect: (databasePath) => inspectMigrationDatabase(databasePath)
};

/** Dispatches CLI commands without terminating the process, allowing package and test wrappers to supply migration hooks. */
export async function runMigrationCli(
  args: string[],
  io: MigrationCliIo = { stdout: console.log, stderr: console.error },
  hooks: MigrationCliHooks = defaultHooks
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    let result: unknown;
    if (parsed.command === 'inspect') result = await hooks.inspect(parsed.databasePath, parsed.pluginsPath);
    else if (parsed.command === 'apply') {
      if (!hooks.apply) throw new Error('migration apply integration is not available in this build');
      result = await hooks.apply({
        databasePath: parsed.databasePath,
        ...(parsed.backupDir ? { backupDir: parsed.backupDir } : {}),
        ...(parsed.pluginsPath ? { pluginsPath: parsed.pluginsPath } : {})
      });
    } else if (parsed.command === 'verify') {
      if (!hooks.verify) throw new Error('migration verify integration is not available in this build');
      result = await hooks.verify({
        databasePath: parsed.databasePath,
        ...(parsed.pluginsPath ? { pluginsPath: parsed.pluginsPath } : {})
      });
    } else if (parsed.command === 'restore') {
      if (!hooks.restore) throw new Error('migration restore integration is not available in this build');
      result = await hooks.restore({ databasePath: parsed.databasePath, backupPath: parsed.backupPath as string });
    } else {
      if (!hooks.repairCreatedBy) throw new Error('creator repair integration is not available in this build');
      result = await hooks.repairCreatedBy({
        databasePath: parsed.databasePath,
        backupDir: parsed.backupDir as string
      });
    }
    if (parsed.command === 'inspect' && !parsed.json) io.stdout(renderInspection(result as MigrationInspectionReport));
    else io.stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export { USAGE as MIGRATION_CLI_USAGE };
