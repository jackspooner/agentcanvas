# Active AgentCanvas plugins

This directory is the runtime source of truth for enabled plugins. Every non-hidden immediate child directory is discovered and activated during AgentCanvas startup.

Do not place plugin source projects here. First-party sources live under `plugin-packages/`; built distributions live under `dist/plugin-catalog/`. Use the repository plugin commands to validate and materialize distributions into this directory, then restart AgentCanvas.

There is deliberately no enabled-plugin configuration list and no `agentcanvas.config.mjs`.
