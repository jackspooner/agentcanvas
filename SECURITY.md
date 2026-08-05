# Security policy

## Supported versions

Security fixes are provided for the current `0.3.x` prerelease line. Older development snapshots and pre-0.2 document formats are not supported runtime versions.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/jackspooner/agentcanvas/security/advisories/new). Do not include exploit details, credentials, private canvas data, or asset contents in a public issue.

Include the affected version, operating system, reproduction steps, expected impact, and any safe proof-of-concept material. Maintainers will acknowledge a report within seven days and will coordinate disclosure after a fix is available. If private vulnerability reporting is temporarily unavailable, open a public issue containing no sensitive details and ask the maintainers to establish a private channel.

## Deployment boundary

AgentCanvas is a local application. It defaults to `127.0.0.1`, has no built-in user authentication, and must not be exposed directly to a LAN or the public internet. Binding to a non-loopback address changes the security boundary: deploy an authenticated, TLS-terminating reverse proxy with explicit authorization and request-size limits, or keep AgentCanvas on loopback.

Share URLs are bearer-style capabilities. Anyone who can access a share URL can read the shared canvas, so treat these URLs as sensitive and do not publish them in logs, issues, or screenshots.

Embed URLs are also bearer-style capabilities. Each one is process-memory,
expires within at most 24 hours, names one exact parent origin, and limits the
browser to an explicit canvas set and `read` or `edit` mode. Ordinary routes
retain frame denial. These constraints do not authenticate the HTTP or MCP API;
create embed sessions from a trusted backend and keep their URLs out of logs,
prompts, analytics, issues, and screenshots.

## Plugin trust model

Plugins are trusted executable dependencies, not sandboxed extensions.

- Server plugins run Node.js code with the permissions of the AgentCanvas process.
- Browser plugins run same-origin JavaScript in the AgentCanvas page.
- Manifest permissions constrain the supported host API; they do not form a security sandbox.
- Shadow DOM isolates rendering and styles, not code or data access.

Review a plugin and its transitive dependencies before copying it into `plugins/`. Install plugins only through the documented local installer, restart after changing the active folders, and run AgentCanvas with a dedicated least-privilege operating-system account. Do not run third-party plugins as `LocalSystem`, Administrator, or root.

## Assets and binary data

AgentCanvas stores provider-neutral media references and serves binary content through bounded opaque resource handles. Reports, logs, diagnostics, OpenAPI examples, and extension output must not contain full base64 payloads, data URLs, arbitrary local paths, authorization headers, or private media bytes.

No media provider is required by AgentCanvas core. Assets-2 and allowlisted filesystem images are independent optional image-source extensions. When Assets-2 is installed, keep that service on a trusted loopback boundary and apply the same authentication requirement before exposing it beyond the host.

## Secrets and configuration

Keep secrets in process environment variables or an external secret manager. Do not put credentials in plugin manifests, `plugin.config.json`, Servy templates, committed `.env` files, canvas metadata, logs, or diagnostics. Use `.env.example` only as a placeholder contract.
