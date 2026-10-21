/**
 * Line alignment: the hunks it reports are exactly the unshared runs, in order,
 * and a table past the budget degrades to one all-added hunk.
 */

import { assertEquals } from "@std/assert";
import { lineHunks } from "../src/lib/line_hunks.ts";
import { assertNamedCases } from "./assert_cases.ts";

Deno.test("lineHunks: contracts", () => {
  assertNamedCases({
    "identical lists have no hunks": () => {
      assertEquals(lineHunks(["a", "b"], ["a", "b"]), []);
    },
    "an appended run is one pure addition": () => {
      assertEquals(lineHunks(["a", "b"], ["a", "b", "x", "y"]), [
        { removed: [], added: ["x", "y"] },
      ]);
    },
    "a deleted run is one pure removal": () => {
      assertEquals(lineHunks(["a", "x", "b"], ["a", "b"]), [
        { removed: ["x"], added: [] },
      ]);
    },
    "an edited line pairs its removal with its replacement": () => {
      assertEquals(lineHunks(["a", "old", "b"], ["a", "new", "b"]), [
        { removed: ["old"], added: ["new"] },
      ]);
    },
    "separate changes stay separate hunks in order": () => {
      assertEquals(
        lineHunks(
          ["a", "b", "c", "d", "e"],
          ["inserted", "a", "b", "C", "d", "e", "tail"],
        ),
        [
          { removed: [], added: ["inserted"] },
          { removed: ["c"], added: ["C"] },
          { removed: [], added: ["tail"] },
        ],
      );
    },
    "a line repeated inside an insertion still aligns with the original":
      () => {
        assertEquals(
          lineHunks(["a", "---", "b"], ["a", "---", "x", "---", "b"]),
          [{ removed: [], added: ["x", "---"] }],
        );
      },
    "past the budget the differing middle is one all-added hunk": () => {
      assertEquals(lineHunks(["a", "b", "c"], ["a", "x", "y", "c"], 1), [
        { removed: [], added: ["x", "y"] },
      ]);
    },
  });
});
