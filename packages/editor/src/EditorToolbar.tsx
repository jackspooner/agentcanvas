import {
  ClipboardCopy,
  ClipboardPaste,
  CopyPlus,
  Grid2X2,
  LocateFixed,
  Maximize2,
  Redo2,
  Scan,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import React, { useSyncExternalStore } from 'react';
import { CORE_EDITOR_COMMANDS, type EditorCommandService } from './commands.js';

const TOOLBAR_COMMANDS = [
  CORE_EDITOR_COMMANDS.undo,
  CORE_EDITOR_COMMANDS.redo,
  CORE_EDITOR_COMMANDS.copy,
  CORE_EDITOR_COMMANDS.paste,
  CORE_EDITOR_COMMANDS.duplicate,
  CORE_EDITOR_COMMANDS.delete,
  CORE_EDITOR_COMMANDS.selectAll
] as const;

const CORE_COMMAND_IDS = new Set<string>(Object.values(CORE_EDITOR_COMMANDS));

const ICONS = {
  [CORE_EDITOR_COMMANDS.undo]: Undo2,
  [CORE_EDITOR_COMMANDS.redo]: Redo2,
  [CORE_EDITOR_COMMANDS.copy]: ClipboardCopy,
  [CORE_EDITOR_COMMANDS.paste]: ClipboardPaste,
  [CORE_EDITOR_COMMANDS.duplicate]: CopyPlus,
  [CORE_EDITOR_COMMANDS.delete]: Trash2,
  [CORE_EDITOR_COMMANDS.selectAll]: Scan
};

export function EditorToolbar({
  commands,
  onCommandError
}: {
  commands: EditorCommandService;
  onCommandError?(error: unknown): void;
}) {
  useSyncExternalStore(commands.subscribe, commands.getSnapshot, commands.getSnapshot);
  const extensionCommands = commands
    .list()
    .filter((command) => !CORE_COMMAND_IDS.has(command.id));
  return (
    <div className="agentcanvas-editor-toolbar" role="toolbar" aria-label="Canvas editing">
      {TOOLBAR_COMMANDS.map((id) => {
        const command = commands.get(id);
        if (!command) return null;
        const Icon = ICONS[id];
        return (
          <button
            type="button"
            key={id}
            aria-label={command.title}
            title={command.title}
            disabled={!commands.isEnabled(id)}
            onClick={() => void commands.execute(id).catch(onCommandError)}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        );
      })}
      {extensionCommands.length > 0 && (
        <select
          aria-label="Extension commands"
          title="Extension commands"
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (id) void commands.execute(id).catch(onCommandError);
          }}
        >
          <option value="">Extensions</option>
          {extensionCommands.map((command) => (
            <option key={command.id} value={command.id} disabled={!commands.isEnabled(command.id)}>
              {command.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const VIEWPORT_COMMANDS = [
  { id: CORE_EDITOR_COMMANDS.zoomOut, icon: ZoomOut },
  { id: CORE_EDITOR_COMMANDS.zoomReset, icon: LocateFixed },
  { id: CORE_EDITOR_COMMANDS.zoomFit, icon: Maximize2 },
  { id: CORE_EDITOR_COMMANDS.zoomIn, icon: ZoomIn },
  { id: CORE_EDITOR_COMMANDS.toggleGridSnap, icon: Grid2X2 }
] as const;

export function EditorViewportToolbar({
  commands,
  gridSnapEnabled,
  onCommandError
}: {
  commands: EditorCommandService;
  gridSnapEnabled: boolean;
  onCommandError?(error: unknown): void;
}) {
  useSyncExternalStore(commands.subscribe, commands.getSnapshot, commands.getSnapshot);
  return (
    <div className="agentcanvas-editor-viewport-toolbar" role="toolbar" aria-label="Canvas viewport">
      {VIEWPORT_COMMANDS.map(({ id, icon: Icon }) => {
        const command = commands.get(id);
        if (!command) return null;
        return (
          <button
            type="button"
            key={id}
            aria-label={command.title}
            title={command.title}
            aria-pressed={id === CORE_EDITOR_COMMANDS.toggleGridSnap ? gridSnapEnabled : undefined}
            disabled={!commands.isEnabled(id)}
            onClick={() => void commands.execute(id).catch(onCommandError)}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
