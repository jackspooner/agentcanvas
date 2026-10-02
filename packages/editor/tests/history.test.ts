import { describe, expect, it } from 'vitest';
import { EditorHistory } from '../src/history.js';

function entry(label: string, affectedElementIds: string[]) {
  return { label, forward: [label], inverse: [`undo ${label}`], affectedElementIds, timestamp: 0 };
}

describe('EditorHistory invalidation', () => {
  it('invalidates transitive relationships across undo and redo while retaining unrelated entries', () => {
    const history = new EditorHistory<string>();
    const first = entry('image-card', ['image', 'card']);
    const unrelated = entry('other', ['other']);
    const redo = entry('card-note', ['card', 'note']);
    history.record(first);
    history.record(unrelated);
    history.record(redo);
    history.confirmUndo(redo);

    expect(history.invalidateElements(['image'])).toBe(true);
    expect(history.peekUndo()).toBe(unrelated);
    expect(history.peekRedo()).toBeUndefined();
  });

  it('clears all entries when the affected IDs or an entry scope is unsafe', () => {
    const unknown = new EditorHistory<string>();
    unknown.record(entry('unknown', []));
    unknown.record(entry('known', ['card']));
    expect(unknown.invalidateElements(['image'])).toBe(true);
    expect(unknown.canUndo).toBe(false);
    expect(unknown.canRedo).toBe(false);

    const global = new EditorHistory<string>();
    global.record(entry('clear', ['card']));
    global.record(entry('other', ['other']));
    expect(global.invalidateElements(['image'], (candidate) => candidate.label === 'clear')).toBe(true);
    expect(global.canUndo).toBe(false);
  });
});
