# External AgentCanvas plugin fixture

This package deliberately lives outside `packages/` and `plugin-packages/`. Its source imports only `@agentcanvas/plugin-sdk`; conformance and distribution scripts import only `@agentcanvas/plugin-testkit`.

For the true external-package proof, pack the SDK and testkit, install those tarballs here, and run:

```sh
npm run check
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

The installable directory is `plugin-dist/external.signal-card`. Installing, disabling, and reinstalling it exercises host discovery and missing-plugin data preservation without rebuilding AgentCanvas.
