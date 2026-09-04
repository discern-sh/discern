/**
 * Crash reporting (ADR 0248): the shared capture/artifact/frame/envelope module,
 * and the end-to-end crash paths on each surface. A crash — an unexpected throw
 * no verb turned into a structured refusal — must leave a version-stamped
 * report the user can attach to an issue, a structured `internal_error`
 * envelope for `--json` consumers, a logbook signature, and exit code 70.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { readDirIfExists } from "../src/shared/fs_presence.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  parseLogbookLine,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import {
  captureCrashReport,
  CRASH_EXIT_CODE,
  crashSignature,
  internalErrorResult,
  MAX_CRASH_FILES,
  renderCrashArtifact,
  renderCrashFrame,
  writeCrashArtifact,
} from "../src/engine/crash.ts";
import { DISCERN_VERSION, ISSUES_URL } from "../src/lib/version.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const FIXED_CRASH_TIME = Date.parse("2026-08-27T12:34:56.000Z");

/** Capture a crash against one fixed wall instant for deterministic records. */
function captureTestCrashReport(
  verb: string | undefined,
  thrown: unknown,
): ReturnType<typeof captureCrashReport> {
  return captureCrashReport(verb, thrown, FIXED_CRASH_TIME);
}

// ── the signature (the logbook-safe reduction) ───────────────────────────────

Deno.test("crashSignature: a dev-run stack trims its frame to the source tree", () => {
  const err = new TypeError("Cannot read properties of undefined");
  err.stack = [
    "TypeError: Cannot read properties of undefined",
    "    at explode (file:///Users/someone/checkout/src/engine/dispatch.ts:42:7)",
    "    at file:///Users/someone/checkout/src/main.ts:9:1",
  ].join("\n");
  assertEquals(crashSignature(err), {
    name: "TypeError",
    frame: "src/engine/dispatch.ts:42:7",
  });
});

Deno.test("crashSignature: a compiled-binary virtual path trims identically", () => {
  const err = new RangeError("boom");
  err.stack = [
    "RangeError: boom",
    "    at run (file:///var/folders/xy/T/deno-compile-discern/src/engine/gate/plan.ts:3:12)",
  ].join("\n");
  assertEquals(crashSignature(err), {
    name: "RangeError",
    frame: "src/engine/gate/plan.ts:3:12",
  });
});

Deno.test("crashSignature: a frame outside the known trees keeps its last two segments", () => {
  const err = new Error("boom");
  err.stack = [
    "Error: boom",
    "    at f (file:///opt/somewhere/vendored/lib.ts:5:5)",
  ].join("\n");
  assertEquals(crashSignature(err), {
    name: "Error",
    frame: "vendored/lib.ts:5:5",
  });
});

Deno.test("crashSignature: a stackless error and a non-Error throw stay name-only", () => {
  const bare = new Error("no stack");
  delete bare.stack;
  assertEquals(crashSignature(bare), { name: "Error" });
  assertEquals(crashSignature("a thrown string"), { name: "throw" });
});

const hostileThrownValueCases: ReadonlyArray<{
  label: string;
  make: () => unknown;
  expectedName: string;
}> = [
  {
    label: "throwing string coercion",
    make: () => ({
      toString: (): string => {
        throw new Error("string coercion failed");
      },
    }),
    expectedName: "throw",
  },
  {
    label: "throwing Error getters",
    make: () => {
      const error = new Error("hidden");
      for (const property of ["name", "message", "stack"] as const) {
        Object.defineProperty(error, property, {
          configurable: true,
          get: () => {
            throw new Error(`${property} getter failed`);
          },
        });
      }
      return error;
    },
    expectedName: "Error",
  },
  {
    label: "revoked proxy",
    make: () => {
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      return revocable.proxy;
    },
    expectedName: "throw",
  },
];

for (const fixture of hostileThrownValueCases) {
  Deno.test(`captureCrashReport: a hostile thrown value cannot escape (${fixture.label})`, () => {
    const report = captureTestCrashReport("status", fixture.make());
    assertEquals(report.name, fixture.expectedName);
    assertEquals(report.message, "The thrown value could not be inspected.");
    assertEquals(report.stack, undefined);
    assertEquals(report.signature, { name: fixture.expectedName });
  });
}

// ── the report and its renderings ────────────────────────────────────────────

Deno.test("captureCrashReport: stamps version, runtime, platform, and verb", () => {
  const report = captureTestCrashReport("done", new TypeError("boom"));
  assertEquals(report.at, "2026-08-27T12:34:56.000Z");
  assertEquals(report.verb, "done");
  assertEquals(report.version, DISCERN_VERSION);
  assertEquals(report.deno, Deno.version.deno);
  assertEquals(report.platform, `${Deno.build.os}-${Deno.build.arch}`);
  assertEquals(report.name, "TypeError");
  assertEquals(report.message, "boom");
  assertExists(report.stack);

  const preResolution = captureTestCrashReport(undefined, "boom");
  assertEquals(preResolution.verb, "discern");
  assertEquals(preResolution.name, "throw");
  assertEquals(preResolution.stack, undefined);
});

Deno.test("renderCrashArtifact: the saved file is self-contained", () => {
  const report = captureTestCrashReport("status", new TypeError("boom"));
  const body = renderCrashArtifact(report);
  assertEquals(
    body.split("\n", 1)[0],
    `discern crash report format ${ON_DISK_FORMATS.crashReport.version}`,
  );
  assertStringIncludes(
    body,
    `version: ${DISCERN_VERSION} (deno ${Deno.version.deno}; ${report.platform})`,
  );
  assertStringIncludes(body, "verb: status");
  assertStringIncludes(body, "TypeError: boom");
  assertStringIncludes(body, ISSUES_URL);
});

Deno.test("renderCrashFrame: names the version and verb, and points at the saved report", () => {
  const report = captureTestCrashReport("status", new TypeError("boom"));
  const withFile = renderCrashFrame(report, "/tmp/report.txt");
  assertStringIncludes(
    withFile,
    `discern ${DISCERN_VERSION} crashed while running \`status\`.`,
  );
  assertStringIncludes(withFile, "TypeError: boom");
  assertStringIncludes(withFile, "/tmp/report.txt");
  assertStringIncludes(withFile, ISSUES_URL);

  const withoutFile = renderCrashFrame(report, undefined);
  assertStringIncludes(withoutFile, "couldn't save a crash report file");
  assertStringIncludes(withoutFile, ISSUES_URL);
});

Deno.test("internalErrorResult: setup crashes retain one runnable recovery action", () => {
  const report = captureTestCrashReport("status", new TypeError("boom"));
  const result = internalErrorResult("status", report, "/tmp/report.txt");
  assertEquals(result.ok, false);
  assertEquals(result.verb, "status");
  assertEquals(result.error, "internal_error");
  assertEquals(result.data, undefined);
  assertExists(result.message);
  assertStringIncludes(result.message, "TypeError: boom");
  assertStringIncludes(result.message, "/tmp/report.txt");
  assertStringIncludes(
    result.message,
    `This is a bug in discern. Report it at ${ISSUES_URL}.`,
  );

  const setupReport = captureTestCrashReport(
    "setup done",
    new TypeError("setup boom"),
  );
  const setupResult = internalErrorResult("setup done", setupReport);
  assertEquals(setupResult.data, { next_action: "discern doctor" });
});

// ── the artifact writer ──────────────────────────────────────────────────────

Deno.test("writeCrashArtifact: saves under .git/discern/crash and prunes to the cap", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "scaffold\n");
    await gitInit(dir);
    const crashDir = join(dir, ".git", "discern", "crash");
    await Deno.mkdir(crashDir, { recursive: true });
    // Prefill past the cap with older, name-sorted-earlier reports.
    for (let i = 0; i < MAX_CRASH_FILES + 5; i += 1) {
      const stamp = String(i).padStart(3, "0");
      await Deno.writeTextFile(
        join(crashDir, `2020-01-01T00-00-00.${stamp}Z-1.txt`),
        "old report",
      );
    }

    const report = captureTestCrashReport("status", new TypeError("boom"));
    const path = await writeCrashArtifact(dir, report);
    assertExists(path);
    assert(path.startsWith(crashDir), `expected ${path} under ${crashDir}`);
    assertStringIncludes(await Deno.readTextFile(path), "TypeError: boom");

    const remaining: string[] = [];
    for await (const entry of Deno.readDir(crashDir)) {
      remaining.push(entry.name);
    }
    assertEquals(remaining.length, MAX_CRASH_FILES);
    // The newest report survives pruning; the removed ones are the oldest.
    assert(remaining.some((name) => join(crashDir, name) === path));
    assert(!remaining.includes("2020-01-01T00-00-00.000Z-1.txt"));
  });
});

Deno.test("writeCrashArtifact: concurrent same-instant reports get distinct files", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "scaffold\n");
    await gitInit(dir);
    const first = captureTestCrashReport(
      "status",
      new TypeError("first crash"),
    );
    const second = captureTestCrashReport(
      "docs",
      new RangeError("second crash"),
    );
    second.at = first.at;

    const [firstPath, secondPath] = await Promise.all([
      writeCrashArtifact(dir, first),
      writeCrashArtifact(dir, second),
    ]);
    assertExists(firstPath);
    assertExists(secondPath);
    assert(
      firstPath !== secondPath,
      `same-instant reports resolved to one path: ${firstPath}`,
    );
    assertStringIncludes(await Deno.readTextFile(firstPath), "first crash");
    assertStringIncludes(await Deno.readTextFile(secondPath), "second crash");

    const files: string[] = [];
    for await (
      const entry of Deno.readDir(join(dir, ".git", "discern", "crash"))
    ) {
      if (entry.isFile) {
        files.push(entry.name);
      }
    }
    assertEquals(files.length, 2);
  });
});

Deno.test("writeCrashArtifact: outside a repository, falls back to a temp file", async () => {
  await withTempDir(async (dir) => {
    const report = captureTestCrashReport("status", new TypeError("boom"));
    const path = await writeCrashArtifact(dir, report);
    assertExists(path);
    assert(!path.startsWith(dir), "must not write into the bare directory");
    assertStringIncludes(await Deno.readTextFile(path), "TypeError: boom");
    await Deno.remove(path);
  });
});

Deno.test("CRASH_EXIT_CODE is sysexits EX_SOFTWARE", () => {
  assertEquals(CRASH_EXIT_CODE, 70);
});

// ── the CLI crash path, end to end ───────────────────────────────────────────

/** Every crash report file under the repo's `.git/discern/crash/`. */
async function crashFiles(dir: string): Promise<string[]> {
  return (await readDirIfExists(join(dir, ".git", "discern", "crash")) ?? [])
    .map((entry) => entry.name)
    .sort();
}

/** Every parsed verb event in the repo's logbook, oldest first. */
async function logbookVerbEvents(dir: string): Promise<VerbEvent[]> {
  const events: VerbEvent[] = [];
  const logDir = join(dir, ".git", "discern", "logbook");
  for await (const entry of Deno.readDir(logDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const text = await Deno.readTextFile(join(logDir, entry.name));
    for (const line of text.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      const parsed = parseLogbookLine(line);
      if (parsed.kind === "event" && parsed.event.kind === "verb") {
        events.push(parsed.event);
      }
    }
  }
  return events;
}

Deno.test("CLI crash: exit 70, the stderr frame, a saved report, and a signed logbook event", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const run = await runAgent(dir, ["status"], {
      env: { DISCERN_CRASH_PROBE: "1" },
    });

    assertEquals(run.code, CRASH_EXIT_CODE, run.output);
    assertTerminalTextIncludes(
      run.stderr,
      `discern ${DISCERN_VERSION} crashed while running \`status\`.`,
    );
    assertTerminalTextIncludes(run.stderr, "Synthetic crash requested");
    assertStringIncludes(run.stderr, ISSUES_URL);

    // The report file exists where the frame says it is.
    const reports = await crashFiles(dir);
    assertEquals(reports.length, 1);
    const reportName = reports[0];
    assertExists(reportName);
    assertStringIncludes(run.stderr, reportName);
    const body = await Deno.readTextFile(
      join(dir, ".git", "discern", "crash", reportName),
    );
    assertStringIncludes(body, "discern crash report");
    assertStringIncludes(body, "verb: status");
    assertStringIncludes(body, "Synthetic crash requested");

    // The logbook event carries the failed outcome and the crash signature.
    const events = await logbookVerbEvents(dir);
    const crashed = events.find((event) => event.verb === "status");
    assertExists(crashed);
    assertEquals(crashed.outcome, "failed");
    assertExists(crashed.crash);
    assertEquals(crashed.crash.name, "Error");
    assertExists(crashed.crash.frame);
    assert(
      crashed.crash.frame.startsWith("src/engine/crash.ts:"),
      `frame was ${crashed.crash.frame}`,
    );
  });
});

Deno.test("CLI crash in --json mode: stdout is one uniform internal_error envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const run = await runAgent(dir, ["status", "--json"], {
      env: { DISCERN_CRASH_PROBE: "1" },
    });

    assertEquals(run.code, CRASH_EXIT_CODE, run.output);
    const envelope = decodeCliResult(run.stdout, "status");
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "status");
    assertEquals(envelope.error, "internal_error");
    assertEquals(envelope.data, undefined);
    assertExists(envelope.message);
    assertStringIncludes(envelope.message, "Synthetic crash requested");
    assertStringIncludes(envelope.message, ISSUES_URL);
    // The saved report is named in the message, and exists.
    const reports = await crashFiles(dir);
    assertEquals(reports.length, 1);
    const reportName = reports[0];
    assertExists(reportName);
    assertStringIncludes(envelope.message, reportName);
    // The human frame still lands on stderr for anyone watching a log.
    assertTerminalTextIncludes(run.stderr, "crashed while running");
  });
});
