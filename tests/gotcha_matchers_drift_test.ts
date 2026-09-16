/** Shipped and repository gotcha matchers must select real engine failure evidence.
 * Each annotated trap needs a reachable case, so changes to diagnostics or a
 * shadowing matcher cannot quietly disable the project's recovery pointers. */

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
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

const DOCS = {
  seeded: "templates/setup/skeleton/map/development/done-gate-gotchas.md",
  live: join(REPO_AUTHORED_PATHS.map, "80-development", "done-gate-gotchas.md"),
} as const;

/** The repository's minimum annotated failure coverage. */
const PROJECT_MATCHER_MINIMUM = 4;

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
  Deno.test(`the ${name} gotchas doc's project matchers all parse`, async () => {
    const parsed = parseGotchasDoc(await Deno.readTextFile(path));
    assertEquals(
      parsed.problems,
      [],
      `project matchers must parse cleanly in ${path}`,
    );
    const annotated = parsed.traps.filter((t) => t.matcher !== undefined);
    assert(
      annotated.length >= PROJECT_MATCHER_MINIMUM,
      `expected at least ${PROJECT_MATCHER_MINIMUM} project matchers in ${path}, found ${annotated.length}`,
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
      `no real engine failure selects these project matchers in ${path} — ` +
        "an engine failure message or stage was likely reworded without " +
        "moving its matcher (or an earlier matcher now shadows it)",
    );
  });
}
