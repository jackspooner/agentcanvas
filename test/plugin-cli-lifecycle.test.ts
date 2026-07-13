import { describe, expect, it, vi } from 'vitest';
import { assertAgentCanvasStopped } from '../src/cli/plugins.js';

describe('plugin CLI lifecycle guard', () => {
  it('refuses disable/replacement operations while AgentCanvas is listening', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ service: 'AgentCanvas', version: '0.2.0' }), {
        headers: { 'content-type': 'application/json' }
      })
    );
    await expect(assertAgentCanvasStopped(fetcher, 'http://127.0.0.1:23003')).rejects.toThrow('must be stopped');
  });

  it('allows the operation when no listener is reachable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(assertAgentCanvasStopped(fetcher, 'http://127.0.0.1:23003')).resolves.toBeUndefined();
  });
});
