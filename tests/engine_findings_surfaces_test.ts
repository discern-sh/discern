/**
 * End-to-end coverage for ADR 0160's working-surface routes. A single seeded
 * logbook carries branch-, session-, and project-scope evidence; each real verb
 * must expose only its own scope, through its normal envelope, without changing
 * any outcome. The focused cases pin the green-only proof rule, the one-line
 * cap, the logbook toggle, and setup suppression.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import type { PatternsFinding } from "../src/shared/patterns_vocabulary.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  type CliJsonResultCommand,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

const BRANCH_SUMMARY =
  "This branch had repeated red Gates in one conversation.";
const SESSION_SUMMARY = "The same command refusal recurred on this branch.";
const SESSION_NEXT =
  "Read the refusal message and satisfy the precondition it names before retrying. If the same precondition keeps recurring, capture the lesson with the `discern-teach-the-project` skill.";

/** A deterministic timestamp `n` minutes after the fixture epoch. */
function at(n: number): string {
  return new Date(Date.parse("2026-07-01T10:00:00.000Z") + n * 60_000)
    .toISOString();
}

/** One agent-driven event with only the fields a detector needs overridden. */
function event(n: number, over: Partial<VerbEvent>): VerbEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: at(n),
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: {
      session: "cli:surface",
      json: true,
      tty: false,
      ci: false,
    },
    branch: "agent/surface",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 100,
    epoch: "epoch-1",
    ...over,
  };
}

/** Seed evidence for all three routed scopes in one recent month. */
async function seedMixedLogbook(main: string): Promise<void> {
  const events: VerbEvent[] = [];
  // Branch: 4 consecutive red done runs plus one green clears the detector
  // threshold and the proof's stricter one-extra-event bar.
  for (let i = 0; i < 4; i += 1) {
    events.push(event(i, {
      outcome: "failed",
      failed_stage: "check/test",
    }));
  }
  events.push(event(4, {}));

  // Session: one agent conversation repeats the same refusal 3 times.
  for (let i = 0; i < 3; i += 1) {
    events.push(event(10 + i, {
      verb: "update",
      outcome: "refused",
      error: "behind_trunk",
    }));
  }

  // Project: 5 documentation lookups (including a repeated miss).
  events.push(event(20, {
    verb: "docs",
    target: "missing-guide",
    outcome: "refused",
    error: "not_found",
  }));
  events.push(event(21, {
    verb: "docs",
    target: "missing-guide",
    outcome: "refused",
    error: "not_found",
  }));
  events.push(event(22, { verb: "docs", target: "quickstart" }));
  events.push(event(23, { verb: "map", target: "the-logbook" }));
  events.push(event(24, { verb: "docs", target: "standards" }));

  // Project: one diagnostic class on 3 branches, with 5 readings of one
  // standard. These same events feed recurring-diagnostic and trajectory.
  const branches = ["agent/a", "agent/a", "agent/b", "agent/b", "agent/c"];
  for (let i = 0; i < branches.length; i += 1) {
    events.push(event(30 + i, {
      branch: branches[i] ?? "agent/c",
      outcome: "failed",
      failed_stage: "check/test",
      diagnostics: [{ tool: "lint", rule: "no-widget" }],
      standards: [{
        name: "coverage",
        value: 80 + i,
        limit: 80,
        direction: "up",
        verdict: "improved",
      }],
    }));
  }

  const dir = join(main, ".git", "discern", "logbook");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "2026-07.jsonl"),
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
}

/** A minimal real gate with a selectable verdict and logbook toggle. */
function gateConfig(testCommand: "true" | "false", logbook = true): string {
  return [
    "[project]",
    'slug = "surface-test"',
    `logbook = ${logbook}`,
    "",
    "[meta]",
    "bootstrapped = true",
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    `test = "${testCommand}"`,
    "",
  ].join("\n");
}

/** Create one committed branch ahead of main, ready to earn a proof. */
async function proofBranch(
  main: string,
  testCommand: "true" | "false" = "true",
  logbook = true,
): Promise<string> {
  await scaffoldEngine(main);
  await writeConfig(main, gateConfig(testCommand, logbook));
  await gitInit(main);
  const worktree = await addWorktree(main, "surface");
  await Deno.writeTextFile(join(worktree, "feature.txt"), "surface\n");
  await git(worktree, "add", "feature.txt");
  await git(worktree, "commit", "-m", "Add surface fixture");
  return worktree;
}

/** Decode a command result whose historical-finding projection is compared across surfaces. */
function parse<Command extends CliJsonResultCommand>(
  stdout: string,
  command: Command,
): CliResultForCommand<Command> {
  return decodeCliResult(stdout, command);
}

/** Extract historical findings from an envelope while treating an absent group as empty. */
function history(
  result: CliResultForCommand<"improvement">,
): PatternsFinding[] {
  return result.data !== undefined && "history" in result.data
    ? result.data.history?.findings ?? []
    : [];
}

/** Remove the history projection from a clone so unrelated envelope data can be compared. */
function withoutHistory(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const copy = structuredClone(data);
  Reflect.deleteProperty(copy, "history");
  return copy;
}

Deno.test("findings route end to end to done, status, improvement, and nowhere else", async () => {
  await withTempDir(async (main) => {
    const worktree = await proofBranch(main);

    // Capture the static improvement catalogue before history exists. The
    // command records afterwards; the seed below replaces that month file.
    const baselineRun = await runAgent(worktree, ["improvement", "--json"]);
    assertEquals(baselineRun.code, 0, baselineRun.output);
    const baseline = parse(baselineRun.stdout, "improvement");
    await seedMixedLogbook(main);

    const doneRun = await runAgent(worktree, ["done", "--json"]);
    assertEquals(doneRun.code, 0, doneRun.output);
    const done = parse(doneRun.stdout, "done");
    assertEquals(done.ok, true);
    assert(done.data !== undefined && "failed_stage" in done.data);
    assertEquals(done.data?.failed_stage, null);
    assert(
      done.data?.proof !== undefined,
      "the green clean branch needs a proof",
    );
    const proofHint = assertHasHint(
      done,
      HINTS["logbook-proof-finding"],
      { count: 1, summary: BRANCH_SUMMARY },
    );
    assertEquals(
      proofHint.includes("\n"),
      false,
      "the proof advisory must stay one physical line",
    );

    const statusRun = await runAgent(worktree, ["status", "--json"]);
    assertEquals(statusRun.code, 0, statusRun.output);
    const status = parse(statusRun.stdout, "status");
    assertHasHint(status, HINTS["logbook-status-finding"], {
      summary: SESSION_SUMMARY,
      next: SESSION_NEXT,
    });

    const improvementRun = await runAgent(worktree, [
      "improvement",
      "--json",
    ]);
    assertEquals(improvementRun.code, 0, improvementRun.output);
    const improvement = parse(improvementRun.stdout, "improvement");
    assertEquals(improvement.ok, baseline.ok);
    assertEquals(
      withoutHistory(improvement.data),
      withoutHistory(baseline.data),
      "historical advice must leave the static catalogue untouched",
    );
    const projectFindings = history(improvement);
    assertEquals(
      projectFindings.map((finding) => finding.detector),
      ["docs-gap", "recurring-diagnostic", "standard-trajectory"],
      "project findings stay grouped and strongest-first",
    );
    assert(projectFindings.every((finding) => finding.scope === "project"));
    assert(
      projectFindings.every((finding) =>
        Object.keys(finding.evidence).length > 0 && finding.next_step.length > 0
      ),
      "each project finding carries evidence and a next step",
    );

    const patternsRun = await runAgent(worktree, ["patterns", "--json"]);
    assertEquals(patternsRun.code, 0, patternsRun.output);
    const patterns = parse(patternsRun.stdout, "patterns");
    assert(patterns.data !== undefined && "findings" in patterns.data);
    const ids = new Set(patterns.data.findings.map((f) => f.detector));
    for (
      const id of [
        "done-thrash",
        "refusal-loop",
        "docs-gap",
        "recurring-diagnostic",
        "standard-trajectory",
      ]
    ) {
      assert(ids.has(id), `patterns must retain ${id}`);
    }

    const acceptRun = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(acceptRun.code, 0, acceptRun.output);
    const accepted = parse(acceptRun.stdout, "accept");
    assert(
      accepted.data !== undefined && "gate_validation" in accepted.data,
    );
    const gateValidation = accepted.data.gate_validation;
    assertEquals(
      gateValidation?.mode,
      "proof",
      "the advisory must leave the proof honor path intact",
    );
  });
});

Deno.test("done finding line is absent on red, while quiet, and with recording off", async () => {
  const cases = [
    { name: "red", test: "false" as const, logbook: true, seed: true },
    { name: "quiet", test: "true" as const, logbook: true, seed: false },
    { name: "off", test: "true" as const, logbook: false, seed: true },
  ];
  for (const fixture of cases) {
    await withTempDir(async (main) => {
      const worktree = await proofBranch(
        main,
        fixture.test,
        fixture.logbook,
      );
      if (fixture.seed) {
        await seedMixedLogbook(main);
      }
      const run = await runAgent(worktree, ["done", "--json"]);
      const result = parse(run.stdout, "done");
      assertEquals(result.ok, fixture.test === "true", fixture.name);
      assertLacksHint(result, HINTS["logbook-proof-finding"], {
        count: 2,
        summary: BRANCH_SUMMARY,
      });
    });
  }
});

Deno.test("status suppresses session findings until setup is bootstrapped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    const events = [0, 1, 2].map((n) =>
      event(n, {
        branch: "main",
        verb: "update",
        outcome: "refused",
        error: "behind_trunk",
      })
    );
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    const run = await runAgent(dir, ["status", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = parse(run.stdout, "status");
    assertLacksHint(result, HINTS["logbook-status-finding"], {
      summary: SESSION_SUMMARY,
      next: SESSION_NEXT,
    });
    assert(result.data !== undefined && "location" in result.data);
    assert(result.data.setup_unfinished !== undefined);
  });
});

Deno.test("status does not correct an owner for interactive refusal history", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    const events = [0, 1, 2].map((n) =>
      event(n, {
        branch: "main",
        verb: "update",
        outcome: "refused",
        error: "behind_trunk",
        driver: {
          session: "cli:owner",
          json: false,
          tty: true,
          ci: false,
        },
      })
    );
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    const run = await runAgent(dir, ["status", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = parse(run.stdout, "status");
    assertLacksHint(result, HINTS["logbook-status-finding"], {
      summary: SESSION_SUMMARY,
      next: SESSION_NEXT,
    });
  });
});

Deno.test("improvement names its missing history while recording is off, and only then", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, gateConfig("true", false));
    await gitInit(dir);

    const offRun = await runAgent(dir, ["improvement", "--json"]);
    assertEquals(offRun.code, 0, offRun.output);
    const expected = assertHasHint(
      parse(offRun.stdout, "improvement"),
      HINTS["improvement-logbook-off"],
    );
    const human = await runAgent(dir, ["improvement"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.output.replaceAll(/\s+/gu, " "), expected);

    await writeConfig(dir, gateConfig("true", true));
    const onRun = await runAgent(dir, ["improvement", "--json"]);
    assertEquals(onRun.code, 0, onRun.output);
    assertLacksHint(
      parse(onRun.stdout, "improvement"),
      HINTS["improvement-logbook-off"],
    );
  });
});
