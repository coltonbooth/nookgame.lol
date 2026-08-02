// Pointer Events only — one code path for touch, mouse and stylus. Anything
// that branches on "is this a phone" belongs further up, not here.

export interface PointerInfo {
  /** CSS pixels, relative to the element's top-left. */
  readonly x: number;
  readonly y: number;
  /** Touch and pen get the finger-occlusion offset; mouse does not. */
  readonly occluding: boolean;
}

export interface PointerHandlers {
  onDown(p: PointerInfo): void;
  onMove(p: PointerInfo): void;
  onUp(p: PointerInfo): void;
  onCancel(): void;
}

export function attachPointer(
  element: HTMLElement,
  handlers: PointerHandlers,
): () => void {
  let activeId: number | null = null;

  const info = (event: PointerEvent): PointerInfo => {
    const rect = element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      occluding: event.pointerType !== 'mouse',
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (activeId !== null || !event.isPrimary) return;
    activeId = event.pointerId;
    // Capture so the drag survives the pointer leaving the canvas.
    element.setPointerCapture(event.pointerId);
    handlers.onDown(info(event));
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activeId) return;
    handlers.onMove(info(event));
  };

  const release = (event: PointerEvent): void => {
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    activeId = null;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activeId) return;
    const p = info(event);
    release(event);
    handlers.onUp(p);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== activeId) return;
    release(event);
    handlers.onCancel();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  // Belt and braces: iOS still fires this in a few edge cases.
  element.addEventListener('contextmenu', preventDefault);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('contextmenu', preventDefault);
  };
}

const preventDefault = (event: Event): void => event.preventDefault();
