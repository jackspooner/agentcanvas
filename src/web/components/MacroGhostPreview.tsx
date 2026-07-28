import type { CanvasElement } from '@agentcanvas/plugin-sdk';
import React from 'react';

interface MacroGhostPreviewProps {
  elements: readonly CanvasElement[];
  renderElement(element: CanvasElement): React.ReactNode;
}

export function MacroGhostPreview({ elements, renderElement }: MacroGhostPreviewProps) {
  if (elements.length === 0) return null;
  return (
    <div className="macro-ghost-preview" aria-hidden="true" data-testid="macro-ghost-preview">
      {elements.map((element) => (
        <div
          key={element.id}
          className="plugin-world-element macro-ghost-element"
          data-element-id={element.id}
          data-macro-ghost="true"
          style={{
            left: element.x,
            top: element.y,
            width: element.width ?? 240,
            height: element.height ?? 120,
            zIndex: element.zIndex ?? 0,
            pointerEvents: 'none'
          }}
        >
          {renderElement({ ...element, locked: true })}
        </div>
      ))}
    </div>
  );
}
