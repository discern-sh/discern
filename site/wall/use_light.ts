/** The shared pointer light. */
import { type RefObject, useEffect } from "react";
import { CARD_LIGHT } from "./Card.tsx";
import { type WallKnobName, wallKnobProperty } from "./tuning/knobs.ts";
import { transitionRunning } from "./use_open_card.ts";
import { NEAR_ATTRIBUTE } from "./use_stage.ts";

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

/**
 * What the stylesheets may turn the reach on and off by: an attribute of the
 * wall root named here, and this media condition. The light asks for the
 * reach again when one of them changes, and at no other change of state, so
 * a stylesheet that set the reach by anything else would change it without
 * the light knowing.
 */
export const LIGHT_REACH_GATES = {
  attributes: [NEAR_ATTRIBUTE],
  media: "(hover: hover)",
} as const;

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
 * The light's pace from the knobs that set it, each read through `knob`.
 * `still` is a visitor who asks for less motion: for them the light neither
 * eases nor fades, and is wherever the pointer is at once.
 */
export function lightPace(
  knob: (name: WallKnobName) => number,
  still: boolean,
): LightPace {
  return {
    ease: still ? 0 : knob("light-ease"),
    fade: still ? 0 : knob("light-fade"),
    span: knob("light-radius"),
  };
}

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
 *   stylesheets' resting values apply.
 * - Between the two it eases toward the pointer over `--wall-light-ease`
 *   milliseconds and stops writing once it has arrived, so a still pointer
 *   costs nothing. A page that scrolls under a still pointer moves the
 *   pointer's place on the wall, and the light follows that the same way.
 * - A visitor who asks for less motion gets neither the fade nor the ease:
 *   the light is where the pointer is, at once.
 * - Touch never moves it, and it holds still while the pointer is over a
 *   modal layer such as an opened card.
 * - It writes nothing while a view transition runs, as `transitionRunning`
 *   says, and takes up from where it stood once the transition has ended.
 *   The browser reports the pointer gone from the wall as a transition
 *   begins, and a light that went down then would redraw the wall on every
 *   frame under pictures that hide it.
 *
 * No pointer handler, scroll handler, or frame reads layout or computed
 * style. A read there makes the browser finish, on the spot, whatever style
 * and layout the page has pending. Everything the light measures, it
 * measures in the report of one `ResizeObserver`, which the browser delivers
 * just after it has laid the page out, when a read costs nothing:
 *
 * - where the wall root is on the page and how far the page has scrolled,
 *   and from those where a still pointer now is on the page;
 * - how far the light reaches, which is the stylesheets' to say;
 * - each card's box inside the root.
 *
 * The observer reports by itself when the root, a card, or the document
 * changes size. What moves the wall or its cards and resizes nothing is
 * followed by asking for a report: the page scrolling under the pointer,
 * anything inside the wall being added, removed, or put in another order,
 * and a change in what `LIGHT_REACH_GATES` names or in the light's own
 * size. Every frame between reports is arithmetic on what the last report
 * found and on the knobs, which are read from the root's inline style.
 *
 * Unmounting removes the listeners, both observers, and every property.
 */
export function useLight(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const page = document.documentElement;
    const still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const gate = globalThis.matchMedia(LIGHT_REACH_GATES.media);
    const cards = new Map<HTMLElement, LitCard>();
    let frame = 0;
    let before: number | null = null;
    let reach = 0;
    let radius = 0;
    let origin: LightPoint = { x: 0, y: 0 };
    let light: Light | null = null;
    let pointer: LightPoint | null = null;
    let client: LightPoint | null = null;

    const knob = (name: WallKnobName): number => {
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
    // The observer reports on a box it has just been given once the browser
    // has next laid the page out, whether or not that box has changed size.
    const again = (target: Element): void => {
      measured.unobserve(target);
      measured.observe(target);
    };
    const step = (now: number): void => {
      frame = 0;
      if (light === null) return;
      // A run held through a view transition begins again with no clock
      // reading, so the time it was held counts for nothing.
      if (transitionRunning()) {
        before = null;
        frame = requestAnimationFrame(step);
        return;
      }
      const pace = lightPace(knob, still.matches);
      // The reach was read for a light of another size.
      if (pace.span !== radius) again(element);
      // A run that began with no clock reading counts its first frame as
      // its beginning.
      const elapsed = before === null ? 0 : now - before;
      light = lightFrame(light, pointer, elapsed, pace);
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
    const head = (when: number | null): void => {
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
    // Where the root is on the page, how far the light reaches, and where a
    // pointer that has not moved now is on the page.
    const locate = (): void => {
      const rect = element.getBoundingClientRect();
      const scroll = { x: globalThis.scrollX, y: globalThis.scrollY };
      origin = {
        x: rect.left + element.clientLeft + scroll.x,
        y: rect.top + element.clientTop + scroll.y,
      };
      radius = knob("light-radius");
      const length = Number.parseFloat(
        getComputedStyle(element).getPropertyValue(LIGHT_REACH),
      );
      reach = Number.isFinite(length) ? length : 0;
      if (client === null) return;
      const at = { x: client.x + scroll.x, y: client.y + scroll.y };
      if (
        pointer !== null &&
        Math.hypot(at.x - pointer.x, at.y - pointer.y) < ARRIVED
      ) return;
      pointer = at;
      head(null);
    };
    // The box of every card now in the wall, and none for a card that left.
    const fit = (): void => {
      const boxes = new Set(
        element.querySelectorAll<HTMLElement>(`.${CARD_LIGHT}`),
      );
      for (const box of boxes) {
        const known = cards.get(box);
        const card = known ?? { box: null, lit: false };
        card.box = boxIn(element, box);
        if (known !== undefined) continue;
        cards.set(box, card);
        measured.observe(box);
      }
      for (const [box, card] of cards) {
        if (boxes.has(box)) continue;
        dim(box, card);
        cards.delete(box);
        measured.unobserve(box);
      }
    };
    // A report on the document alone says the wall may have moved on the
    // page. A report on the root or on a card says the cards may have moved
    // inside the wall as well. Every read comes before any write, and the
    // write waits for a frame of its own while a view transition runs.
    const measured = new ResizeObserver((entries) => {
      locate();
      if (entries.some((entry) => entry.target !== page)) fit();
      if (light === null) return;
      if (transitionRunning()) head(null);
      else draw(light);
    });
    // The page scrolled under a pointer that may not have moved.
    const scrolled = (): void => {
      if (client !== null) again(page);
    };
    // The cards may have changed places, or the reach may have changed.
    const moved = (): void => again(element);
    const changed = new MutationObserver(moved);
    measured.observe(page);
    measured.observe(element);
    changed.observe(element, {
      attributes: true,
      attributeFilter: [...LIGHT_REACH_GATES.attributes],
      childList: true,
      subtree: true,
    });
    gate.addEventListener("change", moved);
    element.addEventListener("pointermove", follow, { passive: true });
    element.addEventListener("pointerleave", leave);
    globalThis.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      gate.removeEventListener("change", moved);
      element.removeEventListener("pointermove", follow);
      element.removeEventListener("pointerleave", leave);
      globalThis.removeEventListener("scroll", scrolled);
      changed.disconnect();
      measured.disconnect();
      cancelAnimationFrame(frame);
      park();
    };
  }, [root]);
}
