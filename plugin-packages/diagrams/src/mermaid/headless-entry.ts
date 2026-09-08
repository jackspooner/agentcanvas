import { parseMermaidSource, renderMermaid } from './engine.js';
import { extractErd } from './erd.js';

Object.assign(globalThis, { AgentCanvasDiagramsEngine: { parseMermaidSource, renderMermaid, extractErd } });
