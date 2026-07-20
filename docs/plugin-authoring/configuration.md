# Configuration and secrets

Plugin configuration is optional. If a manifest declares it, both the schema and config file are required.

## Manifest declaration

```json
{
  "configuration": {
    "schema": "schemas/config.schema.json",
    "file": "plugin.config.json",
    "environment": ["ACME_API_TOKEN"]
  }
}
```

Paths are relative to the distribution root and must pass the same real-path containment rules as entrypoints.

## Config schema

Use strict JSON Schema 2020-12:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["accentColor", "requestLimit"],
  "additionalProperties": false,
  "properties": {
    "accentColor": {
      "type": "string",
      "pattern": "^#[0-9a-fA-F]{6}$"
    },
    "requestLimit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  }
}
```

AgentCanvas validates with strict Ajv and does not insert schema defaults. Missing files, missing required values, additional properties, or invalid values fail startup.

## Reading config

Server activation receives validated, read-only JSON:

```ts
activate(host) {
  const accentColor = String(host.config.accentColor);
}
```

Do not mutate this object or treat it as a live-reload surface. Configuration changes require replacing the distribution/config while stopped and restarting AgentCanvas.

## Secrets

`environment` declares names only. It does not provide values or automatically copy them into `host.config`.

Extension server code may read its documented environment variable. Deployment mechanisms such as `.env`, a shell, a container runtime, or an optional process supervisor own the value. AgentCanvas does not require a specific supervisor.

Never place secrets in:

- `agentcanvas.plugin.json`;
- `plugin.config.json`;
- JSON Schema defaults or examples;
- element data/style/metadata;
- plugin KV;
- diagnostics or thrown messages;
- `/whoami` or plugin status;
- resource details;
- tests, fixtures, or documentation.

Do not log raw authorization headers, cookies, tokens, credentials, or sensitive connection strings.

## Changing configuration contracts

Changing a config key or its semantics is a plugin release change. Update together:

- config schema;
- sample `plugin.config.json`;
- manifest environment declarations;
- plugin README/setup guide;
- deployment examples and `.env.example` where first-party;
- tests and migration/release notes.

Do not add hidden production fallbacks. Invalid or incomplete configuration should fail clearly.
