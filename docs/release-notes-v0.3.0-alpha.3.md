# v0.3.0-alpha.3: Diagrams and host API 1.2

Diagrams is an optional first-party extension with editable native ERDs and five
Mermaid diagram families. See its [guide](../plugin-packages/diagrams/README.md)
for installation, tools, limits, conversion losses and Chromium requirements.
Primitives, Markdown and tables remain the three standard extensions.

Host API 1.2 adds renderer-scoped command inputs, current element/revision reads,
transaction revision checks, hidden internal commands and bounded descriptor
snapshot deadlines. Existing extensions targeting `^1.0.0` and `^1.1.0` remain
compatible. Extension inverse operations are now prepared inside the existing
save queue. No SQLite migration or asynchronous store validation was introduced.

The plugin SDK/testkit advance to `0.3.0-alpha.1`; editor, extension SDK/testkit
and extension scaffolder advance to `0.3.0-alpha.2`. The compatibility scaffolder
advances to `0.2.1`. Rebuild workspace packages and refresh packed consumers.
These package artifacts remain subject to the repository's explicit publication
workflow; this change does not publish packages.

Install Diagrams from the generated catalog and restart the service. Reload the
MCP client catalog. Mermaid server rendering requires Chromium visible to the
actual service account. Default deployment does not install a browser runtime.
