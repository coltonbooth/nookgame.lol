// Whether to animate, and who gets to decide.
//
// This used to be a bare `window.matchMedia(...)` evaluated at every call site,
// several times a frame — and `matchMedia` builds a fresh `MediaQueryList`
// every time you call it. Here it is read once, kept current by a listener, and
// handed out as a plain boolean.
//
// The OS preference is the default, not the last word: a player who wants the
// particles on a machine that asks for calm should be able to say so, and a
// player on a machine that never asks should be able to turn them off.

const QUERY = '(prefers-reduced-motion: reduce)';

let systemPrefers = false;
/** null = follow the system. true/false = the player has overridden it. */
let override: boolean | null = null;

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const list = window.matchMedia(QUERY);
  systemPrefers = list.matches;
  const onChange = (e: MediaQueryListEvent): void => {
    systemPrefers = e.matches;
  };
  // Safari below 14 only has the deprecated form.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
  } else {
    (list as MediaQueryList).addListener(onChange);
  }
}

/** True when animation should be suppressed. Cheap enough to call per frame. */
export const reducedMotion = (): boolean => override ?? systemPrefers;

/** What the OS asked for, ignoring any override. Drives the settings default. */
export const systemReducedMotion = (): boolean => systemPrefers;

/** Pass null to go back to following the system. */
export function setReducedMotion(value: boolean | null): void {
  override = value;
}

export const reducedMotionOverride = (): boolean | null => override;
