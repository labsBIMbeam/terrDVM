import { resource } from '@napplet/sdk';

export type PreviewErrorCode =
  | 'CAPABILITY_DENIED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'FAILED';

const ERROR_MESSAGES: Record<PreviewErrorCode, string> = {
  CAPABILITY_DENIED: 'The shell resource capability is unavailable or denied.',
  UNAVAILABLE: 'The requested resource is unavailable.',
  TIMEOUT: 'The resource request exceeded its client deadline.',
  FAILED: 'The resource request failed.',
};

export class PreviewError extends Error {
  readonly code: PreviewErrorCode;

  constructor(code: PreviewErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], { cause });
    this.name = 'PreviewError';
    this.code = code;
  }
}

export type LoadApprovedBytesOptions = {
  deadlineMs: number;
  isAllowed: (url: string) => boolean;
  signal?: AbortSignal;
};

type NappletWindow = Window & {
  napplet?: {
    resource?: unknown;
  };
};

type ShellFailure = {
  error?: unknown;
};

export function getResourceCapability(): typeof resource {
  const shellResource = (window as NappletWindow).napplet?.resource;
  if (shellResource === undefined) {
    throw new PreviewError('CAPABILITY_DENIED');
  }

  return resource;
}

function normalizeShellFailure(error: unknown): PreviewError {
  if (error instanceof PreviewError) {
    return error;
  }

  const shellCode =
    typeof error === 'object' && error !== null
      ? (error as ShellFailure).error
      : undefined;

  if (shellCode === 'blocked-by-policy') {
    return new PreviewError('CAPABILITY_DENIED', error);
  }
  if (shellCode === 'timeout') {
    return new PreviewError('TIMEOUT', error);
  }
  if (
    shellCode === 'network-error' ||
    shellCode === 'not-found' ||
    shellCode === 'unsupported-scheme'
  ) {
    return new PreviewError('UNAVAILABLE', error);
  }

  return new PreviewError('FAILED', error);
}

export async function loadApprovedBytes(
  url: string,
  { deadlineMs, isAllowed, signal }: LoadApprovedBytesOptions,
): Promise<Blob> {
  if (!isAllowed(url)) {
    throw new PreviewError('CAPABILITY_DENIED');
  }

  const capability = getResourceCapability();
  const controller = new AbortController();
  let deadlineExceeded = false;

  const abortFromCaller = (): void => controller.abort(signal?.reason);
  if (signal?.aborted === true) {
    abortFromCaller();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(new DOMException('Client deadline exceeded', 'TimeoutError'));
  }, deadlineMs);

  try {
    return await capability.bytes(url, { signal: controller.signal });
  } catch (error) {
    if (deadlineExceeded) {
      throw new PreviewError('TIMEOUT', error);
    }
    throw normalizeShellFailure(error);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
