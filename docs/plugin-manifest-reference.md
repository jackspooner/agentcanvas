# AgentCanvas plugin manifest v1 reference

Every distribution root contains `agentcanvas.plugin.json`. The runtime validates it with strict JSON Schema 2020-12 and rejects additional fields.

## Required top-level fields

| Field | Contract |
|---|---|
| `apiVersion` | exactly `agentcanvas.plugin/v1` |
| `id` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`, at most 128 characters in SDK helpers |
| `version` | semantic version |
| `displayName` | non-empty, at most 200 characters |
| `description` | non-empty, at most 2,000 characters |
| `license` | non-empty, at most 100 characters |
| `entrypoints.server` | required contained slash-separated file path |
| `entrypoints.browser` | optional contained slash-separated file path |
| `requires.hostApi` | semantic-version range |
| `requires.plugins` | plugin ID → semantic-version range |
| `requires.capabilities` | capability name → semantic-version range |
| `provides.capabilities` | capability name → exact semantic version |
| `permissions` | unique non-empty strings |
| `contributes` | arrays for elements, commands, tools, procedures, and migrations |
| `configuration` | optional schema/file/environment declaration |

Local contribution names match `^[a-z][a-z0-9-]*$` and are at most 64 characters in SDK helpers. Element declarations include positive integer `schemaVersion`, `browser`, and `snapshot: "supported" | "unsupported"`.

## Derived names

- Persisted element: `<plugin-id>/<local-element>`.
- MCP tool: replace dots and hyphens in the plugin ID with `_`, then append `__`, then replace local-name hyphens with `_`.
- Procedure path: `/api/v1/plugins/<plugin-id>/procedures/<local-procedure>`.

Example: `agentcanvas.image-overlays` + `export-mask-zip` becomes `agentcanvas_image_overlays__export_mask_zip`.

## File safety

Paths must be relative, slash-separated, and may not contain backslashes, drive roots, absolute roots, `.` or `..` segments. Every declared file must exist, resolve to a regular file, and remain inside the real plugin root. A plugin root must be a direct non-symlink child of `plugins/`.

Manifest and config JSON are limited to 256 KiB each. Visible invalid directories fail discovery; they are not ignored.

## Configuration

If `configuration` is present, both the schema and config file are required. The config is validated with strict Ajv and no default insertion. Environment names are declarations only; plugin code reads documented environment variables explicitly. Plugin status responses omit configuration declarations, values, environment names, and filesystem paths.

## Registration parity

Server activation must register exactly the declared local elements, tools,
procedures, migrations, and provided capabilities. Browser activation must
register exactly the catalog's browser element types and commands and support
the declared current element schema version. Extra or missing registrations
fail activation.

Commands require a browser entrypoint. Their global IDs are
`<plugin-id>.<local-command-name>`.

## Trust

Manifest validation is compatibility and integrity checking, not a sandbox. Server and browser entrypoints are trusted executable dependencies.
