export type Cardinality = 'zero-or-one' | 'one' | 'zero-or-many' | 'one-or-many';
export interface ErdAttribute { id: string; name: string; dataType: string; keys: Array<'PK' | 'FK' | 'UK'>; nullable: boolean | null; comment?: string }
export interface ErdEntity { id: string; name: string; alias?: string; x: number; y: number; attributes: ErdAttribute[] }
export interface ErdEndpoint { entityId: string; attributeId?: string; cardinality: Cardinality }
export interface ErdRelationship { id: string; source: ErdEndpoint; target: ErdEndpoint; label: string; identifying: boolean }
export interface ErdData { title: string; entities: ErdEntity[]; relationships: ErdRelationship[] }
export interface MermaidData { title: string; source: string }
export interface DiagramIssue { path: string; code: string; message: string }
export type ErdOperation =
  | { op: 'set-title'; title: string }
  | { op: 'add-entity'; entity: ErdEntity }
  | { op: 'update-entity'; entityId: string; name: string; alias?: string }
  | { op: 'move-entity'; entityId: string; x: number; y: number }
  | { op: 'delete-entity'; entityId: string }
  | { op: 'add-attribute'; entityId: string; attribute: ErdAttribute; index: number }
  | { op: 'update-attribute'; entityId: string; attribute: ErdAttribute }
  | { op: 'reorder-attributes'; entityId: string; attributeIds: string[] }
  | { op: 'delete-attribute'; entityId: string; attributeId: string }
  | { op: 'add-relationship'; relationship: ErdRelationship }
  | { op: 'update-relationship'; relationship: ErdRelationship }
  | { op: 'delete-relationship'; relationshipId: string }
  | { op: 'auto-layout'; direction: 'LR' | 'TB' };
