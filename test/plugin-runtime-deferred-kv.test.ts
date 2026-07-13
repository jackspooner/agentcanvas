import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createDeferredPluginRuntimeServices } from '../src/plugin-runtime/services';
import { initializeEmptyV2Database } from '../src/store/version';

describe('deferred plugin KV', () => {
  it('fails before binding and becomes namespaced after the v0.2 database opens', async () => {
    const services = createDeferredPluginRuntimeServices();
    const left = services.kv('plugin.left');
    const right = services.kv('plugin.right');
    await expect(left.get('value')).rejects.toThrow(/before database binding/);

    const db = new DatabaseSync(':memory:');
    initializeEmptyV2Database(db, '0.2.0');
    services.bindDatabase(db);
    await left.set('value', { owner: 'left' });
    await right.set('value', { owner: 'right' });
    await expect(left.get('value')).resolves.toEqual({ owner: 'left' });
    await expect(right.get('value')).resolves.toEqual({ owner: 'right' });
    expect(() => services.bindDatabase(db)).toThrow(/already bound/);
    db.close();
  });
});
