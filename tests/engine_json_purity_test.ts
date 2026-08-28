/**
 * The `--json` purity guard (ADR 0030): the regression net that keeps every
 * public command path's structured output to one result envelope and nothing else.
 *
 * Two layers:
 *  1. **Behavioural** — run each `--json` verb against a config whose commands print
 *     loudly to BOTH stdout and stderr, and assert the COMBINED stdout+stderr is
 *     exactly one envelope line. Combined (not just stdout) because an agent calling
 *     through a shell tool captures both; a leak on either stream fails the test.
 *     The cases are reconciled both against the top-level verb registry and
 *     against every exact path in `CLI_JSON_RESULT_CONTRACTS`. Every result path
 *     is swept here — in the noisy project or through the worktree lifecycle.
 *     Top-level non-result protocols are consciously excepted by the shared
 *     contract registry. A new nested path cannot hide behind an
 *     already-enrolled parent.
 *  2. **Structural** — a source-level guard that `serializeResult` is called only
 *     through the one emission chokepoint, so a new verb cannot hand-roll an emit
 *     that bypasses the silence rule.
 *
 * Together they make the "an agent only ever sees JSON" contract impossible to
 * regress: add a verb that streams a stray line, or print an envelope off-channel,
 * and one of these fails the gate.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  engineRunArgs,
  gitInit,
  mapPool,
  runAgent,
  type RunResult,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  CLI_JSON_CONTRACT_EXCLUSIONS,
  CLI_JSON_PREDICATE_CONTRACTS,
  CLI_JSON_RESULT_CONTRACTS,
  CLI_PREDICATE_INVOCATION_MODES,
  CLI_PREDICATE_STATES,
  type CliPredicateInvocationMode,
  type CliPredicateState,
  type RegisteredCliJsonPredicateContract,
} from "../src/shared/result_contracts.ts";
import {
  type CliResultEnvelope,
  decodeCliResult,
} from "./decode_cli_result.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/**
 * Assert a `<verb> --json` run emitted ONLY the envelope. The compact envelope is a
 * single physical line, and `JSON.stringify` escapes any newline inside a string
 * value (e.g. a diagnostic's captured output) — so a real newline in the combined
 * output means human narration or subprocess output leaked. The envelope is
 * asserted regardless of `ok`: a refusal or error must be the same single line.
 */
function assertEnvelopeOnly(
  r: RunResult,
  verb: string,
  context = verb,
): CliResultEnvelope {
  const combined = r.output.trim();
  assert(
    combined.length > 0 && !combined.includes("\n"),
    `${context} --json must emit exactly one line (the envelope), nothing else on stdout OR stderr.\n--- got ---\n${r.output}\n-----------`,
  );
  const obj = decodeCliResult(combined, verb);
  assertEquals(
    typeof obj.ok,
    "boolean",
    `${verb}: envelope missing boolean ok`,
  );
  assertEquals(obj.verb, verb, `${verb}: envelope carries the wrong verb`);
  return obj;
}

/** Narrow decoded command output to a non-null, non-array envelope record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A config whose every gate command and standard prints loudly to stdout AND
 * stderr (and still succeeds), so a silence regression surfaces as leaked text. */
const NOISY_CONFIG = [
  "[project]",
  'slug = "json-purity"',
  "",
  "[jobs]",
  `format = "printf 'FMT-OUT\\n'; printf 'FMT-ERR\\n' >&2"`,
  `lint = "printf 'LINT-OUT\\n'; printf 'LINT-ERR\\n' >&2"`,
  `typecheck = "printf 'TC-OUT\\n'"`,
  `test = "printf 'TEST-OUT\\n'; printf 'TEST-ERR\\n' >&2"`,
  "",
  "[standards.cov]",
  `run = "printf 'STANDARD-NOISE\\n'; printf 'DISCERN_METRIC cov 90\\n'"`,
  'direction = "up"',
  "limit = 80",
  "",
].join("\n");

const NOISY_CONFIGS = [
  { name: "buffered", toml: NOISY_CONFIG },
  {
    name: "streamed",
    toml: `${NOISY_CONFIG}\n[gate]\nstream = true\n`,
  },
];

/**
 * One swept `--json` invocation: its canonical registry path, the verb the
 * emitted envelope must carry (some paths share a family verb, such as all
 * config reads), and the argv to run.
 */
interface PurityCase {
  /** Canonical path in the public CLI result-contract registry. */
  readonly commandPath: string;
  readonly envelopeVerb: string;
  readonly args: readonly string[];
}

/** Select the registry verb that owns a possibly nested CLI command path. */
function topLevelVerb(commandPath: string): string {
  return commandPath.split(" ")[0] ?? commandPath;
}

/**
 * The sweep over the noisy scaffolded project — every public command path
 * runnable there, read-only paths first, file-touching ones after. A refusal or
 * error is still an envelope: `desk` refuses machine mode, `preset` reports a
 * missing preset, and the bare command groups require a subcommand. Identity
 * and config reads keep shell-friendly output without the flag, but every case
 * here adds `--json` and therefore receives the same one-envelope protocol.
 */
const PROJECT_CASES: readonly PurityCase[] = [
  { commandPath: "discern", envelopeVerb: "discern", args: [] },
  { commandPath: "done", envelopeVerb: "done", args: ["done"] },
  { commandPath: "done", envelopeVerb: "done", args: ["done", "--dry-run"] },
  { commandPath: "prepare", envelopeVerb: "prepare", args: ["prepare"] },
  { commandPath: "test", envelopeVerb: "test", args: ["test"] },
  {
    commandPath: "standards",
    envelopeVerb: "standards",
    args: ["standards"],
  },
  {
    commandPath: "standards propose",
    envelopeVerb: "standards propose",
    args: [
      "standards",
      "propose",
      "cov",
      "--reason",
      "The purity fixture exercises a proposal refusal.",
      "--dry-run",
    ],
  },
  {
    commandPath: "improvement",
    envelopeVerb: "improvement",
    args: ["improvement"],
  },
  {
    commandPath: "checkpoints",
    envelopeVerb: "checkpoints",
    args: ["checkpoints"],
  },
  { commandPath: "impact", envelopeVerb: "impact", args: ["impact"] },
  { commandPath: "status", envelopeVerb: "status", args: ["status"] },
  {
    commandPath: "await",
    // --timeout 0 evaluates once and answers immediately, so the sweep never
    // waits out the verb's real default.
    envelopeVerb: "await",
    args: ["await", "--trunk-moved", "--timeout", "0"],
  },
  {
    commandPath: "coupling",
    envelopeVerb: "coupling",
    args: ["coupling"],
  },
  { commandPath: "patterns", envelopeVerb: "patterns", args: ["patterns"] },
  {
    commandPath: "patterns reset",
    envelopeVerb: "patterns reset",
    args: ["patterns", "reset", "--dry-run"],
  },
  {
    commandPath: "patterns archive",
    envelopeVerb: "patterns archive",
    args: ["patterns", "archive", "--dry-run"],
  },
  {
    commandPath: "patterns archives",
    envelopeVerb: "patterns archives",
    args: ["patterns", "archives"],
  },
  { commandPath: "desk", envelopeVerb: "desk", args: ["desk"] },
  {
    commandPath: "worktrees",
    envelopeVerb: "worktrees",
    args: ["worktrees"],
  },
  { commandPath: "doctor", envelopeVerb: "doctor", args: ["doctor"] },
  { commandPath: "setup", envelopeVerb: "setup", args: ["setup"] },
  {
    commandPath: "setup verify",
    envelopeVerb: "setup verify",
    args: ["setup", "verify"],
  },
  {
    commandPath: "setup begin",
    envelopeVerb: "setup",
    args: ["setup", "begin", "--force", "--dry-run", "--confirmed"],
  },
  {
    commandPath: "setup step",
    envelopeVerb: "setup step",
    args: ["setup", "step", "1"],
  },
  {
    commandPath: "setup done",
    envelopeVerb: "setup done",
    args: ["setup", "done"],
  },
  {
    commandPath: "setup accept",
    envelopeVerb: "setup accept",
    args: ["setup", "accept", "--dry-run"],
  },
  { commandPath: "map", envelopeVerb: "map", args: ["map", "--list"] },
  { commandPath: "docs", envelopeVerb: "docs", args: ["docs", "--list"] },
  {
    commandPath: "licenses",
    envelopeVerb: "licenses",
    args: ["licenses"],
  },
  {
    commandPath: "triangle",
    envelopeVerb: "triangle",
    args: ["triangle"],
  },
  {
    commandPath: "preset",
    envelopeVerb: "preset",
    args: ["preset", "zz-missing", "--yes"],
  },
  { commandPath: "scripts", envelopeVerb: "scripts", args: ["scripts"] },
  {
    commandPath: "skills",
    envelopeVerb: "skills",
    args: ["skills"],
  },
  {
    commandPath: "skills list",
    envelopeVerb: "skills list",
    args: ["skills", "list"],
  },
  {
    commandPath: "config",
    envelopeVerb: "config",
    args: ["config"],
  },
  {
    commandPath: "config set",
    envelopeVerb: "config",
    args: ["config", "set", "project.name", "Purity", "--dry-run"],
  },
  {
    commandPath: "config set-job",
    envelopeVerb: "config",
    args: ["config", "set-job", "lint", "true", "--dry-run"],
  },
  {
    commandPath: "config set-scope",
    envelopeVerb: "config",
    args: [
      "config",
      "set-scope",
      "json",
      "src/**",
      "--dry-run",
    ],
  },
  {
    commandPath: "config set-standard",
    envelopeVerb: "config",
    args: [
      "config",
      "set-standard",
      "json",
      "--direction",
      "up",
      "--limit",
      "1",
      "--run",
      "true",
      "--dry-run",
    ],
  },
  {
    commandPath: "config get",
    envelopeVerb: "config",
    args: ["config", "get", "project.slug"],
  },
  {
    commandPath: "config array",
    envelopeVerb: "config",
    args: ["config", "array", "project.slug"],
  },
  {
    commandPath: "config has",
    envelopeVerb: "config",
    args: ["config", "has", "missing.key"],
  },
  {
    commandPath: "config subsections",
    envelopeVerb: "config",
    args: ["config", "subsections", "scopes"],
  },
  {
    commandPath: "config keys",
    envelopeVerb: "config",
    args: ["config", "keys", "project"],
  },
  {
    commandPath: "identity",
    envelopeVerb: "identity",
    args: ["identity"],
  },
  {
    commandPath: "worktree",
    envelopeVerb: "worktree",
    args: ["worktree"],
  },
  {
    commandPath: "uninstall",
    envelopeVerb: "uninstall",
    args: ["uninstall", "--dry-run"],
  },
  { commandPath: "refresh", envelopeVerb: "refresh", args: ["refresh"] },
  { commandPath: "tidy", envelopeVerb: "tidy", args: ["tidy"] },
  {
    commandPath: "skills eject",
    envelopeVerb: "skills eject",
    args: ["skills", "eject", "discern-write-adr"],
  },
  {
    commandPath: "upgrade",
    envelopeVerb: "upgrade",
    // Earlier file-touching cases (tidy, eject) dirty the tree by design.
    args: ["upgrade", "--allow-dirty"],
  },
];

interface PredicateFixture {
  readonly contractId: string;
  readonly values: Readonly<Record<CliPredicateState, string>>;
}

/**
 * Only the project facts that make each canonical predicate true or false.
 * Command spelling, option placement, output path, exit semantics, and the
 * Cartesian modes all come from `result_contracts.ts`.
 */
const PREDICATE_FIXTURES: readonly PredicateFixture[] = [
  {
    contractId: "configHas",
    values: { true: "project.slug", false: "missing.key" },
  },
  {
    contractId: "impactHas",
    values: { true: "code", false: "missing-scope" },
  },
];

/** Place a predicate value according to its registered positional or option contract. */
function predicateArgs(
  contract: RegisteredCliJsonPredicateContract,
  value: string,
): string[] {
  const args = contract.command.split(" ");
  return contract.option === undefined
    ? [...args, value]
    : [...args, contract.option, value];
}

/** Insert the JSON flag at the invocation position each predicate mode promises. */
function predicateModeArgs(
  mode: CliPredicateInvocationMode,
  args: readonly string[],
): string[] {
  switch (mode.jsonFlag) {
    case "none":
      return [...args];
    case "before-command":
      return ["--json", ...args];
    case "after-arguments":
      return [...args, "--json"];
  }
}

/** Traverse decoded envelope data defensively, yielding absence at the first non-record segment. */
function valueAtPath(
  value: unknown,
  path: readonly string[],
): unknown {
  let cursor = value;
  for (const segment of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

/** The registry verbs whose output path consults `[gate].stream` — the only
 * ones the streamed config variant can affect, so the only ones re-swept
 * under it (the rest would just repeat their buffered run verbatim). */
const STREAM_SENSITIVE: ReadonlySet<string> = new Set([
  "done",
  "prepare",
  "test",
  "standards",
]);

/**
 * The worktree-lifecycle sweep (run in order after `start` below): argv given
 * the started worktree's id, run either inside that worktree or from the main
 * checkout. These need a real linked worktree, so they sweep in their own
 * harness rather than the noisy project above.
 */
interface LifecycleCase {
  readonly commandPath: string;
  readonly envelopeVerb: string;
  readonly cwd: "worktree" | "main";
  args(id: string): string[];
}

const START_CASE: PurityCase = {
  commandPath: "start",
  envelopeVerb: "start",
  args: ["start", "--name", "purity"],
};

const LIFECYCLE_CASES: readonly LifecycleCase[] = [
  {
    commandPath: "update",
    envelopeVerb: "update",
    cwd: "worktree",
    args: () => ["update"],
  },
  {
    commandPath: "worktree setup",
    envelopeVerb: "worktree setup",
    cwd: "worktree",
    args: () => ["worktree", "setup"],
  },
  {
    commandPath: "worktree rename",
    envelopeVerb: "worktree rename",
    cwd: "worktree",
    args: () => ["worktree", "rename", "Purity title"],
  },
  // Without --confirmed, accept refuses read-only — the refusal must still be
  // the single envelope line.
  {
    commandPath: "accept",
    envelopeVerb: "accept",
    cwd: "worktree",
    args: () => ["accept"],
  },
  {
    commandPath: "worktree teardown",
    envelopeVerb: "worktree teardown",
    cwd: "worktree",
    args: () => ["worktree", "teardown"],
  },
  {
    commandPath: "worktree drop",
    envelopeVerb: "worktree drop",
    cwd: "main",
    args: (id) => ["worktree", "drop", id],
  },
  {
    commandPath: "worktree prune",
    envelopeVerb: "worktree prune",
    cwd: "main",
    args: () => ["worktree", "prune", "--yes"],
  },
];

/**
 * Registry verbs NOT swept, each with the reason it has no envelope to assert.
 * Reconciled against `KNOWN_VERBS` below so a stale entry fails, and a new verb
 * that joins neither the cases nor this set fails the reconciliation.
 */
const NOT_SWEPT: ReadonlyMap<string, string> = new Map(
  CLI_JSON_CONTRACT_EXCLUSIONS
    .filter((entry) => !entry.command.includes(" "))
    .map((entry) => [entry.command, entry.reason]),
);

/** Every registry verb the sweeps enrol (project + start + lifecycle). */
const ENROLLED_VERBS: readonly string[] = [
  ...PROJECT_CASES.filter((c) => c.commandPath !== "discern").map((c) =>
    topLevelVerb(c.commandPath)
  ),
  topLevelVerb(START_CASE.commandPath),
  ...LIFECYCLE_CASES.map((c) => topLevelVerb(c.commandPath)),
];

/** Every exact public command path with a behavioral purity case. */
const ENROLLED_COMMAND_PATHS: ReadonlySet<string> = new Set([
  ...PROJECT_CASES.map((c) => c.commandPath),
  START_CASE.commandPath,
  ...LIFECYCLE_CASES.map((c) => c.commandPath),
]);

/** Every command path the published result registry says emits one envelope. */
const CONTRACTED_COMMAND_PATHS: readonly string[] = CLI_JSON_RESULT_CONTRACTS
  .flatMap((contract) => [...contract.commands]);

/**
 * Registry members with neither a sweep case nor a `NOT_SWEPT` entry. Pure and
 * input-driven so the future-sibling proof below can feed it a synthetic
 * registry; the honesty test drives it with the real one.
 */
function unenrolledVerbs(
  registry: Iterable<string>,
  enrolled: Iterable<string>,
  excepted: Iterable<string>,
): string[] {
  const covered = new Set([...enrolled, ...excepted]);
  return [...registry].filter((verb) => !covered.has(verb)).sort();
}

/** Return unique uncovered registry members in stable order. */
function setDifference(
  candidates: Iterable<string>,
  covered: Iterable<string>,
): string[] {
  const coverage = new Set(covered);
  return [...new Set(candidates)].filter((candidate) =>
    !coverage.has(candidate)
  ).sort();
}

Deno.test("the purity case table stays honest against the full verb registry", () => {
  // No stale exception: every excepted verb is still a real built-in, carries a
  // reason, and is not ALSO swept (which would make the exception a lie).
  for (const [verb, reason] of NOT_SWEPT) {
    assert(
      KNOWN_VERBS.has(verb),
      `NOT_SWEPT lists "${verb}", which is not a built-in verb any more`,
    );
    assert(reason.trim().length > 0, `NOT_SWEPT("${verb}") needs a reason`);
    assert(
      !ENROLLED_VERBS.includes(verb),
      `"${verb}" is both swept and excepted — drop one`,
    );
  }
  // No stale case: every case enrols a verb the registry still owns.
  for (const verb of ENROLLED_VERBS) {
    assert(
      KNOWN_VERBS.has(verb),
      `the sweep enrols "${verb}", which is not a built-in verb any more`,
    );
  }
  // Complete: every built-in verb is either swept or consciously excepted.
  assertEquals(
    unenrolledVerbs(KNOWN_VERBS, ENROLLED_VERBS, NOT_SWEPT.keys()),
    [],
    "every built-in verb must either be swept for --json purity or listed in NOT_SWEPT with a reason",
  );
});

Deno.test("the reconciliation catches a fresh verb joining the registry unenrolled", () => {
  // Future-sibling proof: a brand-new verb under an unrelated name joins the
  // registry, and the reconciliation names it with no case-table edit — the
  // mechanism that forces every future verb into the sweep.
  const withFreshVerb = new Set([...KNOWN_VERBS, "zz-fresh-verb"]);
  assertEquals(
    unenrolledVerbs(withFreshVerb, ENROLLED_VERBS, NOT_SWEPT.keys()),
    ["zz-fresh-verb"],
  );
});

Deno.test("every public JSON command path has a behavioral purity case", () => {
  assertEquals(
    setDifference(CONTRACTED_COMMAND_PATHS, ENROLLED_COMMAND_PATHS),
    [],
    "a public CLI result contract has no noisy --json behavioral case",
  );
  assertEquals(
    setDifference(ENROLLED_COMMAND_PATHS, CONTRACTED_COMMAND_PATHS),
    [],
    "the purity sweep names a stale or uncontracted command path",
  );
});

Deno.test("a future nested contract cannot hide behind an enrolled parent verb", () => {
  assertEquals(
    setDifference(
      [...CONTRACTED_COMMAND_PATHS, "config zz-future"],
      ENROLLED_COMMAND_PATHS,
    ),
    ["config zz-future"],
  );
});

Deno.test("every canonical predicate has a behavioral fixture, with no stale fixture", () => {
  const contracts = CLI_JSON_PREDICATE_CONTRACTS.map((entry) => entry.id);
  const fixtures = PREDICATE_FIXTURES.map((entry) => entry.contractId);
  assertEquals(
    setDifference(contracts, fixtures),
    [],
    "a canonical predicate contract has no true/false behavioral fixture",
  );
  assertEquals(
    setDifference(fixtures, contracts),
    [],
    "the predicate fixture table names a stale contract",
  );
});

Deno.test("a future predicate mode under an enrolled command cannot hide behind its default case", () => {
  assertEquals(
    setDifference(
      [
        ...CLI_JSON_PREDICATE_CONTRACTS.map((entry) => entry.id),
        "zz-future-predicate",
      ],
      PREDICATE_FIXTURES.map((entry) => entry.contractId),
    ),
    ["zz-future-predicate"],
  );
});

Deno.test("predicate modes preserve bare 0/1 and publish true/false JSON observations in both flag positions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, NOISY_CONFIG);
    await gitInit(dir);
    // One non-neutral working-tree change makes impact's canonical `code`
    // predicate true; config membership is unaffected.
    await Deno.writeTextFile(join(dir, "predicate-change.ts"), "change\n");

    const fixtures = new Map(
      PREDICATE_FIXTURES.map((fixture) => [
        fixture.contractId,
        fixture,
      ]),
    );
    for (const contract of CLI_JSON_PREDICATE_CONTRACTS) {
      const fixture = fixtures.get(contract.id);
      assert(fixture !== undefined, `${contract.id} needs a fixture`);
      const parent = CLI_JSON_RESULT_CONTRACTS.find((candidate) =>
        candidate.commands.includes(contract.command)
      );
      assert(parent !== undefined, `${contract.id} needs a parent contract`);

      for (const state of CLI_PREDICATE_STATES) {
        const present = state === "true";
        const args = predicateArgs(contract, fixture.values[state]);
        for (const mode of CLI_PREDICATE_INVOCATION_MODES) {
          const context = `${contract.id} ${state} ${mode.id}`;
          const result = await runAgent(
            dir,
            predicateModeArgs(mode, args),
          );
          const expectedExit = mode.exit === "success" ? 0 : present ? 0 : 1;
          assertEquals(
            result.code,
            expectedExit,
            `${context}: ${result.output}`,
          );

          if (mode.jsonFlag === "none") {
            assertEquals(
              result.output,
              "",
              `${context}: bare predicates stay silent`,
            );
            continue;
          }

          assertEquals(result.stderr, "", `${context}: stderr must stay empty`);
          const envelope = assertEnvelopeOnly(
            result,
            contract.verb,
            context,
          );
          assertEquals(envelope.ok, true, `${context}: query should succeed`);
          assertEquals(
            valueAtPath(envelope, contract.subjectPath),
            fixture.values[state],
            `${context}: predicate subject drifted`,
          );
          assertEquals(
            valueAtPath(envelope, contract.presentPath),
            present,
            `${context}: predicate payload drifted`,
          );
          const parsed = parent.schema.safeParse(envelope);
          assert(
            parsed.success,
            `${context}: envelope fails ${parent.id} runtime schema: ${
              JSON.stringify(parsed.success ? [] : parsed.error.issues)
            }`,
          );
        }
      }
    }
  });
});

Deno.test("every swept --json verb emits ONLY the envelope (no human or subprocess leak)", async () => {
  // Every case drives its own scaffold, so the sweep fans out without cases
  // coupling through shared gate state (a real `done` beside a dry-run, a
  // proof a later verb would see).
  const sweep = NOISY_CONFIGS.flatMap((config) => {
    const cases = config.name === "buffered"
      ? PROJECT_CASES
      : PROJECT_CASES.filter((c) =>
        STREAM_SENSITIVE.has(topLevelVerb(c.commandPath))
      );
    return cases.map((c) => ({ config, c }));
  });
  await mapPool(sweep, 8, async ({ config, c }) => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, config.toml);
      await gitInit(dir);
      assertEnvelopeOnly(
        await runAgent(dir, [...c.args, "--json"]),
        c.envelopeVerb,
        `${c.args.join(" ")} (${config.name})`,
      );
    });
  });
});

Deno.test("done --markdown emits one quiet authored document under both stream settings", async () => {
  for (const config of NOISY_CONFIGS) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, config.toml);
      await gitInit(dir);
      const preview = await runAgent(dir, [
        "done",
        "--dry-run",
        "--markdown",
      ]);
      assertEquals(preview.code, 0, preview.output);
      assertEquals(preview.stderr, "", preview.output);
      assertTerminalTextIncludes(
        preview.stdout,
        "## Current state\n\n**Dry run: nothing changed.**",
      );
      assertTerminalTextIncludes(preview.stdout, "Would check");
      const result = await runAgent(dir, ["done", "--markdown"]);
      assertEquals(result.code, 0, result.output);
      assertEquals(result.stderr, "", result.output);
      assertTerminalTextIncludes(result.stdout, "# `discern done`");
      assertTerminalTextIncludes(result.stdout, "## Current state");
      assertTerminalTextIncludes(result.stdout, "## Evidence");
      assert(
        !result.stdout.includes("**Dry run: nothing changed.**"),
        result.stdout,
      );
      assert(!result.stdout.includes("Would check"), result.stdout);
      assertEquals(result.stdout.match(/^# /gm)?.length, 1, result.stdout);
      for (
        const noise of [
          "FMT-OUT",
          "FMT-ERR",
          "LINT-OUT",
          "LINT-ERR",
          "TC-OUT",
          "TEST-OUT",
          "TEST-ERR",
          "STANDARD-NOISE",
        ]
      ) {
        assert(
          !result.output.includes(noise),
          `${config.name}: ${noise} leaked around the Markdown result:\n${result.output}`,
        );
      }
    });
  }
});

Deno.test("worktree lifecycle --json: start/update/accept/setup/rename/teardown/drop/prune emit only the envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Noisy worktree setup steps and resource commands: they inherit stdio in
    // human mode, so any of these lifecycle verbs re-running them un-silenced
    // under --json surfaces as leaked text.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[worktree.setup]",
        `steps = ["printf 'SETUP-NOISE-OUT\\n'; printf 'SETUP-NOISE-ERR\\n' >&2"]`,
        "",
        "[worktree.resources.thing]",
        `create = "printf 'RESOURCE-CREATE-NOISE\\n'"`,
        `destroy = "printf 'RESOURCE-DESTROY-NOISE\\n'"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    // `start` runs the noisy setup steps and resource create while emitting its
    // envelope; its data names the worktree the rest of the sweep drives.
    const started = await runAgent(dir, [...START_CASE.args, "--json"]);
    assertEnvelopeOnly(started, START_CASE.envelopeVerb);
    const envelope = decodeCliResult(started.stdout, "start");
    assert(envelope.data !== undefined && "id" in envelope.data);
    const id = envelope.data?.id;
    const worktree = envelope.data?.path;
    assert(
      typeof id === "string" && typeof worktree === "string",
      `start --json must carry data.id and data.path:\n${started.stdout}`,
    );

    for (const c of LIFECYCLE_CASES) {
      assertEnvelopeOnly(
        await runAgent(
          c.cwd === "worktree" ? worktree : dir,
          [...c.args(id), "--json"],
        ),
        c.envelopeVerb,
        `${c.args(id).join(" ")} (${c.cwd})`,
      );
    }
  });
});

Deno.test("done --json: a FAILING gate captures output INTO the envelope, never leaks it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "json-purity"',
        "",
        "[jobs]",
        `lint = "printf 'LINT-BOOM-OUT\\n'; printf 'LINT-BOOM-ERR\\n' >&2; exit 1"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    // Single envelope line, despite the failing command's multi-line output…
    assertEnvelopeOnly(r, "done");
    const obj = decodeCliResult(r.stdout, "done");
    assertEquals(obj.ok, false);
    // …and that output rode INTO the envelope as a diagnostic (newlines escaped),
    // which is exactly why it didn't leak as a real stream line.
    assertStringIncludes(
      JSON.stringify(obj.diagnostics),
      "LINT-BOOM",
      "the failing command's output must be captured into the diagnostic",
    );
  });
});

Deno.test("bare discern --json is one controlled result before and after setup", async () => {
  await withTempDir(async (dir) => {
    for (const phase of ["before setup", "after setup"]) {
      if (phase === "after setup") {
        await scaffoldEngine(dir);
      }
      const result = await runAgent(dir, ["--json"]);
      assertEquals(result.code, 1, `${phase}: ${result.output}`);
      assertEnvelopeOnly(result, "discern", phase);
      const envelope = decodeCliResult(result.stdout, "discern");
      assertEquals(envelope.error, "invalid_arguments", phase);
      assert(
        Array.isArray(envelope.hints) && envelope.hints.length > 0,
        `${phase}: root refusal needs registered recovery`,
      );
    }
  });
});

Deno.test("a pre-verb config error is still the uniform envelope (verb + single line)", async () => {
  await withTempDir(async (dir) => {
    // A malformed discern.toml fails during the pre-flight config read, before the
    // verb runs — the one global error path. It must still be the envelope.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEnvelopeOnly(r, "done"); // carries the attempted verb, single line
    assertEquals(decodeCliResult(r.stdout, "done").error, "invalid_toml");
  });
});

Deno.test("serializeResult reaches stdout ONLY through the emitResult chokepoint", async () => {
  // The wire shape is defined once (result_serialization.ts) and printed once
  // (emit.ts). The MCP server is the one other legitimate caller — it folds the
  // serialized envelope into a JSON-RPC tool result, not onto stdout. Any other
  // file calling serializeResult is a verb hand-rolling an emit that escapes the
  // silence rule.
  const allowed = new Set([
    join("src", "shared", "result_serialization.ts"), // the definition
    join("src", "shared", "emit.ts"), // the single print site
    join("src", "engine", "mcp", "server.ts"), // builds the MCP tool result
  ]);
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/engine_json_purity_test.ts#result-serialization-callers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Result serialization callers are production boundaries implemented beneath src; tests contain direct controls.",
        include: (path) => path.startsWith("src/"),
      },
    })
  ) {
    if (allowed.has(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/serializeResult\s*\(/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    `serializeResult must only be emitted via emitResult (src/shared/emit.ts) or the MCP renderer.\n` +
      `Hand-rolled envelope emission found in:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("source-engine subprocesses inherit the quiet Deno launcher", async () => {
  const argv = engineRunArgs(["status", "--json"]);
  assertEquals(
    argv.slice(0, 3),
    ["run", "--quiet", "--no-check"],
    "Deno's launcher diagnostics must stay outside observed discern output",
  );
  assertEquals(argv.slice(-2), ["status", "--json"]);
  assertEquals(argv.filter((arg) => arg === "--quiet"), ["--quiet"]);

  // These paths are private inside engine_helpers. Any other test that names
  // them has bypassed the chokepoint and can expose Deno's dependency-lock
  // notices on stderr. await_readiness_guard_test.ts mentions the identifier
  // only as inert source text for its own synthetic control.
  const allowed = new Set([
    "tests/engine_helpers.ts",
    "tests/await_readiness_guard_test.ts",
  ]);
  const privateIdentifiers = [
    ["MAIN", "TS"].join("_"),
    ["DENO", "JSON"].join("_"),
  ];
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/engine_json_purity_test.ts#quiet-test-launcher-callers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only test sources can bypass the shared source-engine launcher; its two owning controls remain explicit exclusions.",
        include: (path) => path.startsWith("tests/") && !allowed.has(path),
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (
      privateIdentifiers.some((identifier) =>
        new RegExp(`\\b${identifier}\\b`, "u").test(source)
      )
    ) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    `Source-engine subprocesses must use engineRunArgs():\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("authored Markdown reaches agents only through the CLI and MCP result boundaries", async () => {
  const allowed = new Set([
    join("src", "shared", "result_markdown.ts"),
    join("src", "shared", "emit.ts"),
    join("src", "engine", "mcp", "server.ts"),
  ]);
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/engine_json_purity_test.ts#markdown-result-renderers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Markdown result rendering is a production delivery boundary implemented beneath src; tests invoke it as controls.",
        include: (path) => path.startsWith("src/"),
      },
    })
  ) {
    if (allowed.has(rel)) {
      continue;
    }
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/renderResultMarkdown\s*\(/.test(source)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    `Markdown result rendering bypassed the shared boundaries:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("CLI and MCP share the registered failure-recovery preparation", async () => {
  const consumers = new Set([
    join("src", "shared", "emit.ts"),
    join("src", "engine", "mcp", "server.ts"),
  ]);
  const files = await structuralGuardScope({
    guard: "tests/engine_json_purity_test.ts#failure-recovery-consumers",
    universe: "authored-ts",
    narrow: {
      reason:
        "Failure recovery is prepared at the CLI and MCP delivery boundaries.",
      include: (rel) => consumers.has(rel),
    },
  });
  assertEquals(files.length, consumers.size);
  for (const rel of files) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    assertStringIncludes(
      text,
      "withFailureRecoveryHint(",
      `${rel} must prepare failures through the shared registered recovery floor`,
    );
  }
});
