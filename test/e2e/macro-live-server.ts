import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createV2Runtime, createV2ServiceHandler } from '../../src/server-v2.js';

const host = '127.0.0.1';
const port = 23174;
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const pluginsRoot = path.join(repositoryRoot, 'plugin-packages');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentcanvas-macro-e2e-'));
const databasePath = path.join(tempRoot, 'macro-proof.sqlite');
const runtime = await createV2Runtime({
  pluginsRoot,
  databasePath,
  config: { host, port, publicBaseUrl: `http://${host}:${port}` }
});
const server = createServer(createV2ServiceHandler(runtime));

function isOwnedTempPath(candidate: string): boolean {
  return path.dirname(candidate) === tempRoot && path.basename(candidate).startsWith('macro-proof');
}

async function cleanup(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  runtime.dispose();
  if (!isOwnedTempPath(databasePath)) throw new Error('Refusing to remove an unverified macro proof database path.');
  await rm(tempRoot, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      }
    );
  });
}

server.listen(port, host, () => {
  console.log(`Macro proof service listening on http://${host}:${port}`);
});
