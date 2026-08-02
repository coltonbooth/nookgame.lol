// Web Audio, synthesised — no asset files, nothing to load, a few hundred
// bytes of code instead of a few hundred kilobytes of samples.
//
// Two rules from the design doc, and both matter:
//
//   1. Create or resume the context inside a user gesture, or iOS leaves it
//      suspended forever and the game is silent with no error to explain it.
//   2. Rising pitch per run step is the cheapest dopamine in game design —
//      but keep it soft. Nook is not a slot machine.
//
// The notes walk a pentatonic scale, so a long run climbs without ever landing
// on an interval that sounds wrong.

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Deliberately quiet. Turn this up and the whole thing starts to nag. */
const MASTER_GAIN = 0.16;

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
  if (context && context.state === 'suspended') void context.resume();
}

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
  /** Glide to this frequency across the note. */
  readonly to?: number;
}

function play(note: Note): void {
  if (!enabled) return;
  const context = create();
  if (!context || !master || context.state !== 'running') return;

  const start = context.currentTime + (note.at ?? 0);
  const duration = note.duration ?? 0.18;
  const peak = note.gain ?? 1;

  const osc = context.createOscillator();
  osc.type = note.type ?? 'sine';
  osc.frequency.setValueAtTime(note.hz, start);
  if (note.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(note.to, start + duration);
  }

  // Fast attack, exponential decay. Anything slower reads as a synth pad.
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
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

/** A piece landing. Low, short, felt more than heard. */
export function soundPlace(): void {
  play({ hz: 190, to: 130, duration: 0.075, type: 'triangle', gain: 0.5 });
}

/** Tucking into the Nook — its own soft, distinct sound. A small tuck. */
export function soundStash(): void {
  play({ hz: 640, to: 430, duration: 0.09, type: 'sine', gain: 0.35 });
}

/**
 * A clear. Pitch climbs with the run, and a bigger clear adds the fifth above
 * so that four lines at once genuinely sounds bigger than one.
 */
export function soundClear(lines: number, run: number): void {
  const hz = runNote(run);
  play({ hz, duration: 0.22, type: 'sine', gain: 0.7 });
  if (lines >= 2) {
    play({ hz: hz * 1.5, at: 0.045, duration: 0.2, type: 'sine', gain: 0.45 });
  }
  if (lines >= 3) {
    play({ hz: hz * 2, at: 0.09, duration: 0.22, type: 'sine', gain: 0.35 });
  }
}

/** Swept clean is rare. Make it count. */
export function soundSweptClean(): void {
  [0, 4, 7, 12, 16].forEach((semitones, i) => {
    play({
      hz: step(semitones),
      at: i * 0.07,
      duration: 0.4,
      type: 'sine',
      gain: 0.55,
    });
  });
}

/** The alcove opening. Warm, and unmistakably a reward. */
export function soundUnlock(): void {
  play({ hz: step(0), duration: 0.3, type: 'sine', gain: 0.6 });
  play({ hz: step(7), at: 0.1, duration: 0.35, type: 'sine', gain: 0.6 });
  play({ hz: step(12), at: 0.2, duration: 0.5, type: 'sine', gain: 0.5 });
}

/** Nowhere left to put it. Falling, unhurried, not a buzzer. */
export function soundGameOver(): void {
  play({ hz: step(4), duration: 0.5, type: 'sine', gain: 0.45 });
  play({ hz: step(0), at: 0.16, duration: 0.7, type: 'sine', gain: 0.45 });
  play({ hz: step(-5), at: 0.34, duration: 0.9, type: 'sine', gain: 0.4 });
}
