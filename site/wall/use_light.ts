/** The shared pointer light. */
import { type RefObject, useEffect } from "react";
import { CARD_LIGHT } from "./Card.tsx";
import { wallKnobProperty } from "./tuning/knobs.ts";

/**
 * Every custom property the light writes while it moves, by the element it
 * is written on. The stylesheets register each one so that it does not
 * inherit: a new value stays on the element that carries it. A property
 * written every frame that did inherit would restyle everything below that
 * element every frame, which for the wall root is the whole wall.
 */
export const LIGHT_PROPERTIES = {
  /** On the wall root: where the light is, from the root's top left corner
   * in pixels, and how far it has come up, from 0 to 1. */
  room: ["--wall-light-x", "--wall-light-y", "--wall-light-on"],
  /** On the light box of each card the light reaches: the same three,
   * measured from that card's own top left corner. */
  card: ["--wall-card-light-x", "--wall-card-light-y", "--wall-card-light-on"],
} as const;

/**
 * The stylesheet's word on how far from the light a card's border catches it
 * at this moment, as a length on the wall root. Zero means no card takes the
 * light, which is the case while the wall is far and on a screen with no
 * pointer to follow.
 */
export const LIGHT_REACH = "--wall-light-reach";

/** A place, in pixels. */
export interface LightPoint {
  readonly x: number;
  readonly y: number;
}

/** A box, by its edges in pixels. */
export interface LightBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The light at one moment. */
export interface Light {
  /** Where it is. */
  readonly at: LightPoint;
  /** How far it has come up: 0 is dark and 1 is fully up. */
  readonly on: number;
}

/** How the light keeps pace with the pointer. */
export interface LightPace {
  /** Milliseconds the light takes to close about two thirds of any gap. */
  readonly ease: number;
  /** Milliseconds the light takes to come up or to go down. Zero cuts. */
  readonly fade: number;
  /** The farthest the light travels to reach the pointer, in pixels. */
  readonly span: number;
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
 * The light one frame later, given where the pointer is, or `null` once the
 * pointer has gone.
 *
 * The light comes up where the pointer is and goes down where it stands, so
 * nothing ever sweeps in from or out to an edge. While it is up it follows
 * the pointer, easing as `lightStep` does. It follows only as far as
 * `pace.span`: when the pointer is suddenly farther off than that, the light
 * goes down in place and comes up again at the pointer. A `pace.fade` of zero
 * makes each of those changes at once.
 *
 * The light has settled, and the next frame would change nothing, when its
 * place is `pointer` itself and it is fully up.
 */
export function lightFrame(
  light: Light,
  pointer: LightPoint | null,
  elapsed: number,
  pace: LightPace,
): Light {
  const change = pace.fade > 0 ? Math.max(0, elapsed) / pace.fade : 1;
  const stranded = pointer === null || (light.on > 0 &&
    Math.hypot(pointer.x - light.at.x, pointer.y - light.at.y) > pace.span);
  if (stranded) return { at: light.at, on: Math.max(0, light.on - change) };
  return {
    at: light.on > 0
      ? lightStep(light.at, pointer, elapsed, pace.ease)
      : pointer,
    on: Math.min(1, light.on + change),
  };
}

/** How far `point` lies from the nearest part of `box`: zero inside it. */
export function lightGap(point: LightPoint, box: LightBox): number {
  return Math.hypot(
    Math.max(box.left - point.x, 0, point.x - box.right),
    Math.max(box.top - point.y, 0, point.y - box.bottom),
  );
}

/** How bright the light is for how far it has come up: gentle at both ends. */
function shown(on: number): string {
  return (on * on * (3 - 2 * on)).toFixed(3);
}

/** Whether a pointer event landed on a modal layer above the wall. */
function overModal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(":modal") !== null;
}

/**
 * Where `element` was laid out inside `root`, from the root's top left
 * corner. Layout offsets ignore transforms, so a face that has lifted, or a
 * plane that is tilted away, reads the same as one at rest. `null` when the
 * element is not laid out under `root` at all.
 */
function boxIn(root: HTMLElement, element: HTMLElement): LightBox | null {
  let left = 0;
  let top = 0;
  let node: HTMLElement = element;
  while (node !== root) {
    const parent = node.offsetParent;
    if (!(parent instanceof HTMLElement) || !root.contains(parent)) return null;
    left += node.offsetLeft + (parent === root ? 0 : parent.clientLeft);
    top += node.offsetTop + (parent === root ? 0 : parent.clientTop);
    node = parent;
  }
  return {
    left,
    top,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
  };
}

/** One card the light may reach, by the box that draws the light on it. */
interface LitCard {
  /** Its box inside the wall root, or `null` while it is not laid out. */
  box: LightBox | null;
  /** Whether it carries the light's properties now. */
  lit: boolean;
}

/** Set every property in `names` on `element`, each to its value in turn. */
function write(
  element: HTMLElement,
  names: readonly string[],
  values: readonly string[],
): void {
  names.forEach((name, index) =>
    element.style.setProperty(name, values[index] ?? "")
  );
}

/** Remove every property in `names` from `element`. */
function clear(element: HTMLElement, names: readonly string[]): void {
  for (const name of names) element.style.removeProperty(name);
}

/** A length in pixels as the stylesheets read it. */
function px(length: number): string {
  return `${length.toFixed(1)}px`;
}

/**
 * Follow the pointer with one light for the whole wall.
 *
 * While a mouse or pen is over the wall, the hook writes where the light is
 * and how far it has come up, at most once per frame, and nowhere but here:
 *
 * - on the wall root, as `LIGHT_PROPERTIES.room`, for the glow on the canvas;
 * - on the light box of each card within `LIGHT_REACH` of the light, as
 *   `LIGHT_PROPERTIES.card`, for the light that card's border catches.
 *
 * So a frame of pointer travel restyles the root, with the three sections
 * directly under it, and the light boxes of the few cards near the pointer,
 * however many cards the wall holds. The stylesheets turn the values into
 * brightness, never into movement.
 *
 * - The light comes up in place where the pointer arrives and goes down in
 *   place when the pointer leaves, then every property is removed and the
 *   stylesheets' resting values apply. A visitor who asks for less motion
 *   gets both at once.
 * - Between the two it eases toward the pointer over `--wall-light-ease`
 *   milliseconds and stops writing once it has arrived, so a still pointer
 *   costs nothing. A page that scrolls under a still pointer moves the
 *   pointer's place on the wall, and the light follows that the same way.
 * - Touch never moves it, and it holds still while the pointer is over a
 *   modal layer such as an opened card.
 *
 * Nothing here reads layout while the pointer moves or the page scrolls. The
 * root's place on the page and each card's box inside the root are measured
 * when the browser reports that one of them changed size, and every frame
 * after that is arithmetic on those, on the knobs, and on `LIGHT_REACH`,
 * which the hook reads afresh each frame because the wall can arrive or
 * leave under a pointer that never moves. Unmounting removes the listeners,
 * the observer, and every property.
 */
export function useLight(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const cards = new Map<HTMLElement, LitCard>();
    let frame = 0;
    let before = 0;
    let pace: LightPace = { ease: 0, fade: 0, span: 0 };
    let reach = 0;
    let origin: LightPoint = { x: 0, y: 0 };
    let light: Light | null = null;
    let pointer: LightPoint | null = null;
    let client: LightPoint | null = null;

    const knob = (
      name: "light-ease" | "light-fade" | "light-radius",
    ): number => {
      const value = Number.parseFloat(
        element.style.getPropertyValue(wallKnobProperty(name)),
      );
      return Number.isFinite(value) ? value : 0;
    };
    const dim = (box: HTMLElement, card: LitCard): void => {
      if (!card.lit) return;
      card.lit = false;
      clear(box, LIGHT_PROPERTIES.card);
    };
    const draw = (now: Light): void => {
      const at = { x: now.at.x - origin.x, y: now.at.y - origin.y };
      const on = shown(now.on);
      write(element, LIGHT_PROPERTIES.room, [px(at.x), px(at.y), on]);
      for (const [box, card] of cards) {
        if (card.box === null || !(lightGap(at, card.box) < reach)) {
          dim(box, card);
          continue;
        }
        card.lit = true;
        write(box, LIGHT_PROPERTIES.card, [
          px(at.x - card.box.left),
          px(at.y - card.box.top),
          on,
        ]);
      }
    };
    const park = (): void => {
      light = null;
      clear(element, LIGHT_PROPERTIES.room);
      for (const [box, card] of cards) dim(box, card);
    };
    const pick = (): void => {
      const still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
      pace = {
        ease: knob("light-ease"),
        fade: still.matches ? 0 : knob("light-fade"),
        span: knob("light-radius"),
      };
      const length = Number.parseFloat(
        getComputedStyle(element).getPropertyValue(LIGHT_REACH),
      );
      reach = Number.isFinite(length) ? length : 0;
    };
    const step = (now: number): void => {
      frame = 0;
      if (light === null) return;
      pick();
      light = lightFrame(light, pointer, now - before, pace);
      before = now;
      if (pointer === null && light.on === 0) {
        park();
        return;
      }
      draw(light);
      if (light.at !== pointer || light.on < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    const head = (when: number): void => {
      if (frame !== 0) return;
      before = when;
      frame = requestAnimationFrame(step);
    };
    const follow = (event: PointerEvent): void => {
      if (event.pointerType === "touch" || overModal(event.target)) return;
      client = { x: event.clientX, y: event.clientY };
      pointer = { x: event.pageX, y: event.pageY };
      light ??= { at: pointer, on: 0 };
      head(event.timeStamp);
    };
    const leave = (event: PointerEvent): void => {
      if (event.pointerType === "touch" || light === null) return;
      client = null;
      pointer = null;
      head(event.timeStamp);
    };
    const scrolled = (event: Event): void => {
      if (client === null) return;
      pointer = {
        x: client.x + globalThis.scrollX,
        y: client.y + globalThis.scrollY,
      };
      head(event.timeStamp);
    };
    const measured = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      origin = {
        x: rect.left + element.clientLeft + globalThis.scrollX,
        y: rect.top + element.clientTop + globalThis.scrollY,
      };
      const boxes = new Set(
        element.querySelectorAll<HTMLElement>(`.${CARD_LIGHT}`),
      );
      for (const [box, card] of cards) {
        if (boxes.has(box)) continue;
        dim(box, card);
        cards.delete(box);
        measured.unobserve(box);
      }
      for (const box of boxes) {
        const known = cards.get(box);
        const card = known ?? { box: null, lit: false };
        card.box = boxIn(element, box);
        if (known !== undefined) continue;
        cards.set(box, card);
        measured.observe(box);
      }
      if (light !== null) draw(light);
    });
    measured.observe(element);
    element.addEventListener("pointermove", follow, { passive: true });
    element.addEventListener("pointerleave", leave);
    globalThis.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerleave", leave);
      globalThis.removeEventListener("scroll", scrolled);
      measured.disconnect();
      cancelAnimationFrame(frame);
      park();
    };
  }, [root]);
}
