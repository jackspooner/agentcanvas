# `@agentcanvas/editor`

The AgentCanvas-owned controlled editor package. It projects canonical
AgentCanvas element frames into React Flow while keeping persistence, extension
rendering, and revision reconciliation in the host application.

React Flow is an implementation detail. Consumers use the world-viewport,
selection, frame-commit, and renderer contracts exported by this package.

This package is under active v0.3 development.

Frame defaults come from `@agentcanvas/plugin-sdk`'s `resolveElementFrame`, shared
with server and browser extension geometry. Null/absent dimensions use 240×120;
explicit zero dimensions remain zero. React Flow remains private to this package.
