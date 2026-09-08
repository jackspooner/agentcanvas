import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorToolbar } from '../src/EditorToolbar.js';
import { EditorCommandService, EditorHistory } from '../src/index.js';

describe('editor commands and history', () => {
  it('keeps hidden extension commands executable but out of the menu', async () => {
    const commands = new EditorCommandService();
    commands.register({ id: 'fixture.hidden', title: 'Hidden action', hidden: true, execute() {} });
    commands.register({ id: 'fixture.visible', title: 'Visible action', execute() {} });
    const html = renderToStaticMarkup(createElement(EditorToolbar, { commands }));
    expect(html).not.toContain('Hidden action');
    expect(html).toContain('Visible action');
    expect(await commands.execute('fixture.hidden')).toBe(true);
  });
  it('uses one command implementation for every invocation surface', async () => {
    const execute = vi.fn();
    const commands = new EditorCommandService();
    const dispose = commands.register({ id: 'fixture.run', title: 'Run', execute });
    expect(commands.isEnabled('fixture.run')).toBe(true);
    expect(await commands.execute('fixture.run', { elementId: 'one' })).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ elementId: 'one' });
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
