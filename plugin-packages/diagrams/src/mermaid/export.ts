import type { Cardinality, DiagramIssue, ErdData } from '../contracts.js';
import { MermaidSourceError } from './policy.js';

const left: Record<Cardinality, string> = { 'zero-or-one': '|o', one: '||', 'zero-or-many': '}o', 'one-or-many': '}|' };
const right: Record<Cardinality, string> = {
  'zero-or-one': 'o|',
  one: '||',
  'zero-or-many': 'o{',
  'one-or-many': '|{'
};
const issue = (code: string, message: string, path = '/source'): DiagramIssue => ({ path, code, message });

/** Emit exact representable values; callers must parse the result before exposing it. */
export function exportErdMermaid(data: ErdData): { source: string; warnings: DiagramIssue[] } {
  const warnings: DiagramIssue[] = [];
  const errors: DiagramIssue[] = [];
  const quoted = (value: string, path: string) => {
    if (/["\r\n]/.test(value))
      errors.push(
        issue('mermaid.erd.unrepresentable', 'Mermaid quoted values cannot preserve quotes or line breaks.', path)
      );
    return `"${value}"`;
  };
  const lines = ['erDiagram'];
  if (data.title) {
    warnings.push(issue('mermaid.erd.title', 'ER titles require disabled frontmatter and are not exported.', '/title'));
  }
  const names = new Map<string, string>();
  const seen = new Set<string>();
  for (const [index, entity] of data.entities.entries()) {
    const path = `/entities/${index}`;
    if (seen.has(entity.name))
      errors.push(
        issue(
          'mermaid.erd.duplicate-name',
          'Mermaid cannot preserve distinct entities with the same name.',
          `${path}/name`
        )
      );
    seen.add(entity.name);
    const name = quoted(entity.name, `${path}/name`);
    names.set(entity.id, name);
    lines.push(
      `  ${name}${entity.alias ? `[${quoted(entity.alias, `${path}/alias`)}]` : ''}${entity.attributes.length ? ' {' : ''}`
    );
    for (const [i, attribute] of entity.attributes.entries()) {
      for (const [key, value] of [
        ['dataType', attribute.dataType],
        ['name', attribute.name]
      ]) {
        if (!/^[*A-Za-z_\u00C0-\uFFFF][A-Za-z0-9_\-[\]().,\u00C0-\uFFFF*]*\??$/.test(value))
          errors.push(
            issue(
              'mermaid.erd.unrepresentable',
              `Attribute ${key} cannot be represented exactly by Mermaid.`,
              `${path}/attributes/${i}/${key}`
            )
          );
      }
      lines.push(
        `    ${attribute.dataType} ${attribute.name}${attribute.keys.length ? ` ${attribute.keys.join(', ')}` : ''}${attribute.comment !== undefined ? ` ${quoted(attribute.comment, `${path}/attributes/${i}/comment`)}` : ''}`
      );
      if (attribute.nullable !== null)
        warnings.push(
          issue(
            'mermaid.erd.nullability',
            'Explicit nullability is not represented in Mermaid.',
            `${path}/attributes/${i}/nullable`
          )
        );
    }
    if (entity.attributes.length) lines.push('  }');
  }
  for (const [index, relationship] of data.relationships.entries()) {
    const a = names.get(relationship.source.entityId);
    const b = names.get(relationship.target.entityId);
    if (!a || !b)
      errors.push(
        issue('mermaid.erd.endpoint', 'Relationship endpoint does not identify an entity.', `/relationships/${index}`)
      );
    lines.push(
      `  ${a} ${left[relationship.source.cardinality]}${relationship.identifying ? '--' : '..'}${right[relationship.target.cardinality]} ${b} : ${quoted(relationship.label, `/relationships/${index}/label`)}`
    );
    if (relationship.source.attributeId || relationship.target.attributeId)
      warnings.push(
        issue(
          'mermaid.erd.attribute-endpoint',
          'Attribute endpoints become entity endpoints in Mermaid.',
          `/relationships/${index}`
        )
      );
  }
  if (data.entities.length)
    warnings.push(
      issue('mermaid.erd.layout', 'Native positions and stable IDs are not represented in Mermaid.', '/entities')
    );
  if (
    data.entities.some((entity) => entity.width !== undefined || entity.height !== undefined || entity.appearance) ||
    data.relationships.some((edge) => edge.appearance || edge.bends || edge.labelPosition)
  )
    warnings.push(
      issue(
        'mermaid.erd.presentation',
        'Box sizes, appearance overrides, manual connector bends and label positions are not represented in exported Mermaid source.',
        '/entities'
      )
    );
  if (errors.length) throw new MermaidSourceError(errors);
  return { source: lines.join('\n'), warnings };
}
