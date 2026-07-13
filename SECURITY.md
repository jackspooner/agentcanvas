# Security policy

## Supported versions

Security fixes are provided for the current `0.2.x` release line. Older development snapshots and pre-0.2 document formats are not supported runtime versions.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/jackspooner/AgentCanvas/security/advisories/new). Do not include exploit details, credentials, private canvas data, or asset contents in a public issue.

Include the affected version, operating system, reproduction steps, expected impact, and any safe proof-of-concept material. Maintainers will acknowledge a report within seven days and will coordinate disclosure after a fix is available. If private vulnerability reporting is temporarily unavailable, open a public issue containing no sensitive details and ask the maintainers to establish a private channel.

## Deployment boundary

AgentCanvas is a local application. It defaults to `127.0.0.1`, has no built-in user authentication, and must not be exposed directly to a LAN or the public internet. Binding to a non-loopback address changes the security boundary: deploy an authenticated, TLS-terminating reverse proxy with explicit authorization and request-size limits, or keep AgentCanvas on loopback.

Share URLs are bearer-style capabilities. Anyone who can access a share URL can read the shared canvas, so treat these URLs as sensitive and do not publish them in logs, issues, or screenshots.

## Plugin trust model

Plugins are trusted executable dependencies, not sandboxed extensions.

- Server plugins run Node.js code with the permissions of the AgentCanvas process.
- Browser plugins run same-origin JavaScript in the AgentCanvas page.
- Manifest permissions constrain the supported host API; they do not form a security sandbox.
- Shadow DOM isolates rendering and styles, not code or data access.

Review a plugin and its transitive dependencies before copying it into `plugins/`. Install plugins only through the documented local installer, restart after changing the active folders, and run AgentCanvas with a dedicated least-privilege operating-system account. Do not run third-party plugins as `LocalSystem`, Administrator, or root.

## Assets and binary data

AgentCanvas stores durable media through Assets-2 references and serves binary content through bounded opaque resource handles. Reports, logs, diagnostics, OpenAPI examples, and plugin output must not contain full base64 payloads, data URLs, arbitrary local paths, authorization headers, or private asset bytes.

The Assets-2 service is a required local dependency. Keep it on a trusted loopback boundary and apply the same authentication requirement before exposing it beyond the host.

## Secrets and configuration

Keep secrets in process environment variables or an external secret manager. Do not put credentials in plugin manifests, `plugin.config.json`, Servy templates, committed `.env` files, canvas metadata, logs, or diagnostics. Use `.env.example` only as a placeholder contract.
