# Delivery and acceptance

## Delivery waves

### Wave 1: editor foundation

- Add `@agentcanvas/editor`.
- Introduce React Flow behind the package boundary.
- Replace the custom canvas viewport with the controlled adapter.
- Preserve Shadow DOM renderer lifecycle and world placements.
- Add multi-select, marquee, multi-move, resize, keyboard movement, and
  revision-aware generic batch mutations.

### Wave 2: commands and history

- Add the editor command service.
- Add delete, duplicate, clipboard, undo, redo, select-all, fit, and snap
  commands.
- Add icon toolbar, accessible tooltips, and conflict diagnostics.

### Wave 3: extension SDK facade

- Add `@agentcanvas/extension-sdk`.
- Add typed descriptor helpers and command contributions.
- Extend manifest validation, frozen registry, browser catalog, and testkit.
- Keep plugin API v1 compatibility exports and fixtures green.

### Wave 4: author tooling

- Add extension-named scaffolder and compatibility wrapper.
- Generate manifests from typed descriptors.
- Add isolated development host and deterministic pack/verify commands.
- Publish packages only after clean-clone and external-consumer proof.

### Wave 5: release hardening

- Performance and accessibility verification.
- OpenAPI, README, author docs, migration notes, and release notes.
- Servy restart and live browser acceptance.

## Acceptance matrix

| Requirement | Authoritative evidence |
|---|---|
| Canonical state remains AgentCanvas | No React Flow persistence; store/API contract tests |
| Existing extensions still load | Existing plugin and external fixture suites |
| Multi-selection and marquee work | Component tests plus Playwright pointer flow |
| Multi-move is one commit | Network/API assertion and revision increment test |
| Resize persists canonical frame | Component, API, and reload tests |
| Interactive plugin controls work | Shadow DOM video/button Playwright tests |
| Read-only prevents mutations | Share/read-only component and Playwright tests |
| Undo/redo use revisions | Store/API integration and browser tests |
| Revision conflicts do not overwrite | competing revision integration test |
| React Flow is private | package import-boundary/static check |
| Commands have one owner | command registry tests across toolbar/keyboard |
| Descriptor and manifest cannot drift | testkit generation/conformance test |
| Public docs match packages | docs checker and clean external fixture |

## Required repository gates

```text
npm run format:check
npm run lint
npm test
npm run test:e2e
npm run build
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run plugins:verify
npm run check:openapi
npm run check:docs
git diff --check
```

## Runtime acceptance

After repository gates pass:

1. Restart the Servy-managed AgentCanvas service.
2. Verify `/health`, `/whoami`, and `/openapi.json`.
3. Open the index, an editable canvas, and a read-only share.
4. Exercise selection, movement, resize, undo/redo, interactive extension
   controls, agent-directed viewport changes, and reload persistence.
5. Confirm the browser console contains no uncaught errors.

The v0.3 goal is complete only when every applicable acceptance row has direct
evidence. A passing narrow test is not evidence for an untested broader
requirement.

## Alpha implementation evidence

The `v0.3.0-alpha.1` implementation completed all five delivery waves:

- repository package, type, unit, integration, distribution, documentation,
  OpenAPI, license, production build, and Playwright gates pass;
- 13 browser flows cover editing, commands, read-only mode, extension
  lifecycle, and 500-element visible culling;
- an external generated extension passes type checking, conformance tests,
  packing, and host verification outside the repository workspace;
- the Servy-managed Workspace2 service reports `v0.3.0-alpha.1`, the stable
  plugin API `1.0.0`, its exact active extension set, and optional provider
  status without making core readiness provider-dependent;
- live SQLite-backed browser acceptance verified movement, resize, undo, redo,
  reload persistence, read-only sharing, and zero uncaught browser errors.
