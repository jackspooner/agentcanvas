import type { CanvasElement, JsonObject } from '@agentcanvas/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderModelSnapshot } from '../../../plugin-packages/glb-viewer/src/snapshot';
import type { CanvasOperation } from '../../../src/contracts';
import { CanvasView } from '../../../src/web/components/CanvasView';
import {
  fetchBrowserPluginCatalog,
  type LoadedBrowserRegistry,
  loadBrowserPluginRegistry
} from '../../../src/web/plugins/catalog';
import type { CanvasDocument } from '../../../src/web/v2-types';
import { coerceViewport } from '../../../src/web/viewport';
import { TEST_CANVAS_THEME } from '../../fixtures/canvas-theme';
import '../../../src/web/styles.css';
import './fixture.css';

const assetRef = { type: 'asset', project: 'fixture', assetKey: 'e2e/resource' } as const;

function element(
  id: string,
  type: `${string}/${string}`,
  x: number,
  y: number,
  width: number,
  height: number,
  data: JsonObject
): CanvasElement {
  return {
    id,
    type,
    schemaVersion: 1,
    x,
    y,
    width,
    height,
    metadata: {},
    data
  };
}

const defaultElements: CanvasElement[] = [
  element('text-1', 'agentcanvas.primitives/text', -650, -350, 220, 110, { text: 'Initial text' }),
  element('shape-rect', 'agentcanvas.primitives/shape', -390, -350, 180, 110, {
    shape: 'rect',
    label: 'Rectangle'
  }),
  element('shape-ellipse', 'agentcanvas.primitives/shape', -170, -350, 180, 110, {
    shape: 'ellipse',
    label: 'Ellipse'
  }),
  element('markdown-1', 'agentcanvas.markdown/document', 50, -350, 250, 150, {
    markdown: '# Markdown\n\nA **safe** document.'
  }),
  element('table-1', 'agentcanvas.table/table', 340, -350, 260, 160, {
    columns: ['Name', 'Value'],
    rows: [
      ['alpha', '1'],
      ['beta', '2']
    ],
    caption: 'Fixture table'
  }),
  element('asset-1', 'agentcanvas.assets2/asset', -650, -130, 220, 150, {
    assetRef,
    fit: 'contain',
    caption: 'Assets-2 placeholder',
    alt: 'Fixture asset'
  }),
  element('arrow-1', 'agentcanvas.primitives/arrow', 0, 0, 1, 1, {
    from: { elementId: 'text-1', anchor: 'right' },
    to: { elementId: 'markdown-1', anchor: 'left' },
    label: 'anchored connector',
    stroke: '#2563eb',
    strokeWidth: 3
  })
];

const optionalElements: CanvasElement[] = [
  element('video-1', 'agentcanvas.video/video', -390, -130, 260, 180, {
    assetRef,
    posterAssetRef: assetRef,
    caption: 'Video fixture',
    alt: 'Fixture video',
    controls: true,
    autoplay: false,
    loop: false,
    muted: true
  }),
  element('glb-1', 'agentcanvas.glb-viewer/model', -90, -130, 260, 180, {
    assetRef,
    posterAssetRef: assetRef,
    caption: 'GLB fixture',
    alt: 'Fixture model',
    cameraControls: true,
    autoRotate: true
  }),
  element('bbox-1', 'agentcanvas.image-overlays/bbox', 210, -130, 250, 180, {
    canvasWidth: 400,
    canvasHeight: 240,
    boxes: [{ id: 'object-a', x: 48, y: 36, width: 130, height: 90, label: 'object A', color: '#dc2626' }],
    showLabels: true,
    caption: 'Bounding boxes'
  }),
  element('path-1', 'agentcanvas.image-overlays/path', 500, -130, 180, 180, {
    canvasWidth: 200,
    canvasHeight: 200,
    paths: [{ id: 'path-a', d: 'M 20 170 L 90 25 L 170 170 Z', label: 'triangle', color: '#7c3aed' }],
    showLabels: true,
    caption: 'Paths'
  }),
  element('gallery-1', 'agentcanvas.gallery/gallery', -650, 100, 300, 200, {
    items: [
      {
        id: 'first',
        source: { provider: 'agentcanvas.assets2', reference: assetRef },
        alt: 'First gallery image',
        caption: 'First slide'
      },
      {
        id: 'second',
        source: { provider: 'agentcanvas.assets2', reference: assetRef },
        alt: 'Second gallery image',
        caption: 'Second slide'
      }
    ],
    presentation: 'carousel',
    fit: 'contain',
    initialIndex: 0,
    autoplay: false,
    intervalMs: 5000,
    showControls: true,
    showIndicators: true
  }),
  element('dynamic-1', 'external.signal-card/signal-card', -250, 100, 260, 120, {
    label: 'Dynamic fixture',
    status: 'active'
  }),
  element('fail-1', 'fixture.fail/card', 490, 100, 190, 110, { label: 'This renderer fails' })
];

const performanceElements: CanvasElement[] = Array.from({ length: 500 }, (_, index) =>
  element(
    `performance-${index}`,
    'agentcanvas.primitives/text',
    (index % 25) * 180,
    Math.floor(index / 25) * 110,
    150,
    80,
    { text: `Element ${index + 1}` }
  )
);

function requireFixtureElement(id: string): CanvasElement {
  const fixtureElement = optionalElements.find((candidate) => candidate.id === id);
  if (!fixtureElement) throw new Error(`The ${id} browser fixture element is missing`);
  return fixtureElement;
}

const glbFixtureElement = requireFixtureElement('glb-1');

const runtime: Record<string, JsonObject> = {
  'video-1': {
    source: { handle: 'video-handle', url: '/fixture-resources/video.mp4', mimeType: 'video/mp4' },
    poster: { handle: 'poster-handle', url: '/fixture-resources/poster.svg', mimeType: 'image/svg+xml' }
  },
  'glb-1': {
    source: { handle: 'model-handle', url: '/fixture-resources/model.glb', mimeType: 'model/gltf-binary' },
    poster: { handle: 'model-poster-handle', url: '/fixture-resources/poster.svg', mimeType: 'image/svg+xml' }
  },
  'gallery-1': {
    items: [
      {
        id: 'first',
        contentHandle: 'gallery-first',
        contentUrl: '/api/v1/resources/gallery-first/content',
        mimeType: 'image/svg+xml'
      },
      {
        id: 'second',
        contentHandle: 'gallery-second',
        contentUrl: '/api/v1/resources/gallery-second/content',
        mimeType: 'image/svg+xml'
      }
    ]
  }
};

const now = '2026-07-13T12:00:00.000Z';

function initialCanvas(): CanvasDocument {
  const mode = new URLSearchParams(window.location.search).get('canvas');
  const elements =
    mode === 'default'
      ? defaultElements
      : mode === 'optional'
        ? optionalElements
        : mode === 'performance'
          ? performanceElements
          : [...defaultElements, ...optionalElements];
  return {
    id: 'browser-e2e',
    title: 'AgentCanvas v0.3 alpha browser fixture',
    description: 'Disposable browser runtime for registry-driven renderer coverage.',
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
    bounds: { mode: 'unlimited' },
    theme: TEST_CANVAS_THEME,
    elements,
    revision: 1,
    metadata: {},
    documentVersion: 2
  };
}

function withoutRenderer(registry: LoadedBrowserRegistry, type: string): LoadedBrowserRegistry {
  return {
    ...registry,
    renderers: new Map([...registry.renderers].filter(([candidate]) => candidate !== type))
  };
}

function App() {
  const [initialViewport] = useState(() =>
    new URLSearchParams(window.location.search).get('canvas') === 'performance'
      ? coerceViewport({ source: 'user', centerX: 0, centerY: 0, zoom: 1 })
      : undefined
  );
  const [registry, setRegistry] = useState<LoadedBrowserRegistry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState(initialCanvas);
  const [readOnly, setReadOnly] = useState(false);
  const [videoPluginAvailable, setVideoPluginAvailable] = useState(
    () => new URLSearchParams(window.location.search).get('video') !== 'missing'
  );
  const [glbPresent, setGlbPresent] = useState(true);
  const [dynamicPresent, setDynamicPresent] = useState(true);

  useEffect(() => {
    let active = true;
    let activeRegistry: LoadedBrowserRegistry | null = null;
    void fetchBrowserPluginCatalog()
      .then((catalog) => loadBrowserPluginRegistry({ catalog }))
      .then((loaded) => {
        if (active) {
          activeRegistry = loaded;
          setRegistry(loaded);
        } else {
          void loaded.dispose();
        }
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      void activeRegistry?.dispose();
    };
  }, []);

  const visibleCanvas = useMemo(
    () => ({
      ...canvas,
      elements: canvas.elements.filter(
        (candidate) => (glbPresent || candidate.id !== 'glb-1') && (dynamicPresent || candidate.id !== 'dynamic-1')
      )
    }),
    [canvas, dynamicPresent, glbPresent]
  );
  const visibleRegistry = useMemo(
    () => (registry && !videoPluginAvailable ? withoutRenderer(registry, 'agentcanvas.video/video') : registry),
    [registry, videoPluginAvailable]
  );
  const glbPlaceholder = renderModelSnapshot(glbFixtureElement, null);

  function mutateCanvas(mutate: (elements: CanvasElement[]) => CanvasElement[]) {
    setCanvas((current) => ({
      ...current,
      elements: mutate(current.elements),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString()
    }));
  }

  if (loadError) return <main data-testid="load-error">{loadError}</main>;
  if (!visibleRegistry) return <main data-testid="loading">Loading plugin catalog…</main>;

  return (
    <div className="fixture-shell">
      <nav className="fixture-toolbar" aria-label="Fixture controls">
        <span data-testid="registry-count">{visibleRegistry.renderers.size} renderers</span>
        <button
          type="button"
          data-testid="update-text"
          onClick={() =>
            mutateCanvas((elements) =>
              elements.map((candidate) =>
                candidate.id === 'text-1'
                  ? { ...candidate, data: { ...candidate.data, text: 'Updated without remount' } }
                  : candidate
              )
            )
          }
        >
          Update text
        </button>
        <button type="button" data-testid="toggle-readonly" onClick={() => setReadOnly((value) => !value)}>
          Toggle read-only
        </button>
        <button
          type="button"
          data-testid="toggle-video-plugin"
          onClick={() => setVideoPluginAvailable((value) => !value)}
        >
          Toggle video plugin
        </button>
        <button type="button" data-testid="toggle-glb" onClick={() => setGlbPresent((value) => !value)}>
          Toggle GLB element
        </button>
        <button type="button" data-testid="remove-dynamic" onClick={() => setDynamicPresent(false)}>
          Remove dynamic element
        </button>
      </nav>
      <output data-testid="canvas-revision">{canvas.revision}</output>
      <output data-testid="persisted-elements">{JSON.stringify(canvas.elements)}</output>
      <output data-testid="glb-snapshot-policy">{JSON.stringify(glbPlaceholder)}</output>
      <CanvasView
        initialViewport={initialViewport}
        canvas={visibleCanvas}
        elementRuntime={runtime}
        diagnostics={visibleRegistry.diagnostics}
        browserRegistry={visibleRegistry}
        readOnly={readOnly}
        onCanvasOperations={async (operations: readonly CanvasOperation[], expectedRevision) => {
          if (expectedRevision !== canvas.revision) throw new Error('Fixture revision conflict');
          let elements = canvas.elements.map((candidate) => ({ ...candidate }));
          for (const operation of operations) {
            if (operation.op === 'upsertElement') {
              const element = operation.element as CanvasElement;
              const index = elements.findIndex((candidate) => candidate.id === element.id);
              if (index === -1) elements.push(element);
              else elements[index] = element;
            } else if (operation.op === 'patchElementFrame') {
              elements = elements.map((candidate) =>
                candidate.id === operation.elementId ? { ...candidate, ...operation.frame } : candidate
              );
            } else if (operation.op === 'replaceElementData') {
              elements = elements.map((candidate) =>
                candidate.id === operation.elementId
                  ? {
                      ...candidate,
                      data: operation.data,
                      ...(operation.style !== undefined ? { style: operation.style } : {})
                    }
                  : candidate
              );
            } else if (operation.op === 'replaceElementMetadata') {
              elements = elements.map((candidate) =>
                candidate.id === operation.elementId ? { ...candidate, metadata: operation.metadata } : candidate
              );
            } else if (operation.op === 'deleteElement') {
              elements = elements.filter((candidate) => candidate.id !== operation.elementId);
            } else if (operation.op === 'clear') {
              elements = [];
            }
          }
          const next: CanvasDocument = {
            ...canvas,
            elements,
            revision: canvas.revision + 1,
            updatedAt: new Date().toISOString()
          };
          setCanvas(next);
          return next;
        }}
      />
    </div>
  );
}

const fixtureRoot = document.getElementById('root');
if (!fixtureRoot) throw new Error('The browser fixture root element is missing');
createRoot(fixtureRoot).render(<App />);
