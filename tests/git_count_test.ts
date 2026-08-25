/** Unit coverage for the numeric Git fact boundary. */

import { assertEquals } from "@std/assert";
import {
  gitCountFrom,
  parseGitCount,
  UNKNOWN_GIT_COUNT,
} from "../src/shared/git_count.ts";

Deno.test("Git count parsing preserves a factual zero and positive integers", () => {
  assertEquals(parseGitCount("0\n"), 0);
  assertEquals(parseGitCount("17"), 17);
});

Deno.test("Git count parsing rejects every non-canonical numeric shape", () => {
  for (
    const output of [
      "",
      " ",
      "NaN",
      "Infinity",
      "-1",
      "+1",
      "1.5",
      "01",
      "1 trailing",
      String(Number.MAX_SAFE_INTEGER + 1),
    ]
  ) {
    assertEquals(parseGitCount(output), UNKNOWN_GIT_COUNT, output);
  }
});

Deno.test("a failed Git command is unknown even when stdout says zero", () => {
  assertEquals(
    gitCountFrom({ success: false, stdout: "0\n" }),
    UNKNOWN_GIT_COUNT,
  );
  assertEquals(gitCountFrom({ success: true, stdout: "0\n" }), 0);
});
