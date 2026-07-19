/**
 * Logbook substrate integration tests — the recorded behaviour of real verb
 * runs, driven black-box through the engine (`runAgent`) in scaffolded temp
 * repos, plus the MCP chokepoint in-process. The contract under test is the
 * substrate's definition of done:
 *
 *  - any verb run (green or red) appends one valid event under the git common
 *    dir, attributed by BRANCH name — from a linked worktree too, where the
 *    shared common dir converges all fleet activity into one logbook;
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
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";

/** All well-formed events across the project's logbook, in file line order. */
async function readEvents(dir: string): Promise<LogbookEvent[]> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const events: LogbookEvent[] = [];
  let names: string[] = [];
  try {
    for await (const entry of Deno.readDir(logDir)) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        names.push(entry.name);
      }
    }
  } catch {
    return events; // no logbook — the caller asserts on emptiness
  }
  names = names.sort();
  for (const name of names) {
    const text = await Deno.readTextFile(join(logDir, name));
    for (const line of text.split("\n").filter((l) => l !== "")) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event", `unparseable logbook line: ${line}`);
      events.push(parsed.event);
    }
  }
  return events;
}

/** Just the verb events, in order. */
function verbEvents(
  events: LogbookEvent[],
): Extract<LogbookEvent, { kind: "verb" }>[] {
  return events.filter((e) => e.kind === "verb");
}

Deno.test("logbook: a verb run appends one valid, branch-attributed event", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const events = verbEvents(await readEvents(dir));
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
  });
});

Deno.test("logbook: a red gate still records — outcome, steps, diagnostic classes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[capabilities]\ntest = "sh -c 'echo failing; exit 1'"\n`,
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
      const parsed = JSON.parse(r.stdout) as { ok: boolean };
      assertEquals(parsed.ok, true);
    } finally {
      await Deno.chmod(logDir, 0o755);
    }
    assertEquals(await readEvents(dir), []);
  });
});

const STANDARDS_CONFIG = (limit: number, capabilities: string): string =>
  `${capabilities}[standards.cov]
limit = ${limit}
run = "echo DISCERN_METRIC cov 50"
`;

Deno.test("logbook: a limit edit holds the epoch; a capability edit flips it and logs config-change", async () => {
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

    // A real reconfiguration: a capability appears.
    await writeConfig(
      dir,
      STANDARDS_CONFIG(50, '[capabilities]\nlint = "true"\n\n'),
    );
    await runAgent(dir, ["status", "--json"]);

    events = await readEvents(dir);
    verbs = verbEvents(events);
    assertEquals(verbs.length, 3);
    assert(
      verbs[2]?.epoch !== verbs[0]?.epoch,
      "a capability edit must move the fingerprint",
    );
    const changes = events.filter((e) => e.kind === "config-change");
    assertEquals(changes.length, 1);
    const change = changes[0];
    assert(change !== undefined && change.kind === "config-change");
    assertEquals(change.sections, ["capabilities"]);
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
    const status = TOOLS.find((t) => t.name === "discern_status");
    assert(status !== undefined);
    const result = await runTool(status, new WorkingRoot(dir), {});
    assertEquals(result.isError, false);
    const events = verbEvents(await readEvents(dir));
    assertEquals(events.length, 1);
    const event = events[0];
    assert(event !== undefined);
    assertEquals(event.verb, "status");
    assertEquals(event.surface, "mcp");
    assertEquals(event.branch, "main");
    assertEquals(event.outcome, "ok");
  });
});
