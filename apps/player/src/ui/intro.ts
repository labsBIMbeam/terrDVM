/// <reference types="vite/client" />

/**
 * The app intro — and the seam where a code-drawn opening plugs in.
 *
 * There used to be a film here: `/intro.mp4` plus a poster PNG, both served
 * out of `apps/napplet/public/`. Together they were ~32 MB of external assets,
 * which is exactly what `artifactMode: 'single-file'` cannot express, so the
 * film is gone. What survives is the *shape* of the ceremony, because none of
 * the rules around it changed:
 *
 *   - it plays on the session's FIRST entry only (`hasEnteredThisSession`);
 *   - region hops (continent buttons, globe pins) reload the page and must
 *     skip it entirely;
 *   - it is preceded by a deliberate user gesture, which is the same gesture
 *     browsers require before `ui/sound.ts` may make a sound. The film is
 *     removable; that gesture is not.
 *
 * ## Contract for whoever implements `playIntro`
 *
 * Budget      `INTRO_MIN_MS`..`INTRO_MAX_MS` (1.5–2.5 s) of wall clock. This
 *             runs on every first entry of a session, so it has to read as a
 *             door opening, not a title sequence. Resolve at or under the
 *             budget even when frames are being throttled — never let a
 *             stalled `requestAnimationFrame` hold the app shut.
 * Assets      None. The napplet bundles to one file: canvas drawing, inline
 *             SVG and CSS only. No images, no video, no fonts, no fetches.
 * Drawing     Into `context.host` — an empty, full-bleed element that the
 *             caller creates and empties again afterwards. Touch nothing
 *             outside it.
 * Skipping    `context.signal` aborts on a click anywhere on the start screen,
 *             on Escape/Enter/Space, and on teardown. Check it before you
 *             start, and stop within a frame once it fires. Resolve — do not
 *             reject — on abort.
 * Reduced     When `context.reducedMotion` is true, do not animate at all.
 * motion      Paint one static frame — the composition the animation would
 *             have ended on — and resolve. A shortened animation is not a
 *             reduced-motion fallback.
 * Sound       `context.muted` reports whether the user chose a silent entry.
 *             Sound is synthesised in `ui/sound.ts`; never load an audio file.
 * Failure     Never reject and never hang. A broken intro must not be able to
 *             keep the app closed.
 *
 * The call site in `ui/app.ts` already honours all of the above; implementing
 * the opening means replacing the body of `playIntro`, not the call site.
 */

/** Lower edge of the duration budget: below this it reads as a glitch. */
export const INTRO_MIN_MS = 1500;
/** Hard ceiling. `playIntro` must have resolved by now, aborted or not. */
export const INTRO_MAX_MS = 2500;

export interface IntroContext {
  /** Empty, full-bleed element to draw into. Owned and cleared by the caller. */
  readonly host: HTMLElement;
  /** Fires when the user skips, or when the start screen is torn down. */
  readonly signal: AbortSignal;
  /** The user asked for a silent entry, or the sound layer is already muted. */
  readonly muted: boolean;
  /** `prefers-reduced-motion: reduce` is set — paint one static frame. */
  readonly reducedMotion: boolean;
}

/**
 * Play the intro. Resolves when it is finished, skipped, or declined.
 *
 * Placeholder: the film has been removed and the code-drawn opening has not
 * landed yet, so entry is instant. Everything the real implementation needs is
 * already wired — see the contract above.
 */
export function playIntro(context: IntroContext): Promise<void> {
  void context;
  return Promise.resolve();
}

/** `true` when `prefers-reduced-motion: reduce` is set, `false` if unknowable. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const ENTERED_FLAG = 'terrcvm-entered';

/**
 * Has this browsing session already been through the start screen?
 *
 * Region hops reload the page, and the flag is what keeps the ceremony from
 * replaying on them. Storage is a development affordance: a napplet artifact
 * may not touch `sessionStorage` at all (conformance scans for it), so the
 * production build compiles the access out and degrades to "not entered",
 * i.e. the intro simply plays again — the exact fallback a sandboxed shell
 * without storage always had.
 */
export function hasEnteredThisSession(): boolean {
  if (import.meta.env.DEV) {
    try {
      return sessionStorage.getItem(ENTERED_FLAG) === '1';
    } catch {
      return false;
    }
  }
  return false;
}

/** Record that the start screen has been passed. Silent when storage is absent. */
export function markEnteredThisSession(): void {
  if (import.meta.env.DEV) {
    try {
      sessionStorage.setItem(ENTERED_FLAG, '1');
    } catch {
      // No storage in this shell — the intro will simply play again.
    }
  }
}
