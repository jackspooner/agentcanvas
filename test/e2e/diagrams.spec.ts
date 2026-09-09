import type { CanvasOperation, CanvasRecord } from '@agentcanvas/core';
import type { CanvasElement } from '@agentcanvas/plugin-sdk';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import type { ErdData, MermaidData } from '../../plugin-packages/diagrams/src/contracts.js';

const erd: ErdData = {
  title: 'Library',
  entities: [
    {
      id: 'authors',
      name: 'Authors',
      x: 40,
      y: 40,
      attributes: [{ id: 'id', name: 'id', dataType: 'uuid', keys: ['PK'], nullable: false }]
    },
    {
      id: 'books',
      name: 'Books',
      x: 440,
      y: 40,
      attributes: [{ id: 'author_id', name: 'author_id', dataType: 'uuid', keys: ['FK'], nullable: true }]
    }
  ],
  relationships: []
};

async function read(request: APIRequestContext, id: string): Promise<CanvasRecord> {
  const response = await request.get(`/api/v1/canvases/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).canvas;
}
async function batch(request: APIRequestContext, id: string, operations: CanvasOperation[]) {
  const canvas = await read(request, id);
  const response = await request.post(`/api/v1/canvases/${id}/elements:batch`, {
    data: { expectedRevision: canvas.revision, operations, actor: 'diagrams-e2e' }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function seed(request: APIRequestContext, element: Record<string, unknown>, zoom = 0.8): Promise<string> {
  const response = await request.post('/api/v1/canvases', { data: { title: 'Diagrams browser proof' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const id = (await response.json()).canvas.id as string;
  await batch(request, id, [{ op: 'upsertElement', element }]);
  const viewport = await request.post(`/api/v1/canvases/${id}/viewport`, {
    data: { centerX: 480, centerY: 320, zoom, width: 1440, height: 900 }
  });
  expect(viewport.ok(), await viewport.text()).toBeTruthy();
  return id;
}
function native(element: CanvasElement): ErdData {
  return element.data as unknown as ErdData;
}

test('creates native entities and attributes from the public extension command', async ({ page, request }) => {
  const response = await request.post('/api/v1/canvases', { data: { title: 'New ERD' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const id = (await response.json()).canvas.id as string;
  await page.goto(`/canvases/${id}`);
  await page.getByLabel('Extension commands', { exact: true }).selectOption('agentcanvas.diagrams.create-erd');
  const dialog = page.getByRole('dialog', { name: 'Edit Entity relationship diagram', exact: true });
  await dialog.getByRole('button', { name: 'Add entity', exact: true }).click();
  await dialog.getByLabel('Entity name', { exact: true }).fill('Publishers');
  await dialog.getByLabel('Alias', { exact: true }).fill('publisher');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).entities.length).toBe(1);
  await dialog.getByRole('button', { name: 'Entity Publishers', exact: true }).dblclick();
  await dialog.getByRole('button', { name: 'Add attribute', exact: true }).click();
  await dialog.getByLabel('Attribute name', { exact: true }).fill('id');
  await dialog.getByLabel('Data type', { exact: true }).fill('uuid');
  await dialog.getByLabel('PK', { exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Nullable', exact: true }).selectOption('no');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).entities[0].attributes.length).toBe(1);
  const saved = (await currentErd(request, id)).entities[0];
  expect(saved).toMatchObject({
    name: 'Publishers',
    alias: 'publisher',
    attributes: [{ name: 'id', dataType: 'uuid', keys: ['PK'], nullable: false }]
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Attribute Publishers.id', exact: true })).toBeVisible();
});
async function currentErd(request: APIRequestContext, id: string): Promise<ErdData> {
  const element = (await read(request, id)).elements.find((item) => item.type === 'agentcanvas.diagrams/erd');
  if (!element) throw new Error('Missing native ERD');
  return native(element);
}
async function dragEntity(page: Page, header: Locator, dx: number, dy: number, beforeRelease?: () => Promise<void>) {
  const points = await header.evaluate(
    (element, delta) => {
      const rect = element as SVGRectElement;
      const matrix = rect.getScreenCTM();
      if (!matrix) throw new Error('Header has no screen transform');
      const x = rect.x.baseVal.value + rect.width.baseVal.value / 2;
      const y = rect.y.baseVal.value + rect.height.baseVal.value / 2;
      const start = new DOMPoint(x, y).matrixTransform(matrix);
      const end = new DOMPoint(x + delta.dx, y + delta.dy).matrixTransform(matrix);
      return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
    },
    { dx, dy }
  );
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 4 });
  await beforeRelease?.();
  await page.mouse.up();
}

for (const frame of [
  { width: 960, height: 640, rotation: 0, zoom: 0.65 },
  { width: 780, height: 540, rotation: 19, zoom: 0.9 }
]) {
  test(`native drag respects zoom ${frame.zoom}, frame ${frame.width} and rotation ${frame.rotation}`, async ({
    page,
    request
  }) => {
    const id = await seed(
      request,
      {
        id: 'erd',
        type: 'agentcanvas.diagrams/erd',
        schemaVersion: 2,
        x: 0,
        y: 0,
        width: frame.width,
        height: frame.height,
        rotation: frame.rotation,
        data: erd
      },
      frame.zoom
    );
    await page.goto(`/canvases/${id}`);
    const diagram = page.locator('.react-flow__node[data-id="erd"]');
    const header = diagram.locator('[data-drag-entity="authors"]');
    await expect(header).toBeVisible();
    const before = await read(request, id);
    const viewBox = await diagram.locator('.erd-stage').getAttribute('viewBox');
    await dragEntity(page, header, 36, 24, async () => {
      expect((await read(request, id)).revision).toBe(before.revision);
      expect(await diagram.locator('.erd-stage').getAttribute('viewBox')).toBe(viewBox);
    });
    await expect.poll(async () => (await currentErd(request, id)).entities[0].x).toBeCloseTo(76, 0);
    const after = await read(request, id);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.elements[0]).toMatchObject({
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation
    });
    expect(native(after.elements[0]).entities[0].y).toBeCloseTo(64, 0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await currentErd(request, id)).entities[0].x).toBe(40);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await currentErd(request, id)).entities[0].x).toBeCloseTo(76, 0);
    await page.reload();
    await expect(header).toBeVisible();
    expect((await currentErd(request, id)).entities[0].y).toBeCloseTo(64, 0);
  });
}

test('native forms, connection handles, cascade confirmation and transient expanded view use the saved document', async ({
  page,
  request
}) => {
  const id = await seed(request, {
    id: 'erd',
    type: 'agentcanvas.diagrams/erd',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    data: erd
  });
  await page.goto(`/canvases/${id}`);
  const expand = page.getByRole('button', { name: 'Expand', exact: true });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: 'Edit Library', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(expand).toBeFocused();
  await expand.click();
  await dialog.getByRole('button', { name: 'Attribute Authors.id', exact: true }).dblclick();
  await dialog.getByLabel('Attribute name', { exact: true }).fill('author_key');
  await dialog.getByLabel('UK', { exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Nullable', exact: true }).selectOption('unspecified');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).entities[0].attributes[0].name).toBe('author_key');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect Authors attribute author_key', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect Books attribute author_id', exact: true }).click();
  await dialog.getByLabel('Relationship label', { exact: true }).fill('writes');
  await dialog.getByRole('combobox', { name: 'Target cardinality', exact: true }).selectOption('zero-or-many');
  await dialog.getByLabel('Identifying relationship', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).relationships.length).toBe(1);
  const saved = await read(request, id);
  const current = native(saved.elements[0]);
  expect(current.entities[0].attributes[0]).toMatchObject({ keys: ['PK', 'UK'], nullable: null });
  expect(current.relationships[0]).toMatchObject({
    source: { entityId: 'authors', attributeId: 'id' },
    target: { entityId: 'books', attributeId: 'author_id', cardinality: 'zero-or-many' },
    identifying: true
  });
  const stage = dialog.locator('.erd-stage');
  const fitted = await stage.getAttribute('viewBox');
  await stage.hover();
  await page.mouse.wheel(0, -250);
  await expect(stage).not.toHaveAttribute('viewBox', fitted ?? '');
  expect((await read(request, id)).revision).toBe(saved.revision);
  await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Attribute Authors.author_key', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(
    dialog.getByText('Delete this attribute? 1 connected relationship(s) will also be deleted.', { exact: true })
  ).toBeVisible();
  expect((await read(request, id)).elements).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).relationships.length).toBe(0);
  expect((await currentErd(request, id)).entities[0].attributes).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).relationships.length).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Attribute Authors.author_key', exact: true })).toBeVisible();
});

test('Mermaid preview rejects invalid drafts, retains source on close and converts ERD as a second element', async ({
  page,
  request
}) => {
  const source = 'erDiagram\n  AUTHOR ||--o{ BOOK : writes';
  const id = await seed(request, {
    id: 'mermaid',
    type: 'agentcanvas.diagrams/mermaid',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 720,
    height: 480,
    data: { title: 'Mermaid library', source }
  });
  await page.goto(`/canvases/${id}`);
  await expect(page.getByRole('img', { name: 'er diagram', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Mermaid library', exact: true });
  await dialog.getByLabel('Mermaid source', { exact: true }).fill('erDiagram\n  AUTHOR ||--');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog.getByText('Discard unsaved diagram changes?', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  const changed = `${source}\n  BOOK {\n    int id PK\n  }`;
  await dialog.getByLabel('Mermaid source', { exact: true }).fill(changed);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await read(request, id)).elements[0].data.source).toBe(changed);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByLabel('Extension commands', { exact: true }).selectOption('agentcanvas.diagrams.convert-mermaid-erd');
  const conversion = page.getByRole('dialog', { name: 'Convert Mermaid ERD', exact: true });
  await expect(conversion).toBeVisible();
  const losses = conversion.getByLabel('I accept these conversion losses.', { exact: true });
  if (await losses.isVisible()) await losses.check();
  await conversion.getByRole('button', { name: 'Create editable ERD', exact: true }).click();
  await expect.poll(async () => (await read(request, id)).elements.length).toBe(2);
  const converted = await read(request, id);
  expect(converted.elements.find((item) => item.id === 'mermaid')?.data.source).toBe(changed);
  expect(
    native(converted.elements.find((item) => item.type === 'agentcanvas.diagrams/erd') as CanvasElement)
      .entities.map((entity) => entity.name)
      .sort()
  ).toEqual(['AUTHOR', 'BOOK']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entity BOOK', exact: true })).toBeVisible();
});

test('locked and shared diagrams retain Fit and expanded viewing while editing is disabled', async ({
  page,
  request
}) => {
  const id = await seed(request, {
    id: 'erd',
    type: 'agentcanvas.diagrams/erd',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    locked: true,
    data: erd
  });
  await page.goto(`/canvases/${id}`);
  await expect(page.getByRole('button', { name: 'Add entity', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Library', exact: true });
  await expect(dialog.getByRole('button', { name: 'Add entity', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await batch(request, id, [{ op: 'patchElementFrame', elementId: 'erd', frame: { locked: false } }]);
  const share = await request.post(`/api/v1/canvases/${id}/share-links`, { data: {} });
  expect(share.ok(), await share.text()).toBeTruthy();
  await page.goto((await share.json()).share.url);
  await expect(page.getByRole('button', { name: 'Add entity', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Add relationship', exact: true })).toBeDisabled();
});

test('native box resize, appearance, connector bends and labels persist and undo', async ({ page, request }) => {
  const value: ErdData = structuredClone(erd);
  value.relationships.push({
    id: 'writes',
    source: { entityId: 'authors', cardinality: 'one' },
    target: { entityId: 'books', cardinality: 'zero-or-many' },
    label: 'writes',
    identifying: false
  });
  const id = await seed(request, {
    id: 'erd',
    type: 'agentcanvas.diagrams/erd',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    data: value
  });
  await page.goto(`/canvases/${id}`);
  const box = page.locator('[data-drag-entity="authors"]');
  await box.click();
  const resize = page.locator('[data-resize-entity="authors"]');
  await expect(resize).toBeVisible();
  const before = await read(request, id);
  await dragEntity(page, resize, 45, 35);
  await expect.poll(async () => (await currentErd(request, id)).entities[0].width).toBeCloseTo(325, 0);
  expect((await read(request, id)).revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).entities[0].width).toBeUndefined();
  await box.dblclick();
  await page.getByLabel('Box color', { exact: true }).fill('#334455');
  await page.getByLabel('Font size', { exact: true }).fill('18');
  await page.getByRole('combobox', { name: 'Border style', exact: true }).selectOption('dashed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await currentErd(request, id)).entities[0].appearance?.fill).toBe('#334455');
  await page.getByRole('button', { name: 'Relationship writes', exact: true }).click();
  const label = page.getByRole('button', { name: 'Move relationship label; arrow keys move', exact: true });
  await label.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await currentErd(request, id)).relationships[0].labelPosition?.y).toBeDefined();
  const bend = page.getByRole('button', { name: 'Move bend 1; arrow keys move', exact: true });
  await bend.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await currentErd(request, id)).relationships[0].bends?.length).toBeGreaterThan(0);
  const saved = await currentErd(request, id);
  await page.reload();
  expect(await currentErd(request, id)).toEqual(saved);
});

test('Mermaid boxes resize and move, styles and routing save, undo and source reset remain explicit', async ({
  page,
  request
}) => {
  const source = 'flowchart LR\nA[First] -->|connects| B[Second]';
  const id = await seed(request, {
    id: 'mermaid',
    type: 'agentcanvas.diagrams/mermaid',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    data: { title: 'Visual Mermaid', source }
  });
  const current = async () => (await read(request, id)).elements[0].data as unknown as MermaidData;
  await page.goto(`/canvases/${id}`);
  const box = page.locator('[data-visual-node="A"]');
  await expect(box).toBeVisible();
  const before = await read(request, id);
  await dragEntity(page, box, 40, 20);
  await expect.poll(async () => (await current()).presentation?.nodes[0].x).toBeCloseTo(48, 0);
  expect((await read(request, id)).revision).toBe(before.revision + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await current()).presentation).toBeUndefined();
  await box.click();
  await expect(page.locator('[data-visual-resize="A"]')).toBeVisible();
  await dragEntity(page, page.locator('[data-visual-resize="A"]'), 30, 20);
  await expect.poll(async () => (await current()).presentation?.nodes[0].width).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await page.getByLabel('Box color', { exact: true }).fill('#aa3344');
  await page.getByLabel('Font family', { exact: true }).fill('monospace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await current()).presentation?.nodes[0].appearance?.fill).toBe('#aa3344');
  await page.getByRole('button', { name: 'Connector connects', exact: true }).click();
  await page.getByRole('button', { name: 'Move connector label', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await current()).presentation?.edges[0]?.labelPosition).toBeDefined();
  await page.getByRole('button', { name: 'Move bend 1', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await current()).presentation?.edges[0]?.bends?.length).toBeGreaterThan(0);
  const saved = await current();
  await page.reload();
  await expect(box).toBeVisible();
  expect(await current()).toEqual(saved);
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  const visual = page.getByRole('dialog', { name: 'Edit Visual Mermaid', exact: true });
  await expect(visual.locator('[data-visual-node="A"]')).toBeVisible();
  await visual.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Visual Mermaid', exact: true });
  await dialog.getByLabel('Mermaid source', { exact: true }).fill(`${source}\nB-->C`);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByLabel('Reset visual overrides (required when changing source)', { exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await current()).source).toBe(`${source}\nB-->C`);
  expect((await current()).presentation).toBeUndefined();
});

test('Mermaid drag retains its starting revision when a remote save arrives before movement', async ({
  page,
  request
}) => {
  const source = 'flowchart LR\nA[First] --> B[Second]';
  const id = await seed(request, {
    id: 'mermaid',
    type: 'agentcanvas.diagrams/mermaid',
    schemaVersion: 2,
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    data: { title: 'Original', source }
  });
  await page.goto(`/canvases/${id}`);
  const box = page.locator('[data-visual-node="A"]');
  await expect(box).toBeVisible();
  const rect = await box.boundingBox();
  if (!rect) throw new Error('Missing box');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await batch(request, id, [
    { op: 'replaceElementData', elementId: 'mermaid', data: { title: 'Remote edit', source } }
  ]);
  await expect(
    page.getByText('The diagram changed. Your visual draft is preserved; discard it to load the current diagram.', {
      exact: true
    })
  ).toBeVisible();
  await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2 + 20);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Discard visual draft', exact: true })).toBeEnabled();
  await expect(page.locator('.erd-status')).toContainText(/revision|changed|conflict/i);
  const saved = await read(request, id);
  expect(saved.elements[0].data).toEqual({ title: 'Remote edit', source });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect((await read(request, id)).revision).toBe(saved.revision);
});
