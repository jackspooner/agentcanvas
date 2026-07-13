#!/usr/bin/env node
import { scaffoldPlugin } from './scaffold.js';

const usage = `Usage: create-agentcanvas-plugin <plugin-name>

Creates a standalone AgentCanvas plugin in ./<plugin-name>.
The name must use lowercase letters, numbers, and hyphens.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const name = args[0];
  if (args.length !== 1 || name === undefined || name.startsWith('-')) throw new Error(usage);
  const target = await scaffoldPlugin({ name });
  process.stdout.write(
    `Created ${target}\n\nNext:\n  cd ${name}\n  npm install\n  npm test\n  npm run pack:plugin\n  npm run agentcanvas:verify\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
