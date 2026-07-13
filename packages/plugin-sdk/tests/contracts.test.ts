import { describe, expect, it } from 'vitest';
import { deriveElementType, deriveToolName, isJsonValue, isLocalContributionName, isPluginId } from '../src/index.js';

describe('plugin identifier helpers', () => {
  it('derives stable element and tool names', () => {
    expect(deriveElementType('agentcanvas.image-overlays', 'bbox')).toBe('agentcanvas.image-overlays/bbox');
    expect(deriveToolName('agentcanvas.image-overlays', 'add-bbox')).toBe('agentcanvas_image_overlays__add_bbox');
  });

  it('rejects malformed identifiers', () => {
    expect(isPluginId('agentcanvas.primitives')).toBe(true);
    expect(isPluginId('AgentCanvas.Primitives')).toBe(false);
    expect(isLocalContributionName('hello-card')).toBe(true);
    expect(isLocalContributionName('../hello')).toBe(false);
    expect(() => deriveElementType('bad/id', 'card')).toThrow(TypeError);
  });
});

describe('JSON guards', () => {
  it('accepts portable JSON and rejects unsafe runtime values', () => {
    expect(isJsonValue({ nested: ['text', 42, true, null] })).toBe(true);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isJsonValue({ value: undefined })).toBe(false);
    expect(isJsonValue(new Date())).toBe(false);
  });
});
