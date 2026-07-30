/**
 * A fully synthesized sound layer — no assets, a few oscillators and noise
 * bursts, so the single-file artifact stays a single file.
 *
 * Browsers gate audio behind a user gesture; the context lazily resumes on
 * the first call after one. Every function degrades to a silent no-op when
 * WebAudio is unavailable, muted, or not yet unlocked.
 */

let context: AudioContext | null = null;
let muted = false;

const MASTER_GAIN = 0.16;

function ensureContext(): AudioContext | null {
  if (muted) return null;
  if (typeof AudioContext === 'undefined') return null;
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context.state === 'running' ? context : context; // resume is async; play anyway
}

function envelope(
  ctx: AudioContext,
  duration: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak * MASTER_GAIN, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(ctx.destination);
  return gain;
}

function tone(frequency: number, duration: number, peak: number, type: OscillatorType): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  osc.connect(envelope(ctx, duration, peak));
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function noise(duration: number, peak: number, lowpassHz: number): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lowpassHz;
  source.connect(filter);
  filter.connect(envelope(ctx, duration, peak));
  source.start();
}

export const sound = {
  setMuted(value: boolean): void {
    muted = value;
  },
  isMuted(): boolean {
    return muted;
  },
  /** Soft UI tick for buttons and toggles. */
  tick(): void {
    tone(1900, 0.05, 0.35, 'sine');
  },
  /** Warm two-note chime: the scene is ready. */
  chime(): void {
    tone(523.25, 0.35, 0.5, 'sine');
    setTimeout(() => tone(784, 0.5, 0.45, 'sine'), 110);
  },
  /** A single footstep — short filtered noise. */
  step(): void {
    noise(0.07, 0.5, 900);
  },
  /** Kaiju stomp: sub thump plus gravel. */
  stomp(): void {
    tone(52, 0.35, 1.0, 'sine');
    noise(0.22, 0.5, 300);
  },
  /** The crab arrives. */
  boom(): void {
    const ctx = ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.9);
    osc.connect(envelope(ctx, 1.1, 1.0));
    osc.start();
    osc.stop(now + 1.1);
    noise(0.8, 0.55, 220);
  },
};
