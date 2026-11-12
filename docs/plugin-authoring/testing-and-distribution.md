# Testing and distribution

An extension is complete when its source tests pass and its packaged
distribution works without private AgentCanvas imports, React Flow imports, or
a host rebuild.

## Test layers

### Manifest and registration

Use `@agentcanvas/extension-testkit` to check the typed definition, generated
manifest structure, and exact contribution registration. The compatibility
testkit uses Ajv and the SDK-owned structural manifest schema; it is not
dependency-free. The live host additionally owns semver, filesystem containment,
dependency availability and full activation validation. Structural success alone
does not certify a valid version range.

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
- browser command registration, enablement, scoped transactions, and abort;
- activation disposable cleanup;
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
npm run pack:extension
npm run agentcanvas:verify
```

`pack:extension` produces `plugin-dist/<plugin-id>`. The older
`pack:plugin` script remains an alias in the compatibility scaffold.

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

Use the isolated development host during authoring:

```bash
npm exec -- agentcanvas extension dev . --port 23083
```

It uses a temporary extension installation and database and reloads browser
pages after a successful rebuild. For final conformance against a disposable
AgentCanvas database/runtime:

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

The SDK, testkit and scaffolder live in this repository and are not published
to npm. Use the public-source build below to create local packages; no npm
account or private GitHub access is needed for this authoring toolchain.
Running the full AgentCanvas application is separate and still has the
[private dependency requirements](../getting-started.md#prerequisites).

### Build the authoring packages from public source

Requires Node.js 24+, npm 11+, Git, Bash and `tar`, plus network access to public
npm dependencies. These commands work in a Bash shell on Linux/macOS or WSL.
Use a fresh sibling directory; `mkdir` deliberately refuses to overwrite one.

```bash
set -euo pipefail
git clone https://github.com/jackspooner/agentcanvas.git
cd agentcanvas
AUTHORING_DIR="$(dirname "$PWD")/agentcanvas-authoring"
mkdir "$AUTHORING_DIR"
git archive HEAD \
  packages/plugin-sdk packages/plugin-testkit \
  packages/extension-sdk packages/extension-testkit \
  packages/create-agentcanvas-plugin packages/create-agentcanvas-extension \
  | tar -x -C "$AUTHORING_DIR"

cd "$AUTHORING_DIR"
npm init --yes
npm pkg set private=true --json
npm pkg set 'workspaces[0]=packages/*'
npm install
npm run build \
  --workspace @agentcanvas/plugin-sdk \
  --workspace @agentcanvas/plugin-testkit \
  --workspace @agentcanvas/extension-sdk \
  --workspace @agentcanvas/extension-testkit \
  --workspace create-agentcanvas-plugin \
  --workspace create-agentcanvas-extension
npm run check --workspaces --if-present
npm run test --workspaces --if-present

mkdir tarballs
npm pack --workspaces --pack-destination "$AUTHORING_DIR/tarballs"
```

Only the six authoring package sources are exported from the committed checkout;
the application's root manifest, private dependencies and runtime data are not
copied. The extension-named packages reuse the three compatibility packages, so
all six are built together. Their runtime dependencies are local workspace
packages and public npm packages.

The first install creates a lockfile in the isolated build directory. Keep that
lockfile and use `npm ci` there for repeat builds. Public dependency ranges can
resolve newer versions on a new first install. To build a particular source
version, check out its commit before `git archive`; rebuilding the same directory
does not automatically update the exported source.

### Create and verify an extension with local packages

Continue in the same shell so `AUTHORING_DIR` still points to the build above:

```bash
mkdir -p "$AUTHORING_DIR/examples"
cd "$AUTHORING_DIR/examples"
node "$AUTHORING_DIR/packages/create-agentcanvas-extension/dist/cli.js" signal-card
cd signal-card
npm install "$AUTHORING_DIR"/tarballs/agentcanvas-*.tgz
npm test
npm run check
npm run pack:extension
npm run agentcanvas:verify
```

Install all four SDK/testkit tarballs in that single command. It replaces the
generated project's unpublished registry references and supplies their
compatibility dependencies; running plain `npm install` first would try to fetch
unpublished packages. The wildcard assumes the fresh tarball directory above
contains one version of each package.

The result is `signal-card/plugin-dist/signal-card`, ready for the
[host installation steps](README.md#how-activation-works). These checks do not
start AgentCanvas or install into a running host. Continue the
[tutorial](tutorial.md#2-understand-the-generated-layout) to customize it.

The generated project records local tarball paths in its package manifest and
lockfile. Keep the tarballs available, or copy them into a project-owned vendor
directory and reinstall from those paths before sharing the source. Do not ship
machine-specific absolute paths as a public dependency contract. The built
extension distribution is separate from this development environment.

Maintainers with a prepared full checkout can also run
`npm run check:extension-packages` for the automated packed-package proof, and
`npm run test:external-plugin` for the [external plugin fixture](external-plugin-proof.md).
