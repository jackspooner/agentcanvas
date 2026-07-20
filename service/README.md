# Optional Servy deployment examples

AgentCanvas does not require Servy or any other process manager. The public
installation path is documented in `docs/getting-started.md`, and the portable
runtime command is `node --import tsx src/server.ts` from the repository root.

The files in this directory are optional examples only for Windows operators
who have independently chosen and installed Servy. They are not prerequisites,
are not installed by AgentCanvas, and are not the canonical production setup.

If Servy is already part of the deployment, `AgentCanvas.servy.json` is an
example configuration. Replace every `C:/path/to/AgentCanvas` placeholder and
import the template using that deployment's reviewed Servy procedure. It binds
AgentCanvas to loopback and uses the passwordless Windows virtual account
`NT SERVICE\AgentCanvas` rather than `LocalSystem`.

After the service exists and before its first start, grant that virtual account read and execute access to the installation and Modify access to the configured data and log directories. Servy also requires its runtime directory to be writable by a non-LocalSystem service account; grant the virtual account the narrowest access compatible with your Servy version. Do not add a password to the template. AgentCanvas plugins are trusted executable code, so do not run the service as `LocalSystem`, Administrator, or another broadly privileged account.

On Windows, an Administrator PowerShell can configure the account and required ACLs after importing the template:

```powershell
.\service\configure-virtual-service-account.ps1 `
  -ServiceName AgentCanvas `
  -InstallRoot C:\path\to\AgentCanvas `
  -DataRoot C:\path\to\AgentCanvas\data
```

Stop AgentCanvas before running the script and start it again afterward. The script exports the existing Servy record, reinstalls that configuration through Servy's supported `--user` interface, and removes its temporary configuration file.

The script refuses service environments containing secret-like keys because Servy's account-setting CLI would otherwise expose them briefly as process arguments. Move those values to an external secret manager or use Servy's interactive account configuration for that deployment.

`Workspace2AgentCanvas.servy.json` is an optional Workspace2-local example using `NT SERVICE\Workspace2AgentCanvas`. Media providers are independent extensions and are not Windows service dependencies of AgentCanvas core.

Both files are strict JSON and intentionally contain no comments or secrets. Environment variables and their semantics are documented in the repository setup and operations guides.
