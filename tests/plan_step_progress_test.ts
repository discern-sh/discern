/**
 * Plan steps report as their executors run them: each executor names the
 * step it starts and how each recorded step settled, the operation journal
 * keeps them in order, and a progress reading returns them beside the
 * other journalled facts. Every step a run records reaches its observers.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  type CompletionStep,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import {
  foldStep,
  withOperationJournal,
} from "../src/engine/completion/operation_journal.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { runParallel, runSerial } from "../src/engine/jobs/runner.ts";
import {
  recordSteps,
  stepStarted,
  withStepSubject,
} from "../src/engine/plan_steps.ts";
import { worktreeParkResult } from "../src/engine/worktree/park.ts";
import {
  lifecycleContext,
  runEnsureCommands,
} from "../src/engine/worktree/lifecycle.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
import { Logger } from "../src/lib/log.ts";
import {
  BUILT_IN_STEP_LABELS,
  PLAN_STEP_STATE_BY_OUTCOME,
  type StepResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { addWorktree, git, gitInit, scaffoldEngine } from "./engine_helpers.ts";
import { acceptLandingResult } from "../src/engine/worktree/accept.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { withTempDir } from "./helpers.ts";

/** Collect every step fact `work` reports, in order. */
async function stepsOf<T>(
  work: () => Promise<T>,
): Promise<{ readonly value: T; readonly steps: CompletionStep[] }> {
  const steps: CompletionStep[] = [];
  const value = await withCompletionObserver((fact) => {
    if (fact.kind === "step") steps.push(fact.step);
  }, work);
  return { value, steps };
}

/** Labels and states, which the assertions compare. */
function transitions(steps: readonly CompletionStep[]): string[] {
  return steps.map((step) =>
    `${
      step.subject === undefined ? "" : `${step.subject}:`
    }${step.label}:${step.state}`
  );
}

/** Quiet run options for jobs in `cwd`. */
function quiet(cwd: string): {
  cwd: string;
  stream: boolean;
  failFast: boolean;
  color: boolean;
  quiet: boolean;
} {
  return { cwd, stream: false, failFast: false, color: false, quiet: true };
}

/** A task checkout whose setup finished, as one a lifecycle verb accepts. */
async function setUpWorktree(root: string, name: string): Promise<string> {
  const worktree = await addWorktree(root, name);
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined);
  await Deno.mkdir(dirname(marker), { recursive: true });
  await Deno.writeTextFile(marker, "");
  return worktree;
}

Deno.test("plan steps: a step keeps when it started and settles in place", () => {
  const started = foldStep([], { label: "merge", state: "started", at: 10 });
  const other = foldStep(started, {
    label: "merge",
    state: "started",
    at: 12,
    subject: "agent/follower",
  });
  const settled = foldStep(other, {
    label: "merge",
    state: "finished",
    at: 20,
  });
  assertEquals(settled, [
    { label: "merge", state: "finished", started_at: 10, finished_at: 20 },
    {
      label: "merge",
      state: "started",
      started_at: 12,
      subject: "agent/follower",
    },
  ]);
  assertEquals(
    foldStep([], { label: "smoke", state: "skipped", at: 5 }),
    [{ label: "smoke", state: "skipped", finished_at: 5 }],
    "a step that settles without starting has only its end",
  );
});

Deno.test("plan steps: recording a step reports how it settled, under its subject", async () => {
  const outcomes = Object.keys(PLAN_STEP_STATE_BY_OUTCOME) as Array<
    keyof typeof PLAN_STEP_STATE_BY_OUTCOME
  >;
  const recorded: StepResult[] = [];
  const { steps } = await stepsOf(() =>
    withStepSubject("agent/follower", () => {
      stepStarted("first");
      recordSteps(
        recorded,
        ...outcomes.map((outcome): StepResult => ({
          step: {
            kind: "git",
            label: verbatimStepLabel("first"),
            disposition: "run",
          },
          outcome,
        })),
      );
      return Promise.resolve();
    })
  );
  assertEquals(recorded.length, outcomes.length, "every step is recorded");
  assertEquals(
    steps.map((step) => step.state),
    [
      "started",
      ...outcomes.map((outcome) => PLAN_STEP_STATE_BY_OUTCOME[outcome]),
    ],
  );
  assert(steps.every((step) => step.subject === "agent/follower"));
});

Deno.test("plan steps: the job runner reports each job it starts and its verdict", async () => {
  await withTempDir(async (root) => {
    const parallel = await stepsOf(() =>
      runParallel([
        { label: "passes", command: "true" },
        { label: "fails", command: "exit 3" },
      ], quiet(root))
    );
    assertEquals(
      transitions(parallel.steps).sort(),
      ["fails:failed", "fails:started", "passes:finished", "passes:started"],
    );
    const serial = await stepsOf(() =>
      runSerial([
        { label: "first", command: "exit 1" },
        { label: "never", command: "true" },
      ], quiet(root))
    );
    assertEquals(
      transitions(serial.steps),
      ["first:started", "first:failed"],
      "a job that never starts reports nothing",
    );
  });
});

Deno.test("plan steps: lifecycle executors report each step as it settles", async (t) => {
  await withTempDir(async (directory) => {
    // One project serves every executor: each step works on its own
    // checkout, so none consumes what another needs.
    const root = await Deno.realPath(directory);
    await scaffoldEngine(root);
    await gitInit(root);
    const ctx = await lifecycleContext(
      root,
      new Logger({ json: true, noColor: true }),
    );

    await t.step(
      "ensure commands report as the steps a plan names them",
      async () => {
        const { value, steps } = await stepsOf(() =>
          runEnsureCommands(ctx, ["true", "exit 4"], {
            fatal: false,
            cwd: root,
            scope: "repository",
          })
        );
        assertEquals(value.outcomes, ["ok", "failed"]);
        assertEquals(transitions(steps), [
          "true:started",
          "true:finished",
          "exit 4:started",
          "exit 4:failed",
        ]);
      },
    );

    await t.step(
      "every step Park records reached its observers as it settled",
      async () => {
        const worktree = await setUpWorktree(root, "parked-task");
        const { value, steps } = await stepsOf(() =>
          worktreeParkResult(ctx, worktree, false)
        );
        assert(value.ok, value.message);
        const settled = steps.filter((step) => step.state !== "started");
        assertEquals(
          settled.map((step) => `${step.label}:${step.state}`),
          (value.steps ?? []).map((result) =>
            `${result.step.label}:${PLAN_STEP_STATE_BY_OUTCOME[result.outcome]}`
          ),
          "the facts follow the result's own steps, in order",
        );
        assert(
          steps.some((step) =>
            step.label === BUILT_IN_STEP_LABELS.removeWorktree &&
            step.state === "started"
          ),
          "the removal reports when it begins",
        );
      },
    );

    await t.step(
      "every step a direct landing plans reaches its observers",
      async () => {
        const worktree = await setUpWorktree(root, "landing-task");
        await Deno.writeTextFile(join(worktree, "landed.txt"), "landed\n");
        await git(worktree, "add", "-A");
        await git(
          worktree,
          "commit",
          "-q",
          "-m",
          "Land a file",
          "--no-gpg-sign",
        );
        const proven = await finishResult(worktree, {
          surface: { kind: "quiet" },
          cliModel: TEST_CLI_MODEL,
        });
        assert(proven.ok, proven.message);
        const landingCtx = await lifecycleContext(
          worktree,
          new Logger({ json: true, noColor: true }),
        );
        const request = {
          target: worktree,
          confirmed: true,
          variance: [],
          approveStandard: [],
          met: [],
          cliModel: TEST_CLI_MODEL,
        };
        const preview = await acceptLandingResult(landingCtx, {
          ...request,
          dryRun: true,
        });
        assert(preview.ok && preview.plan !== undefined, preview.message);
        const { value, steps } = await stepsOf(() =>
          acceptLandingResult(landingCtx, { ...request, dryRun: false })
        );
        assert(value.ok, value.message);
        const unreported = preview.plan.steps.filter((planned) =>
          !steps.some((step) =>
            step.label === planned.label && step.state !== "started"
          )
        ).map((planned) => planned.label);
        assertEquals(
          unreported,
          [],
          "the progress shows every planned step as it settles, none inferred",
        );
      },
    );
  });
});

Deno.test("plan steps: a progress reading returns the journalled steps", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readme"), "steps\n");
    await gitInit(root);
    let handle: string | undefined;
    await withOperationJournal(
      root,
      { verb: "accept", path: root },
      (opened) => {
        handle = opened;
        stepStarted(BUILT_IN_STEP_LABELS.fastForwardTrunk);
        recordSteps([], {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
            disposition: "run",
          },
          outcome: "ok",
        });
        return Promise.resolve({ ok: true, verb: "accept" } as const);
      },
      { result: (value) => value },
    );
    assert(handle !== undefined);
    const reading = await operationProgressResult(root, { handle });
    assertEquals(
      reading.data?.steps?.map((step) => [step.label, step.state]),
      [[BUILT_IN_STEP_LABELS.fastForwardTrunk, "finished"]],
    );
    const step = reading.data?.steps?.[0];
    assert(
      step?.started_at !== undefined && step.finished_at !== undefined &&
        step.finished_at >= step.started_at,
    );
  });
});

Deno.test("plan steps: a reading without steps omits them", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readme"), "no steps\n");
    await gitInit(root);
    let handle: string | undefined;
    await withOperationJournal(
      root,
      { verb: "done", path: root },
      (opened) => {
        handle = opened;
        return Promise.resolve({ ok: true, verb: "done" } as const);
      },
      { result: (value) => value },
    );
    assert(handle !== undefined);
    const reading = await operationProgressResult(root, { handle });
    assertEquals(reading.data !== undefined && "steps" in reading.data, false);
  });
});
