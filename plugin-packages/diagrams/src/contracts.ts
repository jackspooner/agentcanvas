export type Cardinality = 'zero-or-one' | 'one' | 'zero-or-many' | 'one-or-many';
/** Omitted values inherit the canvas theme. Colors are hexadecimal; fonts are local family names. */
export interface DiagramAppearance {
  fill?: string;
  headerFill?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontFamily?: string;
  fontSize?: number;
}
export interface DiagramPoint {
  x: number;
  y: number;
}
export interface BoxPresentation {
  width?: number;
  height?: number;
  appearance?: DiagramAppearance;
}
export interface ConnectorPresentation {
  bends?: DiagramPoint[];
  labelPosition?: DiagramPoint;
  appearance?: DiagramAppearance;
}
export interface ErdAttribute {
  id: string;
  name: string;
  dataType: string;
  keys: Array<'PK' | 'FK' | 'UK'>;
  nullable: boolean | null;
  comment?: string;
}
export interface ErdEntity extends BoxPresentation {
  id: string;
  name: string;
  alias?: string;
  x: number;
  y: number;
  attributes: ErdAttribute[];
}
export interface ErdEndpoint {
  entityId: string;
  attributeId?: string;
  cardinality: Cardinality;
}
export interface ErdRelationship extends ConnectorPresentation {
  id: string;
  source: ErdEndpoint;
  target: ErdEndpoint;
  label: string;
  identifying: boolean;
}
export interface ErdData {
  title: string;
  entities: ErdEntity[];
  relationships: ErdRelationship[];
}
export interface MermaidData {
  title: string;
  source: string;
  presentation?: MermaidPresentation;
}
/** Presentation keys belong to this exact source; source edits must explicitly reset the layer. */
export interface MermaidPresentation {
  source: string;
  nodes: Array<BoxPresentation & { id: string; x?: number; y?: number }>;
  edges: Array<ConnectorPresentation & { id: string }>;
}
export interface MermaidLayout {
  nodes: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    points: DiagramPoint[];
    labelPosition: DiagramPoint;
  }>;
}
export interface DiagramIssue {
  path: string;
  code: string;
  message: string;
}
export type ErdOperation =
  | { op: 'set-title'; title: string }
  | { op: 'add-entity'; entity: ErdEntity }
  | { op: 'update-entity'; entityId: string; name: string; alias?: string }
  | { op: 'move-entity'; entityId: string; x: number; y: number }
  | { op: 'present-entity'; entityId: string; presentation: BoxPresentation }
  | { op: 'present-relationship'; relationshipId: string; presentation: ConnectorPresentation }
  | { op: 'delete-entity'; entityId: string }
  | { op: 'add-attribute'; entityId: string; attribute: ErdAttribute; index: number }
  | { op: 'update-attribute'; entityId: string; attribute: ErdAttribute }
  | { op: 'reorder-attributes'; entityId: string; attributeIds: string[] }
  | { op: 'delete-attribute'; entityId: string; attributeId: string }
  | { op: 'add-relationship'; relationship: ErdRelationship }
  | { op: 'update-relationship'; relationship: ErdRelationship }
  | { op: 'delete-relationship'; relationshipId: string }
  | { op: 'auto-layout'; direction: 'LR' | 'TB' };
