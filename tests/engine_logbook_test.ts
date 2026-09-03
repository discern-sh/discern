/**
 * Logbook substrate integration tests — the recorded behaviour of real verb
 * runs, driven black-box through the engine (`runAgent`) in scaffolded temp
 * repos, plus the MCP chokepoint in-process. The contract under test is the
 * substrate's definition of done:
 *
 *  - any project-rooted verb run (green or red) appends one valid event under
 *    the git common dir, attributed by BRANCH name — from a linked worktree
 *    too, where the shared common dir converges all fleet activity into one
 *    logbook;
 *  - `[project].logbook = false` stops all writes;
 *  - an unwritable logbook directory changes no verb's outcome — recording
 *    degrades to silence, never interference;
 *  - a limit-only standards edit (what a pin writes) holds the config-epoch
 *    fingerprint, while a capability edit flips it AND logs a `config-change`
 *    event naming the moved section;
 *  - the MCP surface records through its own chokepoint with `surface: "mcp"`.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  defaultMapPath,
  git,
  gitInit,
  readLogbookEvents as readEvents,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import type { LogbookEvent } from "../src/engine/logbook/schema.ts";
import { beginRecording } from "../src/engine/logbook/record.ts";
import {
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { fire, firedHintsFromTexts, HINTS } from "../src/shared/hints.ts";
import {
  observeCheckpointActivity,
  observeSupplementalHints,
} from "../src/shared/result_capture.ts";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";
import { verbNeedsSetup } from "../src/shared/setup_state.ts";
import { RECORDED_VALIDATION_VERBS } from "../src/engine/logbook/validation.ts";

/** Just the verb events, in order. */
function verbEvents(
  events: LogbookEvent[],
): Extract<LogbookEvent, { kind: "verb" }>[] {
  return events.filter((e) => e.kind === "verb");
}

/** Stable hint identities from the exact result an MCP caller received. */
function deliveredHintIds(
  result: { structuredContent: Record<string, unknown> },
): string[] {
  const hints = result.structuredContent.hints;
  assert(
    hints === undefined || Array.isArray(hints),
    "an MCP result returned malformed hints",
  );
  return firedHintsFromTexts(hints as string[] | undefined).map((hint) =>
    hint.id
  );
}

/** Every MCP tool whose declared surface can override the project root. */
function toolsWithPathArgument(): typeof TOOLS {
  return TOOLS.filter((tool) => Object.keys(tool.inputSchema).includes("path"));
}

Deno.test("logbook: a verb run appends one valid, branch-attributed event", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const envValue = "logbook-test-thread-value";
    const r = await runAgent(dir, ["status", "--local", "--json"], {
      env: { CODEX_THREAD_ID: envValue },
    });
    assertEquals(r.code, 0, r.output);
    const allEvents = await readEvents(dir);
    assertEquals(
      allEvents.filter((event) => event.kind === "begin"),
      [],
      "a pure-observation verb stays completion-only",
    );
    const events = verbEvents(allEvents);
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "status");
    assertEquals(event.surface, "cli");
    assertEquals(event.branch, "main");
    assert(
      event.head !== null && /^[0-9a-f]{7,}$/.test(event.head),
      `short HEAD expected, got ${event.head}`,
    );
    assertEquals(event.clean, true);
    assertEquals(event.outcome, "ok");
    assert(event.duration_ms >= 0);
    assert(
      event.epoch !== null && /^[0-9a-f]{8}$/.test(event.epoch),
      `epoch fingerprint expected, got ${event.epoch}`,
    );
    // The enrichment fields: the writing version, the raw driver signals, the
    // flag names (values never), and the change's scale against the trunk.
    assert(
      typeof event.writer === "string" && event.writer.length > 0,
      "every event names the discern version that wrote it",
    );
    assert(event.driver !== undefined, "a CLI event carries driver signals");
    assertEquals(event.driver.json, true);
    assertEquals(event.driver.tty, false);
    assert(
      event.driver.session !== undefined &&
        event.driver.session.startsWith("cli:"),
      `a CLI session hint expected, got ${event.driver.session}`,
    );
    assert(
      event.driver.agent_signals?.some((signal) =>
        signal.agent === "codex" &&
        signal.source === "process-environment" &&
        signal.markers.includes("CODEX_THREAD_ID")
      ) === true,
      "the CLI event carries the catalogue match as advisory evidence",
    );
    assert(
      !JSON.stringify(event.driver).includes(envValue),
      "the environment marker's value must not land in the logbook",
    );
    assertEquals(event.flags, ["local"]);
    assertEquals(event.hint_ids, [
      HINTS["generated-agent-files-missing"].id,
      HINTS["materialized-skills-missing"].id,
      HINTS["status-start-on-trunk"].id,
      HINTS["status-continue-own-effort"].id,
      HINTS["status-no-active-worktrees"].id,
      HINTS["status-full-structured-detail"].id,
    ]);
    assertEquals(event.change, {
      files: 0,
      insertions: 0,
      deletions: 0,
      commits: 0,
    });
  });
});

Deno.test("logbook: Markdown is a first-class agent output signal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const result = await runAgent(dir, ["status", "--local", "--markdown"]);
    assertEquals(result.code, 0, result.output);

    const [event] = verbEvents(await readEvents(dir));
    assert(event !== undefined);
    assertEquals(event.driver?.json, false);
    assertEquals(event.driver?.markdown, true);
    assertEquals(event.flags, ["local"]);
  });
});

Deno.test("logbook: render remains a convenience flag outside the result-format signals", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const result = await runAgent(dir, ["status", "--local", "--render"]);
    assertEquals(result.code, 0, result.output);

    const [event] = verbEvents(await readEvents(dir));
    assert(event !== undefined);
    assertEquals(event.driver?.json, false);
    assertEquals(event.driver?.markdown, false);
    assertEquals(event.flags, ["local", "render"]);
  });
});

Deno.test("logbook: an effectful verb pairs begin and completion by invocation id", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[jobs]\ntest = "true"\n`);
    await gitInit(dir);

    const run = await runAgent(dir, ["test", "--json"]);
    assertEquals(run.code, 0, run.output);

    const events = await readEvents(dir);
    const begins = events.filter((event) =>
      event.kind === "begin" && event.verb === "test"
    );
    const completions = events.filter((event) =>
      event.kind === "verb" && event.verb === "test"
    );
    assertEquals(begins.length, 1);
    assertEquals(completions.length, 1);
    const begin = begins[0];
    const completion = completions[0];
    assert(begin !== undefined && begin.kind === "begin");
    assert(completion !== undefined && completion.kind === "verb");
    assertEquals(completion.invocation, begin.invocation);
    assertEquals(begin.branch, "main");
    assertEquals(begin.surface, "cli");
    assertEquals(begin.driver, completion.driver);
    assertEquals(begin.lock_boundary, "checkout");
    assertEquals(completion.lock_boundary, "checkout");
    assertEquals(begin.dry_run, false);
    assert(
      Date.parse(begin.at) <= Date.parse(completion.at),
      "the begin line must precede its paired completion",
    );
  });
});

Deno.test("logbook: the envelope-less main-worktree orientation records its delivered hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(r.code, 0, r.output);

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    assertEquals(events[0]?.verb, "worktree ensure");
    assertEquals(events[0]?.hint_ids, [
      HINTS["ensure-main-worktree-first"].id,
    ]);
  });
});

Deno.test("logbook: a human-rendered verb records the ids on its observed result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["status", "--local"]);
    assertEquals(r.code, 0, r.output);
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    assertEquals(events[0]?.hint_ids, [
      HINTS["generated-agent-files-missing"].id,
      HINTS["materialized-skills-missing"].id,
      HINTS["status-start-on-trunk"].id,
      HINTS["status-continue-own-effort"].id,
      HINTS["status-no-active-worktrees"].id,
      HINTS["status-full-structured-detail"].id,
    ]);
  });
});

Deno.test("logbook: a refusal records with its slug and the looked-up target", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["docs", "no-such-topic", "--json"]);
    assert(r.code !== 0, "a doc miss refuses");
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "docs");
    assertEquals(
      event.outcome,
      "refused",
      "a declined verb is refused, not failed — different diagnoses",
    );
    assert(event.error !== undefined, "the refusal carries its slug");
    assertEquals(
      event.target,
      "no-such-topic",
      "what was looked up is recorded — the instructions-gap signal",
    );
    assertEquals(
      event.hint_ids,
      [HINTS["docs-find-target"].id],
      "the recorded refusal preserves the wire contract's tailored recovery",
    );
  });
});

Deno.test("logbook: a successful map fetch records the canonical page on CLI and MCP", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const body = "# Concepts\n\nMap-content-sentinel-7f3c1.\n";
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      body,
    );
    await gitInit(dir);

    // The input alias differs from the canonical target. Recording the alias
    // would say what was typed, not which page the map actually served.
    const cli = await runAgent(dir, ["map", "concepts", "--json"]);
    assertEquals(cli.code, 0, cli.output);
    const human = await runAgent(dir, ["map", "concepts"]);
    assertEquals(human.code, 0, human.output);

    const map = TOOLS.find((tool) => tool.name === "discern_map");
    assert(map !== undefined);
    const mcp = await runTool(
      map,
      new WorkingRoot(dir),
      { target: "concepts" },
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(mcp.isError, false);

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 3);
    assertEquals(events.map((event) => event.surface), ["cli", "cli", "mcp"]);
    for (const event of events) {
      assertEquals(event.target, "00-orientation/concepts");
      assertEquals(typeof event.target, "string");
      assert(
        !JSON.stringify(event).includes("Map-content-sentinel-7f3c1"),
        `${event.surface} lifted page content into the metadata-only logbook`,
      );
    }
  });
});

Deno.test("logbook: map-fetch payloads lift by shape under an unrelated verb", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const recording = beginRecording(dir, {
      verb: "fresh-page-reader",
      surface: "mcp",
      driver: Promise.resolve({}),
    });
    await recording.finish({
      verb: "fresh-page-reader",
      surface: "mcp",
      outcome: "ok",
      durationMs: 1,
      result: {
        ok: true,
        verb: "renamed-reader",
        data: {
          doc: {
            target: "91-future/fresh-name",
            content: "message-body-must-never-land",
          },
        },
      },
    });

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "fresh-page-reader");
    assertEquals(event.target, "91-future/fresh-name");
    assert(
      !JSON.stringify(event).includes("message-body-must-never-land"),
      "the lift keeps the target string and drops the page body",
    );
  });
});

Deno.test("logbook: a shown desk tip's id lands on the verb event verbatim", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const shown = beginRecording(dir, {
      verb: "desk",
      surface: "cli",
      driver: Promise.resolve({}),
    });
    await shown.finish({
      verb: "desk",
      surface: "cli",
      outcome: "ok",
      durationMs: 1,
      tipIds: ["patterns-practice-report"],
    });
    const tipless = beginRecording(dir, {
      verb: "desk",
      surface: "cli",
      driver: Promise.resolve({}),
    });
    await tipless.finish({
      verb: "desk",
      surface: "cli",
      outcome: "ok",
      durationMs: 1,
    });

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 2);
    assertEquals(
      events[0]?.tip_ids,
      ["patterns-practice-report"],
      "the registry id is the adoption reader's correlation key",
    );
    assertEquals(
      events[1]?.tip_ids,
      undefined,
      "a session that showed no tip carries no tip_ids field",
    );
  });
});

Deno.test("logbook: checkpoint observations drain onto the event on either surface, exactly once", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Both surfaces record through the one recorder, so the drain lives below
    // them: the same observation attaches identically whether the invocation
    // arrived through the CLI wrapper or the MCP chokepoint.
    for (const surface of ["cli", "mcp"] as const) {
      const recording = beginRecording(dir, {
        verb: "done",
        surface,
        driver: Promise.resolve({}),
      });
      observeCheckpointActivity({
        fired: [{ id: "api-review", definition: "d1", subject: "s1" }],
        declared: [{
          id: "api-review",
          conclusion: "met",
          revised: false,
          elapsed_ms: 5,
        }],
      });
      await recording.finish({
        verb: "done",
        surface,
        outcome: "ok",
        durationMs: 1,
      });
    }
    // A later invocation that observed nothing must carry nothing — begin
    // discards stale accumulator state, finish takes exactly once.
    observeCheckpointActivity({ advise: [{ id: "stale-from-elsewhere" }] });
    const clean = beginRecording(dir, {
      verb: "status",
      surface: "cli",
      driver: Promise.resolve({}),
    });
    await clean.finish({
      verb: "status",
      surface: "cli",
      outcome: "ok",
      durationMs: 1,
    });

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 3);
    const [cli, mcp, stale] = events;
    for (const event of [cli, mcp]) {
      assert(event !== undefined);
      assertEquals(event.checkpoints, {
        fired: [{ id: "api-review", definition: "d1", subject: "s1" }],
        declared: [{
          id: "api-review",
          conclusion: "met",
          revised: false,
          elapsed_ms: 5,
        }],
      });
    }
    assertEquals(cli?.surface, "cli");
    assertEquals(mcp?.surface, "mcp");
    assertEquals(
      stale?.checkpoints,
      undefined,
      "stale accumulator state from outside an invocation never attaches",
    );
  });
});

Deno.test("logbook: bare discern's desk dispatch records like the named verb", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The desk-session marker forces the bare invocation onto the desk path
    // under piped stdio; the nested-desk refusal is the observable outcome.
    const r = await runAgent(dir, [], {
      env: { [DESK_SESSION_ENV]: "1" },
    });
    assertEquals(r.code, 1, r.output);

    const events = await readEvents(dir);
    const begins = events.filter(
      (event) => event.kind === "begin" && event.verb === "desk",
    );
    const completions = verbEvents(events).filter(
      (event) => event.verb === "desk",
    );
    assertEquals(begins.length, 1, "the bare desk appends its begin event");
    assertEquals(completions.length, 1);
    assertEquals(completions[0]?.surface, "cli");
    assertEquals(completions[0]?.outcome, "failed");
  });
});

Deno.test("logbook: documentation search records the flag but never the query", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas.\n",
    );
    await gitInit(dir);
    const query = "private-query-value-7f3c1";

    const cli = await runAgent(dir, ["map", "--search", query, "--json"]);
    assertEquals(cli.code, 0, cli.output);

    const map = TOOLS.find((tool) => tool.name === "discern_map");
    assert(map !== undefined);
    const mcp = await runTool(
      map,
      new WorkingRoot(dir),
      { search: query },
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(mcp.isError, false);

    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 2);
    assertEquals(events.map((event) => event.surface), ["cli", "mcp"]);
    for (const event of events) {
      assertEquals(event.flags, ["search"]);
      assertEquals(event.target, undefined);
      assert(
        !JSON.stringify(event).includes(query),
        `${event.surface} search query must not enter the logbook`,
      );
    }
  });
});

Deno.test("logbook: a red gate still records — outcome, steps, diagnostic classes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[jobs]\ntest = "sh -c 'echo failing; exit 1'"\n`,
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "done");
    assertEquals(event.outcome, "failed");
    assert(
      event.steps !== undefined && event.steps.length > 0,
      "a gate event must carry the envelope's step timings",
    );
    const testStep = event.steps.find((s) => s.label === "test");
    assert(testStep !== undefined, "the failing test job must appear in steps");
    assertEquals(testStep.outcome, "failed");
    assertEquals(
      testStep.disposition,
      "run",
      "the plan's intent rides each step, so collateral skips stay tellable",
    );
    assertEquals(
      testStep.group,
      "Check & test",
      "the gate stage rides each step, so a reader can tell a fixer from a check",
    );
    assertEquals(
      event.failed_stage,
      "check/test",
      "the gate's failed stage is lifted — which red, not just that it was red",
    );
    assert(
      event.diagnostics !== undefined &&
        event.diagnostics.some((d) => d.tool === "test"),
      "the diagnostic CLASS (tool name) must be recorded",
    );
    // Metadata only: the classes never carry the message or captured output.
    for (const d of event.diagnostics ?? []) {
      assertEquals(Object.keys(d).sort(), ["tool"]);
    }
  });
});

Deno.test("logbook: unavailable pre-boundary evidence cannot replace the gate's original red", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[jobs]\nformat = "false"\ntest = "true"\n`);
    await gitInit(dir);
    await Deno.mkdir(
      join(dir, ".git", "discern", "validation-hmac-key"),
      { recursive: true },
    );

    const result = await runAgent(dir, ["done", "--json"]);
    assertEquals(result.code, 1, result.output);
    const event = verbEvents(await readEvents(dir))[0];
    assert(event !== undefined);
    assertEquals(event.outcome, "failed");
    assertEquals(event.failed_stage, "fix");
    assertEquals(event.validation?.state.complete, false);
    assert(
      event.validation?.state.incomplete?.some((entry) =>
        entry.category === "boundary" && entry.reason === "not-reached"
      ),
    );
    assert(
      event.validation?.state.incomplete?.some((entry) =>
        entry.category === "key" && entry.reason === "invalid"
      ),
    );
  });
});

Deno.test("logbook: Proof reuse and the one deliberate rerun spelling remain distinct", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[jobs]\ntest = "echo ok"\n`);
    await gitInit(dir);
    const wt = await addWorktree(dir, "proof-reuse-logbook");
    await Deno.writeTextFile(join(wt, "feature.txt"), "feature\n");
    await git(wt, "add", "feature.txt");
    await git(wt, "commit", "-q", "-m", "add feature", "--no-gpg-sign");
    const firstRun = await runAgent(wt, ["done", "--json"]);
    assertEquals(firstRun.code, 0, firstRun.output);
    // Bare strict done reuses current Proof; the explicit spelling reruns.
    const reused = await runAgent(wt, ["done", "--json"]);
    assertEquals(reused.code, 0, reused.output);
    assertEquals(
      (await runAgent(wt, ["done", "--rerun", "--json"])).code,
      0,
    );
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 3);
    const [first, reuse, probe] = events;
    assertEquals(first?.outcome, "ok");
    assertEquals(first?.flags, undefined);
    assertEquals(first?.gate_ran, true);
    assertEquals(reuse?.outcome, "ok");
    assertEquals(reuse?.gate_ran, false);
    assertEquals(reuse?.flags, undefined);
    assertEquals(probe?.outcome, "ok");
    assertEquals(probe?.gate_ran, true);
    assertEquals(probe?.flags, ["rerun"]);
  });
});

Deno.test("logbook: every registered validation verb records current evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[jobs]\ntest = "true"\n`);
    await gitInit(dir);
    const wt = await addWorktree(dir, "validation-writer-enrollment");
    await Deno.writeTextFile(join(wt, "feature.txt"), "feature\n");
    await git(wt, "add", "feature.txt");
    await git(wt, "commit", "-q", "-m", "add feature", "--no-gpg-sign");

    for (const verb of RECORDED_VALIDATION_VERBS) {
      const result = await runAgent(wt, [verb, "--json"]);
      assertEquals(result.code, 0, result.output);
    }

    const events = verbEvents(await readEvents(dir));
    for (const verb of RECORDED_VALIDATION_VERBS) {
      const event = events.find((candidate) => candidate.verb === verb);
      assert(event !== undefined, `${verb} must write a completion event`);
      assert(
        event.validation !== undefined,
        `${verb} must attach validation evidence`,
      );
    }
  });
});

Deno.test("logbook: a standards pin lands pin events and holds the epoch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[standards.cov]\ndirection = "up"\nlimit = 10\nmargin = 5\nrun = "echo DISCERN_METRIC cov 50"\n`,
    );
    await gitInit(dir);
    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    const pin = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 0, pin.output);

    const events = await readEvents(dir);
    const verbs = verbEvents(events);
    // The check's event carries the measured reading — the value trajectory.
    const checkEvent = verbs.find((e) => e.verb === "standards");
    assert(checkEvent !== undefined && checkEvent.standards !== undefined);
    const reading = checkEvent.standards.find((s) => s.name === "cov");
    assert(reading !== undefined, "the standard's reading must be recorded");
    assertEquals(reading.value, 50);
    assertEquals(reading.measurement, "measured");
    assertEquals(reading.limit, 10);
    assertEquals(reading.margin, 5);
    assertEquals(reading.pin_eligible, true);
    assertEquals(reading.pin_target, 45);
    // The pin verb event records the flag; the pin itself lands as a
    // first-class event — the ratchet's trajectory, readable back out.
    const pinVerb = verbs.filter((e) => e.verb === "standards")[1];
    assert(pinVerb !== undefined);
    assertEquals(pinVerb.flags, ["pin"]);
    const pins = events.filter((e) => e.kind === "pin");
    assertEquals(pins.length, 1);
    const pinEvent = pins[0];
    assert(pinEvent !== undefined && pinEvent.kind === "pin");
    assertEquals(pinEvent.standard, "cov");
    assertEquals(pinEvent.from, 10);
    assertEquals(pinEvent.to, 45);
    assertEquals(pinEvent.measured, 50);
    // A pin rewrites only the limit, which the epoch masks: no config-change.
    const post = await runAgent(dir, ["status", "--json"]);
    assertEquals(post.code, 0, post.output);
    assertEquals(
      (await readEvents(dir)).filter((e) => e.kind === "config-change"),
      [],
      "the pin's limit rewrite must not read as a reconfiguration",
    );
  });
});

Deno.test("logbook: [project].logbook = false stops all writes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `[project]\nlogbook = false\n`);
    await gitInit(dir);
    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await readEvents(dir), []);
    // Not even the directory is created.
    let exists = true;
    try {
      await Deno.stat(join(dir, ".git", "discern", "logbook"));
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  });
});

Deno.test("logbook: an unwritable logbook directory changes no verb's outcome", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    await Deno.chmod(logDir, 0o555);
    try {
      const r = await runAgent(dir, ["status", "--json"]);
      assertEquals(r.code, 0, r.output);
      const parsed = decodeCliResult(r.stdout, "status");
      assertEquals(parsed.ok, true);
    } finally {
      await Deno.chmod(logDir, 0o755);
    }
    assertEquals(await readEvents(dir), []);
  });
});

const STANDARDS_CONFIG = (limit: number, jobs: string): string =>
  `${jobs}[standards.cov]
direction = "up"
limit = ${limit}
run = "echo DISCERN_METRIC cov 50"
`;

Deno.test("logbook: a limit edit holds the epoch; a job edit flips it and logs config-change", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDARDS_CONFIG(10, ""));
    await gitInit(dir);

    await runAgent(dir, ["status", "--json"]);
    // The pin-shaped edit: only the limit moves.
    await writeConfig(dir, STANDARDS_CONFIG(50, ""));
    await runAgent(dir, ["status", "--json"]);

    let events = await readEvents(dir);
    let verbs = verbEvents(events);
    assertEquals(verbs.length, 2);
    assertEquals(
      verbs[1]?.epoch,
      verbs[0]?.epoch,
      "a limit-only edit (what a pin writes) must not move the fingerprint",
    );
    assertEquals(
      events.filter((e) => e.kind === "config-change"),
      [],
      "a limit-only edit must log no config-change event",
    );

    // A real reconfiguration: a job appears.
    await writeConfig(
      dir,
      STANDARDS_CONFIG(50, '[jobs]\nlint = "true"\n\n'),
    );
    await runAgent(dir, ["status", "--json"]);

    events = await readEvents(dir);
    verbs = verbEvents(events);
    assertEquals(verbs.length, 3);
    assert(
      verbs[2]?.epoch !== verbs[0]?.epoch,
      "a job edit must move the fingerprint",
    );
    const changes = events.filter((e) => e.kind === "config-change");
    assertEquals(changes.length, 1);
    const change = changes[0];
    assert(change !== undefined && change.kind === "config-change");
    assertEquals(change.sections, ["jobs"]);
    assertEquals(change.branch, "main");
    assertEquals(change.epoch, verbs[2]?.epoch);
    // The marker precedes the verb event that observed the new epoch.
    assert(
      events.indexOf(change) < events.indexOf(verbs[2] as LogbookEvent),
      "the config-change event must precede its verb event",
    );
  });
});

Deno.test("logbook: a worktree run converges into the shared logbook, attributed by branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "logtest");
    const r = await runAgent(worktree, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    assertEquals(
      events[0]?.branch,
      "agent/logtest",
      "attribution is by branch name, in the MAIN repo's common dir",
    );
  });
});

Deno.test('logbook: the MCP chokepoint records with surface "mcp"', async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Supplemental capture belongs to the CLI's delivered ctx.log channel.
    // Seed one stale id to prove the long-lived MCP process drains rather than
    // attributing it to an unrelated tool result.
    observeSupplementalHints([
      fire(HINTS["ensure-main-worktree-first"]),
    ]);
    const status = TOOLS.find((t) => t.name === "discern_status");
    assert(status !== undefined);
    const result = await runTool(
      status,
      new WorkingRoot(dir),
      {},
      undefined,
      () => Promise.resolve(`${KIT_VERSION}-newer`),
      {
        name: "codex-mcp-client",
        title: "Codex",
        version: "1.2.3",
      },
    );
    assertEquals(result.isError, false);
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "status");
    assertEquals(event.surface, "mcp");
    assertEquals(event.lock_boundary, "none");
    assertEquals(event.branch, "main");
    assertEquals(event.outcome, "ok");
    assertEquals(
      event.hint_ids,
      deliveredHintIds(result),
      "the ordinary verb path must record the exact final delivered hints",
    );
    assertEquals(event.hint_ids, [
      HINTS["mcp-version-mismatch"].id,
      HINTS["generated-agent-files-missing"].id,
      HINTS["materialized-skills-missing"].id,
      HINTS["status-start-on-trunk"].id,
      HINTS["status-continue-own-effort"].id,
      HINTS["status-no-active-worktrees"].id,
      HINTS["status-full-structured-detail"].id,
    ]);
    assert(
      event.driver !== undefined && event.driver.session !== undefined &&
        event.driver.session.startsWith("mcp:"),
      "an MCP event carries its server-instance session hint",
    );
    assertEquals(event.driver?.mcp_client, {
      name: "codex-mcp-client",
      title: "Codex",
      version: "1.2.3",
    });
    assert(
      event.driver?.agent_signals?.some((signal) =>
        signal.agent === "codex" && signal.source === "mcp-client" &&
        signal.markers.includes("clientInfo.name")
      ) === true,
      "the raw MCP declaration and its normalized advisory signal both land",
    );
  });
});

// The two dispatch refusals whose project root is already known are exercised as
// mechanism classes. Each population comes from its production source of truth:
// every path-declaring tool and every tool admitted by SETUP_GATED_VERBS through
// verbNeedsSetup. A new tool therefore enrols automatically. Dispatch returns only
// PendingToolCall values, so a future early-return sibling also has no rendering or
// recording escape hatch around runTool's completion boundary.
Deno.test("logbook: every known-root MCP refusal records its final delivered result exactly once", async () => {
  const cases = [
    {
      name: "relative path",
      bootstrapped: true,
      tools: toolsWithPathArgument,
      args: { path: "some/relative/dir", dry_run: true },
      error: "invalid_arguments",
    },
    {
      name: "pre-setup gate",
      bootstrapped: false,
      tools: () => TOOLS.filter((tool) => verbNeedsSetup(verbOf(tool.name))),
      args: { dry_run: true },
      error: "not_set_up",
    },
  ] as const;

  for (const refusal of cases) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { bootstrapped: refusal.bootstrapped });
      await gitInit(dir);
      const tools = refusal.tools();
      assert(
        tools.length > 0,
        `${refusal.name}: expected at least one enrolled MCP tool`,
      );

      for (const [index, tool] of tools.entries()) {
        const delivered = await runTool(
          tool,
          new WorkingRoot(dir),
          refusal.args,
          undefined,
          () => Promise.resolve(`${KIT_VERSION}-newer`),
        );
        assertEquals(
          delivered.structuredContent.error,
          refusal.error,
          `${refusal.name}: ${tool.name} reached the wrong result path`,
        );

        const events = verbEvents(await readEvents(dir));
        assertEquals(
          events.length,
          index + 1,
          `${refusal.name}: ${tool.name} must add exactly one verb event`,
        );
        const event = events[index];
        assert(event !== undefined);
        assertEquals(event.verb, verbOf(tool.name));
        assertEquals(event.outcome, "refused");

        const finalHintIds = deliveredHintIds(delivered);
        const recordedHintIds = event.hint_ids ?? [];
        assertEquals(
          recordedHintIds,
          finalHintIds,
          `${refusal.name}: ${tool.name} must record the hints it delivered`,
        );
        assert(
          recordedHintIds.includes(HINTS["mcp-version-mismatch"].id),
          `${refusal.name}: ${tool.name} must record the final restart hint`,
        );
      }
    });
  }
});

Deno.test("logbook: an MCP path outside every project has no project logbook to record in", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const tools = toolsWithPathArgument();
    assert(
      tools.length > 0,
      "expected at least one MCP tool with a project-root override",
    );

    await withTempDir(async (outside) => {
      for (const tool of tools) {
        const delivered = await runTool(
          tool,
          new WorkingRoot(dir),
          { path: outside, dry_run: true },
          undefined,
          () => Promise.resolve(KIT_VERSION),
        );
        if (tool.rootIndependent !== true) {
          assertEquals(
            delivered.structuredContent.error,
            "not_initialized",
            `${tool.name}: an outside-project path must not fall back to the held root`,
          );
        }
        assertEquals(
          verbEvents(await readEvents(dir)),
          [],
          `${tool.name}: the held project must not record a call resolved outside every project`,
        );
      }
    });
  });
});
