import { afterEach, expect, it, vi } from 'vitest';
import type { ErdData } from '../src/contracts.js';
import { mountErdForm } from '../src/browser/erd-forms.js';

const data: ErdData = {
  title: 'Shop',
  entities: [
    {
      id: 'users',
      name: 'Users',
      x: 0,
      y: 0,
      attributes: [
        { id: 'id', name: 'id', dataType: 'uuid', keys: ['PK'], nullable: false },
        { id: 'name', name: 'name', dataType: 'text', keys: [], nullable: null }
      ]
    },
    {
      id: 'orders',
      name: 'Orders',
      x: 400,
      y: 0,
      attributes: [{ id: 'user', name: 'user_id', dataType: 'uuid', keys: ['FK'], nullable: true }]
    }
  ],
  relationships: [
    {
      id: 'orders-users',
      label: 'places',
      identifying: true,
      source: { entityId: 'users', attributeId: 'id', cardinality: 'one' },
      target: { entityId: 'orders', attributeId: 'user', cardinality: 'zero-or-many' }
    }
  ]
};

afterEach(() => document.body.replaceChildren());

function panel() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}
function control<T extends HTMLInputElement | HTMLSelectElement>(root: HTMLElement, label: string): T {
  const wrapper = Array.from(root.querySelectorAll('label')).find(
    (element) => element.firstChild?.textContent === label
  );
  if (!wrapper) throw new Error(`Missing ${label}`);
  return wrapper.querySelector('input,select') as T;
}
function submit(root: HTMLElement) {
  root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

it('keeps a failed attribute draft and revision, and saves keys, nullability and order together', async () => {
  const root = panel();
  const apply = vi
    .fn()
    .mockRejectedValueOnce(new Error('Revision conflict: reload before retrying.'))
    .mockResolvedValueOnce(undefined);
  const close = vi.fn();
  const mounted = mountErdForm(root, {
    data,
    revision: 7,
    target: { kind: 'attribute', entityId: 'users', attributeId: 'name' },
    apply,
    close,
    navigate: vi.fn()
  });
  control(root, 'Attribute name').value = 'display_name';
  control<HTMLInputElement>(root, 'UK').checked = true;
  control(root, 'Nullable').value = 'yes';
  control(root, 'Position').value = '0';
  submit(root);
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')?.textContent).toContain('Revision conflict'));
  expect(close).not.toHaveBeenCalled();
  expect(control(root, 'Attribute name').value).toBe('display_name');
  mounted.setReadOnly(true);
  submit(root);
  expect(apply).toHaveBeenCalledTimes(1);
  mounted.setReadOnly(false);
  submit(root);
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenLastCalledWith(
    'Save attribute',
    [
      {
        op: 'update-attribute',
        entityId: 'users',
        attribute: { id: 'name', name: 'display_name', dataType: 'text', keys: ['UK'], nullable: true }
      },
      { op: 'reorder-attributes', entityId: 'users', attributeIds: ['name', 'id'] }
    ],
    7
  );
});

it('offers attribute/entity endpoint changes and self relationships without inventing foreign keys', async () => {
  const root = panel();
  const apply = vi.fn().mockResolvedValue(undefined);
  mountErdForm(root, {
    data,
    revision: 3,
    target: { kind: 'relationship', relationshipId: 'orders-users' },
    apply,
    close: vi.fn(),
    navigate: vi.fn()
  });
  const targetEntity = control<HTMLSelectElement>(root, 'Target entity');
  targetEntity.value = 'users';
  targetEntity.dispatchEvent(new Event('change'));
  expect(
    Array.from(control<HTMLSelectElement>(root, 'Target attribute').options).map((option) => option.value)
  ).toEqual(['', 'id', 'name']);
  control(root, 'Target attribute').value = 'name';
  control(root, 'Source attribute').value = '';
  control(root, 'Source cardinality').value = 'zero-or-one';
  control(root, 'Target cardinality').value = 'one-or-many';
  control<HTMLInputElement>(root, 'Identifying relationship').checked = false;
  submit(root);
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(apply.mock.calls[0][1]).toEqual([
    {
      op: 'update-relationship',
      relationship: {
        id: 'orders-users',
        label: 'places',
        identifying: false,
        source: { entityId: 'users', cardinality: 'zero-or-one' },
        target: { entityId: 'users', attributeId: 'name', cardinality: 'one-or-many' }
      }
    }
  ]);
});

it('shows the cascade count before deleting an attribute and issues only the owner operation', async () => {
  const root = panel();
  const apply = vi.fn().mockResolvedValue(undefined);
  mountErdForm(root, {
    data,
    revision: 2,
    target: { kind: 'attribute', entityId: 'users', attributeId: 'id' },
    remove: true,
    apply,
    close: vi.fn(),
    navigate: vi.fn()
  });
  expect(root.textContent).toContain('1 connected relationship(s) will also be deleted');
  expect(apply).not.toHaveBeenCalled();
  submit(root);
  await vi.waitFor(() =>
    expect(apply).toHaveBeenCalledWith(
      'Delete attribute',
      [{ op: 'delete-attribute', entityId: 'users', attributeId: 'id' }],
      2
    )
  );
});
