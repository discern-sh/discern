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

/** The custom property scroll progress is written to: 0 far, 1 flat. */
const PROGRESS = "--wall-p";

/** The share of one viewport height the visitor scrolls to bring the wall flat. */
const APPROACH_DISTANCE = 0.8;

/**
 * The approach: scrolling brings the wall from far to flat as one plane. It
 * writes scroll progress to `--wall-p` on the wall root, from 0 at the top of
 * the page to 1 after 80% of a viewport, at most once per frame. The
 * stylesheets derive every transform from that one number, and their value
 * without it is 1, so the wall is flat when no stage runs.
 */
export const APPROACH_STAGE: WallStage = {
  id: "approach",
  mount(root: HTMLElement): () => void {
    let frame = 0;
    const write = (): void => {
      frame = 0;
      const distance = globalThis.innerHeight * APPROACH_DISTANCE;
      const progress = distance > 0
        ? Math.min(1, Math.max(0, globalThis.scrollY / distance))
        : 1;
      root.style.setProperty(PROGRESS, progress.toFixed(4));
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(write);
    };
    write();
    globalThis.addEventListener("scroll", schedule, { passive: true });
    globalThis.addEventListener("resize", schedule);
    return () => {
      globalThis.removeEventListener("scroll", schedule);
      globalThis.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      root.style.removeProperty(PROGRESS);
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
