import type { Cardinality, ErdData, ErdEndpoint, ErdOperation, ErdRelationship } from '../contracts.js';
import { appearanceFields } from './appearance-fields.js';

export type ErdSelection =
  | { kind: 'entity'; entityId: string }
  | { kind: 'attribute'; entityId: string; attributeId: string }
  | { kind: 'relationship'; relationshipId: string };
export type ErdFormTarget =
  | ErdSelection
  | { kind: 'title' }
  | { kind: 'new-entity'; x: number; y: number }
  | { kind: 'new-attribute'; entityId: string }
  | { kind: 'new-relationship'; source?: ErdEndpoint; target?: ErdEndpoint };

export function button(label: string, action: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.dataset.agentcanvasInteractive = 'true';
  control.addEventListener('click', action);
  return control;
}

/** A form owns its draft and base revision until it saves or is explicitly closed. */
export function mountErdForm(
  panel: HTMLElement,
  options: {
    data: ErdData;
    revision: number;
    target: ErdFormTarget;
    remove?: boolean;
    apply: (label: string, operations: ErdOperation[], revision: number) => Promise<void>;
    close: () => void;
    navigate: (target: ErdFormTarget) => void;
  }
): { setReadOnly: (value: boolean) => void; hasUnsavedChanges(): boolean; requestClose(): void } {
  const { data, target } = options;
  const form = document.createElement('form');
  form.dataset.agentcanvasInteractive = 'true';
  const heading = document.createElement('h3');
  heading.textContent = options.remove ? 'Confirm deletion' : target.kind.replaceAll('-', ' ');
  const fields = document.createElement('fieldset');
  const error = document.createElement('p');
  error.className = 'erd-form-error';
  error.setAttribute('role', 'alert');
  const actions = document.createElement('div');
  actions.className = 'erd-form-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = options.remove ? 'Confirm delete' : 'Save';
  let readOnly = false;
  let pending = false;
  let dirty = target.kind.startsWith('new-');
  let discard: HTMLDivElement | undefined;
  function requestClose() {
    if (pending) return;
    if (!dirty) {
      options.close();
      return;
    }
    if (discard) return;
    discard = document.createElement('div');
    discard.setAttribute('role', 'alert');
    discard.append(
      'Discard unsaved changes?',
      button('Keep editing', () => {
        discard?.remove();
        discard = undefined;
      }),
      button('Discard changes', options.close)
    );
    form.append(discard);
  }
  const setReadOnly = (value: boolean) => {
    readOnly = value;
    fields.disabled = value || pending;
    save.disabled = value || pending;
  };
  actions.append(save, button('Cancel', requestClose));
  form.append(heading, fields, error, actions);
  form.addEventListener('input', () => {
    dirty = true;
  });
  form.addEventListener('change', () => {
    dirty = true;
  });
  panel.replaceChildren(form);
  panel.hidden = false;

  function field<T extends HTMLElement>(label: string, control: T, parent: HTMLElement = fields): T {
    const wrapper = document.createElement('label');
    wrapper.append(document.createTextNode(label), control);
    control.dataset.agentcanvasInteractive = 'true';
    parent.append(wrapper);
    return control;
  }
  function input(label: string, value: string, required = false): HTMLInputElement {
    const control = document.createElement('input');
    control.value = value;
    control.required = required;
    return field(label, control);
  }
  function select(
    label: string,
    choices: Array<[string, string]>,
    value: string,
    parent?: HTMLElement
  ): HTMLSelectElement {
    const control = document.createElement('select');
    control.replaceChildren(...choices.map(([key, text]) => new Option(text, key)));
    control.value = value;
    return field(label, control, parent);
  }
  function checkbox(label: string, value: boolean): HTMLInputElement {
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = value;
    return field(label, control);
  }
  function number(label: string, value?: number, minimum = -100000, maximum = 100000) {
    const control = input(label, value === undefined ? '' : String(value));
    control.type = 'number';
    control.min = String(minimum);
    control.max = String(maximum);
    control.step = 'any';
    return control;
  }

  let operations: () => ErdOperation[];
  if (options.remove) {
    const relationships = data.relationships.filter((relationship) => {
      if (target.kind === 'entity')
        return [relationship.source, relationship.target].some((end) => end.entityId === target.entityId);
      if (target.kind === 'attribute')
        return [relationship.source, relationship.target].some(
          (end) => end.entityId === target.entityId && end.attributeId === target.attributeId
        );
      return false;
    });
    const summary = document.createElement('p');
    summary.textContent = `Delete this ${target.kind}? ${relationships.length} connected relationship(s) will also be deleted.`;
    fields.append(summary);
    operations = () => {
      if (target.kind === 'entity') return [{ op: 'delete-entity', entityId: target.entityId }];
      if (target.kind === 'attribute')
        return [{ op: 'delete-attribute', entityId: target.entityId, attributeId: target.attributeId }];
      if (target.kind === 'relationship') return [{ op: 'delete-relationship', relationshipId: target.relationshipId }];
      throw new Error('Choose an entity, attribute or relationship to delete.');
    };
  } else if (target.kind === 'title') {
    const title = input('Diagram title', data.title);
    operations = () => [{ op: 'set-title', title: title.value }];
  } else if (target.kind === 'entity' || target.kind === 'new-entity') {
    const entity = target.kind === 'entity' ? data.entities.find((item) => item.id === target.entityId) : undefined;
    if (target.kind === 'entity' && !entity) throw new Error('Entity no longer exists.');
    const name = input('Entity name', entity?.name ?? '', true);
    const alias = input('Alias', entity?.alias ?? '');
    const x = number('Box X', entity?.x ?? (target.kind === 'new-entity' ? target.x : 0));
    const y = number('Box Y', entity?.y ?? (target.kind === 'new-entity' ? target.y : 0));
    x.required = y.required = true;
    const width = number('Box width (blank fits content)', entity?.width, 200, 4096);
    const height = number('Box height (blank fits content)', entity?.height, 64, 8192);
    const appearance = appearanceFields(fields, entity?.appearance);
    const presentation = () => ({
      ...(width.value ? { width: Number(width.value) } : {}),
      ...(height.value ? { height: Number(height.value) } : {}),
      ...(appearance() ? { appearance: appearance() } : {})
    });
    if (entity) {
      const list = document.createElement('div');
      list.className = 'erd-attribute-list';
      for (const attribute of entity.attributes)
        list.append(
          button(`Edit ${attribute.name}`, () =>
            options.navigate({ kind: 'attribute', entityId: entity.id, attributeId: attribute.id })
          )
        );
      list.append(button('Add attribute', () => options.navigate({ kind: 'new-attribute', entityId: entity.id })));
      fields.append(list);
    }
    operations = () => {
      if (entity)
        return [
          {
            op: 'update-entity',
            entityId: entity.id,
            name: name.value,
            ...(alias.value ? { alias: alias.value } : {})
          },
          { op: 'move-entity', entityId: entity.id, x: Number(x.value), y: Number(y.value) },
          { op: 'present-entity', entityId: entity.id, presentation: presentation() }
        ];
      if (target.kind !== 'new-entity') throw new Error('Entity no longer exists.');
      return [
        {
          op: 'add-entity',
          entity: {
            id: `entity_${crypto.randomUUID()}`,
            name: name.value,
            ...(alias.value ? { alias: alias.value } : {}),
            x: Number(x.value),
            y: Number(y.value),
            ...presentation(),
            attributes: []
          }
        }
      ];
    };
  } else if (target.kind === 'attribute' || target.kind === 'new-attribute') {
    const entity = data.entities.find((item) => item.id === target.entityId);
    if (!entity) throw new Error('Entity no longer exists.');
    const attribute =
      target.kind === 'attribute' ? entity.attributes.find((item) => item.id === target.attributeId) : undefined;
    if (target.kind === 'attribute' && !attribute) throw new Error('Attribute no longer exists.');
    const name = input('Attribute name', attribute?.name ?? '', true);
    const dataType = input('Data type', attribute?.dataType ?? '');
    const keys = (['PK', 'FK', 'UK'] as const).map(
      (key) => [key, checkbox(key, attribute?.keys.includes(key) ?? false)] as const
    );
    const nullable = select(
      'Nullable',
      [
        ['unspecified', 'Unspecified'],
        ['yes', 'Yes'],
        ['no', 'No']
      ],
      attribute?.nullable === true ? 'yes' : attribute?.nullable === false ? 'no' : 'unspecified'
    );
    const comment = input('Comment', attribute?.comment ?? '');
    const currentIndex = attribute ? entity.attributes.indexOf(attribute) : entity.attributes.length;
    const order = select(
      'Position',
      Array.from({ length: entity.attributes.length + (attribute ? 0 : 1) }, (_, index) => [
        String(index),
        String(index + 1)
      ]),
      String(currentIndex)
    );
    operations = () => {
      const draft = {
        id: attribute?.id ?? `attribute_${crypto.randomUUID()}`,
        name: name.value,
        dataType: dataType.value,
        keys: keys.filter(([, control]) => control.checked).map(([key]) => key),
        nullable: nullable.value === 'unspecified' ? null : nullable.value === 'yes',
        ...(comment.value ? { comment: comment.value } : {})
      };
      if (!attribute)
        return [{ op: 'add-attribute', entityId: entity.id, attribute: draft, index: Number(order.value) }];
      const ids = entity.attributes.filter((item) => item.id !== attribute.id).map((item) => item.id);
      ids.splice(Number(order.value), 0, attribute.id);
      return [
        { op: 'update-attribute', entityId: entity.id, attribute: draft },
        { op: 'reorder-attributes', entityId: entity.id, attributeIds: ids }
      ];
    };
  } else {
    const relationship =
      target.kind === 'relationship' ? data.relationships.find((item) => item.id === target.relationshipId) : undefined;
    if (target.kind === 'relationship' && !relationship) throw new Error('Relationship no longer exists.');
    if (!data.entities.length) throw new Error('Add an entity before creating a relationship.');
    const label = input('Relationship label', relationship?.label ?? '');
    const identifying = checkbox('Identifying relationship', relationship?.identifying ?? false);
    const labelX = number('Label X (blank uses automatic position)', relationship?.labelPosition?.x);
    const labelY = number('Label Y (blank uses automatic position)', relationship?.labelPosition?.y);
    const bends = field(
      'Connector bends (one x,y pair per line; blank routes automatically)',
      document.createElement('textarea')
    );
    bends.value = relationship?.bends?.map((point) => `${point.x},${point.y}`).join('\n') ?? '';
    const appearance = appearanceFields(fields, relationship?.appearance, false);
    function endpoint(side: 'Source' | 'Target', initial?: ErdEndpoint): () => ErdEndpoint {
      const entity = select(
        `${side} entity`,
        data.entities.map((item) => [item.id, item.name]),
        initial?.entityId ?? data.entities[0].id
      );
      const attribute = select(`${side} attribute`, [], '');
      const refreshAttributes = () => {
        attribute.replaceChildren(
          new Option('Entity (no attribute)', ''),
          ...(data.entities.find((item) => item.id === entity.value)?.attributes ?? []).map(
            (item) => new Option(item.name, item.id)
          )
        );
      };
      refreshAttributes();
      attribute.value = initial?.attributeId ?? '';
      entity.addEventListener('change', refreshAttributes);
      const cardinality = select(
        `${side} cardinality`,
        [
          ['zero-or-one', 'Zero or one'],
          ['one', 'Exactly one'],
          ['zero-or-many', 'Zero or many'],
          ['one-or-many', 'One or many']
        ],
        initial?.cardinality ?? 'one'
      );
      return () => ({
        entityId: entity.value,
        ...(attribute.value ? { attributeId: attribute.value } : {}),
        cardinality: cardinality.value as Cardinality
      });
    }
    const source = endpoint(
      'Source',
      relationship?.source ?? (target.kind === 'new-relationship' ? target.source : undefined)
    );
    const end = endpoint(
      'Target',
      relationship?.target ?? (target.kind === 'new-relationship' ? target.target : undefined)
    );
    operations = () => {
      const draft: ErdRelationship = {
        id: relationship?.id ?? `relationship_${crypto.randomUUID()}`,
        label: label.value,
        identifying: identifying.checked,
        source: source(),
        target: end(),
        ...(appearance() ? { appearance: appearance() } : {}),
        ...(labelX.value !== '' || labelY.value !== ''
          ? { labelPosition: { x: Number(labelX.value), y: Number(labelY.value) } }
          : {}),
        ...(bends.value.trim()
          ? {
              bends: bends.value
                .trim()
                .split('\n')
                .map((line) => {
                  const pair = line.split(',');
                  if (pair.length !== 2 || pair.some((value) => !value.trim() || !Number.isFinite(Number(value))))
                    throw new Error('Each bend must be an x,y pair.');
                  return { x: Number(pair[0]), y: Number(pair[1]) };
                })
            }
          : {})
      };
      if ((labelX.value === '') !== (labelY.value === ''))
        throw new Error('Enter both label coordinates, or leave both blank.');
      return [{ op: relationship ? 'update-relationship' : 'add-relationship', relationship: draft }];
    };
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (readOnly || pending || !form.reportValidity()) return;
    pending = true;
    setReadOnly(readOnly);
    error.textContent = '';
    try {
      await options.apply(
        options.remove ? `Delete ${target.kind}` : `Save ${target.kind}`,
        operations(),
        options.revision
      );
      dirty = false;
      options.close();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pending = false;
      setReadOnly(readOnly);
    }
  });
  form.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')?.focus();
  return { setReadOnly, hasUnsavedChanges: () => dirty || pending, requestClose };
}
