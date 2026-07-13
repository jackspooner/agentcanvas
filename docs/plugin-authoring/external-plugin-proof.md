# External plugin proof

The repository fixture at `test/external-plugin-fixture` deliberately sits outside the host package and first-party plugin workspaces. Its production source imports only `@agentcanvas/plugin-sdk`; tests and packaging import only `@agentcanvas/plugin-testkit`.

Build packed public packages and install them into a disposable copy of the fixture:

```sh
npm pack --workspace @agentcanvas/plugin-sdk --pack-destination <tarball-dir>
npm pack --workspace @agentcanvas/plugin-testkit --pack-destination <tarball-dir>
cd test/external-plugin-fixture
npm install <tarball-dir>/agentcanvas-plugin-sdk-0.2.0.tgz <tarball-dir>/agentcanvas-plugin-testkit-0.2.0.tgz
npm run check
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

Install `plugin-dist/external.signal-card`, restart the host, and verify its element, browser renderer, snapshot renderer, procedure, MCP tool, and schemas in runtime OpenAPI. Disable it while the service is stopped, restart, and verify stored envelopes remain unchanged with missing-plugin diagnostics. Reinstall the same compatible distribution and restart; rendering must return without a document revision or rewrite.

The repository automates the public-package build and distribution checks through `npm run test:external-plugin`. `test/external-plugin-host.test.ts` also exercises install, restart-equivalent registry recreation, missing-plugin preservation, and compatible reinstall against a disposable runtime and database. A real service/browser smoke remains part of release acceptance because it verifies production module delivery without rebuilding the host.

See [Testing and distribution](testing-and-distribution.md) for the complete conformance matrix.
