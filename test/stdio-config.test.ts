import { describe, expect, it } from 'vitest';
import { resolveResidentMcpUrl } from '../src/mcp-v2/stdio.js';

describe('stdio MCP resident target', () => {
  it('uses the documented bridge-specific base URL when present', () => {
    expect(
      resolveResidentMcpUrl(
        { publicBaseUrl: 'http://127.0.0.1:23003' },
        { AGENT_CANVAS_BASE_URL: 'http://127.0.0.1:24003' }
      ).href
    ).toBe('http://127.0.0.1:24003/mcp');
  });

  it('falls back to the host public URL when no bridge override is configured', () => {
    expect(resolveResidentMcpUrl({ publicBaseUrl: 'http://127.0.0.1:23003' }, {}).href).toBe(
      'http://127.0.0.1:23003/mcp'
    );
  });
});
