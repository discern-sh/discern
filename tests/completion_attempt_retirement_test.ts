/**
 * Whichever claim-dependent step finds that another run retired the attempt,
 * the run ends cancelled with that one reason. The retirement lands just
 * before each step of a real `done` and of a real committed standards
 * measurement, and each run must report exactly the retirement: no stale or
 * missing evidence, no failed producer, no refused publication, no crash.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { claimLossBlocker } from "../src/engine/completion/attempt.ts";
import {
  type CompletionObservationFact,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import { completionBlockerAccount } from "../src/engine/completion/progress_prose.ts";
import type { CompletionBlocker } from "../src/engine/completion/protocol.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import {
  type CompletedCandidate,
  completeSourceTip,
} from "../src/engine/completion/source_tip.ts";
import {
  type CompletionRecordStore,
  openCompletionRecordStore,
} from "../src/engine/completion/store.ts";
import { makeOut } from "../src/engine/output.ts";
import { configuredValidation } from "../src/engine/validation/configuration.ts";
import { measureDeclaredStandards } from "../src/engine/validation/measurement.ts";
import { executePublicValidation } from "../src/engine/validation/public_run.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { git } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";

/** Test waits for lint, and a second standard measures with its own command. */
async function retirementProject(root: string): Promise<string> {
  return await project(
    root,
    `
[jobs.lint]
run = "printf l"
inputs = ['**']
[standards.magnitude]
run = "printf 'DISCERN_METRIC magnitude 1\\n'"
inputs = ['source']
direction = 'down'
limit = 2
`,
    undefined,
    undefined,
    { needs: ["jobs.lint"] },
  );
}

/** lint, test, and magnitude each run one command. */
const PRODUCERS = 3;

/** Commit a new source, so every producer of the next run executes. */
async function nextCandidate(path: string, name: string): Promise<void> {
  await Deno.writeTextFile(join(path, "source"), `${name}\n`);
  await git(path, "commit", "-q", "-am", name);
}

/**
 * Close the attempt as recovery's compare-and-swap leaves it. The write is
 * synchronous, so it lands at an exact point inside the run.
 */
function retireNow(store: CompletionRecordStore, attemptId: string): void {
  const path = store.path({ kind: "attempt", id: attemptId });
  const record = decodeWith(
    CompletionRecordSchema,
    Deno.readTextFileSync(path),
  );
  assert(record.kind === "attempt");
  Deno.writeTextFileSync(
    path,
    `${
      JSON.stringify({
        ...record,
        revision: record.revision + 1,
        data: {
          ...record.data,
          state: {
            kind: "finished",
            outcome: "cancelled",
            finished_at: record.data.identity.started_at,
          },
        },
      })
    }\n`,
  );
}

/** Facts a run has reported so far, counted for the steps they precede. */
interface Seen {
  finished: number;
  executed: number;
}

/** A step a run reports through its facts, and the fact that precedes it. */
type FactStep = (fact: CompletionObservationFact, seen: Seen) => boolean;

/** A step only a `done` run's own callbacks reach. */
type RunStep = "binding" | "assembly" | "proof";

/** Where the retirement lands: just after a reported fact, or inside the run. */
type Step = FactStep | RunStep;

/** The producer whose command this fact reports finished, if it is one. */
function finishedProducer(fact: CompletionObservationFact): string | undefined {
  return fact.kind === "event" && fact.event.fact.kind === "command-finished" &&
      fact.event.fact.role === "producer"
    ? fact.event.fact.producer
    : undefined;
}

const receiptPublished = (fact: CompletionObservationFact): boolean =>
  fact.kind === "event" && fact.event.fact.kind === "producer" &&
  fact.event.fact.use === "executed";

/** Lint has finished; test, which needs it, has not passed its pre-check. */
const PRE_CHECK: FactStep = (fact) => finishedProducer(fact) === "jobs.lint";

/** Every producer has finished; only the closing verification remains. */
const CLOSING: FactStep = (fact, seen) =>
  finishedProducer(fact) !== undefined && seen.finished === PRODUCERS;

/** Validation has ended; no receipt has been published. */
const FIRST_RECEIPT: FactStep = (fact) =>
  fact.kind === "event" && fact.event.fact.kind === "validation-summary";

/** One receipt is published; the next is not. */
const LATER_RECEIPT: FactStep = (fact, seen) =>
  receiptPublished(fact) && seen.executed === 1;

/** Run `operation`, retiring its attempt once, where `step` says. */
async function retiredAt<T>(
  path: string,
  step: Step | undefined,
  operation: (
    retireInRun: (at: RunStep, attemptId: string) => void,
  ) => Promise<T>,
): Promise<{ readonly value: T; readonly retired: boolean }> {
  const store = await openCompletionRecordStore(path);
  assert(store !== undefined);
  let retired = false;
  const retire = (attemptId: string): void => {
    if (retired) return;
    retired = true;
    retireNow(store, attemptId);
  };
  const seen: Seen = { finished: 0, executed: 0 };
  const value = await withCompletionObserver((fact) => {
    if (finishedProducer(fact) !== undefined) seen.finished++;
    if (receiptPublished(fact)) seen.executed++;
    if (
      typeof step === "function" && fact.kind === "event" &&
      fact.event.attempt_id !== null && step(fact, seen)
    ) retire(fact.event.attempt_id);
  }, () =>
    operation((at, attemptId) => {
      if (at === step) retire(attemptId);
    }));
  return { value, retired };
}

/** A `done` over the checkout's tip, whose own callbacks can host a retirement. */
function done(
  path: string,
  step: Step | undefined,
): Promise<{
  readonly value: CompletedCandidate<null> | CompletionBlocker;
  readonly retired: boolean;
}> {
  return retiredAt(path, step, async (retireInRun) => {
    const config = await loadConfig(path);
    const configured = await configuredValidation(config, []);
    return await completeSourceTip(
      path,
      { mode: "strict" },
      async ({ execution }) => {
        const attemptId = execution.fence.attempt_id;
        retireInRun("binding", attemptId);
        const validation = await executePublicValidation({
          root: path,
          config,
          scopes: [],
          claimed: execution,
          demand: {
            kind: "done",
            mode: "strict",
            requirements: configured.obligations.map((entry) =>
              entry.requirement
            ),
          },
          bindAttempt: true,
          capacity: { slots: undefined, out: makeOut(false, { quiet: true }) },
        });
        const { evaluator } = validation;
        return {
          value: null,
          passed: validation.outcome.blockers.length === 0,
          validation: {
            ...validation,
            evaluator: {
              ...evaluator,
              observe: (candidateId) => {
                retireInRun("assembly", attemptId);
                return evaluator.observe(candidateId);
              },
              assemble: (...args) => {
                const assembled = evaluator.assemble(...args);
                retireInRun("proof", attemptId);
                return assembled;
              },
            },
          },
        };
      },
    );
  });
}

/** The pending causes a run reports, as narration prints them. */
function rendered(blockers: readonly CompletionBlocker[]): string[] {
  return blockers.map((blocker) => {
    const account = completionBlockerAccount(blocker);
    return `${account.reason} ${account.next}`;
  });
}

/** What a `done` run left pending, and whether it recorded Proof. */
function doneOutcome(
  value: CompletedCandidate<null> | CompletionBlocker,
): { readonly pending: string[]; readonly proven: boolean } {
  return value.kind === "completed"
    ? {
      pending: rendered(value.blockers),
      proven: value.proof_id !== undefined,
    }
    : { pending: rendered([value]), proven: false };
}

const RETIRED = rendered([claimLossBlocker()]);

/** Each claim-dependent step of `done`, with the retirement landing just before it. */
const DONE_STEPS: readonly (readonly [string, Step])[] = [
  ["binding the demand", "binding"],
  ["a producer's pre-check", PRE_CHECK],
  ["the closing verification", CLOSING],
  ["the first receipt", FIRST_RECEIPT],
  ["a later receipt", LATER_RECEIPT],
  ["Proof assembly", "assembly"],
  ["Proof publication and settlement", "proof"],
];

Deno.test("a done retired before any claim-dependent step reports only the retirement", async (t) => {
  await withTempDir(async (root) => {
    const path = await retirementProject(root);
    await t.step("nothing retired: the run records Proof", async () => {
      const ran = await done(path, undefined);
      assertEquals(doneOutcome(ran.value), { pending: [], proven: true });
    });
    for (const [name, step] of DONE_STEPS) {
      await t.step(name, async () => {
        await nextCandidate(path, name);
        const ran = await done(path, step);
        assert(ran.retired, "the retirement landed");
        assertEquals(doneOutcome(ran.value), {
          pending: RETIRED,
          proven: false,
        });
      });
    }
    await t.step(
      "a run that reuses every receipt, after its closing verification",
      async () => {
        // The previous step published every receipt before its retirement, so
        // this run executes nothing and has no receipt left to publish.
        const ran = await done(path, FIRST_RECEIPT);
        assert(ran.retired, "the retirement landed");
        assertEquals(doneOutcome(ran.value), {
          pending: RETIRED,
          proven: false,
        });
      },
    );
  });
});

/** Each claim-dependent step of a measurement, with the retirement just before it. */
const MEASUREMENT_STEPS: readonly (readonly [string, FactStep])[] = [
  ["a producer's pre-check", PRE_CHECK],
  ["the closing verification", CLOSING],
  ["the first receipt", FIRST_RECEIPT],
  ["a later receipt", LATER_RECEIPT],
  [
    "settlement after the last receipt",
    (fact, seen) => receiptPublished(fact) && seen.executed === 2,
  ],
];

Deno.test("a measurement retired before any claim-dependent step reports only the retirement", async (t) => {
  await withTempDir(async (root) => {
    const path = await retirementProject(root);
    // The unretired path is completion_measurement_execution_test.ts's; each
    // step here is reached only when its retirement lands.
    const measure = (step: FactStep) =>
      retiredAt(path, step, () =>
        measureDeclaredStandards(
          path,
          ["coverage", "magnitude"],
          "standards",
          undefined,
          { slots: undefined, out: makeOut(false, { quiet: true }) },
        ));
    for (const [name, step] of MEASUREMENT_STEPS) {
      await t.step(name, async () => {
        await nextCandidate(path, name);
        const ran = await measure(step);
        assert(ran.retired, "the retirement landed");
        assertEquals(ran.value, claimLossBlocker());
      });
    }
  });
});
