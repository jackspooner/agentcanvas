# AgentCanvas plugin manifest v1 reference

Every distribution root contains `agentcanvas.plugin.json`. The runtime validates it with strict JSON Schema 2020-12 and rejects additional fields.

The SDK exports the canonical `PLUGIN_MANIFEST_SCHEMA`. Runtime and testkit compile it with Ajv 2020 (`strict: true`, `allErrors: true`, `useDefaults: false`), without coercion or unknown-property removal. Neither validator mutates the supplied manifest. A shared post-schema check rejects repeated element contribution names even if their other fields differ. The testkit validates structure only: a nonempty but invalid semantic version or range can pass it and still fail runtime validation.

## Required top-level fields

| Field | Contract |
|---|---|
| `apiVersion` | exactly `agentcanvas.plugin/v1` |
| `id` | `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`, at most 128 characters |
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

Local contribution names match `^[a-z][a-z0-9-]*$` and are at most 64 characters. Element declarations include positive safe integer `schemaVersion` (1 through 9,007,199,254,740,991), `browser`, and `snapshot: "supported" | "unsupported"`. Plugin dependency keys obey the plugin-ID rules. Capability names are nonempty strings and are not restricted to plugin-ID syntax. Permissions and string contribution arrays must contain unique entries.

## Derived names

- Persisted element: `<plugin-id>/<local-element>`.
- MCP tool: replace dots and hyphens in the plugin ID with `_`, then append `__`, then replace local-name hyphens with `_`.
- Procedure path: `/api/v1/plugins/<plugin-id>/procedures/<local-procedure>`.

Example: `agentcanvas.image-overlays` + `export-mask-zip` becomes `agentcanvas_image_overlays__export_mask_zip`.

## File safety

Paths must be normalized relative slash-separated paths. Backslashes, drive roots, absolute roots, empty segments, `.` or `..` segments, NUL, query (`?`) and fragment (`#`) characters are rejected structurally. Runtime discovery additionally requires every declared file to exist, resolve to a regular file, and remain inside the real plugin root. A plugin root must be a direct non-symlink child of `plugins/`. Structural validation does not access the filesystem.

Manifest and config JSON are limited to 256 KiB each. Visible invalid directories fail discovery; they are not ignored.

## Configuration

If `configuration` is present, both the schema and config file are required. The config is validated with strict Ajv and no default insertion. Environment names are declarations only; plugin code reads documented environment variables explicitly. Plugin status responses omit configuration declarations, values, environment names, and filesystem paths.

Declared environment names match `^[A-Z][A-Z0-9_]*$`: the first character must be uppercase, not an underscore or digit.

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
