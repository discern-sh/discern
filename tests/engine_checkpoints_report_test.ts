/**
 * The checkpoint READ surfaces (black-box, through the real engine):
 * `discern checkpoints` reports the governing policy, each open question's
 * declaration state, and a structural preview — without running a `when`
 * command, creating an open question, or recording anything — and routes an
 * awaiting question to the two valid `done` conclusions and a declared-unmet
 * one to the owner's variance review. `prepare` and `status` serve the same
 * preview through the advisory hint channel, projected from the ONE shape
 * `done --dry-run` also renders, so the three surfaces cannot disagree.
 *
 * Each journey builds one repository and follows its open question through
 * the states the read surfaces must project. The obligation matrix rides
 * those journeys in-process through the verb cores; one boundary read per
 * surface keeps CLI parsing, output, and exit codes proven.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  readOpenQuestions,
  reconcileOpenQuestion,
} from "../src/engine/checkpoints/open_questions.ts";
import { checkpointsResult } from "../src/engine/checkpoints/report.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { prepareResult } from "../src/engine/gate/prepare.ts";
import { statusResult } from "../src/engine/status/status.ts";
import {
  CHECKPOINT_OBLIGATION_STATES,
  type CheckpointObligationState,
} from "../src/shared/checkpoints.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import {
  assertResultDataKey,
  type CliJsonResultCommand,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";
import {
  adminMarker,
  checkpointObservationEvents,
  commitDocs,
  CONFIG_ADVISE,
  CONFIG_NO_CHECKPOINTS,
  CONFIG_ONE_CHECKPOINT,
  CONFIG_SEPARATOR_QUESTION,
  CONFIG_UNLESS_CHANGED,
  CONFIG_WHEN,
  HOSTILE_QUESTION,
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
  parseCheckpointGateJson,
  parseCheckpointsJson,
  parseJson,
  proofMarker,
  QUESTION_API,
  readLogbook,
  restoreCommittedTree,
  sidecarMarker,
  WHEN_TOUCHES,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";

/** Decode one JSON envelope while preserving its command-specific contract. */
function parseHinted<Command extends CliJsonResultCommand>(
  stdout: string,
  command: Command,
): CliResultForCommand<Command> {
  return decodeCliResult(stdout, command);
}

const WHY = "The docs lag the new surface; a follow-up covers them.";

type SurfaceDecision = "requires" | "proceeds" | "unknown";

/** The hint channel every read surface projects the strict decision onto. */
interface HintedResult {
  readonly hints?: readonly string[] | undefined;
}

/** The plan facts `done --dry-run` projects the strict decision onto. */
interface PlannedResult {
  readonly plan?:
    | { readonly details?: readonly string[] | undefined }
    | undefined;
}

/** Reduce a prepare/status hint set to the strict checkpoint decision it
 * communicates. Presenter prose may move; the routing vocabulary may not. */
function hintedDecision(envelope: HintedResult): SurfaceDecision {
  const hints = envelope.hints ?? [];
  if (
    hints.some((hint) => hint.includes("may require a declared conclusion"))
  ) {
    return "unknown";
  }
  if (
    hints.some((hint) =>
      hint.includes("will require a declared conclusion") ||
      hint.includes("already awaits a declared conclusion") ||
      hint.includes("requires a fresh declared conclusion")
    )
  ) {
    return "requires";
  }
  if (hints.some((hint) => hint.includes("strict obligation is unknown"))) {
    return "unknown";
  }
  return "proceeds";
}

/** Reduce `done --dry-run` plan facts to its checkpoint decision. */
function dryRunDecision(envelope: PlannedResult): SurfaceDecision {
  const details = envelope.plan?.details ?? [];
  if (
    details.some((line) =>
      line.includes("may be required") ||
      line.includes("strict obligation is unknown")
    )
  ) {
    return "unknown";
  }
  if (
    details.some((line) =>
      line.includes("declared conclusion will be required") ||
      line.includes("requires a declared conclusion") ||
      line.includes("requires a fresh declared conclusion")
    )
  ) {
    return "requires";
  }
  return "proceeds";
}

/** The journeys below that establish obligation states, by name. */
const MATRIX_JOURNEYS = [
  "stop-question",
  "stop-conclusions",
  "unless-changed",
  "when",
] as const;

type MatrixJourney = (typeof MATRIX_JOURNEYS)[number];

interface ObligationRow {
  readonly name: string;
  readonly obligation: CheckpointObligationState;
  readonly readDecision: SurfaceDecision;
  readonly strictDecision: Exclude<SurfaceDecision, "unknown">;
  /** The journey that reaches this state and projects the row there. */
  readonly journey: MatrixJourney;
}

/**
 * The obligation matrix: every canonical state, the decision the read surfaces
 * must project there, the decision strict `done` must reach, and the journey
 * that establishes it. A journey visits its rows in the order the state
 * naturally evolves and proves at its end that it visited every one.
 */
const OBLIGATION_MATRIX: readonly ObligationRow[] = [
  {
    name: "no obligation",
    obligation: "none",
    readDecision: "proceeds",
    strictDecision: "proceeds",
    journey: "unless-changed",
  },
  {
    name: "will open",
    obligation: "will_open",
    readDecision: "requires",
    strictDecision: "requires",
    journey: "stop-question",
  },
  {
    name: "already awaits",
    obligation: "awaiting_declaration",
    readDecision: "requires",
    strictDecision: "requires",
    journey: "stop-question",
  },
  {
    name: "declared met",
    obligation: "declared_met",
    readDecision: "proceeds",
    strictDecision: "proceeds",
    journey: "stop-conclusions",
  },
  {
    name: "declared unmet",
    obligation: "declared_unmet",
    readDecision: "proceeds",
    strictDecision: "proceeds",
    journey: "stop-conclusions",
  },
  {
    name: "reopened",
    obligation: "reopened",
    readDecision: "requires",
    strictDecision: "requires",
    journey: "stop-conclusions",
  },
  {
    name: "when remains unknown to reads",
    obligation: "unknown",
    readDecision: "unknown",
    strictDecision: "requires",
    journey: "when",
  },
];

/** The obligations one journey must project, in matrix order. */
function matrixRows(journey: MatrixJourney): CheckpointObligationState[] {
  return OBLIGATION_MATRIX.filter((row) => row.journey === journey).map((
    row,
  ) => row.obligation);
}

/** One journey's position while it projects matrix rows. */
interface MatrixVisit {
  readonly wt: string;
  readonly dir: string;
  readonly journey: MatrixJourney;
  /** Every obligation the journey projected so far, in order. */
  readonly visited: CheckpointObligationState[];
}

/** The strict `done` a matrix row's decision is read from: the done core
 * in-process by default, or the journey's own next boundary run when it
 * takes one at that state anyway. */
type StrictProbe = () => Promise<{ readonly error?: string | undefined }>;

/**
 * Project one obligation row through every consuming surface — the
 * checkpoints, prepare, status, and done --dry-run cores, in-process — proving
 * the decision each surface communicates and that no read wrote the
 * open-question store, the gate marker, a lifecycle event, or ran the `when`
 * command; then take the strict decision through `strict`.
 */
async function projectObligationRow(
  t: Deno.TestContext,
  visit: MatrixVisit,
  obligation: CheckpointObligationState,
  strict: StrictProbe = () =>
    finishResult(visit.wt, {
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
    }),
): Promise<void> {
  const row = OBLIGATION_MATRIX.find((candidate) =>
    candidate.obligation === obligation && candidate.journey === visit.journey
  );
  assert(
    row !== undefined,
    `${visit.journey} does not host the ${obligation} matrix row`,
  );
  await t.step(
    `checkpoint obligations: ${row.name} projects through every consuming surface without read effects`,
    async () => {
      const { wt, dir } = visit;
      const questionBefore = await adminMarker(wt, "checkpointOpenQuestions");
      const gateBefore = await adminMarker(wt, "gateProof");
      const observationsBefore = await checkpointObservationEvents(dir);

      const checkpoints = await checkpointsResult(wt);
      const prepare = await prepareResult(wt);
      const status = await statusResult(wt);
      const dryRun = await finishResult(wt, {
        surface: { kind: "quiet" },
        cliModel: TEST_CLI_MODEL,
        dryRun: true,
      });

      assertEquals(
        checkpoints.data?.checkpoints[0]?.obligation,
        row.obligation,
        row.name,
      );
      assertEquals(hintedDecision(prepare), row.readDecision, row.name);
      assertEquals(hintedDecision(status), row.readDecision, row.name);
      assertEquals(dryRunDecision(dryRun), row.readDecision, row.name);
      assertEquals(
        await adminMarker(wt, "checkpointOpenQuestions"),
        questionBefore,
        `${row.name}: reads changed the open-question store`,
      );
      assertEquals(
        await adminMarker(wt, "gateProof"),
        gateBefore,
        `${row.name}: reads changed the gate marker`,
      );
      assertEquals(
        await checkpointObservationEvents(dir),
        observationsBefore,
        `${row.name}: reads recorded a checkpoint lifecycle event`,
      );
      assertEquals(
        await sidecarMarker(wt, "when-ran.log"),
        "",
        `${row.name}: a read surface ran the when command`,
      );

      // The prepare core is a fixer surface: it refreshes generated agent
      // artifacts by design. Restore the committed tree so the strict probe
      // reads the state this journey committed, not the refresh side effect.
      await restoreCommittedTree(wt);
      const done = await strict();
      const strictDecision: SurfaceDecision =
        done.error === AWAITING_DECLARATION_SLUG ? "requires" : "proceeds";
      assertEquals(strictDecision, row.strictDecision, row.name);
      visit.visited.push(row.obligation);
    },
  );
}

Deno.test("checkpoint obligations: every canonical obligation state has a matrix row and a host journey", () => {
  assertEquals(
    [...new Set(OBLIGATION_MATRIX.map((row) => row.obligation))].sort(),
    [...CHECKPOINT_OBLIGATION_STATES].sort(),
    "every canonical checkpoint obligation state needs a matrix row",
  );
  assertEquals(
    OBLIGATION_MATRIX.length,
    CHECKPOINT_OBLIGATION_STATES.length,
    "each obligation state has exactly one matrix row",
  );
  for (const journey of MATRIX_JOURNEYS) {
    assert(
      matrixRows(journey).length > 0,
      `matrix journey ${journey} hosts no row`,
    );
  }
});

Deno.test("checkpoints: a checkpoint-free effort reports an empty governing set and stays quiet", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_NO_CHECKPOINTS);

    await t.step(
      "a checkpoint-free effort reports an empty governing set and stays quiet",
      async () => {
        const r = await runAgent(wt, ["checkpoints", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseCheckpointsJson(r.stdout);
        assertEquals(env.ok, true);
        assertEquals(env.verb, "checkpoints");
        assertEquals(env.data.checkpoints, []);
        assertEquals(env.hints, undefined);
      },
    );

    await t.step(
      "previews: a checkpoint-free effort adds no checkpoint hints to prepare or status",
      async () => {
        for (const command of ["prepare", "status"] as const) {
          const argv = [command, "--json"];
          const env = parseHinted((await runAgent(wt, argv)).stdout, command);
          for (const hint of env.hints ?? []) {
            assert(
              !hint.startsWith("Checkpoint"),
              `expected no checkpoint hint on ${argv[0]}: ${hint}`,
            );
          }
        }
        // prepare refreshed generated artifacts; hand the next step the
        // committed tree back.
        await restoreCommittedTree(wt);
      },
    );

    await t.step(
      "a corrupt store remains visible with zero resolved definitions",
      async () => {
        const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
        assert(path !== undefined);
        await Deno.mkdir(join(path, ".."), { recursive: true });
        await Deno.writeTextFile(path, "not json\n");

        const report = await runAgent(wt, ["checkpoints", "--json"]);
        assertEquals(report.code, 0, report.output);
        const data = parseCheckpointsJson(report.stdout).data;
        assertEquals(data.checkpoints, []);
        assertEquals(data.drops?.[0]?.scope, "policy");
        assertEquals(data.drops?.[0]?.reason, "open_question_store_corrupt");
        assert((data.drops?.[0]?.policy_commit?.length ?? 0) > 0);

        const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
        assertEquals(preview.code, 0, preview.output);
        const previewEnvelope = decodeCliResult(preview.stdout, "accept");
        assert(
          previewEnvelope.data !== undefined &&
            "checkpoint_drops" in previewEnvelope.data,
        );
        const previewData = previewEnvelope.data;
        assertEquals(
          previewData?.checkpoint_drops?.[0]?.reason,
          "open_question_store_corrupt",
        );
      },
    );
  });
});

Deno.test("checkpoints: a governing stop checkpoint reports its policy row and preview, and every read surface projects its obligation until the question is served", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    const visit: MatrixVisit = {
      wt,
      dir,
      journey: "stop-question",
      visited: [],
    };

    await t.step(
      "a governing stop checkpoint reports its policy row, preview, and declaration routing",
      async () => {
        const observationsBefore = await checkpointObservationEvents(dir);
        const r = await runAgent(wt, ["checkpoints", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseCheckpointsJson(r.stdout);
        assert(
          env.data.policy !== undefined,
          "the policy identity must resolve",
        );
        assertEquals(env.data.checkpoints.length, 1);
        const row = env.data.checkpoints[0];
        assert(row !== undefined);
        assertEquals(row.id, "api-review");
        assertEquals(row.mode, "stop");
        assertEquals(row.question, QUESTION_API);
        assertEquals(
          row.teach,
          "State the failure modes; note what callers must revisit.",
        );
        assertEquals(row.trigger, "paths api/** · authored only");
        assertEquals(row.preview?.holds, true);
        assertEquals(row.preview?.matched, ["api/surface.txt"]);
        assertEquals(row.preview?.when_pending, undefined);
        // Nothing has fired yet, so no open question — and the report says nothing ran.
        assertEquals(row.open_question, undefined);
        // Routing: the two valid done conclusions, never --variance.
        assertHasHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
        for (const hint of env.hints ?? []) {
          assert(
            !hint.includes("--variance"),
            `the read surface must not present --variance as agent work: ${hint}`,
          );
        }
        // The boundary read recorded its invocation, never a lifecycle event.
        assertEquals(
          await checkpointObservationEvents(dir),
          observationsBefore,
        );
      },
    );

    await t.step(
      "previews: prepare, status, and done --dry-run project the one preview; --dry-run never refuses",
      async () => {
        const observationsBefore = await checkpointObservationEvents(dir);
        const params = {
          id: "api-review",
          question: QUESTION_API,
          matched: ["api/surface.txt"],
          related: [],
          state: "will_open" as const,
        };

        const prepare = parseHinted(
          (await runAgent(wt, ["prepare", "--json"])).stdout,
          "prepare",
        );
        const served = assertHasHint(
          prepare,
          HINTS["checkpoint-preview"],
          params,
        );

        const status = parseHinted(
          (await runAgent(wt, ["status", "--json"])).stdout,
          "status",
        );
        const servedByStatus = assertHasHint(
          status,
          HINTS["checkpoint-preview"],
          params,
        );
        assertEquals(
          servedByStatus,
          served,
          "prepare and status must serve the identical preview text",
        );

        const r = await runAgent(wt, ["done", "--dry-run", "--json"]);
        assertEquals(r.code, 0, r.output);
        const dryRun = parseJson(r.stdout);
        assertEquals(dryRun.ok, true);
        assertEquals(dryRun.dry_run, true);
        const details: string[] = dryRun.plan?.details ?? [];
        assert(
          details.includes(
            "Checkpoint 'api-review' (stop): a declared conclusion will be required at done (1 matched).",
          ),
          `the dry-run plan must carry the same preview: ${
            JSON.stringify(details)
          }`,
        );
        assert(
          details.some((line) =>
            line.includes("api-review") && line.includes("required")
          ),
          JSON.stringify(details),
        );
        // Previewing wrote nothing: no open question exists yet, and no read
        // recorded a lifecycle event.
        const openQuestions = await readOpenQuestions(wt);
        assert(openQuestions.status === "missing", openQuestions.status);
        assertEquals(
          await checkpointObservationEvents(dir),
          observationsBefore,
        );
        // prepare refreshed generated artifacts; hand the next step the
        // committed tree back.
        await restoreCommittedTree(wt);
      },
    );

    // The will-open row's strict decision is the bare done that opens the
    // question: its refusal serves the question, and it is the state every
    // later read in this journey follows.
    await projectObligationRow(t, visit, "will_open", async () => {
      const r = await runAgent(wt, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);
      return parseJson(r.stdout);
    });

    await t.step(
      "the report follows the open question: a fresh engine process reads the open question the refusal recorded",
      async () => {
        // A fresh `checkpoints` process reads the state the last process
        // recorded — the spec's session-restart claim, named.
        const read = await runAgent(wt, ["checkpoints", "--json"]);
        assertEquals(read.code, 0, read.output);
        const env = parseCheckpointsJson(read.stdout);
        assertEquals(
          env.data.checkpoints[0]?.open_question?.state,
          "awaiting_declaration",
        );
        assertHasHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
      },
    );

    await projectObligationRow(t, visit, "awaiting_declaration");
    assertEquals(visit.visited, matrixRows(visit.journey));
  });
});

Deno.test("checkpoints: the read surfaces follow one open question through declared met, declared unmet, and reopened", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    const visit: MatrixVisit = {
      wt,
      dir,
      journey: "stop-conclusions",
      visited: [],
    };
    // Conclude the served question met in the opening run — the run both
    // serves and records — reaching the state the report, the human surface,
    // and the matrix read first.
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    await t.step(
      "the report follows the open question: declared met stands with its binding and no routing hint, read by a fresh engine process",
      async () => {
        const env = parseCheckpointsJson(
          (await runAgent(wt, ["checkpoints", "--json"])).stdout,
        );
        const met = env.data.checkpoints[0]?.open_question;
        assertEquals(met?.state, "declared_met");
        assertEquals(met?.declaration?.conclusion, "met");
        assertEquals(met?.declaration?.current, true);
        assertEquals(met?.variance_required, undefined);
        // The open question names its binding — the subject a declaration binds to and
        // a variance authorization later cites.
        assert((met?.definition_hash ?? "").length > 0);
        assert((met?.subject ?? "").length > 0);
        assertLacksHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
      },
    );

    await t.step(
      "the human surface labels a met declaration as declared, never as Passed",
      async () => {
        // The terminal renderer prints the row's state as its label. Both agent
        // conclusions use declaration vocabulary; machine verdict and attention
        // remain separate facts.
        const human = await runAgent(wt, ["checkpoints"], {
          env: { COLUMNS: "120", NO_COLOR: "1" },
        });
        assertEquals(human.code, 0, human.output);
        assertTerminalTextIncludes(human.output, "Declared: api-review");
        assertTerminalTextIncludes(human.output, "Declared met");
        assert(
          !human.output.includes("Passed"),
          `a declaration row must not carry the Passed label:\n${human.output}`,
        );

        const ascii = await runAgent(wt, ["checkpoints"], {
          env: { COLUMNS: "48", LC_ALL: "C", NO_COLOR: "1" },
        });
        assertEquals(ascii.code, 0, ascii.output);
        assertTerminalTextIncludes(ascii.output, ". Declared: api-review");
        assertTerminalTextIncludes(ascii.output, "Declared met");
      },
    );

    await projectObligationRow(t, visit, "declared_met");

    await t.step(
      "the report follows the open question: declared unmet requires a variance, carries the rationale, and routes review",
      async () => {
        assertEquals(
          (await runAgent(
            wt,
            ["done", "--unmet", "api-review", "--why", WHY, "--json"],
          )).code,
          0,
        );
        const env = parseCheckpointsJson(
          (await runAgent(wt, ["checkpoints", "--json"])).stdout,
        );
        const unmet = env.data.checkpoints[0]?.open_question;
        assertEquals(unmet?.state, "declared_unmet");
        assertEquals(unmet?.declaration?.why, WHY);
        assertEquals(unmet?.variance_required, true);
        assertHasHint(env, HINTS["checkpoints-variance-review"], {
          ids: ["api-review"],
        });
      },
    );

    await t.step(
      "the markdown projection carries the declared vocabulary and the variance boundary",
      async () => {
        const r = await runAgent(wt, ["checkpoints", "--markdown"]);
        assertEquals(r.code, 0, r.output);
        assertTerminalTextIncludes(r.stdout, "declared unmet");
        assertTerminalTextIncludes(r.stdout, "owner variance required to land");
        assertTerminalTextIncludes(r.stdout, WHY);
        assertTerminalTextIncludes(r.stdout, "authorize each variance");
      },
    );

    await t.step(
      "the human surface labels an unmet declaration as declared, never as Passed",
      async () => {
        const unmet = await runAgent(wt, ["checkpoints"], {
          env: { COLUMNS: "120", NO_COLOR: "1" },
        });
        assertEquals(unmet.code, 0, unmet.output);
        assertTerminalTextIncludes(unmet.output, "Declared: api-review");
        assertTerminalTextIncludes(unmet.output, "Declared unmet");
        assertTerminalTextIncludes(unmet.output, "owner variance required");
        assertTerminalTextIncludes(unmet.output, WHY);
        assert(
          !unmet.output.includes("Passed"),
          `a declaration row must not carry the Passed label:\n${unmet.output}`,
        );

        const unmetAscii = await runAgent(wt, ["checkpoints"], {
          env: { COLUMNS: "48", LC_ALL: "C", NO_COLOR: "1" },
        });
        assertEquals(unmetAscii.code, 0, unmetAscii.output);
        assertTerminalTextIncludes(unmetAscii.output, ". Declared: api-review");
        assertTerminalTextIncludes(unmetAscii.output, "Declared unmet");
      },
    );

    await projectObligationRow(t, visit, "declared_unmet");

    await t.step(
      "the report follows the open question: a relevant edit unbinds the conclusion, and the report says so WITHOUT writing anything",
      async () => {
        await Deno.writeTextFile(
          join(wt, "api", "surface.txt"),
          "endpoint\nrevised\n",
        );
        const storeBefore = await adminMarker(wt, "checkpointOpenQuestions");
        const env = parseCheckpointsJson(
          (await runAgent(wt, ["checkpoints", "--json"])).stdout,
        );
        const reopened = env.data.checkpoints[0]?.open_question;
        assertEquals(reopened?.state, "reopened");
        assertEquals(reopened?.declaration?.current, false);
        assertEquals(reopened?.variance_required, undefined);
        assertHasHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
        assertEquals(
          await adminMarker(wt, "checkpointOpenQuestions"),
          storeBefore,
        );
        // Commit the same revision: the reopened state the matrix reads next.
        await git(wt, "add", "api/surface.txt");
        await git(
          wt,
          "commit",
          "-q",
          "-m",
          "feat: revise the api",
          "--no-gpg-sign",
        );
      },
    );

    await projectObligationRow(t, visit, "reopened");
    assertEquals(visit.visited, matrixRows(visit.journey));
  });
});

Deno.test("checkpoints: an advise checkpoint previews without interlock routing, rides the advisory channel, and never blocks done", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);
    const params = {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
      related: [],
    };

    await t.step(
      "an advise checkpoint previews without interlock routing",
      async () => {
        const env = parseCheckpointsJson(
          (await runAgent(wt, ["checkpoints", "--json"])).stdout,
        );
        const row = env.data.checkpoints[0];
        assertEquals(row?.mode, "advise");
        assertEquals(row?.preview?.holds, true);
        assertEquals(row?.open_question, undefined);
        assertLacksHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
      },
    );

    await t.step(
      "previews: an advise checkpoint rides the advisory channel on prepare and status",
      async () => {
        const prepare = parseHinted(
          (await runAgent(wt, ["prepare", "--json"])).stdout,
          "prepare",
        );
        assertHasHint(prepare, HINTS["checkpoint-advise"], params);
        const status = parseHinted(
          (await runAgent(wt, ["status", "--json"])).stdout,
          "status",
        );
        assertHasHint(status, HINTS["checkpoint-advise"], params);
        // prepare refreshed generated artifacts; the next step's green done
        // earns its Proof over the committed tree.
        await restoreCommittedTree(wt);
      },
    );

    await t.step(
      "done: advise mode serves the question through the advisory channel and never blocks",
      async () => {
        const r = await runAgent(wt, ["done", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseCheckpointGateJson(r.stdout);
        assertEquals(env.ok, true);
        assertHasHint(env, HINTS["checkpoint-advise"], params);
        assertEquals(env.data.checkpoints.advise?.length, 1);
        assertEquals(env.data.checkpoints.outstanding, undefined);
        // No declaration exists or is required; the recorded Proof carries no
        // conclusion block for an advise-only run.
        assert(!(await proofMarker(wt)).includes("Checkpoint conclusions"));
      },
    );

    await t.step(
      "observation: advise servings record for economics without inventing open questions",
      async () => {
        const { events } = await readLogbook(dir);
        const dones = events.filter((event) =>
          event.kind === "verb" && event.verb === "done" &&
          event.checkpoints !== undefined
        );
        assertEquals(dones.length, 1);
        const done = dones[0];
        assert(done !== undefined && done.kind === "verb");
        assertEquals(done.checkpoints?.advise, [{ id: "api-review" }]);
        assertEquals(done.checkpoints?.fired, undefined);
        assertEquals(done.checkpoints?.declared, undefined);

        // The read verb renders the observed history from the same events: one
        // bounded economics row, counts beside their denominators.
        const report = await runAgent(wt, ["checkpoints", "--json"]);
        assertEquals(report.code, 0, report.output);
        const envelope = parseCheckpointsJson(report.stdout);
        const economics = envelope.data.economics;
        assert(economics !== undefined, "observed history must reach the verb");
        assertEquals(economics.efforts, 1);
        assertEquals(economics.omitted, 0);
        assertEquals(economics.rows.length, 1);
        assertEquals(economics.rows[0]?.id, "api-review");
        assertEquals(economics.rows[0]?.fires, 1);
        assertEquals(economics.rows[0]?.efforts_fired, 1);
      },
    );
  });
});

Deno.test("checkpoints: a when condition is reported as undecided and never run by a read surface", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_WHEN, undefined, {
      whenProbe: WHEN_TOUCHES,
    });
    const visit: MatrixVisit = { wt, dir, journey: "when", visited: [] };

    await t.step(
      "a when condition is reported as undecided and never run",
      async () => {
        const env = parseCheckpointsJson(
          (await runAgent(wt, ["checkpoints", "--json"])).stdout,
        );
        const row = env.data.checkpoints[0];
        assertEquals(row?.preview?.holds, true);
        assertEquals(row?.preview?.when_pending, true);
        assertStringIncludes(row?.trigger ?? "", "when: sh when-probe.sh");
        // Undecided means unroutable: no declaration is asked for yet.
        assertLacksHint(env, HINTS["checkpoints-declare"], {
          ids: ["api-review"],
        });
        // Read-only means the command NEVER ran.
        assertEquals(
          await sidecarMarker(wt, "when-ran.log"),
          "",
          "a read surface must not run a when command",
        );
      },
    );

    await t.step(
      "previews: a when-pending stop checkpoint is served as may-require",
      async () => {
        const prepare = parseHinted(
          (await runAgent(wt, ["prepare", "--json"])).stdout,
          "prepare",
        );
        const text = assertHasHint(prepare, HINTS["checkpoint-preview"], {
          id: "api-review",
          question: QUESTION_API,
          matched: ["api/surface.txt"],
          related: [],
          state: "when_pending" as const,
        });
        assertStringIncludes(text, "may require");
        // The preview must not have run the command.
        assertEquals(
          await sidecarMarker(wt, "when-ran.log"),
          "",
          "a preview must not run a when command",
        );
        // prepare refreshed generated artifacts; hand the matrix row the
        // committed tree back.
        await restoreCommittedTree(wt);
      },
    );

    await projectObligationRow(t, visit, "unknown");
    // Strict done is the one local surface that executes the command.
    assertStringIncludes(await sidecarMarker(wt, "when-ran.log"), "ran");
    assertEquals(visit.visited, matrixRows(visit.journey));
  });
});

Deno.test("checkpoints: an open question outside the governing policy stays visible", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    // The engine's own open question API plants a record for a checkpoint id the
    // merge-base policy does not define — the state left behind when policy
    // lands differently than an effort expected.
    const planted = await reconcileOpenQuestion(wt, {
      checkpoint: "ghost",
      definitionHash: "d".repeat(64),
      subject: "s".repeat(64),
      matchedPaths: ["api/surface.txt"],
      relatedPaths: [],
    });
    assert(planted.ok, "the fixture open question must record");
    const env = parseCheckpointsJson(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(env.data.ungoverned?.length, 1);
    assertEquals(env.data.ungoverned?.[0]?.id, "ghost");
    assertEquals(
      env.data.ungoverned?.[0]?.open_question.state,
      "awaiting_declaration",
    );
    // An ungoverned open question is not declarable, so it must not be routed.
    assertLacksHint(env, HINTS["checkpoints-declare"], {
      ids: ["api-review", "ghost"],
    });
  });
});

Deno.test("checkpoints: a corrupt open-question store fails open into an advisory", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(path !== undefined);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, "not json\n");
    const r = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpointsJson(r.stdout);
    assertEquals(env.ok, true);
    assert(
      env.data.advisories?.some((a) => a.includes("did not parse")),
      `expected the parse advisory; got ${JSON.stringify(env.data.advisories)}`,
    );
    // The policy report still stands — fail open never blanks the answer.
    assertEquals(env.data.checkpoints.length, 1);
  });
});

Deno.test("checkpoint obligations: an idle structural trigger opens nothing, and an opened question outranks it on every surface", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_UNLESS_CHANGED);
    const visit: MatrixVisit = {
      wt,
      dir,
      journey: "unless-changed",
      visited: [],
    };
    // The paired docs change makes the structural trigger idle from the start.
    await commitDocs(wt);
    await projectObligationRow(t, visit, "none");

    await t.step(
      "the api-only effort fires the checkpoint and opens its question",
      async () => {
        // Retracting the docs leaves an API-only effort: the trigger is active
        // again, and the gate serves the question.
        await git(wt, "rm", "-q", "docs/api.md");
        await git(
          wt,
          "commit",
          "-q",
          "-m",
          "docs: retract the description",
          "--no-gpg-sign",
        );
        assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
      },
    );

    await t.step(
      "an opened question outranks an idle structural trigger on every surface",
      async () => {
        // Adding the paired docs back makes the current structural trigger idle,
        // but cannot retract the question the gate already served.
        await commitDocs(wt);

        const checkpoints = await checkpointsResult(wt);
        const prepare = await prepareResult(wt);
        const status = await statusResult(wt);
        const dryRun = await finishResult(wt, {
          surface: { kind: "quiet" },
          cliModel: TEST_CLI_MODEL,
          dryRun: true,
        });
        // The prepare core refreshed generated artifacts; the conclusion the
        // next step records earns its Proof over the committed tree.
        await restoreCommittedTree(wt);
        const stillAwaiting = await runAgent(wt, ["done", "--json"]);
        assertEquals(stillAwaiting.code, 1, stillAwaiting.output);
        const done = parseHinted(stillAwaiting.stdout, "done");
        assertResultDataKey(done, "checkpoints");
        assertExists(done.data.checkpoints);

        const obligations = {
          checkpoints:
            checkpoints.data?.checkpoints[0]?.open_question?.state ===
              "awaiting_declaration" &&
            (checkpoints.hints ?? []).some((hint) =>
              hint.includes("Awaiting: api-review")
            ),
          prepare: (prepare.hints ?? []).some((hint) =>
            hint.includes("Checkpoint 'api-review'") &&
            hint.includes("already awaits a declared conclusion")
          ),
          status: (status.hints ?? []).some((hint) =>
            hint.includes("Checkpoint 'api-review'") &&
            hint.includes("already awaits a declared conclusion")
          ),
          done_dry_run: (dryRun.plan?.details ?? []).some((line) =>
            line.includes("Checkpoint 'api-review'") &&
            line.includes("requires a declared conclusion")
          ),
          done: done.error === "awaiting_declaration" &&
            done.data?.checkpoints?.outstanding?.[0]?.id === "api-review",
        };
        assertEquals(obligations, {
          checkpoints: true,
          prepare: true,
          status: true,
          done_dry_run: true,
          done: true,
        });
        // The served question still names the evidence that opened it.
        const awaiting = parseCheckpointGateJson(stillAwaiting.stdout);
        assertEquals(awaiting.error, AWAITING_DECLARATION_SLUG);
        assertEquals(awaiting.data.checkpoints.outstanding?.[0]?.matched, [
          "api/surface.txt",
        ]);
      },
    );

    await t.step(
      "done: an opened stop question remains interlocked after its trigger becomes inactive",
      async () => {
        // A conclusion recorded while the trigger remains inactive is still part
        // of this run's checkpoint evidence, including the variance requirement.
        const concluded = await runAgent(wt, [
          "done",
          "--unmet",
          "api-review",
          "--why",
          "The changed docs do not yet describe the compatibility trade-off.",
          "--json",
        ]);
        assertEquals(concluded.code, 0, concluded.output);
        const env = parseCheckpointGateJson(concluded.stdout);
        assertEquals(
          env.data.checkpoints.declared_unmet?.[0]?.id,
          "api-review",
        );
        assertStringIncludes(env.data.proof?.line ?? "", "variance required");
      },
    );

    assertEquals(visit.visited, matrixRows(visit.journey));
  });
});

Deno.test("checkpoints: dynamic question, path, and rationale separators stay inside one terminal row, and the human refusal keeps its paragraphs", async (t) => {
  await withTempDir(async (dir) => {
    const changedPath =
      `api/surface${LINE_SEPARATOR}line${PARAGRAPH_SEPARATOR}paragraph.txt`;
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_SEPARATOR_QUESTION,
      undefined,
      { changedPath },
    );

    await t.step(
      "done: the human refusal keeps authored paragraphs and inert hostile separators",
      async () => {
        // The refusal is a multi-paragraph product message: its own newlines are
        // deliberate structure, while separators inside governed dynamic text
        // stay visible, inert notation. Rendering it through a single-line sink
        // turns the paragraphs into visible newline symbols — the defect this
        // guards. The refusal also opens the question the next step reads.
        const human = await runAgent(wt, ["done"], {
          env: { COLUMNS: "200", NO_COLOR: "1" },
        });
        assertEquals(human.code, 1, human.output);
        assert(
          !human.output.includes("␊"),
          `authored refusal newlines leaked as visible symbols:\n${human.output}`,
        );
        assert(
          /\n\s*Question: /.test(human.output),
          `the question must open its own line:\n${human.output}`,
        );
        assertTerminalTextIncludes(human.output, "<U+2028>");
        assertTerminalTextIncludes(human.output, "<U+2029>");
        assert(
          !human.output.includes(LINE_SEPARATOR) &&
            !human.output.includes(PARAGRAPH_SEPARATOR),
          "a raw line or paragraph separator reached the terminal",
        );
      },
    );

    await t.step(
      "dynamic question, path, and rationale separators stay inside one terminal row",
      async () => {
        const stored = await readOpenQuestions(wt);
        assert(stored.status === "ok");
        const openQuestion = stored.openQuestions["api-review"];
        assert(openQuestion !== undefined);
        const rationale =
          `Deferred because ${LINE_SEPARATOR} evidence ${PARAGRAPH_SEPARATOR} is incomplete.`;
        const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
        assert(path !== undefined);
        // Rationale admission rejects these separators. Plant structurally valid
        // legacy/corrupt evidence to prove the terminal boundary remains the sink's
        // guarantee even when that upstream defence is bypassed.
        await Deno.writeTextFile(
          path,
          `${
            JSON.stringify({
              version: 1,
              openQuestions: {
                ...stored.openQuestions,
                "api-review": {
                  ...openQuestion,
                  declaration: {
                    conclusion: "unmet",
                    why: rationale,
                    definitionHash: openQuestion.definitionHash,
                    subject: openQuestion.subject,
                    declaredAt: "2026-08-21T12:00:00.000Z",
                  },
                },
              },
            })
          }\n`,
        );

        const human = await runAgent(wt, ["checkpoints"], {
          env: { COLUMNS: "120", NO_COLOR: "1" },
        });
        assertEquals(human.code, 0, human.output);
        assertTerminalTextIncludes(
          human.output,
          `Question: ${HOSTILE_QUESTION}`.replaceAll(LINE_SEPARATOR, "<U+2028>")
            .replaceAll(PARAGRAPH_SEPARATOR, "<U+2029>"),
        );
        assertTerminalTextIncludes(
          human.output,
          "Changed: api/surface<U+2028>line<U+2029>paragraph.txt.",
        );
        assertTerminalTextIncludes(
          human.output,
          "Rationale: Deferred because <U+2028> evidence <U+2029> is incomplete.",
        );
        assertEquals(human.output.includes(LINE_SEPARATOR), false);
        assertEquals(human.output.includes(PARAGRAPH_SEPARATOR), false);
      },
    );
  });
});
