import type { CapabilityProvider } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { assertRequiredPluginCapabilities } from '../src/plugin-runtime/bootstrap';
import { FrozenPluginRegistry } from '../src/plugin-runtime/registry';

function registry(readiness: NonNullable<CapabilityProvider<unknown>['readiness']>): FrozenPluginRegistry {
  const provider: CapabilityProvider<unknown> = {
    name: 'agentcanvas.assets',
    version: '1.0.0',
    value: {},
    readiness
  };
  return new FrozenPluginRegistry([], new Map([[provider.name, provider]]));
}

describe('required plugin capability readiness', () => {
  it('waits through retryable startup failures until the provider becomes ready', async () => {
    let currentTime = 0;
    const readiness = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'assets_unavailable', retryable: true })
      .mockResolvedValueOnce({ ok: false, code: 'assets_unavailable', retryable: true })
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn(async (milliseconds: number) => {
      currentTime += milliseconds;
    });

    await assertRequiredPluginCapabilities(registry(readiness), {
      timeoutMs: 30_000,
      retryIntervalMs: 500,
      now: () => currentTime,
      sleep
    });

    expect(readiness).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(currentTime).toBe(1_000);
  });

  it('fails immediately for a non-retryable readiness error', async () => {
    const readiness = vi.fn().mockResolvedValue({
      ok: false,
      code: 'assets_identity_mismatch',
      retryable: false
    });
    const sleep = vi.fn();

    await expect(
      assertRequiredPluginCapabilities(registry(readiness), {
        timeoutMs: 30_000,
        retryIntervalMs: 500,
        sleep
      })
    ).rejects.toMatchObject({
      code: 'plugin_capability_invalid',
      details: { code: 'assets_identity_mismatch', attempts: 1 }
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops retrying at the configured readiness deadline', async () => {
    let currentTime = 0;
    const readiness = vi.fn().mockResolvedValue({
      ok: false,
      code: 'assets_unavailable',
      retryable: true
    });

    await expect(
      assertRequiredPluginCapabilities(registry(readiness), {
        timeoutMs: 10,
        retryIntervalMs: 4,
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        }
      })
    ).rejects.toMatchObject({
      code: 'plugin_capability_invalid',
      details: { code: 'assets_unavailable', attempts: 4, waitedMs: 10 }
    });
    expect(readiness).toHaveBeenCalledTimes(4);
  });
});
