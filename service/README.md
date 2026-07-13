# Servy templates

`AgentCanvas.servy.json` is the public example. Replace every `C:/path/to/AgentCanvas` placeholder, ensure Assets-2 is already running at `ASSETS_BASE_URL`, and import the template with Servy from an Administrator PowerShell. It binds AgentCanvas to loopback and deliberately sets `RunAsLocalSystem` to `false`.

Configure Servy to run the service under a dedicated, unprivileged local account that has read access to the installation and write access only to the configured data and log directories. AgentCanvas plugins are trusted executable code, so do not run the service as `LocalSystem`, Administrator, or another broadly privileged account.

`Workspace2AgentCanvas.servy.json` is an optional Workspace2-local example. It additionally declares the local Windows service dependency `Workspace2Assets2`. That service name is not part of AgentCanvas's public runtime contract; external installations should use `AgentCanvas.servy.json` and operate their Assets-2 service independently.

Both files are strict JSON and intentionally contain no comments or secrets. Environment variables and their semantics are documented in the repository setup and operations guides.
