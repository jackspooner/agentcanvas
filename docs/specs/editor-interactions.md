# Editor interactions

## Selection

- Clicking a node selects it and clears the previous selection.
- Platform multi-select modifier plus click toggles a node.
- Shift-dragging on empty canvas creates a partial-intersection marquee.
- Escape clears selection.
- Locked elements remain selectable but cannot be mutated.
- Read-only canvases allow selection and navigation but expose no mutation
  controls.

The renderer context `selected` value is true when its element belongs to the
current selection.

## Movement

- Dragging the host-owned node handle moves every selected, unlocked node.
- Arrow keys move selected unlocked nodes by one world unit.
- Shift plus arrow moves by ten world units.
- Grid snapping is enabled by default at ten world units and can be toggled.
- Movement commits one `patchElementFrame` operation per changed element.

Interactive extension content MUST remain operable. Pointer and wheel events
originating from controls marked interactive are not treated as canvas
gestures. Focusable editor chrome outside the extension renderer does not make
plain node content interactive.

## Resize

- A selected, unlocked node with finite dimensions exposes resize handles.
- Minimum size is 24 by 24 world units unless an extension contribution
  specifies a larger minimum.
- Resize commits `x`, `y`, `width`, and `height` in one frame patch.
- Aspect-ratio locking MAY be added by extension metadata or a later editor
  preference.

## Delete, duplicate, and clipboard

- Delete and Backspace delete selected unlocked nodes after the editor confirms
  focus is not inside editable extension content.
- Duplicate creates new IDs, offsets copies by 20 world units, and selects the
  copies.
- Copy writes an AgentCanvas JSON clipboard payload and a plain-text summary.
- Paste accepts only validated AgentCanvas clipboard payloads in v0.3.
- Pasted elements receive new IDs and preserve type, schema version, frame,
  style, metadata, and data.

## Undo and redo

- Undo: `Ctrl/Cmd+Z`.
- Redo: `Ctrl/Cmd+Shift+Z` and `Ctrl+Y`.
- Failed operations are not added to history.
- Viewport navigation and selection changes are not document history entries.

## Viewport

- Primary-button drag on empty space pans.
- Space plus drag pans from any non-interactive host chrome.
- Wheel and pinch zoom around the pointer.
- Fit shows fixed canvas bounds or all node-placed elements.
- Reset returns to world origin at 100 percent.
- The user viewport continues to be saved separately from document revisions.
- A newer agent viewport request may direct the view but does not alter
  selection or document history.

## Commands and UI

Core commands use stable IDs:

```text
agentcanvas.undo
agentcanvas.redo
agentcanvas.copy
agentcanvas.paste
agentcanvas.duplicate
agentcanvas.delete
agentcanvas.selectAll
agentcanvas.zoomIn
agentcanvas.zoomOut
agentcanvas.zoomReset
agentcanvas.zoomFit
agentcanvas.toggleGridSnap
```

Toolbar buttons, keyboard shortcuts, context menus, and extensions invoke the
same command service. Controls use icons with accessible labels and tooltips.
