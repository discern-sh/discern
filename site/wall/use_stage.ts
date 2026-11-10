/** The wall's stage: what moves the wall as a whole. */
import { type RefObject, useEffect } from "react";

/**
 * One way of staging the wall. A stage drives the wall root from outside React
 * and puts everything back when it stops, so another stage can replace it.
 */
export interface WallStage {
  /** Stable name, written to the wall root as `data-wall-stage` while mounted. */
  readonly id: string;
  /** Start driving `root`. Returns the function that stops and restores it. */
  readonly mount: (root: HTMLElement) => () => void;
}

/**
 * The wall root carries this attribute whenever the plane is flat and has no
 * transform at all. Stylesheets scope to it anything that needs viewport-fixed
 * coordinates, which a transformed ancestor breaks.
 */
const NEAR = "data-wall-near";

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
 * The approach: scrolling brings the wall from far to flat as one plane.
 *
 * The stylesheet performs the motion as a scroll-driven animation that the
 * pool's exit from the viewport times, so it runs with no script and is right
 * on the first paint. This stage only reports where the plane has got to. It
 * sets `data-wall-near` on the wall root while the plane is flat, which is
 * always where no approach is staged and, where one is, from the moment the
 * pool has left the viewport until any part of it returns. The stylesheet
 * stands its animation down in that state, so a near plane carries no
 * transform. The stage moves nothing and measures nothing while the page
 * scrolls: the browser reports the pool's crossing.
 *
 * One thing it does start. A card that takes keyboard focus while the plane
 * is far is too small to read, so the stage scrolls the pool away and the
 * wall arrives under the focus.
 */
export const APPROACH_STAGE: WallStage = {
  id: "approach",
  mount(root: HTMLElement): () => void {
    const pool = root.querySelector(".wall-pool");
    if (pool === null) {
      root.setAttribute(NEAR, "");
      return () => root.removeAttribute(NEAR);
    }
    let poolInView = pool.getBoundingClientRect().bottom >= POOL_EDGE;
    let frame = 0;
    const settle = (): void => {
      frame = 0;
      root.toggleAttribute(NEAR, !(poolInView && approachIsStaged(pool)));
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
    const arrive = (event: FocusEvent): void => {
      const focused = event.target;
      if (root.hasAttribute(NEAR) || !(focused instanceof Element)) return;
      if (
        focused.closest(".wall-plane") === null ||
        !focused.matches(":focus-visible")
      ) return;
      globalThis.scrollBy({
        top: pool.getBoundingClientRect().bottom,
        behavior: "smooth",
      });
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
    root.addEventListener("focusin", arrive);
    globalThis.addEventListener("resize", schedule);
    for (const preference of preferences) {
      preference.addEventListener("change", schedule);
    }
    return () => {
      crossing.disconnect();
      root.removeEventListener("focusin", arrive);
      globalThis.removeEventListener("resize", schedule);
      for (const preference of preferences) {
        preference.removeEventListener("change", schedule);
      }
      cancelAnimationFrame(frame);
      root.removeAttribute(NEAR);
    };
  },
};

/**
 * Run one stage on the wall root for as long as the component is mounted.
 * Mounting marks the root with `data-wall-stage="<id>"`; unmounting, or a
 * change of stage, stops the stage and removes the mark.
 */
export function useStage(
  root: RefObject<HTMLElement>,
  stage: WallStage = APPROACH_STAGE,
): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    element.dataset.wallStage = stage.id;
    const stop = stage.mount(element);
    return () => {
      stop();
      delete element.dataset.wallStage;
    };
  }, [root, stage]);
}
