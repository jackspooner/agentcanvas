import type { CanvasElement, JsonValue } from '@agentcanvas/plugin-sdk';

export interface TableData {
  columns: string[];
  rows: string[][];
  caption: string | null;
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function tableData(element: Readonly<CanvasElement>): TableData {
  return {
    columns: strings(element.data.columns),
    rows: Array.isArray(element.data.rows) ? element.data.rows.map(strings) : [],
    caption: typeof element.data.caption === 'string' ? element.data.caption : null
  };
}
