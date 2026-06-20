export const DEFAULT_CANVAS_WIDTH = 1600;
export const DEFAULT_CANVAS_HEIGHT = 1000;

export interface AssetReference {
  type: 'asset';
  project: string;
  assetId: string;
  assetBaseUrl?: string;
}

export interface AssetDetailsContextImage extends AssetReference {
  resolvedUrl?: string | null;
}

export interface AssetGenerationDetails {
  service?: string | null;
  tool?: string | null;
  provider?: string | null;
  model?: string | null;
  quality?: string | null;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  jsonPrompt?: unknown;
  contextImages?: Array<AssetDetailsContextImage | string | unknown>;
  controls?: Record<string, unknown>;
  providerRequest?: Record<string, unknown> | null;
  requestId?: string | null;
  imageIndex?: number | string | null;
  generatedAt?: string | null;
}

export interface AssetDetailsResponse {
  ok: boolean;
  asset: {
    project?: string | null;
    assetId?: string | null;
    filename?: string | null;
    contentType?: string | null;
    sizeBytes?: number | null;
    contentSha256?: string | null;
    width?: number | null;
    height?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    metadata?: Record<string, unknown>;
  };
  generation: AssetGenerationDetails | null;
  warnings?: string[];
}

export interface CanvasElementStyle {
  color?: string;
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  fontWeight?: string | number;
  fontFamily?: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  [key: string]: unknown;
}

export interface CanvasElementBase {
  id: string;
  type: CanvasElementType;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  rotation?: number | null;
  opacity?: number | null;
  locked?: boolean | null;
  style?: CanvasElementStyle | null;
  metadata?: Record<string, unknown>;
}

export interface TextElement extends CanvasElementBase {
  type: 'text';
  text: string;
}

export interface MarkdownElement extends CanvasElementBase {
  type: 'markdown';
  markdown: string;
}

export interface AssetElement extends CanvasElementBase {
  type: 'asset';
  assetRef: AssetReference;
  caption?: string | null;
  fit?: 'contain' | 'cover' | 'stretch' | 'original' | null;
  alt?: string | null;
  resolvedUrl?: string | null;
}

export interface GlbViewerElement extends CanvasElementBase {
  type: 'glbViewer';
  assetRef: AssetReference;
  caption?: string | null;
  alt?: string | null;
  resolvedUrl?: string | null;
  cameraControls?: boolean | null;
  autoRotate?: boolean | null;
}

export interface VideoElement extends CanvasElementBase {
  type: 'video';
  assetRef: AssetReference;
  caption?: string | null;
  alt?: string | null;
  resolvedUrl?: string | null;
  controls?: boolean | null;
  autoplay?: boolean | null;
  loop?: boolean | null;
  muted?: boolean | null;
  posterAssetRef?: AssetReference | null;
  posterResolvedUrl?: string | null;
}

export interface BBoxOverlayBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
  color?: string | null;
  fill?: string | null;
  strokeWidth?: number | null;
  labelAlign?: 'left' | 'center' | 'right' | null;
  labelVerticalAlign?: 'top' | 'middle' | 'bottom' | null;
  labelPadding?: number | null;
  metadata?: Record<string, unknown>;
}

export interface BBoxOverlayElement extends CanvasElementBase {
  type: 'bboxOverlay';
  canvasWidth?: number;
  canvasHeight?: number;
  boxes?: BBoxOverlayBox[];
  layoutAssetRef?: AssetReference | null;
  layoutResolvedUrl?: string | null;
  layoutSchema?: string | null;
  layoutResolutionError?: string | null;
  imageAssetRef?: AssetReference | null;
  imageResolvedUrl?: string | null;
  caption?: string | null;
  alt?: string | null;
  showLabels?: boolean | null;
  background?: string | null;
}

export interface PathOverlayPath {
  id: string;
  d: string;
  label?: string | null;
  color?: string | null;
  fill?: string | null;
  strokeWidth?: number | null;
  metadata?: Record<string, unknown>;
}

export interface PathOverlayElement extends CanvasElementBase {
  type: 'pathOverlay';
  canvasWidth: number;
  canvasHeight: number;
  paths: PathOverlayPath[];
  caption?: string | null;
  alt?: string | null;
  showLabels?: boolean | null;
  background?: string | null;
}

export interface ConnectorEndpoint {
  elementId?: string | null;
  x?: number | null;
  y?: number | null;
  anchor?: 'center' | 'top' | 'right' | 'bottom' | 'left' | null;
}

export interface LineElement extends CanvasElementBase {
  type: 'line' | 'arrow';
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  label?: string | null;
  stroke?: string | null;
  strokeWidth?: number | null;
}

export interface TableElement extends CanvasElementBase {
  type: 'table';
  columns: string[];
  rows: Array<Array<string>>;
  caption?: string | null;
}

export interface ShapeElement extends CanvasElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'diamond';
  label?: string | null;
}

export interface GroupElement extends CanvasElementBase {
  type: 'group';
  children: string[];
}

export type CanvasElement = TextElement | MarkdownElement | AssetElement | GlbViewerElement | VideoElement | BBoxOverlayElement | PathOverlayElement | LineElement | TableElement | ShapeElement | GroupElement;

export type CanvasElementType = CanvasElement['type'];

export interface CanvasBackground {
  color?: string;
  grid?: boolean;
}

export interface CanvasRecord {
  id: string;
  title: string;
  description?: string | null;
  project?: string | null;
  conversationId?: string | null;
  createdBy: 'agent' | 'user' | 'system';
  createdAt: string;
  updatedAt: string;
  width: number;
  height: number;
  background?: CanvasBackground | null;
  elements: CanvasElement[];
  revision: number;
  metadata?: Record<string, unknown>;
}

export type CanvasViewportSource = 'default' | 'user' | 'agent';

export interface CanvasViewport {
  centerX: number;
  centerY: number;
  zoom: number;
  width: number;
  height: number;
  source: CanvasViewportSource;
  updatedAt: string | null;
}

export interface CanvasViewportState {
  userViewport: CanvasViewport;
  agentViewport: CanvasViewport | null;
}

export interface CanvasViewportInput {
  centerX?: number;
  centerY?: number;
  zoom?: number;
  width?: number;
  height?: number;
  source?: 'user' | 'agent';
}

export type CanvasOperation =
  | { op: 'upsertElement'; element: CanvasElement | Record<string, unknown> }
  | { op: 'patchElement'; elementId: string; patch: Partial<CanvasElement> | Record<string, unknown> }
  | { op: 'deleteElement'; elementId: string }
  | { op: 'clear' };

export interface CanvasBatchRequest {
  operations: CanvasOperation[];
  expectedRevision?: number;
  idempotencyKey?: string;
  actor?: string;
}

export interface ShareLinkRecord {
  id: string;
  canvasId: string;
  mode: 'read';
  label?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export interface CreateCanvasInput {
  title: string;
  description?: string | null;
  project?: string | null;
  conversationId?: string | null;
  createdBy?: 'agent' | 'user' | 'system';
  width?: number;
  height?: number;
  background?: CanvasBackground | null;
  metadata?: Record<string, unknown>;
}

export interface CreateShareLinkInput {
  mode?: 'read';
  label?: string | null;
  expiresAt?: string | null;
}
