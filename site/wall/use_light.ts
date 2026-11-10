/** The shared pointer light. */
import { type RefObject, useEffect } from "react";

/** The custom properties the light is written to, in viewport pixels. */
const LIGHT_X = "--wall-light-x";
const LIGHT_Y = "--wall-light-y";

/**
 * Follow the pointer with one light for the whole wall.
 *
 * While mounted, the hook writes the pointer's viewport position to
 * `--wall-light-x` and `--wall-light-y` on the wall root, at most once per
 * frame, and removes both when the pointer leaves so the stylesheet's resting
 * value applies. It writes nothing else: the stylesheets turn the two lengths
 * into brightness, never into movement. It reads no layout while the pointer
 * moves, and unmounting removes its listeners and both properties.
 */
export function useLight(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const write = (): void => {
      frame = 0;
      element.style.setProperty(LIGHT_X, `${x}px`);
      element.style.setProperty(LIGHT_Y, `${y}px`);
    };
    const rest = (): void => {
      cancelAnimationFrame(frame);
      frame = 0;
      element.style.removeProperty(LIGHT_X);
      element.style.removeProperty(LIGHT_Y);
    };
    const follow = (event: PointerEvent): void => {
      x = event.clientX;
      y = event.clientY;
      if (frame === 0) frame = requestAnimationFrame(write);
    };
    element.addEventListener("pointermove", follow, { passive: true });
    element.addEventListener("pointerleave", rest);
    return () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerleave", rest);
      rest();
    };
  }, [root]);
}
