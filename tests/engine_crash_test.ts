/**
 * Crash reporting (ADR 0246): the shared capture/artifact/frame/envelope module,
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
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
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
import { ISSUES_URL, KIT_VERSION } from "../src/lib/version.ts";

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

// ── the report and its renderings ────────────────────────────────────────────

Deno.test("captureCrashReport: stamps version, runtime, platform, and verb", () => {
  const report = captureCrashReport("done", new TypeError("boom"));
  assertEquals(report.verb, "done");
  assertEquals(report.version, KIT_VERSION);
  assertEquals(report.deno, Deno.version.deno);
  assertEquals(report.platform, `${Deno.build.os}-${Deno.build.arch}`);
  assertEquals(report.name, "TypeError");
  assertEquals(report.message, "boom");
  assertExists(report.stack);

  const preResolution = captureCrashReport(undefined, "boom");
  assertEquals(preResolution.verb, "discern");
  assertEquals(preResolution.name, "throw");
  assertEquals(preResolution.stack, undefined);
});

Deno.test("renderCrashArtifact: the saved file is self-contained", () => {
  const report = captureCrashReport("status", new TypeError("boom"));
  const body = renderCrashArtifact(report);
  assertStringIncludes(body, "discern crash report");
  assertStringIncludes(
    body,
    `version: ${KIT_VERSION} (deno ${Deno.version.deno}; ${report.platform})`,
  );
  assertStringIncludes(body, "verb: status");
  assertStringIncludes(body, "TypeError: boom");
  assertStringIncludes(body, ISSUES_URL);
});

Deno.test("renderCrashFrame: names the version and verb, and points at the saved report", () => {
  const report = captureCrashReport("status", new TypeError("boom"));
  const withFile = renderCrashFrame(report, "/tmp/report.txt");
  assertStringIncludes(
    withFile,
    `discern ${KIT_VERSION} crashed while running \`status\`.`,
  );
  assertStringIncludes(withFile, "TypeError: boom");
  assertStringIncludes(withFile, "/tmp/report.txt");
  assertStringIncludes(withFile, ISSUES_URL);

  const withoutFile = renderCrashFrame(report, undefined);
  assertStringIncludes(withoutFile, "couldn't save a crash report file");
  assertStringIncludes(withoutFile, ISSUES_URL);
});

Deno.test("internalErrorResult: the uniform machine envelope, no data payload", () => {
  const report = captureCrashReport("status", new TypeError("boom"));
  const result = internalErrorResult("status", report, "/tmp/report.txt");
  assertEquals(result.ok, false);
  assertEquals(result.verb, "status");
  assertEquals(result.error, "internal_error");
  assertEquals(result.data, undefined);
  assertExists(result.message);
  assertStringIncludes(result.message, "TypeError: boom");
  assertStringIncludes(result.message, "/tmp/report.txt");
  assertStringIncludes(result.message, ISSUES_URL);
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

    const report = captureCrashReport("status", new TypeError("boom"));
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

Deno.test("writeCrashArtifact: outside a repository, falls back to a temp file", async () => {
  await withTempDir(async (dir) => {
    const report = captureCrashReport("status", new TypeError("boom"));
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
