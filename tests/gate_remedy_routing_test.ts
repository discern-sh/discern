/**
 * Red-gate remedy routing guard. The defect class: an agent-facing next step
 * that routes iteration through either the full Gate or its complete standalone
 * test stage before the required final Gate. Both paths repeat the expensive
 * test job instead of using a diagnostic's reproduce command.
 *
 * Three auto-enrolling sweeps over closed sets:
 *
 * 1. Every {@link FAILED_STAGES} remedy claiming generic code-fix work — the
 *    diagnostic cores' signature, "fix the … in the diagnostics" — must name
 *    a narrow iteration (`discern prepare` or the diagnostic's own reproduce
 *    command), and must name its re-run verb (`discern done`) rather than
 *    the verb-generic "the current discern command": only `done` fires stage
 *    remedies. One-shot mechanical remedies (refresh, renumber, grant
 *    access) name their concrete action instead of that signature and stay
 *    exempt — after a one-shot fix, re-running the gate directly IS the
 *    next step.
 * 2. Test-bearing remedies must route through the diagnostic reproduce
 *    commands and state that `discern done` includes the complete test stage.
 * 3. Every `done-rerun`-family hint telling the agent to fix a failure must
 *    name a narrow command alongside its `discern done` re-run.
 *
 * Each sweep asserts it matched at least one member, so a reworded signature
 * fails the guard loudly instead of leaving it vacuously green.
 */

import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import { assert, assertEquals } from "@std/assert";
import { FAILED_STAGES } from "../src/shared/result.ts";
import { gateFailureRemedy, HINTS } from "../src/shared/hints.ts";

/** The diagnostic cores' claim that the fix is open-ended code work. */
const CODE_FIX_SIGNATURE =
  /fix the (?:problems|failing tests) in the diagnostics/iu;

/** A rerun hint's claim that a failure needs fixing before the re-run. */
const FIX_THE_FAILURE = /fix the failure/iu;

/** A named narrow iteration: preparation or the failed diagnostic itself. */
const NARROW_LOOP = /`discern prepare`|reproduce command/u;

/** Report test remedies that can cause a standalone full-suite preflight. */
function testRemedyFailures(label: string, text: string): string[] {
  const failures: string[] = [];
  if (!/diagnostic(?:'s|s')? reproduce command/iu.test(text)) {
    failures.push(`${label}: missing the diagnostic reproduce command`);
  }
  if (!/`discern done`[^.]{0,120}complete test stage/iu.test(text)) {
    failures.push(
      `${label}: does not say that \`discern done\` includes the complete test stage`,
    );
  }
  if (
    /iterate with `discern test`|only once `discern test` is green/iu.test(text)
  ) {
    failures.push(
      `${label}: requires a standalone test pass before \`discern done\``,
    );
  }
  return failures;
}

Deno.test("code-fix stage remedies route iteration through a narrow loop", () => {
  const failures: string[] = [];
  let members = 0;
  for (const stage of FAILED_STAGES) {
    const { text } = gateFailureRemedy(stage);
    if (!CODE_FIX_SIGNATURE.test(text)) {
      continue;
    }
    members += 1;
    if (!NARROW_LOOP.test(text)) {
      failures.push(
        `${stage}: claims code-fix work but names no narrow iteration ` +
          "(`discern prepare` / reproduce command)",
      );
    }
    if (/the current discern command/u.test(text)) {
      failures.push(
        `${stage}: hides the re-run verb behind "the current discern ` +
          'command" — only `done` fires stage remedies, so name `discern done`',
      );
    }
  }
  assert(
    members > 0,
    "no stage remedy carries the code-fix signature — if the diagnostic " +
      "core was reworded, update CODE_FIX_SIGNATURE so this guard keeps " +
      "matching the iterative remedies",
  );
  assertEquals(
    failures,
    [],
    "a red `done` must hand the agent a narrow loop, never a bare " +
      `full-gate re-run:\n  ${failures.join("\n  ")}`,
  );
});

Deno.test("test-bearing remedies avoid a standalone full-suite preflight", () => {
  const failures = FAILED_STAGES
    .filter((stage) => stage.includes("test"))
    .flatMap((stage) => {
      const { text } = gateFailureRemedy(stage);
      return testRemedyFailures(stage, text);
    });
  assertEquals(
    failures,
    [],
    "test failures should iterate on their diagnostics, then use the final Gate:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("the test-remedy detector rejects a future standalone preflight", () => {
  assertEquals(
    testRemedyFailures(
      "future verifier",
      "Fix the diagnostics. Iterate with `discern test`. Re-run `discern done` only once `discern test` is green.",
    ),
    [
      "future verifier: missing the diagnostic reproduce command",
      "future verifier: does not say that `discern done` includes the complete test stage",
      "future verifier: requires a standalone test pass before `discern done`",
    ],
  );
});

Deno.test("done-rerun hints route the fix through a narrow loop", () => {
  const failures: string[] = [];
  let members = 0;
  for (const [key, value] of Object.entries(HINTS)) {
    const def = value as {
      example: unknown;
      template: (params: unknown) => string;
      family?: string;
    };
    if (def.family !== "done-rerun") {
      continue;
    }
    const text = renderCommandRefsCli(def.template(def.example));
    if (!FIX_THE_FAILURE.test(text)) {
      continue;
    }
    members += 1;
    if (!NARROW_LOOP.test(text)) {
      failures.push(
        `${key}: tells the agent to fix a failure without naming a narrow ` +
          "loop (`discern prepare` / reproduce command)",
      );
    }
  }
  assert(
    members > 0,
    "no done-rerun hint carries the fix-the-failure phrasing — if the red " +
      "rerun hint was reworded, update FIX_THE_FAILURE so this guard keeps " +
      "matching it",
  );
  assertEquals(
    failures,
    [],
    "a red-verdict rerun hint must route the fix through a narrow loop:\n  " +
      failures.join("\n  "),
  );
});
