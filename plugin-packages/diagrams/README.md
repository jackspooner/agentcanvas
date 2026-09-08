# Diagrams

Optional first-party AgentCanvas extension `agentcanvas.diagrams` (host API `^1.2.0`).
It supplies native `agentcanvas.diagrams/erd` elements and source-based
`agentcanvas.diagrams/mermaid` elements. The standard extensions remain primitives,
Markdown, and tables. No database connection is involved.

## Editing

Create a diagram from the Extensions menu. Native ERDs support entity header
dragging, names and aliases, ordered attributes with PK/FK/UK annotations and
nullable/required/unspecified status, and relationships with four Crow's Foot
cardinalities at each endpoint. Drag connection handles or use the relationship
form. Attribute attachments refer to stable IDs. Renaming preserves those IDs.
Deleting an entity or attached attribute also removes its relationships; the
confirmation shows the cascade count. Identifying lines are solid, others dashed.

Select an internal item to edit it; Delete inside the editor affects that item.
Outside the editor, normal canvas selection applies. Auto layout supports LR and
TB. Fit changes only the view. Expand opens the same editor with pan and zoom.
Each gesture, submitted form, layout, or cascade is one undo step. Ctrl/Cmd+Z and
redo work while the diagram viewport is focused; text inputs retain native text
undo. Locked and read-only diagrams permit viewing and export. Failed saves retain
the form draft. A revision conflict requires reviewing current state before a new
edit; stale full replacements are never automatically retried.

Mermaid uses a labeled source editor and a 300ms debounced preview. Save parses
and renders the exact submitted text. Supported families are ERDs, flowcharts
(`flowchart`/`graph`), sequence, class, and state diagrams (including supported
grammar aliases). Source is preserved verbatim. Frontmatter and configuration
directives are unsupported. Rendering uses strict security, no click callbacks,
no remote resources, and the canvas theme. Browser output is an inert image.

Generic element writes check structure and synchronous source policy, so invalid
syntax may be retained for repair. Browser rendering, asynchronous resolution,
and `validate-mermaid` show explicit diagnostics; an old image is never presented
as the current source. Normal authoring tools and editor saves require valid syntax.

## Agent tools

The resident MCP derives names such as `agentcanvas_diagrams__create_erd`.

| Local name | Action |
|---|---|
| `create-erd` | Create native data with explicit `layout: preserve`, `LR`, or `TB` |
| `edit-erd` | Atomic semantic operation batch at `expectedRevision` |
| `create-mermaid` | Validate and create exact source |
| `update-mermaid` | Validate and replace source at `expectedRevision` |
| `validate-mermaid` | Syntax/type diagnostics; optional `purpose: convert-to-erd` analysis |
| `export-mermaid` | Validated source and loss warnings from a native ERD |
| `convert-mermaid-erd` | Independent native copy at `expectedRevision`, with `acknowledgeWarnings` |

Example `create-erd` input (use an existing canvas ID):

```json
{"canvasId":"orders-board","x":40,"y":40,"layout":"LR","data":{"title":"Orders","entities":[{"id":"orders","name":"Orders","x":0,"y":0,"attributes":[{"id":"id","name":"id","dataType":"uuid","keys":["PK"],"nullable":false}]}],"relationships":[]}}
```

Example edit (use the resulting element ID and latest canvas revision):

```json
{"canvasId":"orders-board","elementId":"diagram-id","expectedRevision":2,"operations":[{"op":"move-entity","entityId":"orders","x":120,"y":80}]}
```

Mutation results return IDs, revision, affected IDs, removed relationship IDs and
diagnostics. Refresh the canvas, element resolution, inspection and snapshots
after successful changes. Types and schemas are exported by the package's root
and `/schemas` entry points. Generic operations and macros use the same ERD
semantic validator as these tools.

## Conversion

Mermaid ERD conversion uses the pinned parser's internal ER database through an
isolated adapter. It maps aliases, ordered attributes, keys, comments,
relationships, cardinality and identifying status, then applies Dagre layout.
Nullability becomes unspecified and attribute attachments are absent. Subgraphs
and unexpected parser shapes fail explicitly. Styling, comments and source layout
losses require acknowledgement before creation. The original element is unchanged.

Native export reports losses for manual positions, nullability, attribute
attachments and stable native IDs. Unrepresentable grammar values fail instead
of being renamed. Generated source is parsed before successful return. Conversion
is one-time: subsequent edits are independent.

## Limits and rendering

Native limits: 100 entities, 100 attributes per entity and 1,000 overall, 200
relationships, 200 operations per batch. Internal IDs are 1–58 safe ASCII
characters, beginning with a letter. Entity coordinates are finite within
±100,000. Names and types allow 200 characters, native titles/relationship labels
500, comments 2,000. Visible SVG text is shortened to fit; persisted text is not
truncated. Overlap and unreadably small scaling produce inspection warnings.
Frames default to 960×640 (native) and 720×480 (Mermaid); positive frame resizing
scales the view without changing entity positions. Routing supports self and
parallel relationships; arbitrary manual placement does not guarantee clear paths.

Mermaid source is nonblank and at most 20,000 characters. Local Playwright Chromium
produces PNG snapshots at device scale two, at most 4,096 pixels per side and
16 million pixels overall. Resolution scaling is reported. Each uncached job has
a 20-second deadline including queue time, two running slots and eight pending
slots. Overload, cancellation, browser absence and timeout return diagnostics.
The cache holds at most 32 derived images/64MiB and coalesces identical work.
No failures are cached. PNGs are returned through opaque snapshot resource handles;
source data remains the only persisted Mermaid truth. No browser starts during
extension activation or offline contract generation.

## Install and verify

From a built AgentCanvas checkout:

```text
npm run plugins:build
npx playwright install chromium
npm run plugins:install -- dist/plugin-catalog/agentcanvas.diagrams
npm run plugins:verify
```

Restart AgentCanvas through its supported service manager after installation.
Check `/whoami`, `/plugins`, active `/openapi.json`, and the seven resident MCP
tools. Reload MCP clients after restart. Create a native diagram and a Mermaid
diagram, reload the browser, and request a cold canvas snapshot.

On this Windows deployment the service account is
`NT SERVICE\Workspace2AgentCanvas`. Its default browser cache differs from the
interactive user's. Install Chromium into a shared, service-readable directory
by setting `PLAYWRIGHT_BROWSERS_PATH` during installation and in the service's
environment. Grant that account read/execute access. Verify an actual cold PNG
snapshot from the running service; an interactive `playwright install` alone
does not prove service-account visibility. Missing Chromium does not prevent
activation, but Mermaid authoring validation/resolution/snapshots require it.

The standard Docker image stays lightweight. An optional derived image may run
`npx playwright install --with-deps chromium` as root with
`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, make that directory readable by `node`,
install `dist/plugin-catalog/agentcanvas.diagrams` into `plugins/`, and return to
`USER node`. Do not add Chromium to the default image.

## Verification

```text
npm run test --workspace @agentcanvas/extension-diagrams
npm run test:chromium --workspace @agentcanvas/extension-diagrams
npx playwright test --config test/e2e/playwright.config.ts --project diagrams
```

Chromium-dependent integration tests are separate from normal unit tests. Build
the extension first so the installed headless bundle exists. Mermaid 11.17.2,
Dagre 3.1.1 and Playwright 1.61.1 are pinned. See THIRD_PARTY_NOTICES.md.
