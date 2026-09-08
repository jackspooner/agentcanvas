import type { DiagramIssue } from '../contracts.js';

export class MermaidSourceError extends Error {
  constructor(public readonly diagnostics: DiagramIssue[]) {
    super(diagnostics.map((issue) => issue.message).join('; '));
    this.name = 'MermaidSourceError';
  }
}

export function validateMermaidSource(source: string): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const reject = (code: string, message: string) => issues.push({ path: '/source', code, message });
  if (typeof source !== 'string' || !source.trim()) {
    reject('mermaid.source.empty', 'Mermaid source must not be blank.');
    return issues;
  }
  if (source.length > 20_000) reject('mermaid.source.limit', 'Mermaid source exceeds 20,000 characters.');
  if (/%%\s*\{|^\s*---/m.test(source))
    reject('mermaid.source.config', 'Mermaid directives and frontmatter are disabled.');
  // Ignore comments and quoted/inline labels when checking executable statements.
  const uncommented = source.replace(/%%[^\n]*/g, '');
  const statements = uncommented.replace(/"(?:\\.|[^"\\])*"|\[(?!\[)[^\]\n]*\]/g, (label, offset: number) =>
    /^\s*:/.test(uncommented.slice(offset + label.length)) ? label : '"label"'
  );
  if (!/^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram)\b/.test(statements)) {
    reject('mermaid.source.family', 'Supported families are flowchart, sequence, class, state, and ER diagrams.');
  }
  const family = statements.trimStart().split(/\s/, 1)[0];
  const interactive =
    family !== 'erDiagram' && /(?:^|[;\n])\s*click\s+[\w,-]+\s+(?:[\w"']|href\b|call\b)/i.test(statements);
  const links = family === 'sequenceDiagram' && /(?:^|[;\n])\s*links?\s+\w+\s*:/i.test(statements);
  if (interactive || links || /@\s*\{[^}]*\b(?:img|icon)["']?\s*:|\b(?:url\s*\(|@import\b)|\\/i.test(statements)) {
    reject('mermaid.source.external', 'Interactive links, images, icons, and external CSS resources are disabled.');
  }
  return issues;
}
