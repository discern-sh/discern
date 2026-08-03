/** Curated motion and enrollment contracts for discern's terminal-art family. */

import { assert, assertEquals } from "@std/assert";
import {
  DISCERN_ART_VARIANTS,
  type DiscernArtStyle,
  renderDiscernArt,
  renderDiscernArtAnimation,
} from "../src/shared/brand_art.ts";

interface ExpectedMotion {
  readonly frameCount: number;
  readonly frameMs: number;
  readonly finalHoldMs: number;
  readonly opening: string;
}

const EXPECTED_MOTION: Readonly<Record<DiscernArtStyle, ExpectedMotion>> = {
  compact: {
    frameCount: 5,
    frameMs: 65,
    finalHoldMs: 350,
    opening: "◮",
  },
  split: {
    frameCount: 6,
    frameMs: 70,
    finalHoldMs: 550,
    opening: [
      "     /\\",
      "    /| \\",
      "   / |  \\",
      "  /  |   \\",
      " /___|    \\",
    ].join("\n"),
  },
  signal: {
    frameCount: 6,
    frameMs: 60,
    finalHoldMs: 450,
    opening: [
      "         /\\",
      "        /|#\\",
      "       / |##\\",
      "      /  |###\\",
      "     /___|####\\",
    ].join("\n"),
  },
  stamp: {
    frameCount: 4,
    frameMs: 85,
    finalHoldMs: 650,
    opening: [
      "       /\\",
      "      /|#\\",
      "     /_|##\\ discern",
    ].join("\n"),
  },
  monument: {
    frameCount: 6,
    frameMs: 55,
    finalHoldMs: 700,
    opening: [
      "    /\\",
      "   /|#\\",
      "  / |##\\",
      " /  |###",
      "/___|###",
    ].join("\n"),
  },
  resolve: {
    frameCount: 8,
    frameMs: 80,
    finalHoldMs: 500,
    opening: "◮",
  },
  sift: {
    frameCount: 11,
    frameMs: 60,
    finalHoldMs: 600,
    opening: ".      :      #",
  },
  insertion: {
    frameCount: 8,
    frameMs: 90,
    finalHoldMs: 550,
    opening: "n r e c s i d",
  },
  interleave: {
    frameCount: 4,
    frameMs: 130,
    finalHoldMs: 500,
    opening: "d       s       e       n",
  },
  compress: {
    frameCount: 5,
    frameMs: 105,
    finalHoldMs: 500,
    opening: "d   i   s   c   e   r   n",
  },
  refine: {
    frameCount: 5,
    frameMs: 110,
    finalHoldMs: 650,
    opening: ["   /\\", "  /  \\", " /____\\"].join("\n"),
  },
  separate: {
    frameCount: 8,
    frameMs: 80,
    finalHoldMs: 600,
    opening: ". # . # . # . #",
  },
  focus: {
    frameCount: 6,
    frameMs: 90,
    finalHoldMs: 450,
    opening: "???????",
  },
};

Deno.test("every static art member enrolls in its curated motion contract", () => {
  assertEquals(Object.keys(DISCERN_ART_VARIANTS), Object.keys(EXPECTED_MOTION));
  for (const style of Object.keys(EXPECTED_MOTION) as DiscernArtStyle[]) {
    const animation = renderDiscernArtAnimation(style);
    const expected = EXPECTED_MOTION[style];
    assertEquals(animation, DISCERN_ART_VARIANTS[style].animate(), style);
    assertEquals(animation.frames.length, expected.frameCount, style);
    assertEquals(animation.frameMs, expected.frameMs, style);
    assertEquals(animation.finalHoldMs, expected.finalHoldMs, style);
    assertEquals(animation.frames[0], expected.opening, style);
    assertEquals(animation.frames.at(-1), renderDiscernArt(style), style);
  }
});

Deno.test("animation timelines stay deterministic, distinct, and visibly active", () => {
  const seen = new Set<string>();
  for (const [style, variant] of Object.entries(DISCERN_ART_VARIANTS)) {
    const first = variant.animate();
    const second = variant.animate();
    assertEquals(second, first, `${style} must be deterministic`);
    assert(first.frames.length >= 2, `${style} needs more than one frame`);
    assert(
      first.frames.some((frame) => frame !== variant.render()),
      `${style} needs motion before its static frame`,
    );
    for (let index = 1; index < first.frames.length; index += 1) {
      assert(
        first.frames[index] !== first.frames[index - 1],
        `${style} repeats adjacent frame ${index + 1}`,
      );
    }
    const signature = JSON.stringify(first.frames);
    assert(!seen.has(signature), `${style} duplicates another timeline`);
    seen.add(signature);
  }
});

Deno.test("semantic animation frames remain safe for terminal composition", () => {
  for (const [style, variant] of Object.entries(DISCERN_ART_VARIANTS)) {
    for (const [index, frame] of variant.animate().frames.entries()) {
      const label = `${style} frame ${index + 1}`;
      assert(frame !== "", `${label} must not be empty`);
      assert(!frame.endsWith("\n"), `${label} owns a final newline`);
      for (const character of frame) {
        assert(
          character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
          `${label} contains terminal control ${JSON.stringify(character)}`,
        );
        if (variant.charset === "ascii") {
          const code = character.codePointAt(0) ?? 0;
          assert(
            character === "\n" || (code >= 0x20 && code <= 0x7e),
            `${label} contains non-ASCII ${JSON.stringify(character)}`,
          );
        }
      }
      for (const line of frame.split("\n")) {
        assert(
          !/\s$/u.test(line),
          `${label} has trailing whitespace: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});
