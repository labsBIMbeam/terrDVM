import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  INTRO_MAX_MS,
  INTRO_MIN_MS,
  hasEnteredThisSession,
  markEnteredThisSession,
  playIntro,
  prefersReducedMotion,
} from '../../src/ui/intro';

// The intro used to be a 32 MB film element inside app.ts, so the tests that
// covered it were browser-only smoke checks. What replaced it is a seam with a
// written contract — a duration budget, an abort path, a reduced-motion rule
// and a once-per-session flag — and that contract is what these tests hold.

// The node test environment has neither `sessionStorage` nor `window`, which
// is precisely the "storage-absent shell" the seam has to survive. Reaching
// through an index signature lets a test install and remove them; the DOM lib
// types them as always-present globals.
const globals = globalThis as unknown as Record<string, unknown>;

function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, value),
  } as Storage;
}

afterEach(() => {
  delete globals.sessionStorage;
  delete globals.window;
});

describe('intro seam', () => {
  it('intro_duration_budget_stays_inside_the_documented_window', () => {
    // A code-drawn opening that plays every session is a door, not a title
    // sequence. If someone widens this, they have changed the product.
    expect(INTRO_MIN_MS).toBe(1500);
    expect(INTRO_MAX_MS).toBe(2500);
    expect(INTRO_MIN_MS).toBeLessThan(INTRO_MAX_MS);
  });

  it('play_intro_resolves_and_never_rejects_even_when_already_aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const host = { replaceChildren: () => undefined } as unknown as HTMLElement;

    await expect(
      playIntro({
        host,
        signal: controller.signal,
        muted: true,
        reducedMotion: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('play_intro_settles_within_its_own_ceiling', async () => {
    const controller = new AbortController();
    const host = { replaceChildren: () => undefined } as unknown as HTMLElement;
    const started = Date.now();

    await playIntro({
      host,
      signal: controller.signal,
      muted: false,
      reducedMotion: false,
    });

    // A broken intro must not be able to hold the app shut.
    expect(Date.now() - started).toBeLessThanOrEqual(INTRO_MAX_MS);
  });

  it('session_flag_marks_the_first_entry_and_suppresses_the_next_one', () => {
    globals.sessionStorage = fakeStorage();

    expect(hasEnteredThisSession()).toBe(false);
    markEnteredThisSession();
    // Region hops reload the page; this is what keeps the ceremony from
    // replaying on them.
    expect(hasEnteredThisSession()).toBe(true);
  });

  it('session_flag_degrades_to_always_intro_when_storage_is_absent', () => {
    // A sandboxed shell without sessionStorage: reading throws, and the seam
    // reports "not entered" rather than swallowing the first impression.
    expect(globals.sessionStorage).toBeUndefined();
    expect(hasEnteredThisSession()).toBe(false);
    expect(() => markEnteredThisSession()).not.toThrow();
  });

  it('session_flag_degrades_when_storage_throws_on_write', () => {
    const denied = fakeStorage();
    vi.spyOn(denied, 'setItem').mockImplementation(() => {
      throw new Error('storage access denied');
    });
    globals.sessionStorage = denied;

    expect(() => markEnteredThisSession()).not.toThrow();
    expect(hasEnteredThisSession()).toBe(false);
  });

  it('reduced_motion_is_reported_when_asked_and_false_when_unknowable', () => {
    globals.window = {
      matchMedia: (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      }),
    };
    expect(prefersReducedMotion()).toBe(true);

    // No window, no matchMedia: assume motion is fine rather than throwing.
    delete globals.window;
    expect(prefersReducedMotion()).toBe(false);
  });
});
