# Troubleshooting

Start with the first failing lifecycle boundary: service identity, plugin discovery, database readiness, capability readiness, contract generation, then browser rendering.

## Service does not start

Check the service manager's stderr/log output or the foreground process error. AgentCanvas intentionally fails before listening when startup state is invalid.

Common startup codes and causes:

| Signal | Meaning | Action |
|---|---|---|
| `database_migration_required` | Database is older than v0.2 | Stop the service and use the offline migration CLI |
| `database_version_unsupported` | Database is newer than this host | Install a compatible host; do not downgrade data |
| plugin manifest/config validation failure | Visible plugin folder is invalid | Fix or disable that folder while stopped |
| missing/incompatible dependency | Plugin or capability graph cannot resolve | Install a compatible dependency/provider |
| contribution mismatch | Activation did not match the manifest | Make manifest and registrations exact |
| pending plugin schema migration | Installed plugin owns a forward migration | Run `npm run migrate -- apply ...` offline with the active plugin set |
| Assets capability/readiness failure | Required Assets-2 plugin/provider is unavailable | Check Assets-2 health, identity, capabilities, and URL |

Invalid visible plugin directories are never silently ignored.

## Plugin install or disable fails

- Install refuses an existing `plugins/<plugin-id>` folder. Disable the old version first.
- Disable refuses while `/whoami` identifies a running AgentCanvas service. Stop it through the deployment's process or service manager.
- The distribution root, entrypoints, config, and schema files must remain inside the real plugin root.
- Root symlinks, path traversal, absolute entry paths, missing files, and duplicate IDs are rejected.
- Run `npm run plugins:verify` before restarting.

## Plugin is active but its browser element shows a diagnostic card

Check `GET /api/v1/plugins/{pluginId}` and browser console errors.

Typical causes:

- Browser entry failed to import.
- Browser bundle imports a file outside its declared browser subtree.
- Runtime dependencies were left as bare imports instead of bundled relative chunks.
- Renderer registrations do not match the manifest/catalog.
- Renderer does not support the stored schema version.
- `mount`, `update`, or `dispose` threw.

Build browser entries as self-contained ESM using only contained relative chunks/assets. A failed browser plugin must not blank unrelated elements.

## Element is preserved but cannot be edited or rendered

The owning optional plugin is absent. This is expected degraded-document behavior:

- The envelope remains in the canvas.
- Frame and metadata changes, deletion, and clear remain possible.
- New writes and data/style replacement fail with `plugin_unavailable`.
- Reinstalling a compatible plugin restores rendering without a document rewrite.

Do not move the data into an undocumented fallback type.

## Assets do not load

Check:

```bash
curl http://127.0.0.1:23000/health
curl http://127.0.0.1:23000/whoami
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
```

Assets-2 must identify exactly as `asset-service` and include `asset_crud` and `asset_refs`. Verify `ASSETS_BASE_URL`, byte limits, timeouts, and that the stored element contains a valid durable asset reference rather than a transient URL.

## Snapshot contains a diagnostic card

Snapshot collection isolates normal renderer failures. Inspect the returned `diagnostics` array.

Common causes are a missing plugin, explicit `snapshot: "unsupported"`, renderer timeout, invalid scene node, invalid path/color, external URL, raw SVG/CSS, or an unresolved opaque image handle. Hard aggregate limits abort the whole snapshot; normal element failures do not.

## HTTP works but stdio MCP does not

The stdio process is a bridge to the resident `/mcp` endpoint. Verify AgentCanvas is running, `AGENT_CANVAS_BASE_URL` points to it, and resident MCP initializes successfully. The stdio bridge must expose the same tool names and schemas as resident HTTP MCP.

If the client still shows v0.1 aliases or omits newly installed plugin tools, restart AgentCanvas, terminate the old stdio bridge, and use the client's MCP reload/reconnect action. Then request a fresh `tools/list`. Client tool catalogs are commonly cached across a server upgrade; the host does not retain old aliases to satisfy that cache.

## Runtime OpenAPI differs from the committed standard document

This is normal when optional or third-party plugins are active. Runtime `/openapi.json` reflects the exact installed registry. `docs/openapi.standard.json` represents only the four default plugins.

It is a defect when `npm run check:openapi` reports that the generated default document differs from the committed artifact.

## Browser route loads no application

Verify that `/` returns HTML referencing built `/assets/...` files and that those assets return HTTP 200. The production service does not serve `/src/web/main.tsx`. Run `npm run build` before starting a deployment.

## Escalation evidence

When reporting a problem, include:

- AgentCanvas `/whoami` and `/health` without secrets.
- Active plugin IDs and versions.
- Exact error code/message and whether it occurred before or after listening.
- Database physical/document versions, not the database bytes.
- Relevant sanitized diagnostics.
- Whether HTTP and stdio MCP catalogs match.
- Whether the production root serves built assets.

Never include tokens, raw authorization headers, cookies, full data URLs, database files, or plugin config/environment values in diagnostics.
