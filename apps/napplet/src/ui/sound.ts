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

// --- Ambient wind ----------------------------------------------------------
// A looping noise bed under the viewer: barely there at street level, it
// opens up as the camera climbs. One shared node set, started and stopped
// with the scene.
let ambient: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null =
  null;

function stopAmbientNodes(): void {
  if (!ambient) return;
  try {
    ambient.source.stop();
  } catch {
    // Already stopped — fine.
  }
  ambient.source.disconnect();
  ambient.filter.disconnect();
  ambient.gain.disconnect();
  ambient = null;
}

export const sound = {
  setMuted(value: boolean): void {
    muted = value;
    if (muted) stopAmbientNodes();
  },
  isMuted(): boolean {
    return muted;
  },
  /** Start the wind bed; idempotent while one is playing. */
  startAmbient(): void {
    const ctx = ensureContext();
    if (!ctx || ambient) return;
    const seconds = 2;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    const gain = ctx.createGain();
    gain.gain.value = 0.045 * MASTER_GAIN;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    ambient = { source, filter, gain };
  },
  stopAmbient(): void {
    stopAmbientNodes();
  },
  /** 0 = on the ground, 1 = high orbit: the wind swells with altitude. */
  setAmbientLift(lift: number): void {
    if (!ambient || !context) return;
    const clamped = Math.min(1, Math.max(0, lift));
    const now = context.currentTime;
    ambient.filter.frequency.setTargetAtTime(240 + clamped * 620, now, 0.4);
    ambient.gain.gain.setTargetAtTime((0.045 + clamped * 0.11) * MASTER_GAIN, now, 0.4);
  },
  /** Airflow swell for the spiral reveal. */
  whoosh(): void {
    const ctx = ensureContext();
    if (!ctx) return;
    const seconds = 3.2;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    const now = ctx.currentTime;
    // The descent: airflow pitch falls as the camera bleeds off height.
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5 * MASTER_GAIN, now + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(now + seconds);
  },
  /** The crab announces itself: a low sawtooth snarl over gravel. */
  roar(): void {
    const ctx = ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.linearRampToValueAtTime(92, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(41, now + 1.3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 560;
    osc.connect(filter);
    filter.connect(envelope(ctx, 1.4, 0.5));
    osc.start();
    osc.stop(now + 1.4);
    noise(0.9, 0.3, 340);
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
