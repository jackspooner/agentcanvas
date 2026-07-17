# AgentCanvas v0.3 specification set

Status: implemented in `v0.3.0-alpha.1`; retained as the normative contract for
alpha hardening.

This directory defines the v0.3 product and engineering contract for turning
AgentCanvas into a polished local canvas application and a public extension
platform. Normative requirements use **MUST**, **SHOULD**, and **MAY** as
described by RFC 2119.

## Specifications

1. [Product and scope](product.md)
2. [Editor architecture](editor-architecture.md)
3. [Editor interactions](editor-interactions.md)
4. [Extension authoring SDK](extension-sdk.md)
5. [Delivery and acceptance](delivery-and-acceptance.md)

## Locked decisions

- AgentCanvas SQLite documents remain the canonical persisted state.
- The editor uses React Flow through an AgentCanvas-owned adapter package.
- React Flow types and instances are not part of the public extension API.
- Existing plugin distributions remain compatible during the v0.3 transition.
- Public-facing terminology is **extension**. Existing `plugin` identifiers,
  manifests, folders, and package exports remain supported until a separately
  specified breaking release.
- Production extension discovery remains restart-based and folder-driven.
- Browser element content remains framework-neutral and Shadow DOM isolated.
- HTTP, MCP, OpenAPI, browser delivery, snapshots, and the editor consume the
  same frozen extension registry.
- Media references and byte resolution remain owned by optional source extensions; AgentCanvas core does not become a media store.

## Source-of-truth rule

The canonical element envelope and batch operation contract are the bridge
between the editor, HTTP, MCP, persistence, snapshots, and extensions. Editor
state is transient projection state. It MUST NOT become a second persisted
document format.
