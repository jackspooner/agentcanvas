import { describe, expect, it } from 'vitest';
import { CanvasError } from '../src/errors';
import { AGENTCANVAS_PROBLEM_CODES, exampleProblem, problemFromCanvasError } from '../src/api-v2/problem-contract';

describe('AgentCanvas Problem Details contract', () => {
  it('projects one registry definition identically into examples and runtime errors', () => {
    const runtime = problemFromCanvasError(
      new CanvasError('not_found', 'canvas missing: canvas_123', 'not_found', 404),
      'req_runtime',
      '/api/v1/canvases/canvas_123'
    );
    const example = exampleProblem('not_found');
    expect(runtime).toMatchObject({
      type: 'urn:workspace2:problem:not_found',
      title: AGENTCANVAS_PROBLEM_CODES.not_found.title,
      status: AGENTCANVAS_PROBLEM_CODES.not_found.status,
      detail: 'canvas missing: canvas_123',
      code: 'not_found',
      category: AGENTCANVAS_PROBLEM_CODES.not_found.category,
      retryable: AGENTCANVAS_PROBLEM_CODES.not_found.retryable,
      requestId: 'req_runtime'
    });
    expect(example.title).toBe(runtime.title);
    expect(example.category).toBe(runtime.category);
    expect(example.retryable).toBe(runtime.retryable);
  });

  it('sanitizes internal details and rejects undeclared codes', () => {
    expect(
      problemFromCanvasError(
        new CanvasError('internal_error', 'C:\\secret\\database.sqlite', 'storage', 500),
        'req_internal',
        '/api/v1/canvases'
      ).detail
    ).toBe(AGENTCANVAS_PROBLEM_CODES.internal_error.description);
    expect(() =>
      problemFromCanvasError(new CanvasError('unknown_code', 'bad', 'storage', 500), 'req_unknown', '/api')
    ).toThrow('Unknown AgentCanvas problem code');
  });
});
