// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  launched: 0,
  closed: 0,
  closeCalls: 0,
  launchGate: undefined as Promise<void> | undefined,
  launchFailure: undefined as Error | undefined,
  hanging: true,
  calls: [] as Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>
}));
vi.mock('node:fs/promises', () => ({ readFile: async () => 'engine bundle' }));
vi.mock('playwright', () => ({
  chromium: {
    launch: async () => {
      runtime.launched++;
      if (runtime.launchFailure) throw runtime.launchFailure;
      await runtime.launchGate;
      let call: (typeof runtime.calls)[number] | undefined;
      let closed = false;
      return {
        close: async () => {
          runtime.closeCalls++;
          if (!closed) {
            closed = true;
            runtime.closed++;
            call?.reject(new Error('Browser closed'));
          }
        },
        newContext: async () => ({
          route: async () => {},
          newPage: async () => ({
            setContent: async () => {},
            addScriptTag: async () => {},
            evaluate: async () =>
              runtime.hanging
                ? new Promise((resolve, reject) => {
                    call = { resolve, reject };
                    runtime.calls.push(call);
                  })
                : { value: { diagramType: 'flowchart-v2' } }
          })
        })
      };
    }
  }
}));

import { validateMermaid } from '../src/mermaid/headless.js';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  runtime.launched = 0;
  runtime.closed = 0;
  runtime.closeCalls = 0;
  runtime.launchGate = undefined;
  runtime.launchFailure = undefined;
  runtime.hanging = true;
  runtime.calls = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it('uses two browser slots, eight queued jobs, and includes queue time in the deadline', async () => {
  const jobs = Array.from({ length: 10 }, (_, i) =>
    validateMermaid(`flowchart LR\nQueue${i} --> B`).catch((error: Error) => error)
  );
  await expect(validateMermaid('flowchart LR\nOverflow --> B')).rejects.toThrow('queue is full');
  await flush();
  expect(runtime.launched).toBe(2);
  await vi.advanceTimersByTimeAsync(20_000);
  const errors = await Promise.all(jobs);
  expect(errors.every((error) => error instanceof Error && error.message.includes('20 second deadline'))).toBe(true);
  expect(runtime.closed).toBe(2);
  expect(runtime.closeCalls).toBe(2);
  expect(runtime.launched).toBe(2);
});

it('closes Chromium exactly once when cancellation arrives during launch', async () => {
  let finishLaunch!: () => void;
  runtime.launchGate = new Promise<void>((resolve) => {
    finishLaunch = resolve;
  });
  const controller = new AbortController();
  const result = validateMermaid('flowchart LR\nAbortedLaunch --> B', controller.signal).catch((error: Error) => error);
  await flush();
  expect(runtime.launched).toBe(1);
  const reason = new Error('Caller cancelled');
  controller.abort(reason);
  expect(await result).toBe(reason);
  finishLaunch();
  await flush();
  expect(runtime.closed).toBe(1);
  expect(runtime.closeCalls).toBe(1);
  expect(runtime.calls).toEqual([]);
});

it('coalesces identical jobs and keeps failures out of the result cache', async () => {
  const source = 'flowchart LR\nCoalesced --> B';
  const a = validateMermaid(source).catch((error: Error) => error);
  const b = validateMermaid(source).catch((error: Error) => error);
  await flush();
  expect(runtime.launched).toBe(1);
  runtime.calls[0].reject(new Error('Transport failed at C:\\private\\chromium\\renderer.js'));
  expect(await a).toMatchObject({ diagnostics: [expect.objectContaining({ code: 'mermaid.headless.failed' })] });
  expect(await b).toMatchObject({ diagnostics: [expect.objectContaining({ code: 'mermaid.headless.failed' })] });
  expect(((await a) as Error).message).not.toContain('C:');
  await flush();
  runtime.hanging = false;
  expect(await validateMermaid(source)).toEqual({ diagramType: 'flowchart-v2' });
  await flush();
  expect(runtime.launched).toBe(2);
  expect(runtime.closed).toBe(2);
});

it('returns a safe actionable missing-browser diagnostic without executable paths', async () => {
  runtime.launchFailure = new Error(
    'Executable missing at C:\\Users\\private\\AppData\\Local\\ms-playwright\\chrome.exe\nlaunch stack details'
  );
  const caught = await validateMermaid('flowchart LR\nMissingBrowser --> B').catch((error: Error) => error);
  expect(caught).toMatchObject({
    diagnostics: [
      expect.objectContaining({
        code: 'mermaid.headless.browser-unavailable',
        message: expect.stringContaining('Playwright Chromium installation')
      })
    ]
  });
  expect(JSON.stringify(caught)).not.toMatch(/Users|AppData|chrome\.exe|launch stack/);
  expect((caught as Error).message).not.toContain('C:');
  await flush();
  expect(runtime.closed).toBe(0);
});

it('preserves the timeout diagnostic when Playwright launch times out', async () => {
  runtime.launchFailure = Object.assign(new Error('Timeout launching C:\\private\\chrome.exe'), {
    name: 'TimeoutError'
  });
  await expect(validateMermaid('flowchart LR\nLaunchTimeout --> B')).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'mermaid.headless.timeout' })]
  });
  await flush();
});

it('preserves structured Mermaid source diagnostics across the browser boundary', async () => {
  const diagnostics = [{ path: '/source', code: 'mermaid.parse', message: 'Expected a closing bracket.' }];
  const result = validateMermaid('flowchart LR\nSourceIssue --> B').catch((error: Error) => error);
  await flush();
  runtime.calls[0].resolve({ diagnostics });
  expect(await result).toMatchObject({ diagnostics });
  await flush();
  expect(runtime.closed).toBe(1);
});

it('evicts older successful results at the 32 entry ceiling', async () => {
  runtime.hanging = false;
  for (let i = 0; i < 34; i++) await validateMermaid(`flowchart LR\nCache${i} --> B`);
  await flush();
  const launched = runtime.launched;
  await validateMermaid('flowchart LR\nCache33 --> B');
  expect(runtime.launched).toBe(launched);
  await validateMermaid('flowchart LR\nCache0 --> B');
  expect(runtime.launched).toBe(launched + 1);
  await flush();
  expect(runtime.closed).toBe(runtime.launched);
});
