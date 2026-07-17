import { describe, expect, it, vi } from 'vitest';
import { EditorCommandService, EditorHistory } from '../src/index.js';

describe('editor commands and history', () => {
  it('uses one command implementation for every invocation surface', async () => {
    const execute = vi.fn();
    const commands = new EditorCommandService();
    const dispose = commands.register({ id: 'fixture.run', title: 'Run', execute });
    expect(commands.isEnabled('fixture.run')).toBe(true);
    expect(await commands.execute('fixture.run')).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    dispose();
    expect(await commands.execute('fixture.run')).toBe(false);
  });

  it('moves confirmed entries between undo and redo without losing operations', () => {
    const history = new EditorHistory<string>();
    const entry = {
      label: 'Move',
      forward: ['forward'],
      inverse: ['inverse'],
      affectedElementIds: ['card'],
      timestamp: 1
    };
    history.record(entry);
    expect(history.peekUndo()).toBe(entry);
    history.confirmUndo(entry);
    expect(history.peekRedo()).toBe(entry);
    history.confirmRedo(entry);
    expect(history.peekUndo()).toBe(entry);
  });
});
