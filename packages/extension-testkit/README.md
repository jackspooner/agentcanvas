# `@agentcanvas/extension-testkit`

Public conformance helpers for typed AgentCanvas extension descriptors and
their generated installed manifests.

The package re-exports the plugin API v1 testkit for compatibility.

This package is not published to npm. Use the [public-source build and local
tarball installation guide](https://github.com/jackspooner/agentcanvas/blob/main/docs/plugin-authoring/testing-and-distribution.md#build-the-authoring-packages-from-public-source)
to build and install the SDK/testkit packages together. That path requires no
private GitHub access or npm account.

`assertExtensionDefinition` validates the static manifest structure and proves
that element, command, tool, procedure, and migration declarations still match
the typed authoring descriptor.

`ManualRendererFrameScheduler` provides deterministic timestamps, activity
changes, callback-failure isolation, and disposal for dynamic browser-renderer
unit tests without using a real browser clock.
