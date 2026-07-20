/**
 * `discern patterns` integration tests — the verb driven black-box through the
 * engine (`runAgent`) in scaffolded temp repos, proving the wired surface the
 * unit harness (`patterns_test.ts`) can't: the CLI's JSON envelope validates
 * against the published output schema, an empty logbook is a helpful
 * first-class state, a seeded logbook produces ranked plain-count findings,
 * the human rendering carries the advisory boundary, and the reset removes
 * exactly the logbook — nothing beside it — with a faithful dry-run.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import {
  PatternsOutputSchema,
  PatternsResetOutputSchema,
} from "../src/shared/result_schemas.ts";
import type {
  PatternsData,
  PatternsResetData,
} from "../src/shared/result_schemas.ts";

/** One synthetic seeded verb-event line (agent-shaped, on its own branch). */
function seededEvent(at: string, outcome: "ok" | "failed"): string {
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "1.0.0",
    driver: { session: "cli:7", json: true, tty: false, ci: false },
    branch: "agent/seeded",
    head: "abc1234",
    clean: true,
    outcome,
    ...(outcome === "failed" ? { failed_stage: "check/test" } : {}),
    duration_ms: 1200,
    epoch: "e1",
  });
}

/** Seed one month file holding a done-thrash stream, a torn line, and a pin. */
async function seedLogbook(dir: string): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-06.jsonl"),
    [
      seededEvent("2026-06-01T10:00:00.000Z", "failed"),
      seededEvent("2026-06-01T11:00:00.000Z", "failed"),
      seededEvent("2026-06-01T12:00:00.000Z", "failed"),
      seededEvent("2026-06-01T13:00:00.000Z", "ok"),
      '{"schema":1,"kind":"ver',
      JSON.stringify({
        schema: 1,
        at: "2026-06-01T14:00:00.000Z",
        kind: "pin",
        branch: "agent/seeded",
        standard: "cov",
        from: 80,
        to: 85,
        measured: 85,
      }),
    ].join("\n") + "\n",
  );
}

Deno.test("patterns: an empty logbook is a first-class state with a helpful message", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(r.code, 0, r.output);
    const parsed = PatternsOutputSchema.parse(JSON.parse(r.stdout));
    assertEquals(parsed.ok, true);
    const data = parsed.data as PatternsData;
    assertEquals(data.logbook.events, 0);
    assertEquals(data.findings, []);
    assert(
      data.detectors.every((d) => d.status === "insufficient-evidence"),
      "with no history every detector reports insufficient evidence",
    );
    assert(
      (parsed.hints ?? []).some((h) => h.includes("logbook is empty")),
      `the empty state needs its helpful message, got: ${
        JSON.stringify(parsed.hints)
      }`,
    );
  });
});

Deno.test("patterns: a seeded logbook yields ranked plain-count findings that validate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    const r = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(r.code, 0, r.output);
    const parsed = PatternsOutputSchema.parse(JSON.parse(r.stdout));
    assertEquals(parsed.ok, true);
    const data = parsed.data as PatternsData;
    assert(data.logbook.events >= 5, "the seeded events must be read");
    assertEquals(
      data.logbook.unparsed,
      1,
      "the torn line is counted, not fatal",
    );

    const thrash = data.findings.find((f) => f.detector === "done-thrash");
    assert(thrash !== undefined, "the seeded 3-streak must fire done-thrash");
    assertEquals(thrash.evidence.consecutive_failures, 3);
    assertStringIncludes(thrash.observed, "3 consecutive runs");
    assertStringIncludes(thrash.next_step, "discern-diagnose-a-bug");
    assertEquals(thrash.scope, "branch");

    // The report stays honest about what it could NOT judge.
    assert(
      data.detectors.some((d) => d.status === "insufficient-evidence"),
      "a young logbook must report its insufficient detectors",
    );
    // Advisory, structurally: findings never flip the envelope.
    assertEquals(parsed.ok, true);
  });
});

Deno.test("patterns: the human report carries the findings and the advisory boundary", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    const r = await runAgent(dir, ["patterns"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "discern patterns");
    assertStringIncludes(r.output, "done-thrash");
    assertStringIncludes(r.output, "Advisory only");
    assertStringIncludes(r.output, "next");
  });
});

Deno.test("patterns reset: dry-run previews, apply removes exactly the logbook", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    // A sibling under .git/discern/ that reset must NOT touch — "the whole
    // logbook directory" means the logbook directory alone.
    const sibling = join(dir, ".git", "discern", "resources.txt");
    await Deno.writeTextFile(sibling, "ledger\n");
    const logDir = join(dir, ".git", "discern", "logbook");

    // The preview lists the files and removes nothing.
    const preview = await runAgent(dir, [
      "patterns",
      "reset",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    const previewParsed = PatternsResetOutputSchema.parse(
      JSON.parse(preview.stdout),
    );
    assertEquals(previewParsed.dry_run, true);
    const previewData = previewParsed.data as PatternsResetData;
    assert(
      previewData.removed.some((f) => f.file === "2026-06.jsonl"),
      "the plan must list the month file",
    );
    assert(
      (await Deno.stat(join(logDir, "2026-06.jsonl"))).isFile,
      "a dry-run removes nothing",
    );

    // The apply removes the directory and reports what it removed.
    const apply = await runAgent(dir, ["patterns", "reset", "--json"]);
    assertEquals(apply.code, 0, apply.output);
    const applyParsed = PatternsResetOutputSchema.parse(
      JSON.parse(apply.stdout),
    );
    const applyData = applyParsed.data as PatternsResetData;
    assert(applyData.removed.some((f) => f.file === "2026-06.jsonl"));
    assert(applyData.bytes > 0);
    let logbookGone = false;
    try {
      await Deno.stat(logDir);
    } catch {
      logbookGone = true;
    }
    // The reset's own completion event may recreate the directory after the
    // removal (recording never interferes, and the toggle is still on) — so
    // assert on CONTENT: the seeded month must be gone even if a fresh
    // logbook has already restarted.
    if (!logbookGone) {
      let seededGone = false;
      try {
        await Deno.stat(join(logDir, "2026-06.jsonl"));
      } catch {
        seededGone = true;
      }
      assert(seededGone, "the seeded history must be gone after reset");
    }
    assertEquals(
      await Deno.readTextFile(sibling),
      "ledger\n",
      "reset must remove the logbook alone, never its siblings",
    );

    // Afterwards the verb reports a young logbook again (at most the reset's
    // own freshly-recorded events), with no findings.
    const after = await runAgent(dir, ["patterns", "--json"]);
    assertEquals(after.code, 0, after.output);
    const afterData = PatternsOutputSchema.parse(JSON.parse(after.stdout))
      .data as PatternsData;
    assert(
      afterData.logbook.events <= 2,
      `the history must be gone, saw ${afterData.logbook.events} events`,
    );
    assertEquals(afterData.findings, []);
  });
});

Deno.test("patterns reset: with nothing recorded it says so and succeeds", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["patterns", "reset", "--json"]);
    assertEquals(r.code, 0, r.output);
    const parsed = PatternsResetOutputSchema.parse(JSON.parse(r.stdout));
    assertEquals(parsed.ok, true);
    assertEquals((parsed.data as PatternsResetData).removed, []);
    assert(
      (parsed.hints ?? []).some((h) => h.includes("No logbook to remove")),
      `the empty reset needs its message, got: ${JSON.stringify(parsed.hints)}`,
    );
  });
});
