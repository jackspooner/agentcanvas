# AgentCanvas 0.3.0-alpha.5

The optional MediaTools extension attaches existing image jobs to reserved Gallery
frames or carousel slots. Queued, running and failed jobs display safe placeholders;
completion converts only the matching slot to a normal filesystem image reference.
Geometry, captions, ordering and carousel settings survive. The extension never
submits generation and does not join the standard default activation set.

Binding intents and collected outputs persist in namespaced SQLite KV. Restart
reconciliation, publication retries, source ownership checks and revision checks
prevent lost attachments or overwriting removed/rebound slots. Collect within the
current 24-hour job-history retention; collected file references survive expiry.

Host API 1.4.0 and SDK alpha.3 add managed service lifecycle hooks and provider-neutral
not-ready image errors. Gallery 0.1.1 adds its authoring capability; Filesystem Images
0.1.1 adds file admission. Extension SDK alpha.4 reexports those contracts. Editor
alpha.3 retains unrelated undo/redo entries across external element revisions while
removing conflicts and transitive multi-element dependencies.

No database or Gallery element schema migration is required. Update the SDK pins,
rebuild and replace Gallery/Filesystem Images, explicitly install MediaTools, configure
its endpoint/output directory/root and private bearer, then restart when idle. See
the [extension setup](../plugin-packages/mediatools/README.md).
