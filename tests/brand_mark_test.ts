/**
 * The canonical text mark: its codepoint pin, the README's wordmark opening,
 * and the sweep that keeps mark-family glyph literals at their homes.
 *
 * The law: authored JavaScript/TypeScript spells a mark-family glyph only at
 * its defining constant or inside a golden test that pins rendered frames;
 * every other module imports `DISCERN_MARK` or `DISCERN_TRIANGLE_GLYPHS` so
 * each glyph stays defined once. Prose and stylesheets carry the glyph as
 * content, and their own guards pin them to the constant instead: `README.md`
 * here, the site's CSS ornament and rendered lockup in
 * `tests/site_docs_test.ts`, the brand link on every route in
 * `tests/site_serve_test.ts`.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  DISCERN_DOCS_URL,
  DISCERN_MARK,
  DISCERN_WORDMARK,
} from "../src/shared/brand.ts";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import { AUTHORED_DENO_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("the project mark is U+25EE and the README opens with its wordmark", async () => {
  assertEquals(DISCERN_MARK.codePointAt(0), 0x25ee);
  assertEquals([...DISCERN_MARK].length, 1);
  assertEquals(DISCERN_WORDMARK, "◮ discern");
  assertEquals(DISCERN_DOCS_URL, "https://discern.sh/docs");

  const readme = await Deno.readTextFile(
    new URL("../README.md", import.meta.url),
  );
  assertEquals(readme.split("\n", 1)[0], `# ${DISCERN_WORDMARK}`);
});

/** Golden tests pin rendered frames, so they may spell any family glyph. */
const GOLDEN_FRAME_TESTS = [
  "tests/brand_animation_test.ts",
  "tests/brand_art_test.ts",
  "tests/engine_gate_presentation_test.ts", // exact package-composed TTY frame
  "tests/human_output_grouping_test.ts", // exact narration boundary frames
  "tests/log_test.ts", // exact Logger narration frames
  "tests/narration_test.ts", // exact package narration frames
  "tests/triangle_art_test.ts",
];

/** Each glyph's defining constant — the one non-golden home for its literal. */
const MARK_GLYPH_HOMES: ReadonlyMap<string, readonly string[]> = new Map([
  [DISCERN_MARK, [
    "src/shared/brand.ts",
    "tests/brand_mark_test.ts", // the wordmark pin above spells it in full
    ...GOLDEN_FRAME_TESTS,
  ]],
  [DISCERN_TRIANGLE_GLYPHS.upLeft, [
    "art/terminal/triangle.ts",
    ...GOLDEN_FRAME_TESTS,
  ]],
  [DISCERN_TRIANGLE_GLYPHS.downLeft, [
    "art/terminal/triangle.ts",
    ...GOLDEN_FRAME_TESTS,
  ]],
  [DISCERN_TRIANGLE_GLYPHS.downRight, [
    "art/terminal/triangle.ts",
    ...GOLDEN_FRAME_TESTS,
  ]],
]);

Deno.test("mark-family glyph literals stay at their constants and golden tests", async () => {
  const offenders: string[] = [];
  for (const rel of AUTHORED_DENO_FILES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const [glyph, homes] of MARK_GLYPH_HOMES) {
      if (text.includes(glyph) && !homes.includes(rel)) {
        offenders.push(
          `${rel} spells ${glyph} directly — import it from ` +
            `src/shared/brand.ts (DISCERN_MARK) or art/terminal/triangle.ts ` +
            `(DISCERN_TRIANGLE_GLYPHS), or enrol the file in MARK_GLYPH_HOMES ` +
            `in tests/brand_mark_test.ts with its reason`,
        );
      }
    }
  }
  assertEquals(offenders, []);
});
