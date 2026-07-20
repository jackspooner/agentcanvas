import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __revokedObjectUrls: string[];
    __textSurface?: HTMLElement;
    __textRoot?: ShadowRoot;
  }
}

interface PersistedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

async function persistedElements(page: Page): Promise<PersistedElement[]> {
  const value = await page.getByTestId('persisted-elements').textContent();
  return JSON.parse(value ?? '[]') as PersistedElement[];
}

async function persistedElement(page: Page, id: string): Promise<PersistedElement> {
  const element = (await persistedElements(page)).find((candidate) => candidate.id === id);
  if (!element) throw new Error(`Persisted fixture element ${id} was not found`);
  return element;
}

async function openFixture(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?canvas=all');
  await expect(page.getByTestId('registry-count')).toHaveText('13 renderers');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    window.__revokedObjectUrls = [];
    URL.revokeObjectURL = (url: string) => {
      window.__revokedObjectUrls.push(url);
      original(url);
    };
  });
});

test('loads the registry catalog and browser modules from same-origin build-hash URLs', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));

  await openFixture(page);

  const catalogResponse = await page.request.get('/api/v1/plugins');
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = (await catalogResponse.json()) as { plugins: Array<{ id: string; browserEntryUrl: string }> };
  expect(catalog.plugins.map((plugin) => plugin.id)).toEqual([
    'agentcanvas.primitives',
    'agentcanvas.markdown',
    'agentcanvas.table',
    'agentcanvas.assets2',
    'agentcanvas.gallery',
    'agentcanvas.image-overlays',
    'agentcanvas.video',
    'agentcanvas.glb-viewer',
    'fixture.fail'
  ]);
  expect(catalog.plugins.every((plugin) => plugin.browserEntryUrl.startsWith('/api/v1/plugin-modules/'))).toBe(true);
  const requestedPluginModules = requests.filter((pathname) => pathname.startsWith('/api/v1/plugin-modules/'));
  expect(new Set(requestedPluginModules)).toEqual(new Set(catalog.plugins.map((plugin) => plugin.browserEntryUrl)));
});

test('renders default and optional elements while isolating one failing browser plugin', async ({ page }) => {
  await openFixture(page);

  await expect(page.locator('[data-element-id="text-1"] .content')).toHaveText('Initial text');
  await expect(page.locator('[data-element-id="shape-rect"] .content')).toHaveClass(/\brect\b/);
  await expect(page.locator('[data-element-id="shape-ellipse"] .content')).toHaveClass(/\bellipse\b/);
  await expect(page.locator('[data-element-id="markdown-1"] article h1')).toHaveText('Markdown');
  await expect(page.locator('[data-element-id="table-1"] caption')).toHaveText('Fixture table');
  await expect(page.locator('[data-element-id="asset-1"] .placeholder')).toContainText('asset unavailable');
  const assetNodeBox = await page.locator('[data-element-id="asset-1"]').boundingBox();
  const assetFrameBox = await page.locator('[data-element-id="asset-1"] figure.frame').boundingBox();
  if (!assetNodeBox || !assetFrameBox) throw new Error('Asset renderer frame has no bounding box');
  expect(assetFrameBox).toEqual({
    x: assetNodeBox.x + 1,
    y: assetNodeBox.y + 1,
    width: assetNodeBox.width - 2,
    height: assetNodeBox.height - 2
  });
  await expect(page.locator('[data-element-id="bbox-1"] .plugin-renderer-surface svg')).toBeVisible();
  await expect(page.locator('[data-element-id="path-1"] .plugin-renderer-surface svg')).toBeVisible();
  await expect(page.locator('[data-element-id="video-1"] video')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('[data-element-id="gallery-1"] img')).toHaveAttribute('alt', 'First gallery image');

  const failedCard = page.locator('[data-element-id="fail-1"] [role="status"]');
  await expect(failedCard).toContainText('Renderer error');
  await expect(failedCard).toContainText('The browser renderer for fixture.fail/card failed.');
  await expect(page.locator('[data-element-id="text-1"] .content')).toBeVisible();
});

test('applies one canvas theme to the board and extension defaults', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('.agentcanvas-editor')).toHaveCSS('background-color', 'rgb(240, 253, 244)');
  const table = page.locator('[data-element-id="table-1"]');
  await expect(table.locator('th').first()).toHaveCSS('background-color', 'rgb(20, 83, 45)');
  await expect(table.locator('th').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(table.locator('.frame')).toHaveCSS('border-color', 'rgb(134, 239, 172)');
  await expect(table.locator('.frame')).toHaveCSS('border-width', '2px');
});

test('navigates a gallery without mutating its canonical canvas state', async ({ page }) => {
  await openFixture(page);
  const revisionBefore = await page.getByTestId('canvas-revision').textContent();
  const before = JSON.stringify(await persistedElement(page, 'gallery-1'));
  const gallery = page.locator('[data-element-id="gallery-1"]');
  await expect(gallery.locator('img')).toHaveAttribute('alt', 'First gallery image');
  await expect(gallery.getByText('1 / 2', { exact: true })).toBeVisible();
  await gallery.getByRole('button', { name: 'Next image' }).click();
  await expect(gallery.locator('img')).toHaveAttribute('alt', 'Second gallery image');
  await expect(gallery.getByText('2 / 2', { exact: true })).toBeVisible();
  expect(JSON.stringify(await persistedElement(page, 'gallery-1'))).toBe(before);
  expect(await page.getByTestId('canvas-revision').textContent()).toBe(revisionBefore);
});

test('updates a Shadow DOM renderer without remounting its surface or root', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('[data-element-id="text-1"] .content')).toHaveText('Initial text');

  await page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('[data-element-id="text-1"] .plugin-renderer-surface');
    if (!surface?.shadowRoot) throw new Error('Text renderer surface was not mounted');
    window.__textSurface = surface;
    window.__textRoot = surface.shadowRoot;
  });

  await page.getByTestId('update-text').click();
  await expect(page.locator('[data-element-id="text-1"] .content')).toHaveText('Updated without remount');
  expect(
    await page.evaluate(() => {
      const current = document.querySelector<HTMLElement>('[data-element-id="text-1"] .plugin-renderer-surface');
      return current === window.__textSurface && current?.shadowRoot === window.__textRoot;
    })
  ).toBe(true);
});

test('uses the host drag handle but leaves composed-path interactive media alone', async ({ page }) => {
  await openFixture(page);

  const originalText = await persistedElement(page, 'text-1');
  const handle = page.getByRole('button', { name: 'Move text-1' });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Text drag handle has no bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 54, handleBox.y + handleBox.height / 2 + 31, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await persistedElement(page, 'text-1')).x).toBeGreaterThan(originalText.x);
  await expect.poll(async () => (await persistedElement(page, 'text-1')).y).toBeGreaterThan(originalText.y);
  expect(Math.abs((await persistedElement(page, 'text-1')).x % 10)).toBe(0);
  expect(Math.abs((await persistedElement(page, 'text-1')).y % 10)).toBe(0);

  const originalVideo = await persistedElement(page, 'video-1');
  const viewportBefore = await page.locator('.viewport-status').textContent();
  const video = page.locator('[data-element-id="video-1"] video');
  const videoBox = await video.boundingBox();
  if (!videoBox) throw new Error('Video renderer has no bounding box');
  await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(videoBox.x + videoBox.width / 2 + 70, videoBox.y + videoBox.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  expect(await persistedElement(page, 'video-1')).toMatchObject({ x: originalVideo.x, y: originalVideo.y });
  expect(await page.locator('.viewport-status').textContent()).toBe(viewportBefore);
});

test('zooms the canvas when the wheel is over non-interactive node content', async ({ page }) => {
  await openFixture(page);

  const statusBefore = await page.locator('.viewport-status').textContent();
  const text = page.locator('[data-element-id="text-1"] .content');
  const textBox = await text.boundingBox();
  if (!textBox) throw new Error('Text renderer has no bounding box');
  await page.mouse.move(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
  await page.mouse.wheel(0, -240);

  await expect.poll(async () => page.locator('.viewport-status').textContent()).not.toBe(statusBefore);
});

test('uses canonical commands for duplicate, delete, undo, and redo', async ({ page }) => {
  await openFixture(page);
  const originalCount = (await persistedElements(page)).length;

  await page.locator('[data-element-id="text-1"]').click();
  const duplicate = page.getByRole('button', { name: 'Duplicate' });
  await expect(duplicate).toBeEnabled();
  await duplicate.click();
  await expect.poll(async () => (await persistedElements(page)).length).toBe(originalCount + 1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await persistedElements(page)).length).toBe(originalCount);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(async () => (await persistedElements(page)).length).toBe(originalCount + 1);

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await persistedElements(page)).length).toBe(originalCount);
});

test('persists keyboard movement and resize controls', async ({ page }) => {
  await openFixture(page);
  const original = await persistedElement(page, 'text-1');
  const frame = page.locator('[data-element-id="text-1"]');
  await frame.click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await persistedElement(page, 'text-1')).x).toBe(original.x + 1);

  const beforeResize = await persistedElement(page, 'text-1');
  const resizeHandle = frame.locator('.agentcanvas-editor-resize-handle').last();
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error('Resize handle has no bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 40, handleBox.y + handleBox.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await persistedElement(page, 'text-1')).width ?? 0)
    .toBeGreaterThan(beforeResize.width ?? 0);
  await expect
    .poll(async () => (await persistedElement(page, 'text-1')).height ?? 0)
    .toBeGreaterThan(beforeResize.height ?? 0);
});

test('supports additive multi-selection and moves selected nodes together', async ({ page }) => {
  await openFixture(page);
  const textBefore = await persistedElement(page, 'text-1');
  const shapeBefore = await persistedElement(page, 'shape-rect');
  const revisionBefore = Number(await page.getByTestId('canvas-revision').textContent());

  await page.locator('[data-element-id="text-1"]').click();
  await page.locator('[data-element-id="shape-rect"]').click({ modifiers: ['Control'] });
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

  const handle = page.getByRole('button', { name: 'Move text-1' });
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Text drag handle has no bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 45, handleBox.y + handleBox.height / 2 + 25, { steps: 4 });
  await expect(page.getByTestId('canvas-revision')).toHaveText(String(revisionBefore));
  await page.mouse.up();

  await expect.poll(async () => (await persistedElement(page, 'text-1')).x).toBeGreaterThan(textBefore.x);
  await expect.poll(async () => (await persistedElement(page, 'shape-rect')).x).toBeGreaterThan(shapeBefore.x);
  await expect(page.getByTestId('canvas-revision')).toHaveText(String(revisionBefore + 1));
});

test('uses Shift-drag marquee selection', async ({ page }) => {
  await openFixture(page);
  const text = page.locator('[data-element-id="text-1"]');
  const shape = page.locator('[data-element-id="shape-rect"]');
  const textBox = await text.boundingBox();
  const shapeBox = await shape.boundingBox();
  if (!textBox || !shapeBox) throw new Error('Marquee fixtures do not have bounding boxes');

  await page.keyboard.down('Shift');
  await page.mouse.move(textBox.x - 12, textBox.y - 12);
  await page.mouse.down();
  await page.mouse.move(shapeBox.x + shapeBox.width + 8, shapeBox.y + shapeBox.height + 8, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(text).toHaveClass(/\bselected\b|\bis-selected\b/);
  await expect(shape).toHaveClass(/\bselected\b|\bis-selected\b/);
});

test('uses the shared command service for clipboard and viewport controls', async ({ page }) => {
  await openFixture(page);
  const countBefore = (await persistedElements(page)).length;
  await page.locator('[data-element-id="text-1"]').click();
  await page.getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('button', { name: 'Paste' }).click();
  await expect.poll(async () => (await persistedElements(page)).length).toBe(countBefore + 1);

  const statusBefore = await page.locator('.viewport-status').textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => page.locator('.viewport-status').textContent()).not.toBe(statusBefore);

  const snap = page.getByRole('button', { name: 'Toggle grid snapping' });
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
});

test('keeps a 500-element canvas responsive with visible-element culling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const startedAt = Date.now();
  await page.goto('/?canvas=performance');
  await expect(page.getByTestId('persisted-elements')).toContainText('performance-499');
  await expect(page.locator('.agentcanvas-editor')).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(10_000);
  expect((await persistedElements(page)).length).toBe(500);
  expect(await page.locator('.react-flow__node').count()).toBeLessThan(500);

  await page.getByRole('button', { name: 'Fit canvas' }).click();
  await page.locator('[data-element-id="performance-0"]').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await persistedElement(page, 'performance-0')).x).toBe(1);
});

test('blocks element movement in read-only mode', async ({ page }) => {
  await openFixture(page);
  const original = await persistedElement(page, 'text-1');

  await page.getByTestId('toggle-readonly').click();
  await expect(page.getByText('read-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move text-1' })).toHaveCount(0);

  const frame = page.locator('[data-element-id="text-1"]');
  const frameBox = await frame.boundingBox();
  if (!frameBox) throw new Error('Text frame has no bounding box');
  await page.mouse.move(frameBox.x + 20, frameBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + 100, frameBox.y + 80, { steps: 4 });
  await page.mouse.up();
  expect(await persistedElement(page, 'text-1')).toMatchObject({ x: original.x, y: original.y });
});

test('preserves optional-plugin data while missing and restores rendering without mutation', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('[data-element-id="video-1"] video')).toHaveAttribute('src', /^blob:/);
  const before = JSON.stringify(await persistedElement(page, 'video-1'));

  await page.goto('/?canvas=all&video=missing');
  await expect(page.getByTestId('registry-count')).toHaveText('12 renderers');
  const missingCard = page.locator('[data-element-id="video-1"] [role="status"]');
  await expect(missingCard).toContainText('Plugin unavailable');
  await expect(missingCard).toContainText('No active browser renderer is available for agentcanvas.video/video.');
  expect(JSON.stringify(await persistedElement(page, 'video-1'))).toBe(before);

  await page.goto('/?canvas=all');
  await expect(page.getByTestId('registry-count')).toHaveText('13 renderers');
  await expect(page.locator('[data-element-id="video-1"] video')).toHaveAttribute('src', /^blob:/);
  expect(JSON.stringify(await persistedElement(page, 'video-1'))).toBe(before);
});

test('applies GLB lifecycle attributes, releases resources, and exposes the deterministic snapshot placeholder policy', async ({
  page
}) => {
  await openFixture(page);
  const viewer = page.locator('[data-element-id="glb-1"] model-viewer');
  await expect(viewer).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('poster', /^blob:/);
  await expect(viewer).toHaveAttribute('camera-controls', '');
  await expect(viewer).toHaveAttribute('auto-rotate', '');
  await expect(viewer).toHaveAttribute('alt', 'Fixture model');

  const policyText = await page.getByTestId('glb-snapshot-policy').textContent();
  const policy = JSON.parse(policyText ?? '{}') as { nodes: Array<{ kind: string; text?: string }> };
  expect(policy.nodes.filter((node) => node.kind === 'path')).toHaveLength(3);
  expect(policy.nodes.some((node) => node.kind === 'text' && node.text === 'GLB fixture')).toBe(true);

  const revokedBefore = await page.evaluate(() => window.__revokedObjectUrls.length);
  await page.getByTestId('toggle-glb').click();
  await expect(page.locator('[data-element-id="glb-1"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__revokedObjectUrls.length)).toBeGreaterThan(revokedBefore);

  await page.getByTestId('toggle-glb').click();
  await expect(page.locator('[data-element-id="glb-1"] model-viewer')).toHaveAttribute('camera-controls', '', {
    timeout: 30_000
  });
});
