import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STANDARD_PLUGINS } from '../../src/cli/openapi.js';
import { createV2Runtime, createV2ServiceHandler } from '../../src/server-v2.js';

const host = '127.0.0.1';
const port = 23175;
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agentcanvas-diagrams-e2e-'));
const pluginsRoot = path.join(tempRoot, 'plugins');
await mkdir(pluginsRoot);
for (const id of [...STANDARD_PLUGINS, 'agentcanvas.diagrams'])
  await cp(path.join(repositoryRoot, 'dist', 'plugin-catalog', id), path.join(pluginsRoot, id), { recursive: true });
const runtime = await createV2Runtime({
  pluginsRoot,
  databasePath: path.join(tempRoot, 'diagrams.sqlite'),
  config: { host, port, publicBaseUrl: `http://${host}:${port}` }
});
const server = createServer(createV2ServiceHandler(runtime));

async function cleanup(): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  runtime.dispose();
  if (
    path.dirname(tempRoot) !== path.resolve(os.tmpdir()) ||
    !path.basename(tempRoot).startsWith('agentcanvas-diagrams-e2e-')
  )
    throw new Error('Refusing to remove an unverified diagram fixture path.');
  await rm(tempRoot, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(
    signal,
    () =>
      void cleanup().then(
        () => process.exit(0),
        (error) => {
          console.error(error);
          process.exit(1);
        }
      )
  );
server.listen(port, host, () => console.log(`Diagram proof service listening on http://${host}:${port}`));
