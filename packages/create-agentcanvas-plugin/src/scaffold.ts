import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deriveExtensionNames, derivePluginNames, type PluginNames } from './naming.js';

export interface ScaffoldPluginOptions {
  name: string;
  cwd?: string;
}

const templateDirectory = resolve(import.meta.dirname, '../templates/default');

async function replaceTokens(directory: string, replacements: Readonly<Record<string, string>>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceTokens(sourcePath, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    let content = await readFile(sourcePath, 'utf8');
    for (const [token, value] of Object.entries(replacements)) content = content.replaceAll(token, value);
    await writeFile(sourcePath, content, 'utf8');
  }
}

async function scaffold(options: ScaffoldPluginOptions, names: PluginNames): Promise<string> {
  const parent = resolve(options.cwd ?? process.cwd());
  const target = join(parent, names.directoryName);
  try {
    await stat(target);
    throw new Error(`Target already exists: ${target}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Target already exists:')) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${names.directoryName}.agentcanvas-staging-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  try {
    await cp(templateDirectory, staging, { recursive: true, errorOnExist: true });
    await replaceTokens(staging, {
      __PLUGIN_ID__: names.pluginId,
      __PACKAGE_NAME__: names.packageName,
      __DISPLAY_NAME__: names.displayName
    });
    await rename(join(staging, 'gitignore'), join(staging, '.gitignore'));
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return target;
}

export async function scaffoldPlugin(options: ScaffoldPluginOptions): Promise<string> {
  return scaffold(options, derivePluginNames(options.name));
}

export async function scaffoldExtension(options: ScaffoldPluginOptions): Promise<string> {
  return scaffold(options, deriveExtensionNames(options.name));
}
