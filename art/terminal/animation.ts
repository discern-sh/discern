/**
 * Pure, ANSI-free animation timelines for discern's terminal-art family.
 * Every builder receives the canonical static render and returns it verbatim
 * as the final frame; terminal effects remain the caller's responsibility.
 */

import { DISCERN_MARK, DISCERN_NAME } from "../../src/shared/brand.ts";

/** A semantic animation timeline with no terminal cursor effects. */
export interface DiscernArtAnimation {
  readonly frames: readonly string[];
  readonly frameMs: number;
  readonly finalHoldMs: number;
}

/** Join semantic art rows without claiming the caller's final newline. */
function artRows(rows: readonly string[]): string {
  return rows.join("\n");
}

/** Finish a timeline on the renderer-owned static frame and remove duplicate beats. */
export function finishAnimation(
  staticArt: string,
  candidates: readonly string[],
  frameMs: number,
  finalHoldMs: number,
): DiscernArtAnimation {
  const frames: string[] = [];
  for (const candidate of candidates) {
    if (
      candidate !== staticArt && candidate !== frames[frames.length - 1]
    ) {
      frames.push(candidate);
    }
  }
  frames.push(staticArt);
  return Object.freeze({
    frames: Object.freeze(frames),
    frameMs,
    finalHoldMs,
  });
}

/** Build cumulative row-reveal frames from selected prefix lengths. */
function prefixFrames(
  staticArt: string,
  counts: readonly number[],
): readonly string[] {
  const rows = staticArt.split("\n");
  return counts.map((count) => artRows(rows.slice(0, count)));
}

/** Reveal matching depths from both edges of the canonical name. */
function revealNameEdges(depth: number): string {
  const letters = [...DISCERN_NAME];
  return letters.map((letter, index) =>
    index < depth || index >= letters.length - depth ? letter : " "
  ).join("");
}

/** Open the compact lockup from its center toward both ends of the name. */
export function animateDiscernCompact(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [
      DISCERN_MARK,
      ...[1, 2, 3].map((depth) => `${DISCERN_MARK} ${revealNameEdges(depth)}`),
    ],
    65,
    350,
  );
}

/** Fill the split mark's right half inward before adding its wordmark. */
export function animateDiscernSplit(
  staticArt: string,
): DiscernArtAnimation {
  const left = ["    /|", "   / |", "  /  |", " /___|"];
  const frames = [0, 1, 2, 3, 4].map((depth) =>
    artRows([
      "     /\\",
      ...left.map((prefix, index) => {
        const width = index + 1;
        const fill = Math.min(depth, width);
        return `${prefix}${" ".repeat(width - fill)}${"#".repeat(fill)}\\`;
      }),
    ])
  );
  return finishAnimation(staticArt, frames, 70, 550);
}

/** Radiate signal rails from the filled mark before resolving its name. */
export function animateDiscernSignal(
  staticArt: string,
): DiscernArtAnimation {
  const runs = [8, 7, 6, 5];
  const cores = ["/|#\\", "/ |##\\", "/  |###\\", "/___|####\\"];
  const frames = [0, 2, 4, 6, 8].map((reach) =>
    artRows([
      "         /\\",
      ...cores.map((core, index) => {
        const run = runs[index] ?? 0;
        const rail = Math.min(reach, run);
        return `${" ".repeat(run - rail)}${"-".repeat(rail)}${core}${
          "-".repeat(rail)
        }`;
      }),
    ])
  );
  return finishAnimation(staticArt, frames, 60, 450);
}

/** Close the stamp around the bare lockup one edge at a time. */
export function animateDiscernStamp(
  staticArt: string,
): DiscernArtAnimation {
  const rows = staticArt.split("\n");
  return finishAnimation(
    staticArt,
    [
      artRows([
        "       /\\",
        "      /|#\\",
        `     /_|##\\ ${DISCERN_NAME}`,
      ]),
      artRows(rows.slice(1, 4)),
      artRows(rows.slice(0, 4)),
    ],
    85,
    650,
  );
}

/** Cut the monument into view from left to right. */
export function animateDiscernMonument(
  staticArt: string,
): DiscernArtAnimation {
  const rows = staticArt.split("\n");
  const frames = [8, 16, 24, 32, 40].map((cut) =>
    artRows(rows.map((row) => row.slice(0, cut).trimEnd()))
  );
  return finishAnimation(staticArt, frames, 55, 700);
}

/** Write the resolve trace one completed step at a time. */
export function animateDiscernResolve(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3, 4, 5, 6, 7]),
    80,
    500,
  );
}

/** Drop one more sift row into place on each beat. */
export function animateDiscernSift(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    60,
    600,
  );
}

/** Accumulate the insertion passes until every letter occupies its final slot. */
export function animateDiscernInsertion(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3, 4, 5, 6, 7]),
    90,
    550,
  );
}

/** Add the staggered streams, their merged row, and the final lockup in order. */
export function animateDiscernInterleave(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3]),
    130,
    500,
  );
}

/** Ratchet the name through each authored spacing tier. */
export function animateDiscernCompress(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3, 4]),
    105,
    500,
  );
}

/** Extend the refinement pipeline from outline to filled mark to wordmark. */
export function animateDiscernRefine(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [
      artRows(["   /\\", "  /  \\", " /____\\"]),
      artRows(["   /\\", "  /  \\   ->", " /____\\"]),
      artRows([
        "   /\\          /\\",
        "  /  \\   ->   /|#\\",
        " /____\\      /_|##\\",
      ]),
      artRows([
        "   /\\          /\\",
        "  /  \\   ->   /|#\\   ->",
        " /____\\      /_|##\\",
      ]),
    ],
    110,
    650,
  );
}

/** Descend the mixture through the mark before revealing the separated classes. */
export function animateDiscernSeparate(
  staticArt: string,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    prefixFrames(staticArt, [1, 2, 3, 4, 5, 7, 8]),
    80,
    600,
  );
}

/** Open the focus aperture from an obscured field into the complete lockup. */
export function animateDiscernFocus(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    ["???????", ...prefixFrames(staticArt, [1, 2, 3, 4])],
    90,
    450,
  );
}
