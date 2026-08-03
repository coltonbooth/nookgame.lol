// Web Audio, synthesised — no asset files, nothing to load, a few hundred
// bytes of code instead of a few hundred kilobytes of samples.
//
// Two rules, and both matter:
//
//   1. Create or resume the context inside a user gesture, or iOS leaves it
//      suspended forever and the game is silent with no error to explain it.
//   2. Rising pitch per run step is the cheapest dopamine in game design.
//      Nook *is* a slot machine, so lean on it: every clear pays out in coins
//      and bells, and a long streak climbs the whole way up.
//
// The notes still walk a pentatonic scale, so a long run climbs without ever
// landing on an interval that sounds wrong. That constraint has nothing to do
// with volume — it is what stops a nine-step streak turning into noise.

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Loud. This is a machine that wants your attention. */
const MASTER_GAIN = 0.34;

/** Major pentatonic, in semitones. No interval in it can clash. */
const PENTATONIC = [0, 2, 4, 7, 9];
const BASE_HZ = 392; // G4

function create(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Call from the first real user gesture. Safe to call repeatedly — iOS can
 * re-suspend the context when the tab goes to the background.
 */
export function unlockAudio(): void {
  const context = create();
  if (!context) return;
  if (context.state === 'suspended') void context.resume();

  if (!watchingVisibility) {
    watchingVisibility = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ctx?.state === 'suspended') {
        void ctx.resume();
      }
    });
  }
}

let watchingVisibility = false;

export function setAudioEnabled(value: boolean): void {
  enabled = value;
  if (master && ctx) master.gain.value = value ? MASTER_GAIN : 0;
}

export const audioEnabled = (): boolean => enabled;

interface Note {
  readonly hz: number;
  /** Seconds from now. */
  readonly at?: number;
  readonly duration?: number;
  readonly type?: OscillatorType;
  readonly gain?: number;
  /**
   * Glide to this frequency across the note.
   *
   * **Only ever on notes under ~0.1s.** A pitch glide over a short percussive
   * blip is a transient — the click of a piece landing, the chirp of a coin. A
   * pitch glide over a long note on a rich waveform is a portamento, which is
   * to say a voice, which is to say a sound no puzzle game should be making.
   * If a note needs to last, hold its pitch.
   */
  readonly to?: number;
  /**
   * Cents to detune a second, stacked oscillator by. Two copies of a waveform a
   * few cents apart beat against each other, which is what makes a bell ring
   * rather than beep.
   *
   * Keep it small — under about 6 cents. Wide detune on a sustained note is a
   * slow wobble, and a slow wobble on a sawtooth is the same problem as above.
   */
  readonly detune?: number;
}

function play(note: Note): void {
  if (!enabled) return;
  const context = create();
  if (!context || !master) return;

  // `resume()` is async, so the very first sound of a session — the one fired
  // in the same tick as the unlocking gesture — would be dropped on the floor
  // by a `state !== 'running'` guard. Kick a resume and schedule anyway;
  // a still-suspended context queues the note rather than losing it.
  if (context.state === 'suspended') void context.resume();
  if (context.state === 'closed') return;

  const start = context.currentTime + (note.at ?? 0);
  const duration = note.duration ?? 0.18;
  const peak = note.gain ?? 1;

  // Fast attack, exponential decay. Anything slower reads as a synth pad.
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  env.connect(master);

  const voices = note.detune === undefined ? [0] : [0, note.detune];
  for (const cents of voices) {
    const osc = context.createOscillator();
    osc.type = note.type ?? 'sine';
    osc.frequency.setValueAtTime(note.hz, start);
    if (note.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(note.to, start + duration);
    }
    if (cents !== 0) osc.detune.setValueAtTime(cents, start);
    osc.connect(env);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}

/**
 * One second of white noise, built once and reused.
 *
 * Noise is what separates a machine from a synthesiser: the tick of a coin
 * hitting a tray, the sizzle on a bell, the hiss under a riser. All of it is
 * filtered noise, and it costs one buffer for the whole game.
 */
let noiseBuffer: AudioBuffer | null = null;

function getNoise(context: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) {
    return noiseBuffer;
  }
  const frames = context.sampleRate;
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

interface Hit {
  /** Centre of the bandpass, in Hz. High is a tick; low is a thump. */
  readonly hz: number;
  readonly at?: number;
  readonly duration?: number;
  readonly gain?: number;
  readonly q?: number;
}

/** A burst of filtered noise. The percussion half of the sound design. */
function noise(hit: Hit): void {
  if (!enabled) return;
  const context = create();
  if (!context || !master) return;
  if (context.state === 'suspended') void context.resume();
  if (context.state === 'closed') return;

  const start = context.currentTime + (hit.at ?? 0);
  const duration = hit.duration ?? 0.05;

  const source = context.createBufferSource();
  source.buffer = getNoise(context);
  // Start somewhere random in the buffer so repeated hits are not identical.
  const offset = Math.random() * 0.5;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(hit.hz, start);
  filter.Q.setValueAtTime(hit.q ?? 4, start);

  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(hit.gain ?? 0.4, start + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(env);
  env.connect(master);
  source.start(start, offset, duration + 0.02);
  source.stop(start + duration + 0.02);
}

/** Semitones above the base, as a frequency. */
const step = (semitones: number): number =>
  BASE_HZ * Math.pow(2, semitones / 12);

/** The note for run step `n`, walking up the pentatonic and octave-shifting. */
function runNote(n: number): number {
  const index = Math.max(0, n - 1);
  const octave = Math.floor(index / PENTATONIC.length);
  return step(PENTATONIC[index % PENTATONIC.length]! + octave * 12);
}

// --- the machine's vocabulary ----------------------------------------------

/**
 * Coins into the tray. The workhorse of the whole soundtrack.
 *
 * Each coin is a bright blip plus a noise tick, scattered in time so they land
 * as a cascade rather than a chord. The scatter is the entire trick: perfectly
 * spaced coins sound like a metronome, and slightly uneven ones sound like
 * money falling.
 */
export function soundCoin(count: number, at = 0): void {
  const coins = Math.max(1, Math.min(count, 14));
  for (let i = 0; i < coins; i++) {
    const when = at + i * 0.035 + Math.random() * 0.018;
    const hz = 1400 + Math.random() * 900;
    // Fixed pitch and very short. A coin is a strike, not a note.
    play({ hz, at: when, duration: 0.04, type: 'square', gain: 0.12 });
    noise({ hz: 5200, at: when, duration: 0.03, gain: 0.16, q: 2 });
  }
}

/**
 * A slot bell. Two detuned voices plus a struck transient — the beating
 * between the voices is what makes it ring rather than beep.
 */
export function soundBell(semitones = 0, at = 0, gain = 0.5): void {
  const hz = step(semitones + 12);
  play({ hz, at, duration: 0.6, type: 'triangle', gain, detune: 5 });
  play({ hz: hz * 2.02, at, duration: 0.42, type: 'sine', gain: gain * 0.5 });
  noise({ hz: 6000, at, duration: 0.05, gain: 0.2, q: 1.5 });
}

/**
 * The riser: a mechanical ratchet climbing the scale, played when the jackpot
 * meter is nearly full.
 *
 * Deliberately *stepped* rather than swept. A continuous pitch glide on a rich
 * waveform is a siren at best and something a great deal worse at worst — a
 * slow portamento over a detuned sawtooth is, unmistakably, a moan, and there
 * is no volume at which that is the sound you want a puzzle game to make. Discrete
 * plucks up a pentatonic with a tick on each one read as a reel spinning up,
 * which is what this is supposed to be anyway.
 *
 * The same rule applies everywhere in this file: pitch glides are reserved for
 * things that are short and percussive, where they read as a transient rather
 * than as a voice.
 */
export function soundRiser(seconds = 0.9): void {
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const at = (i / steps) * seconds;
    play({
      hz: step(PENTATONIC[i % PENTATONIC.length]! + Math.floor(i / PENTATONIC.length) * 12),
      at,
      duration: 0.07,
      type: 'square',
      gain: 0.1 + t * 0.14,
    });
    noise({ hz: 2600 + t * 3200, at, duration: 0.035, gain: 0.1 + t * 0.1 });
  }
}

/** The meter filled. Everything the machine has, all at once. */
export function soundJackpot(): void {
  // Bells on the octave, ringing over each other rather than in sequence.
  [0, 4, 7, 12].forEach((semitones, i) => {
    soundBell(semitones, i * 0.09, 0.55);
  });
  // A fast arpeggio underneath, then coins for a good long while.
  [0, 4, 7, 12, 16, 19, 24].forEach((semitones, i) => {
    play({
      hz: step(semitones),
      at: 0.05 + i * 0.045,
      duration: 0.14,
      type: 'square',
      gain: 0.22,
    });
  });
  soundCoin(14, 0.18);
  soundCoin(12, 0.62);
}

// --- the ordinary events ---------------------------------------------------

/** A piece landing. Short, hard, and with a real transient on it. */
export function soundPlace(): void {
  play({ hz: 190, to: 120, duration: 0.08, type: 'triangle', gain: 0.6 });
  noise({ hz: 3200, duration: 0.02, gain: 0.28, q: 2 });
}

/** Lifting a piece out of the tray. */
export function soundPickup(): void {
  play({ hz: 320, to: 420, duration: 0.055, type: 'square', gain: 0.2 });
}

/**
 * Released somewhere it cannot go. A flat, blunt thud — still deliberately not
 * a buzzer, because refusing an input is the one moment the machine should not
 * be celebrating.
 */
export function soundInvalid(): void {
  play({ hz: 150, to: 100, duration: 0.1, type: 'square', gain: 0.35 });
  noise({ hz: 400, duration: 0.06, gain: 0.2 });
}

/** Spending a Key. Metallic, turning, and clearly a different act to a clear. */
export function soundKey(): void {
  noise({ hz: 2400, duration: 0.06, gain: 0.3 });
  play({ hz: step(7), duration: 0.16, type: 'square', gain: 0.42 });
  soundBell(12, 0.08, 0.45);
  soundCoin(5, 0.16);
}

/** A level's objectives all met. Brighter and shorter than swept clean. */
export function soundLevelClear(): void {
  [0, 4, 7, 12].forEach((semitones, i) => {
    soundBell(semitones, i * 0.07, 0.45);
  });
  soundCoin(8, 0.1);
}

/** Tucking into the Nook — its own distinct sound. A quick mechanical clunk. */
export function soundStash(): void {
  play({ hz: 640, to: 380, duration: 0.09, type: 'square', gain: 0.34 });
  noise({ hz: 1800, duration: 0.03, gain: 0.18 });
}

/**
 * A clear. Pitch climbs with the run, a bigger clear stacks the fifth and the
 * octave on top, and coins pour for as long as the clear was big.
 */
export function soundClear(lines: number, run: number): void {
  const hz = runNote(run);
  // Struck, not sung: short triangles with a hard noise transient. The
  // sustained detuned sawtooth this used to be was far too close to a voice.
  noise({ hz: 3600, duration: 0.025, gain: 0.3, q: 2 });
  play({ hz, duration: 0.16, type: 'triangle', gain: 0.5, detune: 4 });
  if (lines >= 2) {
    play({ hz: hz * 1.5, at: 0.05, duration: 0.14, type: 'square', gain: 0.32 });
  }
  if (lines >= 3) {
    play({ hz: hz * 2, at: 0.1, duration: 0.16, type: 'square', gain: 0.28 });
    noise({ hz: 7000, at: 0.1, duration: 0.16, gain: 0.14, q: 1 });
  }
  // Deep into a run even a single deserves a handful of coins.
  soundCoin(lines * 3 + Math.min(run, 5), 0.04);
}

/** Swept clean is rare. Make it count. */
export function soundSweptClean(): void {
  [0, 4, 7, 12, 16].forEach((semitones, i) => {
    soundBell(semitones, i * 0.075, 0.5);
  });
  soundCoin(12, 0.14);
}

/** The alcove opening. Warm, and unmistakably a reward. */
export function soundUnlock(): void {
  soundBell(0, 0, 0.5);
  soundBell(7, 0.11, 0.5);
  soundBell(12, 0.22, 0.55);
  soundCoin(6, 0.16);
}

/**
 * A new personal best. The only fanfare that climbs and stays up — everything
 * else resolves downward or holds.
 */
export function soundNewBest(): void {
  [0, 4, 7, 12, 16, 19].forEach((semitones, i) => {
    play({
      hz: step(semitones),
      at: i * 0.06,
      duration: 0.16,
      type: 'square',
      gain: 0.34,
    });
    soundBell(semitones, i * 0.06, 0.4);
  });
  soundCoin(14, 0.3);
}

/**
 * Nowhere left to put it. Cashing out: a falling run with the coins paid back
 * out at the end of it. Still unhurried, still not a buzzer — the machine is
 * not scolding you, it is settling up.
 */
export function soundGameOver(): void {
  play({ hz: step(4), duration: 0.3, type: 'triangle', gain: 0.4 });
  play({ hz: step(0), at: 0.16, duration: 0.34, type: 'triangle', gain: 0.4 });
  play({ hz: step(-5), at: 0.34, duration: 0.5, type: 'triangle', gain: 0.38 });
  soundCoin(9, 0.5);
}
