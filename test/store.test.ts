import { describe, expect, it } from 'vitest';
import { SqliteCanvasStore } from '../src/store/sqlite';

const makeStore = () => new SqliteCanvasStore(':memory:');

describe('SQLite canvas store', () => {
  it('creates a canvas at revision 1', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Smoke canvas', project: 'demo' });
    expect(canvas.id).toMatch(/^canvas_/);
    expect(canvas.revision).toBe(1);
    expect(canvas.elements).toEqual([]);
  });

  it('applies element operations and increments revisions', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Ops' });
    const updated = store.applyOperations(canvas.id, {
      operations: [{ op: 'upsertElement', element: { id: 'm1', type: 'markdown', x: 0, y: 0, markdown: '# Hi' } }],
      expectedRevision: 1
    });
    expect(updated.revision).toBe(2);
    expect(updated.elements).toHaveLength(1);
  });

  it('rejects stale expected revisions', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Stale' });
    store.applyOperations(canvas.id, { operations: [{ op: 'upsertElement', element: { id: 't1', type: 'text', x: 0, y: 0, text: 'hello' } }] });
    expect(() => store.applyOperations(canvas.id, {
      expectedRevision: 1,
      operations: [{ op: 'upsertElement', element: { id: 't2', type: 'text', x: 0, y: 0, text: 'later' } }]
    })).toThrow(/revision/i);
  });

  it('creates and resolves read-only share links', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Shared' });
    const link = store.createShareLink(canvas.id, { mode: 'read' });
    expect(link.url).toContain('/c/');
    const resolved = store.resolveShareToken(link.token);
    expect(resolved.canvas.id).toBe(canvas.id);
    expect(resolved.link.mode).toBe('read');
  });

  it('tracks user and agent-controlled viewport state per canvas', () => {
    const store = makeStore();
    const canvas = store.createCanvas({ title: 'Viewport' });

    const initial = store.getViewportState(canvas.id);
    expect(initial.userViewport).toMatchObject({ centerX: 0, centerY: 0, zoom: 1, width: 1920, height: 900, source: 'default' });
    expect(initial.agentViewport).toBeNull();

    const userViewport = store.recordViewport(canvas.id, {
      source: 'user',
      centerX: 120,
      centerY: -80,
      zoom: 1.5,
      width: 1440,
      height: 820
    });
    expect(userViewport.source).toBe('user');

    const agentViewport = store.recordViewport(canvas.id, {
      source: 'agent',
      centerX: 900,
      centerY: 400,
      zoom: 0.75,
      width: 1920,
      height: 900
    });
    expect(agentViewport.source).toBe('agent');

    const updated = store.getViewportState(canvas.id);
    expect(updated.userViewport).toMatchObject({ centerX: 120, centerY: -80, zoom: 1.5, width: 1440, height: 820, source: 'user' });
    expect(updated.agentViewport).toMatchObject({ centerX: 900, centerY: 400, zoom: 0.75, width: 1920, height: 900, source: 'agent' });
  });
});
