# Testing and distribution

A plugin is complete when its source tests pass and its packaged distribution works without private AgentCanvas imports or a host rebuild.

## Test layers

### Manifest and registration

Use `@agentcanvas/plugin-testkit` to check manifest structure and exact contribution registration. The live host remains the canonical owner of strict Ajv, semver, containment, and full activation validation.

Test:

- identifier rules and contribution uniqueness;
- exact manifest/registration parity;
- required entrypoints and declared config files;
- capability/plugin ranges;
- no undeclared contribution registration.

### Element contracts

Test valid and invalid `data`/`style`, required properties, additional-property rejection, cross-field rules, summaries, and complete current-version envelopes. Include finite-number and JSON edge cases.

### Browser lifecycle

Use a real ShadowRoot or browser harness to verify:

- mount once and update without remount;
- abort-aware asynchronous updates;
- stale completion suppression;
- dispose exactly once;
- release of object URLs, media sources, listeners, overlays, and other resources;
- `data-agentcanvas-interactive` behavior;
- read-only mode;
- renderer failure isolation and Shadow DOM styling isolation.

### Snapshot safety

Verify declared snapshot policy, geometry, labels, extents, escaping, and diagnostics. Reject raw SVG/HTML/CSS, external URLs, data URLs, `url(...)` paints, invalid colors/paths, excessive nodes/depth/text, and undeclared image handles.

### Tools and procedures

Test both input and output schemas. Verify permission-scoped mutations, complete replacement semantics, abort handling, deterministic errors, and resource handles for binary output.

### Migrations

Run importers and schema migrations more than once against immutable fixtures and require identical output. Validate every result with the current envelope and plugin schemas. Include unknown-field and unsupported-version failures.

## Build the distribution

The generated scaffold provides:

```bash
npm run check
npm test
npm run pack:plugin
npm run agentcanvas:verify
```

`pack:plugin` produces `plugin-dist/<plugin-id>`.

A distribution normally contains:

```text
agentcanvas.plugin.json
dist/server.mjs
dist/browser/entry.mjs        # when declared
dist/browser/chunks/...       # contained relative chunks
schemas/config.schema.json    # when declared
plugin.config.json            # when declared
README.md
LICENSE
```

Do not ship source-tree imports, private host imports, absolute paths, local workspace links, undeclared runtime files, or browser chunks outside the declared browser subtree.

Server and browser entrypoints are prebuilt ESM. Browser dependencies must be bundled or emitted as contained relative chunks/assets. The production module route serves only the browser subtree.

## Verify package contents

Also run:

```bash
npm pack --dry-run
```

Inspect the file list. Verify every relative browser import resolves inside the browser subtree and every manifest/config path resolves inside the distribution root.

## Host conformance

Against a disposable AgentCanvas database/runtime:

1. Install the distribution while stopped.
2. Restart without rebuilding the host.
3. Verify plugin status and runtime OpenAPI.
4. Verify the namespaced MCP tool and procedure.
5. Create and read its element.
6. Render it in the browser and snapshot.
7. Disable it and verify data preservation plus diagnostics.
8. Reinstall it and verify rendering returns without document mutation.

Do not use the live database as the first integration target.

## Public-package proof

Before claiming third-party compatibility, pack the SDK and testkit and install those tarballs into a project outside the AgentCanvas source/workspace tree:

```bash
npm pack --workspace @agentcanvas/plugin-sdk --pack-destination <tarball-dir>
npm pack --workspace @agentcanvas/plugin-testkit --pack-destination <tarball-dir>
npm install <tarball-dir>/agentcanvas-plugin-sdk-*.tgz <tarball-dir>/agentcanvas-plugin-testkit-*.tgz
```

Build and package using only those public packages. The repository automates this proof with `npm run test:external-plugin` and the fixture documented in [External plugin proof](external-plugin-proof.md).
