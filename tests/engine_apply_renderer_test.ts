/**
 * Architectural guard for ADR 0028's apply path: if a verb returns `steps[]`,
 * human apply summaries must pass through the shared StepResult renderer instead
 * of growing a parallel hand-written narration beside the `--json` result.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

/** Count non-overlapping literal occurrences when asserting one shared rendering call site. */
function countMatches(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

Deno.test("architecture: worktree apply summaries use the shared StepResult renderer", async () => {
  const lifecycle = await Deno.readTextFile("src/engine/worktree/lifecycle.ts");

  assertStringIncludes(lifecycle, "renderStepResults(");
  assertStringIncludes(lifecycle, "function emitOrRenderWorktreeResult");
  assert(
    !lifecycle.includes("function emitResults("),
    "do not reintroduce a JSON-only apply helper; render the applied DiscernResult for human mode too",
  );
  assert(
    !lifecycle.includes("emitResults("),
    "worktree apply paths must route through emitOrRenderWorktreeResult",
  );

  // Apply call sites for setup, teardown, drop, accept, update, start, and
  // prune. A future result-bearing worktree verb should use this helper too, so
  // raising this count is an intentional architectural change.
  assertEquals(
    countMatches(lifecycle, "emitOrRenderWorktreeResult("),
    7,
    "every result-bearing worktree apply wrapper should share the result renderer",
  );
});

Deno.test("architecture: standards human apply renders the applied result steps", async () => {
  const standards = await Deno.readTextFile("src/engine/gate/standards.ts");

  assertStringIncludes(standards, "renderStepResults(outSink(out),");
  assertStringIncludes(
    standards,
    'const result = appliedResult("standards", results);',
  );
  assert(
    !standards.includes("const { ok } = await executeStandardPlan"),
    "standards must render the applied result object, not keep a separate ok-only human path",
  );
});
