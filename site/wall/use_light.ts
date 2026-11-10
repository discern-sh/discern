/** The shared pointer light. */
import { type RefObject, useEffect } from "react";
import { wallKnobProperty } from "./tuning/knobs.ts";

/** The custom properties the light is written to, in viewport pixels. */
const LIGHT_X = "--wall-light-x";
const LIGHT_Y = "--wall-light-y";

/** A place in the viewport, in pixels. */
export interface LightPoint {
  readonly x: number;
  readonly y: number;
}

/** The part of the viewport the wall can be seen in. */
export interface LightBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Closer to its target than this, in pixels, the light has arrived. */
const ARRIVED = 0.5;

/**
 * Where the light is one frame later: part of the way from `from` to `to`,
 * and `to` itself once it is close enough to count as arrived.
 *
 * `ease` is the time in milliseconds the light takes to close about two
 * thirds of any gap, so the share it covers depends only on the time that has
 * passed and it never overshoots. An `ease` of zero puts the light on its
 * target at once.
 */
export function lightStep(
  from: LightPoint,
  to: LightPoint,
  elapsed: number,
  ease: number,
): LightPoint {
  const share = ease > 0 ? 1 - Math.exp(-Math.max(0, elapsed) / ease) : 1;
  const x = from.x + (to.x - from.x) * share;
  const y = from.y + (to.y - from.y) * share;
  return Math.hypot(to.x - x, to.y - y) < ARRIVED ? to : { x, y };
}

/**
 * The nearest place the light cannot be seen from `point`: straight out
 * through the closest edge of `box`, `reach` pixels past that edge. The light
 * enters from there and leaves to there, so it never appears or vanishes
 * while any of it shows.
 */
export function lightAway(
  point: LightPoint,
  box: LightBox,
  reach: number,
): LightPoint {
  const exits = [
    { gap: point.x - box.left, away: { x: box.left - reach, y: point.y } },
    { gap: box.right - point.x, away: { x: box.right + reach, y: point.y } },
    { gap: point.y - box.top, away: { x: point.x, y: box.top - reach } },
    { gap: box.bottom - point.y, away: { x: point.x, y: box.bottom + reach } },
  ];
  return exits.reduce((nearest, exit) =>
    exit.gap < nearest.gap ? exit : nearest
  ).away;
}

/** Whether a pointer event landed on a modal layer above the wall. */
function overModal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(":modal") !== null;
}

/**
 * Follow the pointer with one light for the whole wall.
 *
 * While a mouse or pen is over the wall, the hook writes where the light is to
 * `--wall-light-x` and `--wall-light-y` on the wall root, at most once per
 * frame. It writes nothing else: the stylesheets turn the two lengths into
 * brightness, never into movement.
 *
 * - The light eases toward the pointer over `--wall-light-ease` milliseconds
 *   and stops writing once it has arrived, so a still pointer costs nothing.
 * - It glides in from just out of sight when the pointer arrives, and out
 *   again when the pointer leaves, then removes both properties so the
 *   stylesheet's resting value applies. It never appears or vanishes in view.
 * - Touch never moves it, and it holds still while the pointer is over a
 *   modal layer such as an opened card.
 *
 * The wall is measured once as the light enters and once as it leaves, never
 * while the pointer moves. Unmounting removes the listeners and both
 * properties.
 */
export function useLight(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    let frame = 0;
    let before = 0;
    let ease = 0;
    let at: LightPoint | null = null;
    let to: LightPoint = { x: 0, y: 0 };
    let leaving = false;

    const knob = (name: "light-ease" | "light-radius"): number => {
      const value = Number.parseFloat(
        element.style.getPropertyValue(wallKnobProperty(name)),
      );
      return Number.isFinite(value) ? value : 0;
    };
    const seen = (): LightBox => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.max(rect.left, 0),
        top: Math.max(rect.top, 0),
        right: Math.min(rect.right, globalThis.innerWidth),
        bottom: Math.min(rect.bottom, globalThis.innerHeight),
      };
    };
    const park = (): void => {
      at = null;
      element.style.removeProperty(LIGHT_X);
      element.style.removeProperty(LIGHT_Y);
    };
    const step = (now: number): void => {
      frame = 0;
      if (at === null) return;
      at = lightStep(at, to, now - before, ease);
      before = now;
      if (at === to && leaving) {
        park();
        return;
      }
      element.style.setProperty(LIGHT_X, `${at.x.toFixed(1)}px`);
      element.style.setProperty(LIGHT_Y, `${at.y.toFixed(1)}px`);
      if (at !== to) frame = requestAnimationFrame(step);
    };
    const head = (target: LightPoint, away: boolean, when: number): void => {
      to = target;
      leaving = away;
      if (frame !== 0) return;
      ease = knob("light-ease");
      before = when;
      frame = requestAnimationFrame(step);
    };
    const follow = (event: PointerEvent): void => {
      if (event.pointerType === "touch" || overModal(event.target)) return;
      const pointer = { x: event.clientX, y: event.clientY };
      at ??= lightAway(pointer, seen(), knob("light-radius"));
      head(pointer, false, event.timeStamp);
    };
    const leave = (event: PointerEvent): void => {
      if (event.pointerType === "touch" || at === null) return;
      const pointer = { x: event.clientX, y: event.clientY };
      head(
        lightAway(pointer, seen(), knob("light-radius")),
        true,
        event.timeStamp,
      );
    };
    element.addEventListener("pointermove", follow, { passive: true });
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
      park();
    };
  }, [root]);
}
