# Diagrams

Optional first-party AgentCanvas extension `agentcanvas.diagrams` (host API `^1.2.0`).
It supplies native `agentcanvas.diagrams/erd` elements and source-based
`agentcanvas.diagrams/mermaid` elements. The standard extensions remain primitives,
Markdown, and tables. No database connection is involved.

## Editing

Version 0.2 adds individual box resizing, appearance overrides, connector bends,
and label positioning to native and Mermaid diagrams. Select a box and drag its
corner handle; select a connector to reveal bend and label handles. Arrow keys
move a focused handle by one logical pixel (Shift uses ten). The item form offers
numeric coordinates as a keyboard alternative. Dragging uses diagram coordinates
at any outer canvas zoom or rotation, and each release creates one undo entry.

Appearance fields support hexadecimal colors, local font families, font size,
border width, and solid/dashed/dotted borders. Blank fields inherit the current
canvas theme; Reset appearance removes overrides. Native ERDs also offer a
separate header color. Native row content sets a minimum box height. Mermaid box
resizing keeps glyph size independent of box size; adjust Font size separately.
Manual overlap and connector crossings are allowed.

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
Native Auto layout clears manual bends and label positions while retaining box
sizes and appearance; undo restores the complete previous arrangement.
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
Inline and expanded Mermaid views add host-owned selection and drag controls over
that image. The five supported families share the same saved presentation layer
with server PNG snapshots. Sequence participants move horizontally; enlarging a
participant's height shifts the timeline down without reordering messages.
Sequence messages retain their endpoint order while bends and labels are editable.
Container/subgraph frames remain Mermaid-owned; their individual child boxes are
editable. Notes and sequence control structures remain source-owned.

Mermaid presentation IDs belong to the exact saved source. Source edits require
checking **Reset visual overrides** before Save; title-only edits preserve them.
This deliberately avoids guessing how an old visual edit maps to changed source.
Reset selected to Mermaid defaults removes its position, size, and appearance
overrides. Failed saves retain the visual draft; Discard visual draft loads the
current confirmed version after a conflict.

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
| `validate-mermaid` | Syntax/type diagnostics; `purpose: layout` returns box/connector IDs and geometry; `purpose: convert-to-erd` analyzes conversion |
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

Native `present-entity` replaces its complete optional presentation (width, height,
appearance). `present-relationship` replaces bends, labelPosition and appearance.
Pass `{}` to reset those fields. Preserve existing presentation fields in the
replacement when changing only one setting. Names and IDs are unaffected.

```json
{"canvasId":"orders-board","elementId":"diagram-id","expectedRevision":3,"operations":[{"op":"present-entity","entityId":"orders","presentation":{"width":420,"height":200,"appearance":{"fill":"#224466","textColor":"#ffffff","borderStyle":"dashed"}}}]}
```

For Mermaid, first call `validate-mermaid` with the exact source, `purpose: layout`
and optionally `canvasId` to use that canvas's theme. Its `layout.nodes` and
`layout.edges` supply the IDs to use in `update-mermaid`:

```json
{"canvasId":"orders-board","elementId":"flow-id","expectedRevision":4,"data":{"title":"Order flow","source":"flowchart LR\nA-->B","presentation":{"source":"flowchart LR\nA-->B","nodes":[{"id":"A","x":120,"y":80,"width":240,"height":120,"appearance":{"fill":"#ddeeff"}}],"edges":[{"id":"L_A_B_0","bends":[{"x":400,"y":200}],"labelPosition":{"x":430,"y":220}}]}}}
```

Use inspected IDs rather than inferring them from display labels. Omit Y overrides
for sequence participants. New source must explicitly omit the old presentation
layer. Inspection and mutation results contain geometry and diagnostics, never SVG
payloads or image data URLs.

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
attachments, stable native IDs, box sizes, appearance, bends and label positions.
Mermaid-to-native conversion also warns when a saved presentation layer is omitted.
Unrepresentable grammar values fail instead
of being renamed. Generated source is parsed before successful return. Conversion
is one-time: subsequent edits are independent.

## Limits and rendering

Native limits: 100 entities, 100 attributes per entity and 1,000 overall, 200
relationships, 200 operations per batch. Internal IDs are 1–58 safe ASCII
characters, beginning with a letter. Each connector allows 16 manual bends, with 600 across a native
diagram to remain within snapshot node limits. Native width is 200–4,096 and
height 64–8,192 logical pixels (row content may require a larger minimum).
Appearance font sizes are 8–48, border widths 0–12, colors six/eight-digit hex.
Entity coordinates are finite within
±100,000. Names and types allow 200 characters, native titles/relationship labels
500, comments 2,000. Visible SVG text is shortened to fit; persisted text is not
truncated. Overlap and unreadably small scaling produce inspection warnings.
Frames default to 960×640 (native) and 720×480 (Mermaid); positive frame resizing
scales the view without changing entity positions. Routing supports self and
parallel relationships; arbitrary manual placement does not guarantee clear paths.

Mermaid source is nonblank and at most 20,000 characters. Presentation allows 200
box overrides and 500 connector overrides, up to 16 bends per connector, box
dimensions 16–4,096, and coordinates within ±100,000. Local Playwright Chromium
produces PNG snapshots at device scale two, at most 4,096 pixels per side and
16 million pixels overall. Resolution scaling is reported. Each uncached job has
a 20-second deadline including queue time, two running slots and eight pending
slots. Overload, cancellation, browser absence and timeout return diagnostics.
The cache holds at most 32 derived images/64MiB and coalesces identical work.
No failures are cached. PNGs are returned through opaque snapshot resource handles;
source owns Mermaid semantics and its optional presentation owns manual appearance.
No browser starts during
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
Check `/whoami`, `/api/v1/plugins`, active `/openapi.json`, and the seven resident MCP
tools. Reload MCP clients after restart. Create a native diagram and a Mermaid
diagram, reload the browser, and request a cold canvas snapshot.

### Upgrading from Diagrams 0.1

Both element schemas are now version 2. Stop the service, replace the installed
distribution through the extension CLI, and run the existing offline migration
before restarting. The pure 1→2 steps preserve existing data and styles; they do
not create visual overrides. The migration CLI makes and verifies a database
backup and records the migration ledger while preserving canvas revisions/events.

```text
npm run plugins:disable -- agentcanvas.diagrams
npm run plugins:install -- dist/plugin-catalog/agentcanvas.diagrams
npm run migrate -- apply --database <database-path> --backup-dir <backup-path> --plugins plugins
npm run migrate -- verify --database <database-path> --plugins plugins
npm run plugins:verify
```

Generic API callers and macro element templates must use `schemaVersion: 2` for
new writes. The document migration does not rewrite stored macro definitions or
external clients. Keep the verified backup and previous distribution for rollback;
do not reinstall schema 1 over a migrated database.

On this Windows deployment the service account is
`NT SERVICE\Workspace2AgentCanvas`. Its default browser cache differs from the
interactive user's. Install Chromium into a shared, service-readable directory
by setting `PLAYWRIGHT_BROWSERS_PATH` during installation and in the service's
environment. Grant that account read/execute access. Verify an actual cold PNG
snapshot from the running service; an interactive `playwright install` alone
does not prove service-account visibility. This service's verified default profile
cache is `C:\Windows\ServiceProfiles\Workspace2AgentCanvas\AppData\Local\ms-playwright`;
an administrator can install there using the same `PLAYWRIGHT_BROWSERS_PATH`
for the installation command, without changing the service environment.
Missing Chromium does not prevent
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
npx playwright test --config test/e2e/playwright.config.ts --project diagrams-live
```

Chromium-dependent integration tests are separate from normal unit tests. Build
the extension first so the installed headless bundle exists. Mermaid 11.17.2,
Dagre 3.1.1 and Playwright 1.61.1 are pinned. See THIRD_PARTY_NOTICES.md.
