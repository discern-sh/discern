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
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import {
  PatternsOutputSchema,
  PatternsResetOutputSchema,
} from "../src/shared/result_schemas.ts";
import type {
  PatternsData,
  PatternsResetData,
} from "../src/shared/result_schemas.ts";
import { DETECTOR_FAMILIES } from "../src/shared/patterns_vocabulary.ts";
import { HINTS } from "../src/shared/hints.ts";
import { displayWidth } from "../src/lib/text.ts";
import {
  PATTERNS_FAMILY_SECTIONS,
  PATTERNS_TONE_GLYPHS,
  PATTERNS_TRAJECTORY_CAVEAT,
  patternsResult,
} from "../src/engine/logbook/patterns.ts";
import { DETECTORS } from "../src/engine/logbook/detectors.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** One synthetic seeded verb-event line (agent-shaped, on its own branch). */
function seededEvent(at: string, outcome: "ok" | "failed"): string {
  return JSON.stringify({
    schema: 1,
    at,
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
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
      // One identity-bearing run: the invocation-scoped Claude marker names
      // the driver; the ambient host marker beside it must attribute nothing.
      JSON.stringify({
        schema: 1,
        at: "2026-06-01T13:30:00.000Z",
        kind: "verb",
        verb: "status",
        surface: "cli",
        writer: "9.9.9",
        driver: {
          session: "cli:7",
          json: true,
          tty: false,
          ci: false,
          agent_signals: [
            {
              agent: "claude",
              source: "process-environment",
              markers: ["CLAUDECODE"],
            },
            {
              agent: "devin",
              source: "host-filesystem",
              markers: ["/opt/.devin"],
            },
          ],
        },
        branch: "agent/seeded",
        head: "abc1234",
        clean: true,
        outcome: "ok",
        duration_ms: 100,
        epoch: "e1",
      }),
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

const REPORT_STANDARD_NAMES = Array.from(
  { length: 16 },
  (_, index) => `metric-${String(index + 1).padStart(2, "0")}`,
);

function reportStandards(reading: number, total: number): unknown[] {
  return REPORT_STANDARD_NAMES.map((name, index) => {
    switch (index % 3) {
      case 0:
        return {
          name,
          direction: "up",
          limit: 80,
          value: 82 + reading / total,
          verdict: "improved",
        };
      case 1:
        return {
          name,
          direction: "down",
          limit: 100,
          value: 90 + (reading / Math.max(1, total - 1)) * 20,
          verdict: "regressed",
        };
      default:
        return {
          name,
          direction: "up",
          limit: 80,
          value: 80,
          verdict: "unchanged",
        };
    }
  });
}

/** Seed a report-sized corpus: many findings per detector across every family,
 * plus one config/release boundary inside each standard series. */
async function seedCollapsedReportLogbook(dir: string): Promise<void> {
  const branches = Array.from(
    { length: 20 },
    (_, index) => `agent/report-${String(index + 1).padStart(2, "0")}`,
  );
  const doneReadings = branches.length * 7;
  const events: Record<string, unknown>[] = [];
  let sequence = 0;
  let reading = 0;
  const at = (): string =>
    new Date(
      Date.UTC(2026, 6, 1, 9) + sequence++ * 3_600_000,
    ).toISOString();

  for (const branch of branches) {
    const session = `cli:${branch}`;
    events.push({
      schema: 1,
      at: at(),
      kind: "verb",
      verb: "prepare",
      surface: "cli",
      writer: reading < doneReadings / 2 ? "9.9.8" : "9.9.9",
      driver: { session, json: true, tty: false, ci: false },
      branch,
      head: `prepare-${branch}`,
      clean: true,
      outcome: "ok",
      duration_ms: 1000,
      epoch: reading < doneReadings / 2 ? "e1" : "e2",
    });
    for (let run = 0; run < 7; run += 1) {
      const failed = run < 6;
      const beforeBoundary = reading < doneReadings / 2;
      events.push({
        schema: 1,
        at: at(),
        kind: "verb",
        verb: "done",
        surface: "cli",
        writer: beforeBoundary ? "9.9.8" : "9.9.9",
        driver: { session, json: true, tty: false, ci: false },
        branch,
        head: `head-${branch}-${run}`,
        clean: true,
        outcome: failed ? "failed" : "ok",
        ...(failed ? { failed_stage: "check/test" } : {}),
        duration_ms: 21_000,
        steps: [
          {
            label: "test",
            kind: "job",
            outcome: failed ? "failed" : "ok",
            disposition: "run",
            group: "Check & test",
            duration_s: 20,
          },
          {
            label: "lint",
            kind: "job",
            outcome: "ok",
            disposition: "run",
            group: "Check & test",
            duration_s: 1,
          },
        ],
        standards: reportStandards(reading, doneReadings),
        epoch: beforeBoundary ? "e1" : "e2",
      });
      reading += 1;
    }
  }

  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    join(logDir, "2026-07.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function occurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  return haystack.split(needle).length - 1;
}

interface SeededAdminSibling {
  path: string;
  contents: string;
}

/** Seed every registered artifact except the logbook reset owns. */
async function seedAdminSiblings(dir: string): Promise<SeededAdminSibling[]> {
  const seeded: SeededAdminSibling[] = [];
  for (const key of GIT_ADMIN_STATE_KEYS) {
    if (key === "logbook") {
      continue;
    }
    const entry = GIT_ADMIN_STATE[key];
    const resolved = await gitAdminStatePath(dir, key);
    assert(resolved !== undefined, `could not resolve ${key}`);
    const path = entry.kind === "directory"
      ? join(resolved, "reset-must-preserve")
      : resolved;
    const contents = `${key}\n`;
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
    seeded.push({ path, contents });
  }
  return seeded;
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
    assertEquals(data.population, {
      analyzed: 0,
      agent: 0,
      human: 0,
      unknown: 0,
      identities: [],
    });
    assertEquals(data.findings, []);
    assert(
      data.detectors.every((d) => d.status === "insufficient-evidence"),
      "with no history every detector reports insufficient evidence",
    );
    assertHasHint(parsed, HINTS["patterns-logbook-empty"]);
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

    // The driver split states the segmentation, and identity attribution
    // honours only the invocation-scoped signal — never the ambient one.
    assertEquals(data.population.analyzed, 5);
    assertEquals(data.population.agent, 5);
    assertEquals(data.population.human, 0);
    assertEquals(data.population.identities, [
      { agent: "claude", label: "Claude Code", runs: 1 },
    ]);

    const thrash = data.findings.find((f) => f.detector === "done-thrash");
    assert(thrash !== undefined, "the seeded 3-streak must fire done-thrash");
    assertEquals(thrash.evidence.consecutive_failures, 3);
    assertStringIncludes(thrash.observed, "3 consecutive runs");
    assertEquals(thrash.tone, "attention");
    assertStringIncludes(thrash.brief, "3 red `done` runs");
    assertStringIncludes(thrash.next_step, "discern-cure-a-bug");
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
    assertStringIncludes(r.output, "Consecutive red done runs");
    assertStringIncludes(r.output, "driven by agents");
    assertStringIncludes(r.output, "Claude Code 1");
    assertStringIncludes(r.output, "Advisory only");
    assertStringIncludes(r.output, "→");
  });
});

Deno.test("patterns: the compact human report enrolls every family, tone, detector, and finding", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedCollapsedReportLogbook(dir);

    // Read the exact pre-command result the human invocation will project.
    // `patternsResult` is pure observation and records no new event.
    const result = await patternsResult(dir);
    assert(result.ok && result.data !== undefined);
    const data = result.data;
    assertEquals(data.detectors.length, DETECTORS.length);
    for (const family of DETECTOR_FAMILIES) {
      assert(
        data.findings.some((finding) => finding.family === family),
        `${family} needs a fired detector in the report fixture`,
      );
    }

    const human = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "80", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assert(!human.output.includes("\x1b["), "NO_COLOR must emit no ANSI");
    const plain = normalized(human.output);
    const lines = human.output.trimEnd().split("\n");
    for (const [index, line] of lines.entries()) {
      assert(
        displayWidth(line) <= 80,
        `80-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }

    // The canonical family vocabulary owns section order. The total
    // presentation record makes a new family fail type-checking until titled.
    let previousSection = -1;
    for (const family of DETECTOR_FAMILIES) {
      const heading = PATTERNS_FAMILY_SECTIONS[family].heading;
      const index = human.output.indexOf(heading);
      assert(index > previousSection, `${family} is out of canonical order`);
      assertEquals(occurrences(human.output, heading), 1);
      previousSection = index;
    }

    // Each fired detector becomes one block title, even when it emitted many
    // rows. Footer titles do not count because only an exact trimmed line is a
    // block heading.
    const trimmedLines = lines.map((line) => line.trim());
    for (const detector of data.detectors.filter((d) => d.status === "fired")) {
      assertEquals(
        trimmedLines.filter((line) => line === detector.title).length,
        1,
        `${detector.id} must render its title once`,
      );
    }

    // Every finding still has one glyph row. Normalize whitespace so a wrap is
    // presentation-only, then prove every subject + brief survived.
    const glyphs = new Set(
      Object.values(PATTERNS_TONE_GLYPHS).map(({ glyph }) => glyph),
    );
    const glyphRows = lines.filter((line) =>
      line.startsWith("    ") && glyphs.has(line.slice(4, 5)) &&
      line.slice(5, 7) === "  "
    );
    assertEquals(glyphRows.length, data.findings.length);
    const rowKeys = new Map<string, number>();
    for (const finding of data.findings) {
      const key = normalized(
        `${
          finding.subject === undefined ? "" : finding.subject
        } ${finding.brief}`,
      );
      rowKeys.set(key, (rowKeys.get(key) ?? 0) + 1);
    }
    for (const [key, count] of rowKeys) {
      assert(
        occurrences(plain, key) >= count,
        `report dropped ${count - occurrences(plain, key)} row(s): ${key}`,
      );
    }

    // Repeated detector guidance appears once. Subject-specific standard pins
    // collapse into one named action, and the boundary caveat appears once.
    const steps = new Map<string, number>();
    for (const finding of data.findings) {
      if (finding.next_step.includes("discern standards --pin")) {
        continue;
      }
      steps.set(
        finding.next_step,
        (steps.get(finding.next_step) ?? 0) + 1,
      );
    }
    for (const [step, count] of steps) {
      if (count > 1) {
        assertEquals(
          occurrences(plain, normalized(step)),
          1,
          `repeated next step rendered more than once: ${step}`,
        );
      }
    }
    assertEquals(occurrences(plain, "`discern standards --pin`"), 1);
    assertEquals(
      occurrences(plain, normalized(PATTERNS_TRAJECTORY_CAVEAT)),
      1,
    );

    const spoke = data.detectors.filter((d) => d.status === "fired").length;
    const clear = data.detectors.filter((d) => d.status === "quiet").length;
    const young = data.detectors.filter((d) =>
      d.status === "insufficient-evidence"
    ).length;
    assertEquals(spoke + clear + young, DETECTORS.length);
    assertStringIncludes(
      plain,
      `${DETECTORS.length} detectors · ${spoke} spoke · ${clear} all clear · ${young} too young to say`,
    );

    // The old renderer spent four lines per finding, plus seven fixed lines.
    // This corpus is intentionally repetition-heavy: the recurring report must
    // stay at or below half that legacy account.
    const legacyLines = data.findings.length * 4 + 7;
    assert(
      lines.length <= Math.floor(legacyLines / 2),
      `compact report used ${lines.length} lines; legacy shape used ${legacyLines}`,
    );

    const narrow = await runAgent(dir, ["patterns"], {
      env: { COLUMNS: "60", NO_COLOR: "1" },
    });
    assertEquals(narrow.code, 0, narrow.output);
    for (const [index, line] of narrow.output.trimEnd().split("\n").entries()) {
      assert(
        displayWidth(line) <= 60,
        `60-column line ${index + 1} is ${displayWidth(line)} columns: ${line}`,
      );
    }
    const narrowPlain = normalized(narrow.output);
    for (const detector of data.detectors) {
      assertStringIncludes(narrowPlain, normalized(detector.title));
    }
    for (const key of rowKeys.keys()) {
      assertStringIncludes(narrowPlain, key);
    }
  });
});

Deno.test("patterns reset: dry-run previews, apply removes exactly the logbook", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await seedLogbook(dir);
    // Every registered sibling must survive: "the whole logbook directory"
    // means the logbook directory alone. New registry members auto-enrol.
    const siblings = await seedAdminSiblings(dir);
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
    for (const sibling of siblings) {
      assertEquals(
        await Deno.readTextFile(sibling.path),
        sibling.contents,
        `reset must preserve ${sibling.path}`,
      );
    }

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
    assertHasHint(parsed, HINTS["patterns-reset-empty"]);
  });
});
