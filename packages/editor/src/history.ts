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

  invalidateElements(
    changedElementIds: readonly string[],
    isUnsafe: (entry: EditorHistoryEntry<TOperation>) => boolean = () => false
  ): boolean {
    if (changedElementIds.length === 0) return false;
    const entries = [...this.undoEntries, ...this.redoEntries];
    if (
      entries.some(
        (entry) =>
          entry.affectedElementIds.length === 0 ||
          entry.affectedElementIds.some((id) => typeof id !== 'string' || id.length === 0) ||
          isUnsafe(entry)
      )
    ) {
      const changed = entries.length > 0;
      this.clear();
      return changed;
    }

    const affected = new Set(changedElementIds);
    let expanded = true;
    // ponytail: rescan at most 200 bounded history entries; index relationships only if the history limit grows.
    while (expanded) {
      expanded = false;
      for (const entry of entries) {
        if (entry.affectedElementIds.some((id) => affected.has(id))) {
          for (const id of entry.affectedElementIds) {
            if (!affected.has(id)) {
              affected.add(id);
              expanded = true;
            }
          }
        }
      }
    }

    const retain = (entry: EditorHistoryEntry<TOperation>) => !entry.affectedElementIds.some((id) => affected.has(id));
    const before = this.undoEntries.length + this.redoEntries.length;
    const undo = this.undoEntries.filter(retain);
    const redo = this.redoEntries.filter(retain);
    this.undoEntries.splice(0, this.undoEntries.length, ...undo);
    this.redoEntries.splice(0, this.redoEntries.length, ...redo);
    return this.undoEntries.length + this.redoEntries.length !== before;
  }

  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
  }
}
