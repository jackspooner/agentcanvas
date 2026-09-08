import { defineExtension } from '@agentcanvas/extension-sdk';

export const diagramTools = [
  'create-erd',
  'edit-erd',
  'create-mermaid',
  'update-mermaid',
  'validate-mermaid',
  'export-mermaid',
  'convert-mermaid-erd'
] as const;
export default defineExtension({
  manifest: {
    id: 'agentcanvas.diagrams',
    version: '0.1.0',
    displayName: 'Diagrams',
    description: 'Editable entity relationship diagrams and Mermaid diagrams.',
    license: 'MIT',
    entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
    requires: { hostApi: '^1.2.0', plugins: {}, capabilities: { 'agentcanvas.snapshot-resources': '^1.0.0' } },
    provides: { capabilities: {} },
    permissions: ['canvas.read', 'canvas.mutate-own', 'diagnostics.emit']
  },
  contributes: {
    elements: ['erd', 'mermaid'].map((name) => ({
      name,
      schemaVersion: 1,
      browser: true,
      snapshot: 'supported' as const
    })),
    tools: diagramTools,
    procedures: [],
    migrations: [],
    commands: [
      { name: 'create-erd', title: 'New entity relationship diagram' },
      { name: 'create-mermaid', title: 'New Mermaid diagram' },
      { name: 'edit', title: 'Edit diagram' },
      { name: 'export-mermaid', title: 'Export ERD as Mermaid' },
      { name: 'convert-mermaid-erd', title: 'Convert to editable ERD' },
      { name: 'apply-erd', title: 'Apply ERD edit' },
      { name: 'apply-mermaid', title: 'Save Mermaid source' }
    ]
  }
});
