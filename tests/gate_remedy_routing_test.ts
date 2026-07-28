/**
 * Red-gate remedy routing guard. The defect class: an agent-facing next step
 * that, at a red `done`, routes ITERATION back through the full gate. The
 * fast inner loop (`discern prepare` / `discern test`) exists so a failing
 * change is fixed without paying full gate time per attempt — a remedy that
 * says "fix, then re-run" with no fast loop teaches `done`-only iteration
 * (the logbook's `skipped-prepare` detector measures the damage).
 *
 * Two auto-enrolling sweeps over closed sets:
 *
 * 1. Every {@link FAILED_STAGES} remedy claiming generic code-fix work — the
 *    diagnostic core's signature, "fix the reported problems" — must name
 *    `discern prepare`, and must name its re-run verb (`discern done`)
 *    rather than the verb-generic "the current discern command": only `done`
 *    fires stage remedies. One-shot mechanical remedies (refresh, renumber,
 *    grant access) name their concrete action instead of that signature and
 *    stay exempt — after a one-shot fix, re-running the gate directly IS the
 *    next step.
 * 2. Every `done-rerun`-family hint telling the agent to fix a failure must
 *    name a fast-loop verb alongside its `discern done` re-run.
 *
 * Each sweep asserts it matched at least one member, so a reworded signature
 * fails the guard loudly instead of leaving it vacuously green.
 */

import { assert, assertEquals } from "@std/assert";
import { FAILED_STAGES } from "../src/shared/result.ts";
import { gateFailureRemedy, HINTS } from "../src/shared/hints.ts";

/** The diagnostic core's claim that the fix is open-ended code work. */
const CODE_FIX_SIGNATURE = /fix the reported problems/iu;

/** A rerun hint's claim that a failure needs fixing before the re-run. */
const FIX_THE_FAILURE = /fix the failure/iu;

/** A named fast-loop verb — the routing the red-gate moment must carry. */
const FAST_LOOP = /`discern (?:prepare|test)`/u;

Deno.test("code-fix stage remedies route iteration through the fast loop", () => {
  const failures: string[] = [];
  let members = 0;
  for (const stage of FAILED_STAGES) {
    const { text } = gateFailureRemedy(stage);
    if (!CODE_FIX_SIGNATURE.test(text)) {
      continue;
    }
    members += 1;
    if (!FAST_LOOP.test(text)) {
      failures.push(
        `${stage}: claims code-fix work but names no fast inner loop ` +
          "(`discern prepare` / `discern test`)",
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
    "a red `done` must hand the agent the fast inner loop, never a bare " +
      `full-gate re-run:\n  ${failures.join("\n  ")}`,
  );
});

Deno.test("done-rerun hints route the fix through the fast loop", () => {
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
    const text = def.template(def.example);
    if (!FIX_THE_FAILURE.test(text)) {
      continue;
    }
    members += 1;
    if (!FAST_LOOP.test(text)) {
      failures.push(
        `${key}: tells the agent to fix a failure without naming the fast ` +
          "inner loop (`discern prepare` / `discern test`)",
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
    "a red-verdict rerun hint must route the fix through the fast loop:\n  " +
      failures.join("\n  "),
  );
});
