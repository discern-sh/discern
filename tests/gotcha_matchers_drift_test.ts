/**
 * The seeded-matcher drift guard (ADR 0189): the trap matchers seeded into the
 * shipped gotchas template and this repository's live page must keep matching
 * the engine's REAL failure evidence. The evidence corpus is built from the
 * engine's own sources — `jobFailureMessage` for the timeout and exit-127
 * strings, `FAILED_STAGES` for the stage vocabulary — never from copies, so
 * rewording a failure message (or renaming a stage) without moving its matcher
 * fails here, in the gate, before the matcher can silently stop firing.
 *
 * The guard is reachability, not a hand-kept mapping: every seeded matcher
 * must be the trap selected for at least one corpus failure. That catches a
 * reworded message (its matcher selects nothing) AND a shadowing reorder (an
 * earlier matcher steals every failure that used to reach a later one).
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import {
  type GateFailureEvidence,
  matchTrap,
  parseGotchasDoc,
} from "../src/engine/gate/gotcha_match.ts";
import { jobFailureMessage } from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import { FAILED_STAGES } from "../src/shared/result.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

const DOCS = {
  template: join(
    REPO_ROOT,
    "templates",
    "setup",
    "skeleton",
    "docs",
    "80-development",
    "done-gate-gotchas.md",
  ),
  live: join(REPO_AUTHORED_PATHS.map, "80-development", "done-gate-gotchas.md"),
} as const;

/** The seeding floor: the stack-independent traps annotated at minimum. */
const SEEDED_MATCHER_MINIMUM = 4;

/** A real failed JobResult, as the runner would settle it. */
function failedJob(overrides: Partial<JobResult>): JobResult {
  return {
    label: "test",
    status: "failed",
    code: 1,
    durationS: 1,
    outputLines: 0,
    errorLikeLines: 0,
    ...overrides,
  };
}

/** The corpus of real failures: one per failed stage (bare), plus the two
 * engine-authored evidence messages a matcher can key on. */
function realFailureCorpus(): GateFailureEvidence[] {
  const bareStages: GateFailureEvidence[] = FAILED_STAGES.map((stage) => ({
    failedStage: stage,
    diagnostics: [],
  }));
  const timedOut = jobFailureMessage(
    "test",
    failedJob({ timedOut: { seconds: 600, key: "[gate].timeout" } }),
  );
  const notFound = jobFailureMessage("lint", failedJob({ code: 127 }));
  return [
    ...bareStages,
    { failedStage: "check/test", diagnostics: [{ message: timedOut }] },
    { failedStage: "check/test", diagnostics: [{ message: notFound }] },
  ];
}

for (const [name, path] of Object.entries(DOCS)) {
  Deno.test(`the ${name} gotchas doc's seeded matchers all parse`, async () => {
    const parsed = parseGotchasDoc(await Deno.readTextFile(path));
    assertEquals(
      parsed.problems,
      [],
      `seeded matchers must parse cleanly in ${path}`,
    );
    const seeded = parsed.traps.filter((t) => t.matcher !== undefined);
    assert(
      seeded.length >= SEEDED_MATCHER_MINIMUM,
      `expected at least ${SEEDED_MATCHER_MINIMUM} seeded matchers in ${path}, found ${seeded.length}`,
    );
  });

  Deno.test(`the ${name} gotchas doc's matchers each fire on real engine evidence`, async () => {
    const { traps } = parseGotchasDoc(await Deno.readTextFile(path));
    const corpus = realFailureCorpus();
    const unreached = traps
      .filter((t) => t.matcher !== undefined)
      .filter((t) => !corpus.some((failure) => matchTrap(traps, failure) === t))
      .map((t) => t.title);
    assertEquals(
      unreached,
      [],
      `no real engine failure selects these seeded matchers in ${path} — ` +
        "an engine failure message or stage was likely reworded without " +
        "moving its matcher (or an earlier matcher now shadows it)",
    );
  });
}
