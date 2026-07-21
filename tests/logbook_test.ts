/**
 * Logbook substrate unit tests — the pure layers of the recording subsystem:
 *
 *  - the event schema: a written line reads back identical, and the reader
 *    TOLERATES the unknown (extra fields pass through; a foreign schema major
 *    or shape is classified, not misread; a torn line never throws) — the
 *    compatibility contract the substrate carries for the life of the feature;
 *  - the config epoch: the section list derives from the config schema itself
 *    (a new section auto-enrols), a standards pin changes NO hash while a real
 *    edit flips exactly its section, and `meta` bookkeeping never moves it;
 *  - the store: rotation keeps the newest month files, prunes oldest-first,
 *    and is loud (the removals are themselves an event); the epoch sidecar
 *    round-trips and tolerates corruption.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  configSchema,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  logbookEventSchema,
  parseLogbookLine,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import {
  canonicalJson,
  changedSections,
  configEpoch,
} from "../src/engine/logbook/epoch.ts";
import {
  appendEvent,
  logbookDir,
  MAX_MONTH_FILES,
  monthFileName,
  readEpochState,
  writeEpochState,
} from "../src/engine/logbook/store.ts";
import {
  readLogbookStream,
  readRecentLogbookStream,
} from "../src/engine/logbook/read.ts";

// ── the event schema ────────────────────────────────────────────────────────

/** A representative verb event exercising every field. */
function sampleEvent(): VerbEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: "2026-07-19T12:00:00.000Z",
    writer: "1.0.0",
    kind: "verb",
    verb: "done",
    surface: "cli",
    driver: {
      session: "cli:4242",
      json: true,
      tty: false,
      ci: false,
      agent_signals: [{
        agent: "codex",
        source: "process-environment",
        markers: ["CODEX_THREAD_ID"],
      }],
      mcp_client: {
        name: "codex-mcp-client",
        title: "Codex",
        version: "1.2.3",
      },
    },
    branch: "agent/sample",
    head: "abc1234",
    clean: false,
    tree: "9f21ab04",
    outcome: "failed",
    error: "dirty_worktree",
    failed_stage: "check/test",
    duration_ms: 1234,
    target: "the-gate",
    from: "main",
    flags: ["force"],
    change: { files: 3, insertions: 40, deletions: 5, commits: 2 },
    scopes: ["web"],
    steps: [{
      label: "lint",
      kind: "job",
      outcome: "ok",
      disposition: "run",
      group: "Check & test",
      duration_s: 3,
      error_like_lines: 2,
    }],
    diagnostics: [{
      tool: "lint",
      rule: "no-unused-vars",
      file: "src/a.ts",
      count: 14,
    }],
    standards: [{
      name: "cov",
      direction: "up",
      limit: 80,
      value: 84.2,
      verdict: "improved",
      measurement: "measured",
    }],
    update: { behind: 3, files: 7, overlap: 1 },
    epoch: "0a1b2c3d",
  };
}

Deno.test("logbook schema: a substrate-era minimal line still parses (fields only accrete)", () => {
  // The first recorded events carried none of the enrichment fields; readers
  // must parse them forever — the additive-only compatibility promise.
  const parsed = parseLogbookLine(JSON.stringify({
    schema: LOGBOOK_SCHEMA_VERSION,
    at: "2026-07-19T12:00:00.000Z",
    kind: "verb",
    verb: "status",
    surface: "cli",
    branch: "main",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 42,
    epoch: null,
  }));
  assert(parsed.kind === "event", "a minimal substrate-era line must parse");
});

Deno.test("logbook schema: a written line round-trips through the parser", () => {
  const event = sampleEvent();
  const parsed = parseLogbookLine(JSON.stringify(event));
  assert(parsed.kind === "event", `expected an event, got ${parsed.kind}`);
  assertEquals(parsed.event, event);
});

Deno.test("logbook schema: unknown fields pass through untouched (forward compat)", () => {
  const line = JSON.stringify({
    ...sampleEvent(),
    a_future_field: "kept",
    steps: [{ label: "x", kind: "job", outcome: "ok", future_note: 7 }],
  });
  const parsed = parseLogbookLine(line);
  assert(parsed.kind === "event");
  const raw = parsed.event as unknown as Record<string, unknown>;
  assertEquals(raw.a_future_field, "kept");
});

Deno.test("logbook schema: an unknown schema major is foreign, never misread", () => {
  const parsed = parseLogbookLine(
    JSON.stringify({ ...sampleEvent(), schema: LOGBOOK_SCHEMA_VERSION + 1 }),
  );
  assertEquals(parsed.kind, "foreign");
});

Deno.test("logbook schema: an unknown kind is foreign; a torn line is torn", () => {
  assertEquals(
    parseLogbookLine(
      JSON.stringify({
        schema: LOGBOOK_SCHEMA_VERSION,
        at: "2026-07-19T12:00:00.000Z",
        kind: "verb-v2",
      }),
    ).kind,
    "foreign",
  );
  assertEquals(parseLogbookLine('{"schema":1,"kind":"ver').kind, "torn");
  assertEquals(parseLogbookLine("").kind, "torn");
});

Deno.test("logbook schema: config-change, pin, and prune events validate", () => {
  const ok = logbookEventSchema.safeParse({
    schema: LOGBOOK_SCHEMA_VERSION,
    at: "2026-07-19T12:00:00.000Z",
    kind: "config-change",
    branch: "main",
    sections: ["capabilities"],
    epoch: "deadbeef",
  });
  assert(ok.success);
  const pin = logbookEventSchema.safeParse({
    schema: LOGBOOK_SCHEMA_VERSION,
    at: "2026-07-19T12:00:00.000Z",
    writer: "1.0.0",
    kind: "pin",
    branch: "agent/sample",
    standard: "cov",
    from: 80,
    to: 84,
    measured: 84.2,
  });
  assert(pin.success);
  const prune = logbookEventSchema.safeParse({
    schema: LOGBOOK_SCHEMA_VERSION,
    at: "2026-07-19T12:00:00.000Z",
    kind: "prune",
    removed: [{
      file: "2025-01.jsonl",
      events: 12,
      ok: 9,
      failed: 2,
      refused: 1,
      by_verb: { done: 5, status: 7 },
    }],
  });
  assert(prune.success);
});

// ── the config epoch ────────────────────────────────────────────────────────

const STANDARD_CONFIG = (limit: number, run: string): string => `
[standards.cov]
limit = ${limit}
run = "${run}"
`;

Deno.test("epoch: every top-level config section is hashed (schema-driven, auto-enrol)", () => {
  const epoch = configEpoch(parseConfigOrThrow(""));
  assertEquals(
    Object.keys(epoch.sections).sort(),
    Object.keys(configSchema.shape).sort(),
  );
});

Deno.test("epoch: a standards pin (a limit edit) changes no hash", () => {
  const before = configEpoch(
    parseConfigOrThrow(STANDARD_CONFIG(10, "echo DISCERN_METRIC cov 12")),
  );
  const pinned = configEpoch(
    parseConfigOrThrow(STANDARD_CONFIG(12, "echo DISCERN_METRIC cov 12")),
  );
  assertEquals(pinned.fingerprint, before.fingerprint);
  assertEquals(changedSections(before.sections, pinned.sections), []);
});

Deno.test("epoch: a real standards edit flips exactly the standards section", () => {
  const before = configEpoch(
    parseConfigOrThrow(STANDARD_CONFIG(10, "echo DISCERN_METRIC cov 12")),
  );
  const edited = configEpoch(
    parseConfigOrThrow(STANDARD_CONFIG(10, "echo DISCERN_METRIC cov 99")),
  );
  assert(edited.fingerprint !== before.fingerprint);
  assertEquals(changedSections(before.sections, edited.sections), [
    "standards",
  ]);
});

Deno.test("epoch: a capability edit flips exactly the capabilities section", () => {
  const before = configEpoch(parseConfigOrThrow(""));
  const edited = configEpoch(
    parseConfigOrThrow('[jobs]\nlint = "deno lint"'),
  );
  assert(edited.fingerprint !== before.fingerprint);
  assertEquals(changedSections(before.sections, edited.sections), [
    "capabilities",
  ]);
});

Deno.test("epoch: [meta] bookkeeping is masked (an upgrade re-stamp moves nothing)", () => {
  const before = configEpoch(parseConfigOrThrow(""));
  const restamped = configEpoch(
    parseConfigOrThrow("[meta]\nschema_version = 99\nbootstrapped = true"),
  );
  assertEquals(restamped.fingerprint, before.fingerprint);
});

Deno.test("epoch: canonical JSON ignores key declaration order", () => {
  assertEquals(
    canonicalJson({ b: 1, a: [{ y: 2, x: 3 }] }),
    canonicalJson({ a: [{ x: 3, y: 2 }], b: 1 }),
  );
});

// ── the store ───────────────────────────────────────────────────────────────

function verbEventAt(at: string): VerbEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at,
    kind: "verb",
    verb: "status",
    surface: "cli",
    branch: "main",
    head: null,
    clean: null,
    outcome: "ok",
    duration_ms: 1,
    epoch: null,
  };
}

Deno.test("store: appends land one parseable line per event in the month file", async () => {
  await withTempDir(async (dir) => {
    const at = "2026-07-19T12:00:00.000Z";
    await appendEvent(dir, verbEventAt(at));
    await appendEvent(dir, verbEventAt(at));
    const text = await Deno.readTextFile(
      join(logbookDir(dir), monthFileName(at)),
    );
    const lines = text.trimEnd().split("\n");
    assertEquals(lines.length, 2);
    for (const line of lines) {
      assertEquals(parseLogbookLine(line).kind, "event");
    }
  });
});

Deno.test("store: rotation prunes oldest-first, keeps the cap, and leaves digests", async () => {
  await withTempDir(async (dir) => {
    const logDir = logbookDir(dir);
    await Deno.mkdir(logDir, { recursive: true });
    // Fabricate more history than the cap, all older than the event's month.
    // The oldest month holds real events (plus one torn line), so its digest
    // has something to prove; the rest are empty.
    const oldest = [
      JSON.stringify(verbEventAt("2020-01-02T12:00:00.000Z")),
      JSON.stringify(verbEventAt("2020-01-03T12:00:00.000Z")),
      JSON.stringify({
        ...verbEventAt("2020-01-04T12:00:00.000Z"),
        verb: "done",
        outcome: "failed",
      }),
      JSON.stringify({
        ...verbEventAt("2020-01-05T12:00:00.000Z"),
        verb: "done",
        outcome: "refused",
      }),
      '{"schema":1,"kind":"ver',
    ].join("\n") + "\n";
    for (let i = 0; i < MAX_MONTH_FILES + 2; i++) {
      const name = `2020-${String(i + 1).padStart(2, "0")}.jsonl`;
      await Deno.writeTextFile(join(logDir, name), i === 0 ? oldest : "");
    }
    const at = "2026-07-19T12:00:00.000Z";
    await appendEvent(dir, verbEventAt(at)); // creates a NEW month file → rotation
    const remaining: string[] = [];
    for await (const entry of Deno.readDir(logDir)) {
      if (entry.name.endsWith(".jsonl")) {
        remaining.push(entry.name);
      }
    }
    assertEquals(remaining.length, MAX_MONTH_FILES);
    // Oldest removed first; the newest fabricated months and the new file stay.
    assert(!remaining.includes("2020-01.jsonl"));
    assert(!remaining.includes("2020-02.jsonl"));
    assert(!remaining.includes("2020-03.jsonl"));
    assert(remaining.includes(monthFileName(at)));
    // Loud: the removals are recorded as a prune event in the current file,
    // each removed month leaving its digest so coarse trends survive rotation.
    const lines = (await Deno.readTextFile(join(logDir, monthFileName(at))))
      .trimEnd().split("\n");
    const events = lines.map(parseLogbookLine);
    const prune = events.find((p) =>
      p.kind === "event" && p.event.kind === "prune"
    );
    assert(
      prune !== undefined && prune.kind === "event",
      "no prune event recorded",
    );
    assert(prune.event.kind === "prune");
    assertEquals(
      prune.event.removed.map((d) => d.file),
      ["2020-01.jsonl", "2020-02.jsonl", "2020-03.jsonl"],
    );
    assertEquals(prune.event.removed[0], {
      file: "2020-01.jsonl",
      events: 5,
      ok: 2,
      failed: 1,
      refused: 1,
      by_verb: { status: 2, done: 2 },
      unparsed: 1,
    });
    assertEquals(prune.event.removed[1], { file: "2020-02.jsonl", events: 0 });
  });
});

Deno.test("store: an append into an existing month runs no rotation", async () => {
  await withTempDir(async (dir) => {
    const logDir = logbookDir(dir);
    await Deno.mkdir(logDir, { recursive: true });
    for (let i = 0; i < MAX_MONTH_FILES + 2; i++) {
      const name = `2020-${String(i + 1).padStart(2, "0")}.jsonl`;
      await Deno.writeTextFile(join(logDir, name), "");
    }
    const at = "2026-07-19T12:00:00.000Z";
    await Deno.writeTextFile(join(logDir, monthFileName(at)), "");
    await appendEvent(dir, verbEventAt(at));
    let count = 0;
    for await (const entry of Deno.readDir(logDir)) {
      if (entry.name.endsWith(".jsonl")) {
        count++;
      }
    }
    assertEquals(count, MAX_MONTH_FILES + 3);
  });
});

// ── the stream reader ───────────────────────────────────────────────────────

Deno.test("reader: a missing logbook is an empty stream, not an error", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await readLogbookStream(dir), {
      events: [],
      unparsed: 0,
      months: [],
    });
  });
});

Deno.test("reader: months merge chronologically and torn/foreign lines are counted, never fatal", async () => {
  await withTempDir(async (dir) => {
    const logDir = logbookDir(dir);
    await Deno.mkdir(logDir, { recursive: true });
    // Two months written out of name order, one holding a torn line and a
    // foreign (future-major) line between real events — plus an out-of-order
    // append inside the newer month (a concurrent worktree's interleaving).
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      [
        JSON.stringify(verbEventAt("2026-07-02T09:00:00.000Z")),
        JSON.stringify(verbEventAt("2026-07-01T08:00:00.000Z")),
      ].join("\n") + "\n",
    );
    await Deno.writeTextFile(
      join(logDir, "2026-06.jsonl"),
      [
        JSON.stringify(verbEventAt("2026-06-10T10:00:00.000Z")),
        '{"schema":1,"kind":"ver',
        JSON.stringify({
          ...verbEventAt("2026-06-11T10:00:00.000Z"),
          schema: 99,
        }),
        JSON.stringify(verbEventAt("2026-06-12T10:00:00.000Z")),
      ].join("\n") + "\n",
    );
    // The epoch sidecar sits beside the months and is not event storage.
    await writeEpochState(dir, {
      schema: LOGBOOK_SCHEMA_VERSION,
      branches: {},
    });
    const stream = await readLogbookStream(dir);
    assertEquals(stream.months, ["2026-06.jsonl", "2026-07.jsonl"]);
    assertEquals(stream.unparsed, 2);
    assertEquals(
      stream.events.map((e) => e.at),
      [
        "2026-06-10T10:00:00.000Z",
        "2026-06-12T10:00:00.000Z",
        "2026-07-01T08:00:00.000Z",
        "2026-07-02T09:00:00.000Z",
      ],
    );
  });
});

Deno.test("reader: the inline tail is event-bounded and never opens an older month once full", async () => {
  await withTempDir(async (dir) => {
    const logDir = logbookDir(dir);
    await Deno.mkdir(logDir, { recursive: true });
    await Deno.writeTextFile(
      join(logDir, "2026-06.jsonl"),
      `${JSON.stringify(verbEventAt("2026-06-30T23:59:00.000Z"))}\n`,
    );
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      [
        JSON.stringify(verbEventAt("2026-07-01T08:00:00.000Z")),
        JSON.stringify(verbEventAt("2026-07-02T09:00:00.000Z")),
        JSON.stringify(verbEventAt("2026-07-03T10:00:00.000Z")),
      ].join("\n") + "\n",
    );

    const recent = await readRecentLogbookStream(dir, 2);
    assertEquals(recent.months, ["2026-07.jsonl"]);
    assertEquals(
      recent.events.map((event) => event.at),
      ["2026-07-02T09:00:00.000Z", "2026-07-03T10:00:00.000Z"],
    );
  });
});

Deno.test("store: the epoch sidecar round-trips and tolerates corruption", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await readEpochState(dir), undefined);
    const state = {
      schema: LOGBOOK_SCHEMA_VERSION,
      branches: {
        main: { fingerprint: "deadbeef", sections: { project: "0000abcd" } },
      },
    };
    await writeEpochState(dir, state);
    assertEquals(await readEpochState(dir), state);
    await Deno.writeTextFile(
      join(logbookDir(dir), "epoch.json"),
      "not json {",
    );
    assertEquals(await readEpochState(dir), undefined);
  });
});
