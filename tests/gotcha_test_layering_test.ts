/**
 * Gotcha matcher variants belong at the in-process tail seam. A test that
 * knows the matcher vocabulary and also launches the full engine repeats
 * Deno startup, config discovery, git inspection, and gate execution for each
 * variant. Keep one black-box proof in engine_gate_failure_tail_test.ts; test
 * the variant matrix through gateFailureGotchasTail.
 *
 * The scan uses the authored-TypeScript universe, so a fresh test file enrolls
 * automatically. The markers name the production seam and its public matcher
 * contract rather than today's test names.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const SELF = "tests/gotcha_test_layering_test.ts";
const BLACK_BOX_PROBE = "tests/engine_gate_failure_tail_test.ts";

/**
 * A matcher-aware test necessarily names at least one of these contracts.
 * Keep the strings separate from the launch regex so this guard does not match
 * itself.
 */
const MATCHER_MARKERS = [
  "gotcha-match",
  "gateFailureGotchasTail",
  "gate-failure-gotcha-matched",
  "This failure matches",
] as const;

const ENGINE_LAUNCH = new RegExp(
  String.raw`\b(?:runAgent|runAgentMerged|runAgentPty)\s*` + "\\(",
  "g",
);

Deno.test("gotcha matcher variants stay at the in-process tail seam", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/gotcha_test_layering_test.ts#matcher-test-layering",
      universe: "authored-ts",
      narrow: {
        reason:
          "The invariant governs executable test cases named by the established _test.ts convention, excluding its own detector source.",
        include: (path) =>
          path.startsWith("tests/") && path.endsWith("_test.ts") &&
          path !== SELF,
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (!MATCHER_MARKERS.some((marker) => source.includes(marker))) {
      continue;
    }
    const launches = [...source.matchAll(ENGINE_LAUNCH)].length;
    if (launches > 0 && rel !== BLACK_BOX_PROBE) {
      offenders.push(`${rel}: ${launches} full-engine launch sites`);
    }
  }

  assertEquals(
    offenders,
    [],
    "matcher-aware variant tests must call gateFailureGotchasTail directly; " +
      `${BLACK_BOX_PROBE} owns the one black-box surface proof`,
  );
});
