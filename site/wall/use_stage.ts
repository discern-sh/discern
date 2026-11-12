/** The wall's stage: what moves the wall as a whole. */
import { type RefObject, useEffect } from "react";

/**
 * One way of staging the wall. A stage drives the wall root from outside React
 * and restores the root when it stops, so another stage can replace it.
 */
export interface WallStage {
  /** Start driving `root`. Returns the function that stops and restores it. */
  readonly mount: (root: HTMLElement) => () => void;
}

/**
 * The wall root carries this attribute whenever the plane is flat and has no
 * transform at all. Stylesheets scope to it what belongs to the flat wall
 * alone, such as the pointer light's reach onto cards.
 */
export const NEAR_ATTRIBUTE = "data-wall-near";

/** The stage: the lens bar, the plane, and the link past the cards. */
const STAGE = ".wall-stage";

/**
 * Matches the stage while the keyboard's focus is on it: on the link past the
 * cards, a lens chip, or a card. A card in the far view is too small to read,
 * and the browser cannot scroll to a card that is drawn where it does not
 * lie, so keyboard focus on the stage means a flat plane.
 *
 * The stylesheet says so by itself, with no script: in `wall.css` the stage's
 * own far-view rules stand down on this selector, and the plane's and the
 * lens bar's stand down on the part of it each can see. The approach marks
 * the root `data-wall-near` on the same selector, so the plane is flat under
 * a focused lens chip too, and everything else that is scoped to the flat
 * wall agrees with the plane.
 *
 * The pause control is left out. It belongs to the far view, and holding the
 * focus must not end the view it pauses.
 */
export const KEYBOARD_ON_STAGE = ":has(:focus-visible:not(.wall-pause))";

/** Matches a link or a button while a pointer or a key presses it. */
const PRESSED_CONTROL = ":is(a[href], button):active";

/**
 * How much of the pool, in pixels from the top of the viewport, must still
 * show for the pool to count as in view. An observer reports a box that only
 * touches the viewport's edge as intersecting, and a pool whose last row has
 * reached that edge has timed the approach to its end.
 */
const POOL_EDGE = 1;

/**
 * Whether the stylesheet stages an approach in this browser, at this size,
 * for this visitor. The stylesheet alone decides that: where it stages one, it
 * names a view timeline on the pool, and the name is what this reads.
 */
function approachIsStaged(pool: Element): boolean {
  const timeline = getComputedStyle(pool).getPropertyValue(
    "view-timeline-name",
  ).trim();
  return timeline !== "" && timeline !== "none";
}

/**
 * Whether the keyboard's focus is on the stage now. A browser that cannot
 * read the selector stages no approach either, and answers no.
 */
function keyboardOnStage(stage: Element | null): boolean {
  return stage !== null && CSS.supports(`selector(${KEYBOARD_ON_STAGE})`) &&
    stage.matches(KEYBOARD_ON_STAGE);
}

/** Whether what holds the focus lies in a modal layer over the page. */
function inModalLayer(holder: EventTarget | null): boolean {
  return holder instanceof Element && holder.closest("dialog") !== null;
}

/** Whether what holds the focus lies on the stage. */
function onStage(stage: Element | null, holder: EventTarget | null): boolean {
  return stage !== null && holder instanceof Node && stage.contains(holder);
}

/**
 * Whether one of the stage's controls is being pressed now. Some browsers
 * give a pressed button no focus and take the focus from whatever held it,
 * so the focus can go nowhere while the visitor is still at the stage.
 */
function pressingStage(stage: Element | null): boolean {
  return stage !== null && stage.querySelector(PRESSED_CONTROL) !== null;
}

/**
 * The approach: scrolling brings the wall from far to flat as one plane.
 *
 * The stylesheet performs the motion as a scroll-driven animation that the
 * pool's exit from the viewport times, so it runs with no script and is right
 * on the first paint. This stage only reports where the plane has got to. It
 * sets `data-wall-near` on the wall root while the plane is flat:
 *
 * - always, where no approach is staged;
 * - where one is, from the moment the pool has left the viewport until any
 *   part of it returns;
 * - while the keyboard's focus is on the stage, as `KEYBOARD_ON_STAGE` says,
 *   and from then on for as long as the focus stays anywhere on the stage,
 *   whatever moves it. A pointer's press takes the focus without the
 *   keyboard's mark, and a plane that tilted away under the press would carry
 *   the pressed card or chip out from under the pointer before the click. A
 *   press on one of the stage's controls that leaves the focus nowhere keeps
 *   the plane flat too. The far view returns when the focus leaves the stage
 *   any other way. A modal layer that takes the focus from the stage, as an
 *   opened card does, leaves the plane as it was until the focus comes back
 *   out.
 *
 * The stylesheet stands its animation down in that state, so a near plane
 * carries no transform. The stage moves nothing, scrolls nothing, and measures
 * nothing while the page scrolls: the browser reports the pool's crossing,
 * and the browser brings a focused card into view by itself, on a plane that
 * is already flat.
 */
export const APPROACH_STAGE: WallStage = {
  mount(root: HTMLElement): () => void {
    const pool = root.querySelector(".wall-pool");
    if (pool === null) {
      root.setAttribute(NEAR_ATTRIBUTE, "");
      return () => root.removeAttribute(NEAR_ATTRIBUTE);
    }
    const stage = root.querySelector(STAGE);
    let poolInView = pool.getBoundingClientRect().bottom >= POOL_EDGE;
    let keyboard = keyboardOnStage(stage);
    let frame = 0;
    const settle = (): void => {
      frame = 0;
      root.toggleAttribute(
        NEAR_ATTRIBUTE,
        keyboard || !(poolInView && approachIsStaged(pool)),
      );
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(settle);
    };
    const crossing = new IntersectionObserver((entries) => {
      const latest = entries.at(-1);
      if (latest === undefined) return;
      poolInView = latest.isIntersecting;
      settle();
    }, { rootMargin: `-${POOL_EDGE}px 0px 0px 0px` });
    // The focus changes hands, or a key turns focus that a pointer placed
    // into the keyboard's, which no change of focus reports.
    const refocus = (event: FocusEvent | KeyboardEvent): void => {
      const leaving = event instanceof FocusEvent && event.type === "focusout";
      const holder = leaving ? event.relatedTarget : event.target;
      // A modal layer borrows the focus, so the plane stays as it is until
      // the focus comes back out. Focus that moves within the wall is read
      // as it arrives, not as it leaves.
      if (inModalLayer(holder)) return;
      if (leaving && holder instanceof Node && root.contains(holder)) return;
      // A stage that lies flat for the keyboard stays flat while the focus
      // is anywhere on it, and through a press that takes the focus away.
      const kept = keyboard &&
        (leaving ? pressingStage(stage) : onStage(stage, holder));
      const held = kept || (!leaving && keyboardOnStage(stage));
      if (held === keyboard) return;
      keyboard = held;
      settle();
    };
    // Motion and pointer preferences can change what the stylesheet stages
    // without the window changing size.
    const preferences = [
      "(prefers-reduced-motion: reduce)",
      "(pointer: fine)",
      "(forced-colors: active)",
    ].map((query) => globalThis.matchMedia(query));
    settle();
    crossing.observe(pool);
    root.addEventListener("focusin", refocus);
    root.addEventListener("focusout", refocus);
    root.addEventListener("keydown", refocus);
    globalThis.addEventListener("resize", schedule);
    for (const preference of preferences) {
      preference.addEventListener("change", schedule);
    }
    return () => {
      crossing.disconnect();
      root.removeEventListener("focusin", refocus);
      root.removeEventListener("focusout", refocus);
      root.removeEventListener("keydown", refocus);
      globalThis.removeEventListener("resize", schedule);
      for (const preference of preferences) {
        preference.removeEventListener("change", schedule);
      }
      cancelAnimationFrame(frame);
      root.removeAttribute(NEAR_ATTRIBUTE);
    };
  },
};

/**
 * Run one stage on the wall root for as long as the component is mounted.
 * Unmounting, or a change of stage, stops the stage and restores the root.
 */
export function useStage(
  root: RefObject<HTMLElement>,
  stage: WallStage = APPROACH_STAGE,
): void {
  useEffect(() => {
    const element = root.current;
    return element === null ? undefined : stage.mount(element);
  }, [root, stage]);
}
