# MediaTools image bindings

`agentcanvas.mediatools` is an optional extension that attaches an existing
MediaTools image job to a single-image Gallery element or an existing gallery
item. It does not submit image-generation jobs. It polls the supplied job, reads its completed
output from the configured MediaTools output directory, and admits that file
through the Filesystem Images extension. Gallery changes go through the Gallery
authoring capability.

The extension contributes no element types. While a job is pending, its stable
image reference stays on the target and reports a pending diagnostic. On
completion, the reference is replaced with the canonical Filesystem Images
reference. Agent tools return binding IDs, statuses, diagnostics, and opaque
source references; they do not return local paths, signed URLs, or image bytes.

## Configure and install

Build the catalog from an AgentCanvas checkout:

```sh
npm run plugins:build
npm run plugins:install -- dist/plugin-catalog/agentcanvas.gallery
npm run plugins:install -- dist/plugin-catalog/agentcanvas.filesystem-images
npm run plugins:install -- dist/plugin-catalog/agentcanvas.mediatools
npm run plugins:verify
```

Stop AgentCanvas before installing the distributions and restart it after
configuration is complete. These extensions are optional and are not added by
`plugins:materialize -- --defaults`. The MediaTools config file must contain
explicit service, output-directory, and Filesystem Images root settings. The
packaged example is:

```json
{
  "baseUrl": "http://127.0.0.1:23018",
  "outputDirectory": "C:/Workspace2/renders",
  "filesystemRootId": "workspace2"
}
```

The packaged path `C:/Workspace2/renders` is a subdirectory of the existing
Filesystem Images `workspace2` root at `C:/Workspace2`. Keep that root setting
and grant the AgentCanvas service account read access to the `renders`
subdirectory. Set `AGENT_CANVAS_MEDIATOOLS_TOKEN` in the service's environment; it is read at
startup and must not be placed in either extension's config file. Restart
AgentCanvas after installing or changing configuration.

## Bind an existing job

Use the `agentcanvas_mediatools__bind` tool with a MediaTools `runId` that
already exists. The example creates a single-image Gallery element on an
existing canvas:

```json
{
  "bindingId": "render-42",
  "canvasId": "design-board",
  "runId": "existing-image-job-id",
  "target": { "kind": "image", "x": 40, "y": 40 },
  "alt": "Concept image"
}
```

For a gallery, use `kind: "append"` with its existing element ID and a new item
ID, or `kind: "replace"` with an existing element and item ID. Replacement
proceeds only if the item still has the source observed when the request was
made. `outputIndex` defaults to `0`. The binding ID is the stable image
element/item ID for new targets. Reusing a binding ID is an idempotent retry
only when the other inputs match.

`bind` attaches the pending reference and returns the binding status. The worker
checks every five seconds, and serializes cycles so slow calls do not overlap.
Transient errors use exponential backoff capped at 30 seconds. MediaTools job
history expires after 24 hours; bind while the job is available and keep
MediaTools reachable until output collection finishes. Once the output is
admitted by Filesystem Images, the canvas stores its stable root-relative
reference. Outstanding bindings are persisted and resumed when AgentCanvas
restarts. Use `agentcanvas_mediatools__get_binding` for one status or
`agentcanvas_mediatools__list_bindings` for a page. Those read tools do not
collect jobs or submit generation. Completed output is passed to the configured
Filesystem Images root, so canvases persist only its root ID and relative path.

Statuses are `attaching`, `queued`, `running`, `collected`, `completed`,
`failed`, and `superseded`. A failed binding includes a safe error code and
message; invalid, expired, or failed jobs and outputs rejected by the configured
filesystem root are terminal. A superseded binding means its target changed or
disappeared before attachment completed.

## Verification

```sh
npm run build --workspace @agentcanvas/extension-mediatools
npm run check:notices --workspace @agentcanvas/extension-mediatools
npm run plugins:verify
```

Third-party licenses for the bundled MediaTools client dependency closure are
included in `THIRD_PARTY_NOTICES.md`.
