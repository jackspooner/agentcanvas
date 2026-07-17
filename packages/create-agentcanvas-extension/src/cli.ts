#!/usr/bin/env node
import { scaffoldExtension } from './index.js';

const usage = `Usage: create-agentcanvas-extension <extension-name>

Creates a standalone AgentCanvas extension in ./<extension-name>.
The name must use lowercase letters, numbers, and hyphens.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const name = args[0];
  if (args.length !== 1 || name === undefined || name.startsWith('-')) throw new Error(usage);
  const target = await scaffoldExtension({ name });
  process.stdout.write(
    `Created ${target}\n\nNext:\n  cd ${name}\n  npm install\n  npm test\n  npm run pack:extension\n  npm run agentcanvas:verify\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
