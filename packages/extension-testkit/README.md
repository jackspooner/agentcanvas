# `@agentcanvas/extension-testkit`

Public conformance helpers for typed AgentCanvas extension descriptors and
their generated installed manifests.

The package re-exports the plugin API v1 testkit for compatibility.

`assertExtensionDefinition` validates the static manifest structure and proves
that element, command, tool, procedure, and migration declarations still match
the typed authoring descriptor.

`ManualRendererFrameScheduler` provides deterministic timestamps, activity
changes, callback-failure isolation, and disposal for dynamic browser-renderer
unit tests without using a real browser clock.
