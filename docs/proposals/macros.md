# AgentCanvas macros contract

Status: implemented v1 declarative creation-only contract
Date: 2026-07-27

## Recommendation

Add macros as a first-class, host-owned automation capability that turns typed
inputs and an explicit anchor into a previewable set of canonical canvas
operations.

A macro is not a recording of pointer actions and is not arbitrary executable
code. Its stable contract is:

```text
Macro definition + exact version
  + validated inputs
  + explicit canvas context
  -> side-effect-free plan
  -> validated canonical operations
  -> one revision-aware atomic commit
  -> named outputs and provenance
```

V1 is the implemented declarative creation-only contract. It does not attempt
selection authoring, extension planners, external tool calls, agent
orchestration, linked-instance propagation, conditionals, loops, or arbitrary
expressions.

## Product rationale

AgentCanvas already supports reusable element types, extension commands,
schema-backed server procedures, revision-aware batch mutations, idempotency,
and undo/redo. Macros fill the missing layer between a single element command
and an entire application extension:

- templates standardize content;
- commands standardize an interaction;
- procedures expose extension-owned server behavior;
- macros standardize a parameterized canvas outcome.

Examples include:

- one standard table whose columns and style remain fixed while rows change;
- one report section containing a heading, evidence table, summary, and
  conclusion;
- repeated product, person, experiment, or source cards;
- architecture, approval-gate, retry, or agent-loop diagram fragments;
- presentation frames or review scaffolds with named content slots.

Comparable systems reinforce four useful design choices:

- Miro lets people save selected board content as a reusable template and gives
  templates previews and scopes.
- Figma component properties make the intended variable surface explicit
  instead of asking users to edit arbitrary internals.
- Node-RED subflows provide instance properties for reusable visual structures.
- Notion buttons combine multiple actions, variables, and optional
  confirmation.

AgentCanvas should combine those ideas without adopting their document or
runtime models wholesale.

## Core concepts

### Macro definition

A durable, discoverable record containing:

- stable namespaced ID;
- immutable integer version;
- title, description, and optional category;
- scope: `installation` or `canvas`, with a canvas ID for canvas scope;
- a local draft-2020-12 JSON Schema input contract;
- declared element-type/schema-version dependencies;
- fixed element templates with relative `x`, `y`, `width`, and `height`;
- optional named output bindings from generated element keys.

Editing a published macro creates a new version. Executions always resolve and
record an exact version. The UI may offer “latest,” but it must resolve that
alias before planning.

### Macro plan

A plan is a side-effect-free, short-lived expansion of one macro invocation. It
contains:

- macro ID and exact version;
- input and canvas revision digests;
- normalized canonical operations;
- operation count, generated-element count, and affected element IDs;
- named output bindings;
- dependency and validation diagnostics;
- a preview scene or affected frames;
- an opaque plan ID and expiry.

Planning must not write the canvas or invoke an external service.

### Macro execution

Execution accepts a plan ID, expected canvas revision, and idempotency key. The
host verifies that the plan is still valid, commits all operations in one
transaction, and returns:

- resulting canvas revision;
- created, changed, and deleted element IDs;
- resolved named outputs;
- warnings and diagnostics;
- macro ID, exact version, plan ID, input/plan digests, named outputs, and a safe
  summary.

### Macro provenance

Generated elements are ordinary independent canvas elements. The invocation is
recorded in batch/event provenance; it does not become a live parent object.

Automatic linked instances should be deferred. Propagating later macro edits
would require an override, merge, deletion, and conflict model comparable to a
component system. That is a separate product.

## Authoring experience

### Create and run a macro

V1 definitions are created or versioned through the public HTTP/MCP macro
operations only. A caller supplies the declarative definition, including fixed
canonical element templates and typed input references. There is no selection
authoring UI or extension authoring adapter in this contract.

### Run macro

Macros are reachable through stable HTTP and MCP operations and the browser
runner for an existing canvas.

The run dialog is generated from the macro input schema. It shows placement,
effect summary, validation messages, and a ghost preview before commit.

V1 invocation placement is an explicit world-coordinate `{ x, y }` anchor. Any
future cursor, viewport, or selection placement must normalize to that anchor
before planning and is deferred from this contract.

### Table example

`standard-comparison-table@1` might declare:

- fixed: column headers, column widths, style, and wrapping policy;
- input: rows, plus an explicit invocation anchor;
- output: `table`;
- dependency: `agentcanvas.table/table@1`.

An invocation plans one `upsertElement` operation and returns the resulting
table element ID through `outputs.table`.

## Contract sketch

The canonical v1 authoring shape is the host schema contract (the stored record
adds `id` and `version`):

```json
{
  "scope": "installation",
  "title": "Standard comparison table",
  "inputSchema": { "type": "object" },
  "dependencies": [{ "elementType": "agentcanvas.table/table", "schemaVersion": 1 }],
  "elements": [{
    "key": "table",
    "type": "agentcanvas.table/table",
    "schemaVersion": 1,
    "x": 0,
    "y": 0,
    "width": 640,
    "height": 320,
    "data": {
      "columns": ["Criterion", "Option A", "Option B", "Recommendation"],
      "rows": { "$macroRef": "input", "pointer": "/rows" }
    }
  }],
  "outputs": { "table": "table" }
}
```

`$macroRef` is typed and has only two v1 forms: an RFC 6901 input pointer or a
generated element ID reference. References are allowed only in element data,
style, and metadata. V1 deliberately has no general expressions, context
references, executable body, or extension-planner branch. See the complete
[standard comparison-table example](../examples/standard-comparison-table.macro.json).

## API and MCP surface

Use stable generic operations so saving a macro does not change the MCP tool
catalog:

- `GET /api/v1/macros`
- `POST /api/v1/macros`
- `GET /api/v1/macros/:macroId/versions/:version` with optional `canvasId` for
  canvas-scoped resolution;
- `POST /api/v1/macros/:macroId/versions` with the macro ID owned by the path;
- `PATCH /api/v1/macros/:macroId` with `{ archived }`;
- `POST /api/v1/canvases/:canvasId/macros/:macroId:plan` with
  `{ macroVersion, anchor, input, label? }`;
- `POST /api/v1/canvases/:canvasId/macros:execute`

Recommended MCP tools:

- `macro_list`
- `macro_get`
- `macro_create`
- `macro_create_version`
- `macro_archive`
- `macro_plan`
- `canvas_run_macro`

`canvas_run_macro` accepts the supported plan/direct forms. The plan-first path
is required for browser preview; the direct path is useful for agents and still
plans internally before commit. Saving a macro never changes `tools/list`.

Macro definitions are dynamic data, so saving or versioning one must not add a
new MCP tool or extension-registry entry. All HTTP behavior, schemas, status
codes, and examples belong in the active generated OpenAPI document; this
proposal does not hand-edit the generated standard artifact.

## Architectural fit

### Reuse

Macros should reuse:

- canonical `CanvasOperation[]`;
- the existing revision-aware batch endpoint;
- idempotency keys;
- extension element validation;
- the shared editor command service;
- editor history labels and inverse operations;
- existing missing-extension diagnostics.

### Add

The host needs:

- macro definition and immutable version storage;
- a host-owned macro catalog of saved definitions;
- a deterministic planner and plan validator;
- short-lived plan storage;
- a host-owned executor;
- batch-level provenance;
- generic HTTP, OpenAPI, and MCP handlers;
- browser input, preview, confirmation, and result UI.

User-authored definitions are dynamic data, not new registry entries. This
preserves the rule that the installed extension registry is frozen at startup
and avoids forcing MCP clients to refresh their tool catalog after every macro
edit.

### Do not reuse plugin KV as the macro store

Plugin KV is namespaced to one extension, capped per value, and not a
cross-extension catalog. Macros can reference several element types and must
remain discoverable and diagnosable when an optional extension is missing.
They therefore require host-owned storage.

### Preserve extension ownership

The current browser transaction API and server canvas facade intentionally
limit an extension to its own elements. A general macro implementation must not
remove that boundary.

Instead:

- a declarative macro may contain only canonical element templates declared in
  its dependencies;
- the host expands typed references, validates every resulting operation against
  the active registry and declared limits, then commits the complete plan.

## Persistence and audit

A physical schema 4 migration provides host-owned storage for:

- `macro_definitions`;
- `macro_versions`;
- batch-level macro provenance.

Plans and preview elements remain short-lived and are not durable macro data.

Current canvas events record each normalized operation independently, even when
several operations share one revision. The macro invocation record preserves
macro ID, exact version, plan ID, input digest, plan digest, actor-safe summary,
named outputs, and history label without polluting element metadata.

Do not store full macro inputs in audit data by default. Inputs may contain
sensitive content. Store a digest and an explicitly safe summary.

## Failure and safety rules

- Planning is pure and has hard operation, element, and payload limits.
- Missing or incompatible dependencies fail explicitly.
- Input and every expanded element are validated before commit.
- Commit uses `expectedRevision` and an idempotency key.
- Retries of the same logical execution reuse the same bounded idempotency key;
  a new plan/execution receives a new key.
- A stale plan fails; it is never silently replanned during commit.
- One macro run creates one undo history entry.
- V1 creates elements only; destructive effects are deferred with other
  transforms.
- Read-only canvases cannot plan mutating execution as if it were available.
- V1 cannot access the network, filesystem, agents, or arbitrary code.
- Macro definitions cannot access the network, filesystem, agents, arbitrary
  code, or extension planners.

The host reports active capability readiness through `/whoami`; saved macros
are not dynamic MCP tools. Archived definitions remain readable for history and
exact-version reads, but cannot be planned or executed. A browser preview is
translucent and non-persistent; one successful browser execution creates one
revision and one session-local history unit. Provenance retains safe
identifiers, digests, and named outputs, never raw input.

## Delivery plan

### Phase 1: foundation and table proof

- Define `MacroDefinitionV1`, plan, result, diagnostic, and dependency
  contracts.
- Add host storage and exact-version lifecycle.
- Add pure plan and atomic execute services.
- Add generic HTTP/OpenAPI/MCP surfaces.
- Add batch provenance.
- Add the browser runner's schema-driven input form and preview.
- Add one documented standard-table example; do not seed it as an installation
  default or add selection authoring.
- Verify one browser execution is one undo entry and one canvas revision.

This phase proves the original use case without committing to a general
programming language.

### Deferred capabilities

The following remain explicitly out of the approved v1 contract:

- selection authoring or saving a selection as a macro;
- extension planners and semantic authoring adapters;
- macro import/export, beyond the documented bounded JSON example;
- installation/canvas scope expansion beyond the host schema already defined;
- dependency inspection UX beyond explicit plan diagnostics.

### Later, only with a separate design

- Add selection transforms with declared target types.
- Allow acyclic calls to exact macro versions.
- Flatten composed plans before preview and commit.
- Add deprecation and dependent-macro inspection.

- linked instances and update propagation;
- conditionals, loops, and expressions;
- external tools or agent calls;
- scheduled or event-triggered execution;
- shared/team scopes after an account and authorization model exists.

## Acceptance criteria for the first release

- A user can create and run a standard table macro with fixed headers and
  variable rows.
- Browser and MCP invocations use the same macro definition and validation.
- Preview reports exact intended effects without mutating the canvas.
- Execution is atomic, revision-aware, idempotent, and produces one undo entry.
- The result returns stable IDs for named outputs.
- Missing table support produces an explicit dependency diagnostic.
- Editing a macro creates a new version and old invocations remain explainable.
- Saving or editing a macro does not change the MCP tool catalog.
- Macro definitions cannot contain executable JavaScript or undeclared external
  effects.

## Decision record

The approved v1 boundary is declarative creation macros with typed parameters,
explicit anchors, preview, exact versions, host-owned execution, and no linked
instances, selection authoring, extension planners, or external actions.

## External references

- Miro custom templates:
  https://help.miro.com/hc/en-us/articles/360019018899-Custom-templates
- Figma component properties:
  https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties
- Node-RED subflows and instance properties:
  https://nodered.org/docs/developing-flows/flow-structure
- Notion buttons and variables:
  https://www.notion.com/en-gb/help/buttons
