import { type CanvasThemeV1, DEFAULT_CANVAS_THEME } from '@agentcanvas/extension-sdk';
import type { ErDB } from 'mermaid/dist/diagrams/er/erDb.js';
import type { Cardinality, DiagramIssue, ErdData } from '../contracts.js';
import { MermaidSourceError, withMermaid } from './engine.js';

const cardinalities: Record<string, Cardinality> = {
  ZERO_OR_ONE: 'zero-or-one',
  ONLY_ONE: 'one',
  ZERO_OR_MORE: 'zero-or-many',
  ONE_OR_MORE: 'one-or-many'
};
const issue = (code: string, message: string, path = '/source'): DiagramIssue => ({ path, code, message });

/** Isolated adapter for the pinned Mermaid 11.17.2 ER database, read while holding its engine queue. */
export function extractErd(
  source: string,
  theme: Readonly<CanvasThemeV1> = DEFAULT_CANVAS_THEME,
  signal?: AbortSignal
): Promise<{ data: ErdData; warnings: DiagramIssue[] }> {
  return withMermaid(source, theme, signal, async (api) => {
    const diagram = await api.mermaidAPI.getDiagramFromText(source);
    if (diagram.type !== 'er')
      throw new MermaidSourceError([issue('mermaid.erd.required', 'Conversion requires an erDiagram.')]);
    const db = diagram.db as ErDB;
    if (!(db.getEntities() instanceof Map) || !Array.isArray(db.getSubGraphs()))
      throw new Error('Unsupported Mermaid ER database contract.');
    if (db.getSubGraphs().length)
      throw new MermaidSourceError([
        issue('mermaid.erd.subgraph', 'ER subgraphs cannot be converted to native entities.')
      ]);
    const warnings: DiagramIssue[] = [];
    const idMap = new Map<string, string>();
    const entities = [...db.getEntities()].map(([name, entity], index) => {
      if (entity.shape !== 'erBox')
        throw new MermaidSourceError([issue('mermaid.erd.shape', `Unsupported ER entity shape: ${entity.shape}.`)]);
      const id = `entity-${index + 1}`;
      idMap.set(entity.id, id);
      if (entity.cssStyles?.length || (entity.cssClasses && entity.cssClasses !== 'default'))
        warnings.push(issue('mermaid.erd.styles', `Styles on ${name} are not imported.`));
      return {
        id,
        name,
        ...(entity.alias ? { alias: entity.alias } : {}),
        x: (index % 4) * 300,
        y: Math.floor(index / 4) * 300,
        attributes: entity.attributes.map((attribute, i) => ({
          id: `${id}-attribute-${i + 1}`,
          name: attribute.name,
          dataType: attribute.type,
          keys: [...(attribute.keys ?? [])],
          nullable: null,
          ...(attribute.comment ? { comment: attribute.comment } : {})
        }))
      };
    });
    const relationships = db.getRelationships().map((relationship, index) => {
      const sourceId = idMap.get(relationship.entityA);
      const targetId = idMap.get(relationship.entityB);
      // Mermaid names cardB for the left/source endpoint and cardA for the right/target endpoint.
      const sourceCardinality = cardinalities[relationship.relSpec.cardB];
      const targetCardinality = cardinalities[relationship.relSpec.cardA];
      if (
        !sourceId ||
        !targetId ||
        !sourceCardinality ||
        !targetCardinality ||
        !['IDENTIFYING', 'NON_IDENTIFYING'].includes(relationship.relSpec.relType)
      )
        throw new Error('Unsupported Mermaid ER relationship contract.');
      return {
        id: `relationship-${index + 1}`,
        source: { entityId: sourceId, cardinality: sourceCardinality },
        target: { entityId: targetId, cardinality: targetCardinality },
        label: relationship.roleA,
        identifying: relationship.relSpec.relType === 'IDENTIFYING'
      };
    });
    if (db.getClasses().size) warnings.push(issue('mermaid.erd.styles', 'Mermaid class definitions are not imported.'));
    if (/^\s*%%/m.test(source))
      warnings.push(
        issue('mermaid.erd.comments', 'Source comments are not imported; attribute comments are preserved.')
      );
    if (/^\s*direction\s/m.test(source))
      warnings.push(issue('mermaid.erd.direction', 'Mermaid layout direction is not preserved as native positions.'));
    if (db.getAccTitle() || db.getAccDescription())
      warnings.push(issue('mermaid.erd.accessibility', 'Mermaid accessibility metadata is not imported.'));
    return { data: { title: db.getDiagramTitle() || '', entities, relationships }, warnings };
  });
}

export { exportErdMermaid } from './export.js';
