# Changes

## 0.2.0

- Individual box resize, theme-inheriting color/font/border overrides, connector
  bend handles and label positioning for native ERDs and all five Mermaid families.
- Mermaid inline/expanded visual controls preserve source with a separate,
  source-bound presentation layer shared with PNG snapshots. Sequence participant
  movement preserves message order; source edits explicitly reset overrides.
- Native `present-entity` / `present-relationship` operations and Mermaid layout
  inspection expose these controls to agents through the existing seven tools.
- Element schemas advance to 2 with pure, lossless 1→2 migrations. Stop the service
  and run offline apply/verify before restart; update generic writes and macro
  templates to schema 2. Standard extensions and host API remain unchanged.

## 0.1.0

- Native editable ERDs with stable structured identities, semantic operation batches,
  Dagre layout, shared SVG geometry, native snapshots and editor undo history.
- Five Mermaid families, validated authoring, recoverable raw invalid syntax,
  local bounded Chromium PNG rendering and opaque resource delivery.
- Seven agent tools and explicit independent ERD conversion/export with loss warnings.
- Requires AgentCanvas host API 1.2.0 and service-account access to pinned Chromium.
