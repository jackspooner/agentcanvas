import type { CanvasThemeV1 } from '@agentcanvas/extension-sdk';
import type { ErdData, ErdEndpoint, ErdOperation } from '../contracts.js';
import { diagramGeometry, renderErdScene, applyErdOperations } from '../erd/index.js';
import { button, type ErdFormTarget, type ErdSelection, mountErdForm } from './erd-forms.js';
import { sceneToSvg, svgElement, preserveSvgFocus } from './scene-dom.js';
import { erdEditorStyles } from './styles.js';

export interface ErdEditorOptions {
  getState: () => { data: ErdData; revision: number; readOnly: boolean; theme: Readonly<CanvasThemeV1> };
  apply: (label: string, operations: ErdOperation[], expectedRevision: number) => Promise<void>;
  expand?: () => void;
  exportMermaid?: () => void;
  expanded?: boolean;
  signal: AbortSignal;
}

/** Each gesture commits once through the host command service with its captured revision. */
export function mountErdEditor(
  root: ShadowRoot | HTMLElement,
  options: ErdEditorOptions
): { update(): void; dispose(): void; hasUnsavedChanges(): boolean } {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const style = document.createElement('style');
  style.textContent = erdEditorStyles;
  const frame = document.createElement('div');
  frame.className = 'erd-editor';
  frame.dataset.agentcanvasInteractive = 'true';
  frame.tabIndex = 0;
  frame.setAttribute('aria-label', 'Entity relationship diagram editor');
  const toolbar = document.createElement('div');
  toolbar.className = 'erd-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Diagram actions');
  const svg = svgElement('svg', { class: 'erd-stage', role: 'group', 'aria-label': 'Entities and relationships' });
  svg.dataset.agentcanvasInteractive = 'true';
  const status = document.createElement('div');
  status.className = 'erd-status';
  status.setAttribute('role', 'status');
  const panel = document.createElement('div');
  panel.className = 'erd-form-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Edit diagram item');
  panel.hidden = true;
  panel.dataset.agentcanvasInteractive = 'true';
  frame.append(toolbar, svg, status, panel);
  root.replaceChildren(style, frame);
  let selection: ErdSelection | undefined;
  let form: ReturnType<typeof mountErdForm> | undefined;
  let connecting = false;
  let source: ErdEndpoint | undefined;
  let pending = false;
  let disposed = false;
  let releasedHeader: string | undefined;
  let view: { x: number; y: number; width: number; height: number } | undefined;
  let drag:
    | {
        entityId: string;
        pointerId: number;
        revision: number;
        x: number;
        y: number;
        start: DOMPoint;
        inverse: DOMMatrix;
        dx: number;
        dy: number;
        operation?: (dx: number, dy: number) => ErdOperation;
      }
    | undefined;
  let pan: { pointerId: number; start: DOMPoint; inverse: DOMMatrix; x: number; y: number } | undefined;
  const editButtons: HTMLButtonElement[] = [];

  function closeForm() {
    form = undefined;
    panel.hidden = true;
    panel.replaceChildren();
    frame.focus();
  }
  async function commit(label: string, operations: ErdOperation[], revision: number) {
    if (options.getState().readOnly) throw new Error('This diagram is read-only. Your draft has been kept.');
    if (pending) throw new Error('Wait for the current diagram change to finish.');
    pending = true;
    updateControls();
    try {
      await options.apply(label, operations, revision);
      if (!disposed) {
        if (operations.some((operation) => operation.op === 'auto-layout' || operation.op === 'add-entity'))
          view = undefined;
        status.textContent = `${label} saved.`;
        update();
      }
    } finally {
      pending = false;
      if (!disposed) updateControls();
    }
  }
  function run(label: string, operations: ErdOperation[], revision = options.getState().revision) {
    void commit(label, operations, revision).catch((error) => {
      if (!disposed) status.textContent = error instanceof Error ? error.message : String(error);
    });
  }
  function openForm(target: ErdFormTarget, remove = false) {
    if (options.getState().readOnly || pending) return;
    if (form?.hasUnsavedChanges()) {
      status.textContent = 'Save or discard the current draft before editing another item.';
      form.requestClose();
      return;
    }
    if (target.kind === 'entity' || target.kind === 'attribute' || target.kind === 'relationship') selection = target;
    connecting = false;
    source = undefined;
    const state = options.getState();
    try {
      form = mountErdForm(panel, {
        data: structuredClone(state.data),
        revision: state.revision,
        target,
        remove,
        apply: commit,
        close: closeForm,
        navigate: openForm
      });
    } catch (error) {
      closeForm();
      status.textContent = error instanceof Error ? error.message : String(error);
    }
    draw();
  }
  function action(label: string, callback: () => void, editing = true) {
    const control = button(label, callback);
    toolbar.append(control);
    if (editing) editButtons.push(control);
    return control;
  }
  action('Title', () => openForm({ kind: 'title' }));
  action('Add entity', () => {
    const data = options.getState().data;
    const bounds = diagramGeometry(data).bounds;
    openForm({
      kind: 'new-entity',
      x: data.entities.length ? bounds.x + bounds.width + 32 : 40,
      y: data.entities[0]?.y ?? 40
    });
  });
  action('Add relationship', () => openForm({ kind: 'new-relationship' }));
  const connectButton = action('Connect', () => {
    if (form?.hasUnsavedChanges()) {
      form.requestClose();
      return;
    }
    closeForm();
    connecting = !connecting;
    source = undefined;
    status.textContent = connecting ? 'Choose a source handle, then a target handle. Escape cancels.' : '';
    draw();
  });
  const editButton = action('Edit selected', () => selection && openForm(selection));
  const deleteButton = action('Delete selected', () => selection && openForm(selection, true));
  action('Layout LR', () => run('Layout left to right', [{ op: 'auto-layout', direction: 'LR' }]));
  action('Layout TB', () => run('Layout top to bottom', [{ op: 'auto-layout', direction: 'TB' }]));
  action(
    'Fit',
    () => {
      view = undefined;
      draw();
    },
    false
  );
  if (options.expand) action('Expand', options.expand, false);
  if (options.exportMermaid) action('Export Mermaid', options.exportMermaid, false);

  function updateControls() {
    const disabled = options.getState().readOnly || pending;
    for (const control of editButtons) control.disabled = disabled;
    editButton.disabled = disabled || !selection;
    deleteButton.disabled = disabled || !selection;
    form?.setReadOnly(disabled);
    connectButton.setAttribute('aria-pressed', String(connecting));
    for (const node of svg.querySelectorAll<SVGElement>('[data-scene-id]')) {
      const item = selectionAt(node);
      if (item) node.dataset.selected = String(JSON.stringify(item) === JSON.stringify(selection));
      if (item?.kind === 'relationship') node.setAttribute('opacity', node.dataset.selected === 'true' ? '.65' : '1');
    }
  }
  function selectItem(next: ErdSelection) {
    selection = next;
    status.textContent = `${next.kind} selected. Enter edits; Delete opens confirmation.`;
    updateControls();
  }
  function connect(endpoint: ErdEndpoint) {
    if (options.getState().readOnly || pending) return;
    if (!source) {
      source = endpoint;
      connecting = true;
      status.textContent = 'Choose a target handle. The same entity is allowed.';
      draw();
    } else openForm({ kind: 'new-relationship', source, target: endpoint });
  }
  function viewBox() {
    if (view) svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  }
  function draw() {
    if (disposed) return;
    const restoreFocus = preserveSvgFocus(svg);
    const state = options.getState();
    const data = drag?.operation
      ? applyErdOperations(state.data, [drag.operation(drag.dx, drag.dy)]).data
      : drag
        ? {
            ...state.data,
            entities: state.data.entities.map((entity) =>
              entity.id === drag?.entityId ? { ...entity, x: drag.x + drag.dx, y: drag.y + drag.dy } : entity
            )
          }
        : state.data;
    const geometry = diagramGeometry(data);
    const scene = renderErdScene(data, state.theme);
    if (!view)
      view = {
        x: scene.bounds.x - 24,
        y: scene.bounds.y - 24,
        width: Math.max(240, scene.bounds.width + 48),
        height: Math.max(160, scene.bounds.height + 48)
      };
    viewBox();
    const title = svgElement('title');
    title.textContent = data.title || 'Entity relationship diagram';
    svg.replaceChildren(title, ...sceneToSvg(scene.nodes));
    const sceneNodes = new Map(
      Array.from(svg.querySelectorAll<SVGElement>('[data-scene-id]'), (node) => [node.dataset.sceneId, node])
    );
    for (const entity of data.entities) {
      const node = sceneNodes.get(`entity:${entity.id}`);
      if (!node) continue;
      node.dataset.entityId = entity.id;
      node.dataset.selected = String(selection?.kind === 'entity' && selection.entityId === entity.id);
      node.dataset.agentcanvasInteractive = 'true';
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Entity ${entity.name}`);
      const box = geometry.entities.find((item) => item.id === entity.id);
      for (const attribute of entity.attributes) {
        const row = sceneNodes.get(`attribute:${entity.id}:${attribute.id}`);
        if (!row) continue;
        row.dataset.attributeId = attribute.id;
        row.dataset.entityId = entity.id;
        row.dataset.selected = String(
          selection?.kind === 'attribute' && selection.attributeId === attribute.id && selection.entityId === entity.id
        );
        row.dataset.agentcanvasInteractive = 'true';
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `Attribute ${entity.name}.${attribute.name}`);
        const rowBox = box?.rows.find((item) => item.id === attribute.id);
        if (rowBox && box)
          row.prepend(
            svgElement('rect', {
              x: box.x,
              y: rowBox.y,
              width: box.width,
              height: box.rowHeight,
              fill: 'transparent',
              stroke: 'transparent'
            })
          );
      }
      if (!box || state.readOnly || pending) continue;
      const header = svgElement('rect', {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.headerHeight,
        fill: 'transparent',
        'data-drag-entity': entity.id,
        'data-entity-id': entity.id,
        'data-agentcanvas-interactive': 'true'
      });
      node.append(header);
      if (selection?.kind === 'entity' && selection.entityId === entity.id) {
        svg.append(
          svgElement('rect', {
            x: box.x + box.width - 8,
            y: box.y + box.height - 8,
            width: 16,
            height: 16,
            fill: state.theme.colors.accent,
            stroke: state.theme.colors.surface,
            tabindex: 0,
            role: 'button',
            'aria-label': `Resize ${entity.name}; arrow keys resize`,
            'data-resize-entity': entity.id,
            'data-agentcanvas-interactive': 'true',
            style: 'cursor:nwse-resize'
          })
        );
      }
      if (connecting) {
        for (const end of [
          { y: box.y + box.headerHeight / 2, attributeId: undefined },
          ...box.rows.map((row) => ({ y: row.centerY, attributeId: row.id }))
        ]) {
          const handle = svgElement('circle', {
            cx: box.x + box.width,
            cy: end.y,
            r: 7,
            class: 'erd-connect-handle',
            role: 'button',
            tabindex: 0,
            'aria-label': `Connect ${entity.name}${end.attributeId ? ` attribute ${entity.attributes.find((item) => item.id === end.attributeId)?.name}` : ''}`,
            'data-connect-entity': entity.id,
            'data-agentcanvas-interactive': 'true'
          });
          if (end.attributeId) handle.dataset.connectAttribute = end.attributeId;
          svg.append(handle);
        }
      }
    }
    for (const relationship of data.relationships) {
      const node = sceneNodes.get(`relationship:${relationship.id}`);
      if (!node) continue;
      node.dataset.relationshipId = relationship.id;
      node.dataset.agentcanvasInteractive = 'true';
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', `Relationship ${relationship.label || relationship.id}`);
      if (selection?.kind === 'relationship' && selection.relationshipId === relationship.id)
        node.setAttribute('opacity', '.65');
      const route = geometry.relationships.find((item) => item.id === relationship.id);
      if (route)
        node.append(
          svgElement('polyline', {
            points: route.points.map((point) => `${point.x},${point.y}`).join(' '),
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': 16,
            'pointer-events': 'stroke'
          })
        );
      if (
        route &&
        !state.readOnly &&
        !pending &&
        selection?.kind === 'relationship' &&
        selection.relationshipId === relationship.id
      ) {
        const bends = relationship.bends?.length ? relationship.bends : route.points.slice(1, -1);
        for (const [index, point] of bends.entries())
          svg.append(
            svgElement('circle', {
              cx: point.x,
              cy: point.y,
              r: 7,
              fill: state.theme.colors.accent,
              stroke: state.theme.colors.surface,
              tabindex: 0,
              role: 'button',
              'aria-label': `Move bend ${index + 1}; arrow keys move`,
              'data-bend-relationship': relationship.id,
              'data-bend-index': index,
              'data-agentcanvas-interactive': 'true'
            })
          );
        if (relationship.label)
          svg.append(
            svgElement('circle', {
              cx: route.label.x,
              cy: route.label.y,
              r: 8,
              fill: 'transparent',
              stroke: state.theme.colors.accent,
              tabindex: 0,
              role: 'button',
              'aria-label': 'Move relationship label; arrow keys move',
              'data-label-relationship': relationship.id,
              'data-agentcanvas-interactive': 'true'
            })
          );
      }
    }
    updateControls();
    restoreFocus();
  }
  function targetElement(event: Event): Element | undefined {
    return event.target instanceof Element ? event.target : undefined;
  }
  function selectionAt(target?: Element): ErdSelection | undefined {
    const item = target?.closest<SVGElement>('[data-attribute-id],[data-entity-id],[data-relationship-id]');
    if (item?.dataset.attributeId && item.dataset.entityId)
      return { kind: 'attribute', entityId: item.dataset.entityId, attributeId: item.dataset.attributeId };
    if (item?.dataset.entityId) return { kind: 'entity', entityId: item.dataset.entityId };
    if (item?.dataset.relationshipId) return { kind: 'relationship', relationshipId: item.dataset.relationshipId };
    return undefined;
  }
  function activate(event: Event, edit = false) {
    const target = targetElement(event);
    const handle = target?.closest<SVGElement>('[data-connect-entity]');
    if (handle?.dataset.connectEntity) {
      connect({
        entityId: handle.dataset.connectEntity,
        ...(handle.dataset.connectAttribute ? { attributeId: handle.dataset.connectAttribute } : {}),
        cardinality: 'one'
      });
      return;
    }
    // Pointer capture retargets header clicks to the SVG, including the second click.
    const next =
      selectionAt(target) ??
      (target === svg && releasedHeader ? { kind: 'entity' as const, entityId: releasedHeader } : undefined);
    if (!next) return;
    selectItem(next);
    if (edit) openForm(next);
    else {
      const id =
        next.kind === 'relationship'
          ? `relationship:${next.relationshipId}`
          : next.kind === 'entity'
            ? `entity:${next.entityId}`
            : `attribute:${next.entityId}:${next.attributeId}`;
      Array.from(svg.querySelectorAll<SVGElement>('[data-scene-id]'))
        .find((node) => node.dataset.sceneId === id)
        ?.focus();
    }
  }
  svg.addEventListener('click', (event) => activate(event), { signal });
  svg.addEventListener('dblclick', (event) => activate(event, true), { signal });
  function point(event: PointerEvent | WheelEvent, inverse: DOMMatrix) {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  }
  function visualOperation(target?: Element): ((dx: number, dy: number) => ErdOperation) | undefined {
    const handle = target?.closest<SVGElement>(
      '[data-resize-entity],[data-bend-relationship],[data-label-relationship]'
    );
    if (!handle) return;
    const data = structuredClone(options.getState().data);
    const geometry = diagramGeometry(data);
    if (handle.dataset.resizeEntity) {
      const entity = data.entities.find((item) => item.id === handle.dataset.resizeEntity)!;
      const box = geometry.entities.find((item) => item.id === entity.id)!;
      return (dx, dy) => ({
        op: 'present-entity',
        entityId: entity.id,
        presentation: {
          width: Math.max(200, Math.min(4096, box.width + dx)),
          height: Math.max(64, Math.min(8192, box.height + dy)),
          ...(entity.appearance ? { appearance: entity.appearance } : {})
        }
      });
    }
    const id = handle.dataset.bendRelationship ?? handle.dataset.labelRelationship;
    const relationship = data.relationships.find((item) => item.id === id)!;
    const route = geometry.relationships.find((item) => item.id === id)!;
    return (dx, dy) => {
      const presentation = {
        ...(relationship.appearance ? { appearance: relationship.appearance } : {}),
        ...(relationship.bends ? { bends: relationship.bends } : {}),
        ...(relationship.labelPosition ? { labelPosition: relationship.labelPosition } : {})
      };
      if (handle.dataset.bendRelationship) {
        const bends = structuredClone(relationship.bends?.length ? relationship.bends : route.points.slice(1, -1));
        const index = Number(handle.dataset.bendIndex);
        bends[index] = { x: bends[index].x + dx, y: bends[index].y + dy };
        presentation.bends = bends;
      } else presentation.labelPosition = { x: route.label.x + dx, y: route.label.y + dy };
      return { op: 'present-relationship', relationshipId: relationship.id, presentation };
    };
  }
  svg.addEventListener(
    'pointerdown',
    (event) => {
      releasedHeader = undefined;
      if (event.button !== 0 || pending || !panel.hidden) return;
      const target = targetElement(event);
      if (target?.closest('[data-connect-entity]')) return;
      const entityId = target?.closest<SVGElement>('[data-drag-entity]')?.dataset.dragEntity;
      const state = options.getState();
      const inverse = svg.getScreenCTM()?.inverse();
      if (!inverse) return;
      const operation = visualOperation(target);
      if (operation && !state.readOnly) {
        drag = {
          entityId: '',
          pointerId: event.pointerId,
          revision: state.revision,
          x: 0,
          y: 0,
          start: point(event, inverse),
          inverse,
          dx: 0,
          dy: 0,
          operation
        };
      } else if (entityId && !state.readOnly) {
        const entity = state.data.entities.find((item) => item.id === entityId);
        if (!entity) return;
        selectItem({ kind: 'entity', entityId });
        drag = {
          entityId,
          pointerId: event.pointerId,
          revision: state.revision,
          x: entity.x,
          y: entity.y,
          start: point(event, inverse),
          inverse,
          dx: 0,
          dy: 0
        };
      } else if (options.expanded && !selectionAt(target) && view) {
        pan = { pointerId: event.pointerId, start: point(event, inverse), inverse, x: view.x, y: view.y };
      } else return;
      svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    { signal }
  );
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (drag?.pointerId === event.pointerId) {
        const position = point(event, drag.inverse);
        drag.dx = position.x - drag.start.x;
        drag.dy = position.y - drag.start.y;
        try {
          draw();
        } catch (error) {
          finishGesture(undefined, true);
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      } else if (pan?.pointerId === event.pointerId && view) {
        const position = point(event, pan.inverse);
        view.x = pan.x - (position.x - pan.start.x);
        view.y = pan.y - (position.y - pan.start.y);
        viewBox();
      }
    },
    { signal }
  );
  function finishGesture(event?: PointerEvent, cancel = false) {
    const current = drag;
    const pointerId = drag?.pointerId ?? pan?.pointerId;
    if (pointerId === undefined || (event && event.pointerId !== pointerId)) return;
    drag = undefined;
    pan = undefined;
    if (current && !cancel && current.dx === 0 && current.dy === 0) releasedHeader = current.entityId;
    if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    if (current && !cancel && (Math.abs(current.dx) > 0.1 || Math.abs(current.dy) > 0.1))
      run(
        current.operation ? 'Change diagram presentation' : 'Move entity',
        current.operation
          ? [current.operation(current.dx, current.dy)]
          : [
              {
                op: 'move-entity',
                entityId: current.entityId,
                x: Math.round((current.x + current.dx) * 100) / 100,
                y: Math.round((current.y + current.dy) * 100) / 100
              }
            ],
        current.revision
      );
    if (current && (cancel || current.dx !== 0 || current.dy !== 0)) draw();
  }
  svg.addEventListener('pointerup', (event) => finishGesture(event), { signal });
  svg.addEventListener('pointercancel', (event) => finishGesture(event, true), { signal });
  svg.addEventListener('lostpointercapture', (event) => finishGesture(event, true), { signal });
  svg.addEventListener(
    'wheel',
    (event) => {
      if (!options.expanded || !view || drag || pan) return;
      const inverse = svg.getScreenCTM()?.inverse();
      if (!inverse) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = point(event, inverse);
      const factor = Math.exp(Math.max(-0.25, Math.min(0.25, event.deltaY * 0.001)));
      const width = Math.max(80, Math.min(100000, view.width * factor));
      const scale = width / view.width;
      view = {
        x: anchor.x - (anchor.x - view.x) * scale,
        y: anchor.y - (anchor.y - view.y) * scale,
        width,
        height: view.height * scale
      };
      viewBox();
    },
    { signal, passive: false }
  );
  frame.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        if (drag || pan) finishGesture(undefined, true);
        else if (!panel.hidden) form?.requestClose();
        else if (connecting) {
          connecting = false;
          source = undefined;
          draw();
        } else return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = targetElement(event);
      const operation = visualOperation(target);
      if (operation && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (!options.getState().readOnly && !pending) {
          const distance = event.shiftKey ? 10 : 1;
          run('Change diagram presentation', [
            operation(
              event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
              event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0
            )
          ]);
        }
        return;
      }
      // Text controls own Delete/Backspace and Enter; the host must never delete the outer diagram here.
      if (target?.closest('input,textarea,select,form')) {
        event.stopPropagation();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        if (selection) openForm(selection, true);
      } else if ((event.key === 'Enter' || event.key === ' ') && target?.closest('svg')) {
        event.preventDefault();
        event.stopPropagation();
        activate(event, true);
      }
    },
    { signal }
  );
  function update() {
    const state = options.getState();
    const { colors, typography } = state.theme;
    for (const [key, value] of Object.entries({
      surface: colors.surface,
      text: colors.text,
      border: colors.border,
      accent: colors.accent,
      muted: colors.surfaceMuted,
      font: typography.bodyFont
    }))
      frame.style.setProperty(`--erd-${key}`, value);
    if (state.readOnly && (drag || pan)) finishGesture(undefined, true);
    if (state.readOnly) {
      connecting = false;
      source = undefined;
    }
    if (selection) {
      const selected = selection;
      const exists =
        selected.kind === 'relationship'
          ? state.data.relationships.some((item) => item.id === selected.relationshipId)
          : state.data.entities.some(
              (item) =>
                item.id === selected.entityId &&
                (selected.kind === 'entity' ||
                  item.attributes.some((attribute) => attribute.id === selected.attributeId))
            );
      if (!exists) selection = undefined;
    }
    draw();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    finishGesture(undefined, true);
    lifetime.abort();
    options.signal.removeEventListener('abort', dispose);
    root.replaceChildren();
  }
  options.signal.addEventListener('abort', dispose, { once: true });
  update();
  if (options.signal.aborted) dispose();
  return { update, dispose, hasUnsavedChanges: () => Boolean(form?.hasUnsavedChanges() || drag || pending) };
}
