import { createServer, type RequestListener } from 'node:http';
import { pathToFileURL } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { nanoid } from 'nanoid';
import { createV2App } from './api-v2/app.js';
import { problemForCode } from './api-v2/problem-contract.js';
import { handleMcpV2Request } from './mcp-v2/http.js';
import { createV2Runtime, type V2Runtime } from './runtime.js';
import {
  assertTrustedRequest,
  SECURITY_RESPONSE_HEADERS,
  SecurityPolicyError,
  securityResponseHeaders
} from './security.js';
import { AGENTCANVAS_VERSION } from './version.js';

export { createV2App } from './api-v2/app.js';
export { coreOpenApiPaths } from './api-v2/core-paths.js';
export { type CreateV2RuntimeOptions, createV2Runtime } from './runtime.js';
export function createV2ServiceHandler(runtime: V2Runtime): RequestListener {
  const app = createV2App(runtime);
  const handler = getRequestListener(app.fetch, { hostname: runtime.config.host, overrideGlobalObjects: false });
  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', runtime.config.publicBaseUrl);
    let responseHeaders = SECURITY_RESPONSE_HEADERS;
    const embedMatch = requestUrl.pathname.match(/^\/embed\/([^/]+)$/);
    if (embedMatch) {
      try {
        const session = runtime.embedSessions.get(decodeURIComponent(embedMatch[1]));
        responseHeaders = securityResponseHeaders([session.parentOrigin]);
      } catch {
        responseHeaders = SECURITY_RESPONSE_HEADERS;
      }
    }
    for (const [name, value] of Object.entries(responseHeaders)) response.setHeader(name, value);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      assertTrustedRequest(headers, runtime.config.security);
    } catch (error) {
      if (!(error instanceof SecurityPolicyError)) throw error;
      const securityRequestId = request.headers['x-request-id']?.toString() ?? `req_${nanoid(16)}`;
      const problem = problemForCode(
        error.code as 'untrusted_host' | 'untrusted_origin',
        error.message,
        securityRequestId,
        requestUrl.pathname
      );
      response.statusCode = problem.status;
      response.setHeader('content-type', 'application/problem+json');
      response.setHeader('x-request-id', securityRequestId);
      response.end(JSON.stringify(problem));
      return;
    }
    if (requestUrl.pathname === '/mcp') {
      await handleMcpV2Request(request, response, {
        publicBaseUrl: runtime.config.publicBaseUrl,
        registry: runtime.registry,
        store: runtime.store,
        macros: runtime.macros,
        browserCatalog: runtime.browserCatalog,
        diagnostics: () => runtime.plugins.diagnostics.list()
      });
      return;
    }
    await handler(request, response);
  };
}

export async function startAgentCanvas(): Promise<void> {
  const { loadAgentCanvasDotenv } = await import('./dotenv.js');
  loadAgentCanvasDotenv();
  const runtime = await createV2Runtime();
  const server = createServer(createV2ServiceHandler(runtime));
  server.once('close', () => runtime.dispose());
  server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`AgentCanvas ${AGENTCANVAS_VERSION} listening on ${runtime.config.publicBaseUrl}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentCanvas().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
