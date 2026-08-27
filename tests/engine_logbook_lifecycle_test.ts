/**
 * Black-box Logbook lifecycle coverage. Every destructive lifecycle action is
 * exercised only inside a scaffolded temporary repository; this suite never
 * points reset or archive at discern's own Logbook.
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { stripAnsi } from "discern-design-system/cli";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { LOGBOOK_LIFECYCLE_ACTION_NAMES } from "../src/shared/logbook_lifecycle.ts";
import { LOGBOOK_POWERED } from "../src/shared/logbook_powered.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import type {
  PatternsArchivesData,
  PatternsData,
} from "../src/shared/result_schemas.ts";
import {
  appendEvent,
  archiveLogbook,
  isLogbookArchiveFileName,
  logbookArchiveDir,
  logbookArchiveFileName,
  logbookDir,
  LogbookLifecycleBusyError,
  LogbookLifecycleError,
  logbookLifecycleLockPath,
  nextLogbookArchiveFileName,
  withLogbookLifecycleLock,
} from "../src/engine/logbook/store.ts";
import { readLogbookStream } from "../src/engine/logbook/read.ts";
import { runPatternsLifecycle } from "../src/engine/logbook/patterns.ts";
import { logbookLifecycleConfirmation } from "../src/engine/dispatch.ts";
import { InteractionCancelled } from "../src/lib/terminal_interaction.ts";
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** Decode a patterns report whose successful payload is required by the test. */
function patternsData(stdout: string): PatternsData {
  const result = decodeCliResult(stdout, "patterns");
  assert(
    result.data !== undefined && "logbook" in result.data,
    `patterns result must carry report data: ${stdout}`,
  );
  return result.data;
}

/** Decode an archive listing whose successful payload is required by the test. */
function patternsArchivesData(stdout: string): PatternsArchivesData {
  const result = decodeCliResult(stdout, "patterns archives");
  assert(
    result.data !== undefined && "archives" in result.data,
    `patterns archives result must carry listing data: ${stdout}`,
  );
  return result.data;
}

/** One well-formed recorded completion line. */
function verbLine(
  at: string,
  verb = "status",
  invocation?: string,
): string {
  return JSON.stringify({
    schema: 1,
    at,
    writer: "9.9.9",
    kind: "verb",
    ...(invocation !== undefined ? { invocation } : {}),
    verb,
    surface: "cli",
    branch: "main",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 1,
    epoch: null,
  });
}

/** One fresh unmatched begin line for the lifecycle concurrency refusal. */
function beginLine(at: string): string {
  return JSON.stringify({
    schema: 1,
    at,
    writer: "9.9.9",
    kind: "begin",
    invocation: "still-running",
    verb: "done",
    surface: "cli",
    driver: { session: "cli:test", json: false, tty: false, ci: false },
    branch: "agent/other-work",
    head: "abc1234",
    epoch: null,
  });
}

/** Seed one raw active-history line and return its path. */
async function seedActiveLogbook(dir: string): Promise<string> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const path = join(logDir, "2026-08.jsonl");
  await Deno.mkdir(logDir, { recursive: true });
  await Deno.writeTextFile(
    path,
    `${
      JSON.stringify({
        schema: 1,
        at: "2026-08-11T12:00:00.000Z",
        writer: "9.9.9",
        kind: "verb",
        verb: "status",
        surface: "cli",
        branch: "main",
        head: "abc1234",
        clean: true,
        outcome: "ok",
        duration_ms: 1,
        epoch: null,
      })
    }\n`,
  );
  return path;
}

/** Assert the stable semantics of a Receipt check row while leaving its
 * capability-selected marker to the package renderer. */
function assertReceiptCheckSemantics(
  output: string,
  expected: {
    readonly label: string;
    readonly value: string;
    readonly state: string;
  },
): void {
  const line = stripAnsi(output).split(/\r?\n/u).find((candidate) =>
    candidate.includes(expected.label)
  );
  assert(line !== undefined, `missing Receipt check ${expected.label}`);
  const labelAt = line.indexOf(expected.label);
  const valueToken = ` ${expected.value} `;
  const valueAt = line.indexOf(valueToken, labelAt + expected.label.length);
  const stateToken = ` ${expected.state}`;
  const stateAt = line.indexOf(stateToken, valueAt + valueToken.length);
  assert(
    labelAt >= 0 && valueAt > labelAt && stateAt > valueAt,
    `Receipt check must show label, value, and state in order: ${line}`,
  );
  const marker = line.slice(valueAt + valueToken.length, stateAt).trim();
  assert(
    marker.length > 0,
    `Receipt check must retain a visible state marker: ${line}`,
  );
}

interface SeededSibling {
  path: string;
  contents: string;
}

/** Seed every registered Git-admin sibling so preservation auto-enrols. */
async function seedAdminSiblings(dir: string): Promise<SeededSibling[]> {
  const siblings: SeededSibling[] = [];
  for (const key of GIT_ADMIN_STATE_KEYS) {
    if (key === "logbook") {
      continue;
    }
    const entry = GIT_ADMIN_STATE[key];
    const registered = await gitAdminStatePath(dir, key);
    assert(registered !== undefined, `could not resolve ${key}`);
    const path = entry.kind === "directory"
      ? join(registered, "lifecycle-must-preserve")
      : registered;
    const contents = `${key}\n`;
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
    siblings.push({ path, contents });
  }
  return siblings;
}

Deno.test("Logbook lifecycle apply refuses machine mode without changing active history", async () => {
  for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const active = await seedActiveLogbook(dir);
      const before = await Deno.readTextFile(active);

      const result = await runAgent(dir, [
        "patterns",
        action,
        "--json",
      ]);
      assertEquals(result.code, 1, `${action}\n${result.output}`);
      const parsed = decodeCliResult(result.stdout, `patterns ${action}`);
      assertEquals(parsed.ok, false, `${action}\n${result.output}`);
      assertEquals(parsed.verb, `patterns ${action}`);
      assertEquals(parsed.error, "confirmation_required");
      assertEquals(
        await Deno.readTextFile(active),
        before,
        `${action} changed active history after refusing machine apply`,
      );
    });
  }
});

Deno.test({
  name:
    "Logbook lifecycle preview stays noninteractive and read-only under pipes, CI, plain, and JSON",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await gitInit(dir);
        const active = await seedActiveLogbook(dir);
        const before = await Deno.readTextFile(active);
        const cases = [
          {
            name: "pipe",
            run: () => runAgent(dir, ["patterns", action, "--dry-run"]),
          },
          {
            name: "CI pseudo-terminal",
            run: () =>
              runAgentPty(dir, ["patterns", action, "--dry-run"], {
                env: { CI: "1" },
              }),
          },
          {
            name: "plain pseudo-terminal",
            run: () =>
              runAgentPty(dir, [
                "patterns",
                action,
                "--dry-run",
                "--plain",
              ]),
          },
          {
            name: "JSON pipe",
            run: () =>
              runAgent(dir, [
                "patterns",
                action,
                "--dry-run",
                "--json",
              ]),
          },
        ] as const;
        for (const testCase of cases) {
          const result = await testCase.run();
          const label = `${action}: ${testCase.name}\n${result.output}`;
          assertEquals(result.code, 0, label);
          if (testCase.name === "JSON pipe") {
            const parsed = decodeCliResult(
              result.stdout,
              `patterns ${action}`,
            );
            assertEquals(parsed.dry_run, true, label);
            assertResultDataKey(parsed, "events");
            assertEquals(parsed.data.events, 1, label);
            if (action === "reset") {
              assertResultDataKey(parsed, "impacts");
              assert(parsed.data.bytes > 0, label);
              assertEquals(
                parsed.data.impacts,
                LOGBOOK_POWERED.map(({ key, phrase, surface }) => ({
                  key,
                  phrase,
                  surface,
                })),
                "reset impact scope must derive from LOGBOOK_POWERED",
              );
            } else {
              assertResultDataKey(parsed, "source_bytes");
              assert(parsed.data.source_bytes > 0, label);
            }
          } else {
            assertTerminalTextIncludes(result.output, "Events: 1", label);
            assertStringIncludes(result.output, "2026-08.jsonl", label);
            assertTerminalTextIncludes(result.output, "Preview only", label);
          }
          assertEquals(
            await Deno.readTextFile(active),
            before,
            `${label}\npreview changed active history`,
          );
        }
      });
    }
  },
});

Deno.test({
  name:
    "Logbook lifecycle confirmation declines and defaults to No without changing data",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await gitInit(dir);
        const active = await seedActiveLogbook(dir);
        const before = await Deno.readTextFile(active);
        for (const input of ["n\n", "\n"]) {
          const result = await runAgentPty(dir, ["patterns", action], {
            input,
          });
          assertEquals(result.code, 0, `${action}\n${result.output}`);
          assertTerminalTextIncludes(
            result.output,
            "Aborted. Nothing changed.",
          );
          assertTerminalTextIncludes(result.output, "Keep");
          assertTerminalTextIncludes(
            result.output,
            action === "reset" ? "Delete" : "Archive",
          );
          assertEquals(await Deno.readTextFile(active), before);
          assertEquals(
            await pathExists(join(dir, ".git", "discern", "logbook-archives")),
            false,
          );
          assertEquals(
            await pathExists(logbookLifecycleLockPath(join(dir, ".git"))),
            false,
            "cancellation must not create lifecycle state",
          );
        }
      });
    }
  },
});

Deno.test("Logbook dispatch maps only product cancellation to default No", async () => {
  let observedOptions: unknown;
  const labels = { noLabel: "Keep", yesLabel: "Delete" } as const;
  assertEquals(
    await logbookLifecycleConfirmation(
      "Confirm",
      labels,
      (_message, options) => {
        observedOptions = options;
        return Promise.reject(new InteractionCancelled());
      },
    ),
    false,
  );
  assertEquals(observedOptions, { defaultTo: false, ...labels });

  const fault = new Error("synthetic confirmation fault");
  const caught = await assertRejects(
    () =>
      logbookLifecycleConfirmation(
        "Confirm",
        labels,
        () => Promise.reject(fault),
      ),
    Error,
    fault.message,
  );
  assertEquals(caught, fault);
});

Deno.test("Logbook core propagates unrelated confirmation faults", async () => {
  for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const active = await seedActiveLogbook(dir);
      const before = await Deno.readTextFile(active);
      const fault = new Error(`synthetic ${action} confirmation fault`);
      const caught = await assertRejects(
        () =>
          runPatternsLifecycle(dir, action, {
            json: false,
            dryRun: false,
            interactive: true,
            terminal: resolveTerminalContext({
              noColor: true,
              env: fakeEnv({ TERM: "dumb", LANG: "C" }),
              isTerminal: () => true,
              consoleSize: () => ({ columns: 80, rows: 24 }),
            }),
            confirm: () => Promise.reject(fault),
          }),
        Error,
        fault.message,
      );
      assertEquals(caught, fault);
      assertEquals(
        await Deno.readTextFile(active),
        before,
        `${action} changed active history after a confirmation fault`,
      );
    });
  }
});

Deno.test("Logbook lifecycle exposes no unattended confirmation bypass", async () => {
  for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const active = await seedActiveLogbook(dir);
      const before = await Deno.readTextFile(active);
      const help = await runAgent(dir, ["patterns", action, "--help"]);
      assertEquals(help.code, 0, help.output);
      for (const forbidden of ["--yes", "--confirmed"]) {
        assert(
          !help.output.includes(forbidden),
          `${action} help advertised forbidden bypass ${forbidden}`,
        );
        const result = await runAgent(dir, [
          "patterns",
          action,
          forbidden,
          "--json",
        ]);
        assertEquals(result.code, 2, result.output);
        const parsed = decodeCliResult(result.stdout, `patterns ${action}`);
        assertEquals(parsed.ok, false);
        assertEquals(parsed.error, "invalid_arguments");
        assertEquals(await Deno.readTextFile(active), before);
      }
    });
  }
});

Deno.test({
  name:
    "patterns archive seals every raw shard, lists it, and historical reports leave it unchanged",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const common = join(dir, ".git");
      const activeDir = logbookDir(common);
      await Deno.mkdir(activeDir, { recursive: true });
      const july = [
        verbLine("2026-07-31T23:59:00.000Z", "done"),
        '{"schema":1,"kind":"ver',
      ].join("\n");
      const august = [
        JSON.stringify({ schema: 99, future: true }),
        verbLine("2026-08-01T00:01:00.000Z", "prepare"),
        verbLine("2026-08-11T12:00:00.000Z", "status"),
      ].join("\n") + "\n";
      await Deno.writeTextFile(join(activeDir, "2026-07.jsonl"), july);
      await Deno.writeTextFile(join(activeDir, "2026-08.jsonl"), august);
      await Deno.writeTextFile(
        join(activeDir, "epoch.json"),
        '{"schema":1,"branches":{"main":{"fingerprint":"old","sections":{}}}}\n',
      );
      const expectedArchive = `${july}\n${august}`;
      const siblings = await seedAdminSiblings(dir);

      const archived = await runAgentPty(dir, ["patterns", "archive"], {
        input: "y\n",
      });
      assertEquals(archived.code, 0, archived.output);
      assertTerminalTextIncludes(archived.output, "Events: 3");
      assertTerminalTextIncludes(archived.output, "2026-07-31 → 2026-08-11");
      assertStringIncludes(archived.output, "2026-07.jsonl");
      assertStringIncludes(archived.output, "2026-08.jsonl");
      assertStringIncludes(archived.output, "epoch.json");
      assertEquals(await pathExists(activeDir), false);

      const archiveDir = logbookArchiveDir(common);
      const archiveNames: string[] = [];
      for await (const entry of Deno.readDir(archiveDir)) {
        if (entry.isFile && isLogbookArchiveFileName(entry.name)) {
          archiveNames.push(entry.name);
        }
      }
      assertEquals(archiveNames.length, 1, archived.output);
      const filename = archiveNames[0];
      assert(filename !== undefined);
      const archivePath = join(archiveDir, filename);
      assertEquals(await Deno.readTextFile(archivePath), expectedArchive);
      assertTerminalTextIncludes(
        archived.output,
        `discern patterns --logbook-file ${filename}`,
      );
      for (const sibling of siblings) {
        assertEquals(
          await Deno.readTextFile(sibling.path),
          sibling.contents,
          `archive must preserve ${sibling.path}`,
        );
      }

      const sealedBeforeReads = await Deno.readFile(archivePath);
      const listing = await runAgent(dir, [
        "patterns",
        "archives",
        "--json",
      ]);
      assertEquals(listing.code, 0, listing.output);
      const listingData = patternsArchivesData(listing.stdout);
      assertEquals(listingData.archives, [{
        filename,
        events: 3,
        unparsed: 2,
        bytes: new TextEncoder().encode(expectedArchive).length,
        first_at: "2026-07-31T23:59:00.000Z",
        last_at: "2026-08-11T12:00:00.000Z",
      }]);
      const humanListing = await runAgent(dir, ["patterns", "archives"]);
      assertEquals(humanListing.code, 0, humanListing.output);
      assertStringIncludes(humanListing.output, filename);
      assertTerminalTextIncludes(humanListing.output, "Events: 3");
      assertReceiptCheckSemantics(humanListing.output, {
        label: "Unparsable lines",
        value: "2",
        state: "fail",
      });

      const historical = await runAgent(dir, [
        "patterns",
        "--logbook-file",
        filename,
        "--all",
        "--json",
      ]);
      assertEquals(historical.code, 0, historical.output);
      const historicalData = patternsData(historical.stdout);
      assertEquals(historicalData.logbook.source, {
        kind: "archive",
        filename,
      });
      assertEquals(historicalData.logbook.events, 3);
      assertEquals(historicalData.logbook.unparsed, 2);

      const stats = await runAgent(dir, [
        "patterns",
        "--stats",
        "--logbook-file",
        filename,
        "--json",
      ]);
      assertEquals(stats.code, 0, stats.output);
      const statsData = patternsData(stats.stdout);
      assert(statsData.stats !== undefined, "historical stats must be present");
      assertEquals(statsData.logbook.source, {
        kind: "archive",
        filename,
      });
      assertEquals(statsData.stats.validation_workflows.runs, {
        total: 2,
        branches: 1,
        by_verb: [
          {
            verb: "prepare",
            runs: 1,
            branches: 1,
            clean: 1,
            dirty: 0,
            unknown: 0,
            successes: 1,
            failures: 0,
            retries: 0,
          },
          {
            verb: "test",
            runs: 0,
            branches: 0,
            clean: 0,
            dirty: 0,
            unknown: 0,
            successes: 0,
            failures: 0,
            retries: 0,
          },
          {
            verb: "done",
            runs: 1,
            branches: 1,
            clean: 1,
            dirty: 0,
            unknown: 0,
            successes: 1,
            failures: 0,
            retries: 0,
          },
        ],
        evidence: {
          denominator: 2,
          complete: 0,
          incomplete: 0,
          legacy: 1,
          unattributed: 1,
        },
        dirty_state: {
          denominator: 0,
          tracked_only: 0,
          untracked_only: 0,
          mixed: 0,
          unclassified: 0,
        },
      });
      assertEquals(statsData.stats.validation_workflows.cycles.total, 2);

      const historicalStats = await runAgent(dir, [
        "patterns",
        "--stats",
        "--logbook-file",
        filename,
      ], { env: { COLUMNS: "80", NO_COLOR: "1" } });
      assertEquals(historicalStats.code, 0, historicalStats.output);
      assertTerminalTextIncludes(historicalStats.output, `archive ${filename}`);
      assertTerminalTextIncludes(
        historicalStats.output,
        "VALIDATION WORKFLOWS",
      );

      const terminal = await runAgent(dir, [
        "patterns",
        "--logbook-file",
        filename,
      ]);
      assertEquals(terminal.code, 0, terminal.output);
      assertTerminalTextIncludes(terminal.output, `archive ${filename}`);
      assertEquals(await Deno.readFile(archivePath), sealedBeforeReads);

      // The lifecycle command itself is absent from both sides of the cut. The
      // first ordinary reads after it write their completions only to the new
      // active Logbook, proving the recorder resumed on the active store.
      const active = await readLogbookStream(common);
      const verbs = active.events.flatMap((event) =>
        event.kind === "verb" ? [event.verb] : []
      );
      assert(verbs.includes("patterns archives"));
      assert(verbs.includes("patterns"));
      assert(!verbs.includes("patterns archive"));
      assert(!expectedArchive.includes('"verb":"patterns archive"'));
    });
  },
});

Deno.test("historical Logbook selection accepts only regular registered archive basenames", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const common = join(dir, ".git");
    const archives = logbookArchiveDir(common);
    await Deno.mkdir(archives, { recursive: true });
    const filename = "logbook-20260811T120000Z.jsonl";
    const archivePath = join(archives, filename);
    await Deno.writeTextFile(
      archivePath,
      `${verbLine("2026-08-11T12:00:00.000Z")}\n`,
    );
    const before = await Deno.readFile(archivePath);

    const arbitrary = join(dir, "logbook-20260811T120001Z.jsonl");
    await Deno.writeTextFile(
      arbitrary,
      `${verbLine("2026-08-11T12:01:00.000Z")}\n`,
    );
    const directoryName = "logbook-20260811T120002Z.jsonl";
    await Deno.mkdir(join(archives, directoryName));
    const symlinkName = "logbook-20260811T120003Z.jsonl";
    await Deno.symlink(arbitrary, join(archives, symlinkName));

    const invalid = [
      `../${filename}`,
      archivePath,
      "2026-08.jsonl",
      `${filename}/child`,
      "not-an-archive.jsonl",
      directoryName,
      symlinkName,
    ];
    for (const selected of invalid) {
      const result = await runAgent(dir, [
        "patterns",
        "--logbook-file",
        selected,
        "--json",
      ]);
      assertEquals(result.code, 1, `${selected}\n${result.output}`);
      const parsed = decodeCliResult(result.stdout, "patterns");
      assertEquals(parsed.ok, false);
      assertEquals(parsed.error, "invalid_arguments", selected);
      assertEquals(await Deno.readFile(archivePath), before);
    }

    const missing = await runAgent(dir, [
      "patterns",
      "--logbook-file",
      "logbook-20260811T120004Z.jsonl",
      "--json",
    ]);
    assertEquals(missing.code, 1, missing.output);
    assertEquals(
      decodeCliResult(missing.stdout, "patterns").error,
      "not_found",
    );
    assertEquals(await Deno.readFile(archivePath), before);
  });
});

Deno.test({
  name: "Logbook lifecycle refuses while another fresh invocation is in flight",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    for (const action of LOGBOOK_LIFECYCLE_ACTION_NAMES) {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await gitInit(dir);
        const activeDir = join(dir, ".git", "discern", "logbook");
        const active = join(activeDir, "2026-08.jsonl");
        await Deno.mkdir(activeDir, { recursive: true });
        await Deno.writeTextFile(
          active,
          `${beginLine(new Date(SYSTEM_CLOCK.wallNow()).toISOString())}\n`,
        );
        const before = await Deno.readTextFile(active);
        const result = await runAgentPty(dir, ["patterns", action]);
        assertEquals(result.code, 1, `${action}\n${result.output}`);
        assertTerminalTextIncludes(
          result.output,
          "done on agent/other-work remains in flight",
        );
        assertTerminalTextIncludes(result.output, "discern status --all");
        assertEquals(await Deno.readTextFile(active), before);
      });
    }
  },
});

Deno.test("archive names are UTC and collision-safe", async () => {
  await withTempDir(async (common) => {
    const now = new Date("2026-08-11T14:30:15.999Z");
    const archives = logbookArchiveDir(common);
    await Deno.mkdir(archives, { recursive: true });
    const first = logbookArchiveFileName(now);
    const second = logbookArchiveFileName(now, 2);
    assertEquals(first, "logbook-20260811T143015Z.jsonl");
    assertEquals(second, "logbook-20260811T143015Z-2.jsonl");
    await Deno.writeTextFile(join(archives, first), "first\n");
    await Deno.writeTextFile(join(archives, second), "second\n");
    assertEquals(
      await nextLogbookArchiveFileName(common, now),
      "logbook-20260811T143015Z-3.jsonl",
    );
  });
});

Deno.test("archive sealing failure retains the detached source for recovery", async () => {
  await withTempDir(async (common) => {
    const active = logbookDir(common);
    await Deno.mkdir(active, { recursive: true });
    const raw = `${verbLine("2026-08-11T12:00:00.000Z")}\n`;
    await Deno.writeTextFile(join(active, "2026-08.jsonl"), raw);
    const filename = "logbook-20260811T143015Z.jsonl";
    const sealFailure = new Error("injected seal failure");
    let error: unknown;
    try {
      await archiveLogbook(common, filename, {
        seal: () => Promise.reject(sealFailure),
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof LogbookLifecycleError);
    assertEquals(error.cause, sealFailure);
    assertStringIncludes(error.message, "remains recoverable");
    assert(error.detachedPath !== undefined);
    assertEquals(
      await Deno.readTextFile(join(error.detachedPath, "2026-08.jsonl")),
      raw,
    );
    assertEquals(await pathExists(active), false);
    assertEquals(
      await pathExists(join(logbookArchiveDir(common), filename)),
      false,
    );
  });
});

Deno.test("the lifecycle lock serializes every active-history replacement", async () => {
  await withTempDir(async (common) => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withLogbookLifecycleLock(common, async () => {
      entered?.();
      await releasePromise;
    });
    await enteredPromise;
    let error: unknown;
    try {
      await withLogbookLifecycleLock(common, () => Promise.resolve());
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof LogbookLifecycleBusyError);
    release?.();
    await holding;
  });
});

Deno.test("a recorder racing archive detachment writes wholly to the fresh active Logbook", async () => {
  await withTempDir(async (common) => {
    const active = logbookDir(common);
    await Deno.mkdir(active, { recursive: true });
    const oldLine = `${verbLine("2026-08-11T12:00:00.000Z", "done")}\n`;
    await Deno.writeTextFile(join(active, "2026-08.jsonl"), oldLine);
    const filename = "logbook-20260811T143015Z.jsonl";
    await archiveLogbook(common, filename, {
      seal: async (detached, temp) => {
        const oldBytes = await Deno.readFile(join(detached, "2026-08.jsonl"));
        await appendEvent(common, {
          schema: 1,
          at: "2026-08-11T14:30:16.000Z",
          writer: "9.9.9",
          kind: "verb",
          verb: "status",
          surface: "cli",
          branch: "main",
          head: "def5678",
          clean: true,
          outcome: "ok",
          duration_ms: 1,
          epoch: null,
        });
        await Deno.writeFile(temp, oldBytes, { createNew: true });
        return oldBytes.length;
      },
    });
    assertEquals(
      await Deno.readTextFile(join(logbookArchiveDir(common), filename)),
      oldLine,
    );
    const fresh = await readLogbookStream(common);
    assertEquals(
      fresh.events.flatMap((event) =>
        event.kind === "verb" ? [event.verb] : []
      ),
      ["status"],
    );
  });
});
