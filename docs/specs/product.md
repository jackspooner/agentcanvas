# Product and scope

## Product statement

AgentCanvas is a local-first visual workspace where people and agents can
create, inspect, arrange, and operate on extensible canvas documents. The
browser application should feel like a complete editor rather than a renderer
with movement controls.

## Primary users

- A person reviewing and editing a canvas created by an agent.
- An agent using MCP to create or update a canvas while a person observes it.
- An extension author adding a new element, command, inspector, import flow, or
  agent-facing operation without modifying the AgentCanvas kernel.

## v0.3 outcomes

The v0.3 implementation MUST provide:

- direct pan and pointer-relative zoom;
- single and multiple selection;
- drag-marquee selection;
- multi-element movement;
- resize controls for resizable elements;
- keyboard movement and deletion;
- duplicate, copy, paste, undo, and redo commands;
- grid snapping and optional alignment assistance;
- a stable command service used by toolbar, keyboard, menus, and extensions;
- optimistic local editing with revision-aware server reconciliation;
- read-only behavior for share links;
- an AgentCanvas-owned editor package;
- an extension SDK facade with typed authoring helpers and compatibility with
  plugin API v1.

## Non-goals for the first v0.3 release

- Real-time multi-user collaboration.
- User accounts, cloud tenancy, or a public extension marketplace.
- Sandboxing trusted extension code.
- Persisting React Flow nodes or edges.
- Replacing Assets-2 with an AgentCanvas media store.
- A general-purpose vector illustration engine.
- Production hot reload of installed extensions.

## Quality attributes

### Local-first

The default service MUST continue to bind to loopback and operate without an
external account system. Extension development MAY use a disposable
development host, but production activation remains restart-based.

### Agent-readable

Every user-visible edit MUST map to the existing canonical batch operation
model so HTTP, MCP, events, undo, and diagnostics describe the same changes.

### Extensible

Normal element behavior MUST remain outside kernel type switches. Editor
features operate on the generic element envelope and extension contributions.

### Recoverable

Failed optimistic changes MUST restore the latest confirmed canvas state and
surface a useful diagnostic. Revision conflicts MUST never silently overwrite a
newer document.

### Accessible

Core commands MUST be keyboard reachable. Selection and viewport controls MUST
have accessible names, visible focus states, and reduced-motion behavior.
