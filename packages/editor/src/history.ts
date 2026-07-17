export interface EditorHistoryEntry<TOperation> {
  label: string;
  forward: readonly TOperation[];
  inverse: readonly TOperation[];
  affectedElementIds: readonly string[];
  timestamp: number;
}

export class EditorHistory<TOperation> {
  private readonly undoEntries: EditorHistoryEntry<TOperation>[] = [];
  private readonly redoEntries: EditorHistoryEntry<TOperation>[] = [];

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  record(entry: EditorHistoryEntry<TOperation>): void {
    this.undoEntries.push(entry);
    if (this.undoEntries.length > this.limit) this.undoEntries.shift();
    this.redoEntries.length = 0;
  }

  peekUndo(): EditorHistoryEntry<TOperation> | undefined {
    return this.undoEntries.at(-1);
  }

  confirmUndo(entry: EditorHistoryEntry<TOperation>): void {
    if (this.undoEntries.at(-1) !== entry) throw new Error('Undo history changed before confirmation');
    this.undoEntries.pop();
    this.redoEntries.push(entry);
  }

  peekRedo(): EditorHistoryEntry<TOperation> | undefined {
    return this.redoEntries.at(-1);
  }

  confirmRedo(entry: EditorHistoryEntry<TOperation>): void {
    if (this.redoEntries.at(-1) !== entry) throw new Error('Redo history changed before confirmation');
    this.redoEntries.pop();
    this.undoEntries.push(entry);
  }

  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
  }
}
