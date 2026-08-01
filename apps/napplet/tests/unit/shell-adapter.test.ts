import { afterEach, describe, expect, it, vi } from 'vitest';

import { TIMEOUT_S } from '@terrcvm/terrain-engine/config/defaults';
import {
  PreviewError,
  getResourceCapability,
  loadApprovedBytes,
} from '../../src/shell/resource-client';

type ResourceStub = {
  bytes: (url: string, options?: { signal?: AbortSignal }) => Promise<Blob>;
};

function installShellResource(resource?: ResourceStub): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      napplet: resource === undefined ? {} : { resource },
    },
    writable: true,
  });
}

async function expectPreviewCode(
  action: () => unknown | Promise<unknown>,
  code: PreviewError['code'],
): Promise<void> {
  try {
    await action();
    expect.unreachable(`expected PreviewError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewError);
    expect(error).toMatchObject({ code });
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  vi.useRealTimers();
});

describe('shell resource adapter', () => {
  it('resource_capability_absence_maps_to_actionable_denied_state', async () => {
    installShellResource();

    await expectPreviewCode(() => getResourceCapability(), 'CAPABILITY_DENIED');
  });

  it('rejects a URL denied by the caller allowlist before calling the shell', async () => {
    const bytes = vi.fn<ResourceStub['bytes']>();
    installShellResource({ bytes });

    await expectPreviewCode(
      () =>
        loadApprovedBytes('https://unapproved.example/terrain.tif', {
          deadlineMs: TIMEOUT_S * 1_000,
          isAllowed: () => false,
        }),
      'CAPABILITY_DENIED',
    );
    expect(bytes).not.toHaveBeenCalled();
  });

  it('maps the configured client deadline through AbortController to TIMEOUT', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const bytes = vi.fn<ResourceStub['bytes']>((_url, options) => {
      observedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    installShellResource({ bytes });

    const result = loadApprovedBytes('https://approved.example/terrain.tif', {
      deadlineMs: TIMEOUT_S * 1_000,
      isAllowed: () => true,
    });
    // Attach the rejection consumer before advancing fake time so Vitest never
    // observes the expected timeout as an unhandled rejection.
    const timeoutAssertion = expectPreviewCode(() => result, 'TIMEOUT');
    await vi.advanceTimersByTimeAsync(TIMEOUT_S * 1_000);

    await timeoutAssertion;
    expect(observedSignal?.aborted).toBe(true);
  });

  it('maps a shell network failure to UNAVAILABLE', async () => {
    installShellResource({
      bytes: async () => {
        throw Object.assign(new Error('shell resource unavailable'), {
          error: 'network-error',
        });
      },
    });

    await expectPreviewCode(
      () =>
        loadApprovedBytes('https://approved.example/terrain.tif', {
          deadlineMs: TIMEOUT_S * 1_000,
          isAllowed: () => true,
        }),
      'UNAVAILABLE',
    );
  });

  it('maps a distinct non-timeout shell failure to FAILED', async () => {
    installShellResource({
      bytes: async () => {
        throw new Error('stub exploded');
      },
    });

    await expectPreviewCode(
      () =>
        loadApprovedBytes('https://approved.example/terrain.tif', {
          deadlineMs: TIMEOUT_S * 1_000,
          isAllowed: () => true,
        }),
      'FAILED',
    );
  });
});
