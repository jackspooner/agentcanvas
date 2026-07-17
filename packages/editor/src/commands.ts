export interface EditorCommandDescriptor {
  id: string;
  title: string;
  category?: string;
  execute(): Promise<void> | void;
  isEnabled?(): boolean;
}

export type EditorCommandRegistration = () => void;

export class EditorCommandService {
  private readonly commands = new Map<string, EditorCommandDescriptor>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  register(command: EditorCommandDescriptor): EditorCommandRegistration {
    if (this.commands.has(command.id)) throw new Error(`Editor command is already registered: ${command.id}`);
    this.commands.set(command.id, command);
    this.notify();
    return () => {
      if (this.commands.get(command.id) === command) {
        this.commands.delete(command.id);
        this.notify();
      }
    };
  }

  get(id: string): EditorCommandDescriptor | undefined {
    return this.commands.get(id);
  }

  list(): readonly EditorCommandDescriptor[] {
    return [...this.commands.values()];
  }

  isEnabled(id: string): boolean {
    const command = this.commands.get(id);
    return Boolean(command && (command.isEnabled?.() ?? true));
  }

  async execute(id: string): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || !(command.isEnabled?.() ?? true)) return false;
    await command.execute();
    this.notify();
    return true;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const CORE_EDITOR_COMMANDS = Object.freeze({
  undo: 'agentcanvas.undo',
  redo: 'agentcanvas.redo',
  copy: 'agentcanvas.copy',
  paste: 'agentcanvas.paste',
  duplicate: 'agentcanvas.duplicate',
  delete: 'agentcanvas.delete',
  selectAll: 'agentcanvas.selectAll',
  zoomIn: 'agentcanvas.zoomIn',
  zoomOut: 'agentcanvas.zoomOut',
  zoomReset: 'agentcanvas.zoomReset',
  zoomFit: 'agentcanvas.zoomFit',
  toggleGridSnap: 'agentcanvas.toggleGridSnap'
});
