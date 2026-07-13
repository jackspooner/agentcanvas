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
  await expect(page.getByTestId('registry-count')).toHaveText('12 renderers');
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
  await expect(page.locator('[data-element-id="bbox-1"] svg')).toBeVisible();
  await expect(page.locator('[data-element-id="path-1"] svg')).toBeVisible();
  await expect(page.locator('[data-element-id="video-1"] video')).toHaveAttribute('src', /^blob:/);

  const failedCard = page.locator('[data-element-id="fail-1"] [role="status"]');
  await expect(failedCard).toContainText('Renderer error');
  await expect(failedCard).toContainText('The browser renderer for fixture.fail/card failed.');
  await expect(page.locator('[data-element-id="text-1"] .content')).toBeVisible();
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
  await expect.poll(async () => (await persistedElement(page, 'text-1')).x).toBe(originalText.x + 54);
  await expect.poll(async () => (await persistedElement(page, 'text-1')).y).toBe(originalText.y + 31);

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
  await expect(page.getByTestId('registry-count')).toHaveText('11 renderers');
  const missingCard = page.locator('[data-element-id="video-1"] [role="status"]');
  await expect(missingCard).toContainText('Plugin unavailable');
  await expect(missingCard).toContainText('No active browser renderer is available for agentcanvas.video/video.');
  expect(JSON.stringify(await persistedElement(page, 'video-1'))).toBe(before);

  await page.goto('/?canvas=all');
  await expect(page.getByTestId('registry-count')).toHaveText('12 renderers');
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
