/** Class guard for validation-start identity and configured-job verdicts. */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { configSchema } from "../src/shared/config_schema.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import {
  attachValidationEvidence,
  completeValidationEvidence,
  VALIDATION_JOB_OUTCOMES,
  VALIDATION_RUNS,
  validationEvidence,
  type ValidationJobGroup,
  validationJobOutcome,
  type ValidationRun,
  type ValidationStart,
} from "../src/engine/logbook/validation.ts";
import {
  captureValidationStart,
  VALIDATION_CAPTURE_LIMITS,
} from "../src/engine/logbook/validation_state.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { parseLogbookLine } from "../src/engine/logbook/schema.ts";

const cfg = configSchema.parse({});

/** One configured test job at a registry-selected validation boundary. */
function group(
  run: ValidationRun,
  command = "true",
): ValidationJobGroup[] {
  const stage = run.stages.at(-1) ?? "test";
  return [{
    stage,
    mode: "parallel" as const,
    heading: "Validation",
    display: "Validation",
    jobs: [{
      label: "test",
      command,
      kind: "known" as const,
      reportStage: stage,
      willRun: true,
    }],
  }];
}

/** Seed a repository containing every ordinary filesystem entry type. */
async function seedRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, ".gitignore"), "ignored.txt\n");
  await Deno.writeTextFile(join(dir, "alpha.txt"), "alpha\n");
  await Deno.writeTextFile(join(dir, "delete.txt"), "delete\n");
  await Deno.writeFile(join(dir, "binary.bin"), new Uint8Array([0, 1, 2, 255]));
  await Deno.symlink("alpha.txt", join(dir, "link.txt"));
  await gitInit(dir);
}

/** Capture one standalone-test boundary with the production limits. */
async function capture(dir: string): Promise<ValidationStart> {
  return await captureValidationStart(
    dir,
    cfg,
    VALIDATION_RUNS.test,
    group(VALIDATION_RUNS.test),
  );
}

Deno.test("validation-run registry enrolls every run in every explicit job verdict", () => {
  const sourceByOutcome = {
    passed: "ok",
    failed: "failed",
    skipped: "skipped",
    cancelled: "cancelled",
    unavailable: undefined,
  } as const;
  assert(Object.hasOwn(VALIDATION_RUNS, "done"));
  assert(Object.hasOwn(VALIDATION_RUNS, "test"));
  for (const [verb, run] of Object.entries(VALIDATION_RUNS)) {
    for (const expected of VALIDATION_JOB_OUTCOMES) {
      const raw = sourceByOutcome[expected];
      const start = {
        version: 1 as const,
        state: {
          version: 1 as const,
          complete: true,
          capture: run.capture,
          elapsed_ms: 1,
          digest: "opaque",
          components: {},
          counts: {
            index_entries: 0,
            tracked_paths: 0,
            untracked_paths: 0,
            submodules: 0,
          },
          bytes: {
            index_manifest: 0,
            tracked_content: 0,
            untracked_content: 0,
          },
          exclusions: [],
        },
        execution: {
          version: 1 as const,
          complete: true,
          mode: run.mode,
          writer: "test",
          jobs: [{
            id: "test",
            stage: "test",
            kind: "known",
            concurrent_siblings: false,
          }],
        },
      };
      const evidence = completeValidationEvidence(
        start,
        raw === undefined
          ? undefined
          : [{ step: { label: "test" }, outcome: raw }],
      );
      assertEquals(
        evidence.execution.jobs[0]?.outcome,
        expected,
        `${verb}: ${expected}`,
      );
    }
  }
  assertEquals(validationJobOutcome({ outcome: "future" }), "unavailable");
});

Deno.test("legacy verb events remain readable without validation evidence", () => {
  const parsed = parseLogbookLine(JSON.stringify({
    schema: 1,
    at: "2026-08-12T00:00:00.000Z",
    kind: "verb",
    verb: "test",
    surface: "cli",
    branch: "agent/legacy",
    head: "abc1234",
    clean: true,
    outcome: "failed",
    duration_ms: 1,
    epoch: null,
    steps: [{
      label: "test",
      kind: "job",
      outcome: "failed",
      disposition: "run",
    }],
  }));
  assertEquals(parsed.kind, "event");
  if (parsed.kind === "event") {
    assert(parsed.event.kind === "verb");
    assertEquals(parsed.event.validation, undefined);
  }
});

Deno.test("semantic index identity survives refresh but separates staged and unstaged forms", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const clean = await capture(dir);
    assert(clean.state.complete);
    await git(dir, "status", "--short");
    const refreshed = await capture(dir);
    assertEquals(refreshed.state.digest, clean.state.digest);
    assertEquals(
      refreshed.state.components.index,
      clean.state.components.index,
    );

    await Deno.writeTextFile(join(dir, "alpha.txt"), "same working bytes\n");
    await git(dir, "add", "alpha.txt");
    const staged = await capture(dir);
    await git(dir, "reset", "--", "alpha.txt");
    const unstaged = await capture(dir);

    assert(staged.state.complete);
    assert(unstaged.state.complete);
    assertNotEquals(staged.state.digest, unstaged.state.digest);
    assertNotEquals(
      staged.state.components.index,
      unstaged.state.components.index,
      "semantic index content must move even when working-tree bytes are identical",
    );
    assertEquals(staged.state.counts.tracked_paths, 0);
    assertEquals(unstaged.state.counts.tracked_paths, 1);
  });
});

Deno.test("tracked, untracked, ignored, rename, delete, mode, symlink, and binary states are distinct", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const digests = new Set<string>();
    const remember = async (label: string): Promise<void> => {
      const evidence = await capture(dir);
      assert(evidence.state.complete, label);
      const digest = evidence.state.digest;
      assert(digest !== undefined, label);
      assert(!digests.has(digest), `${label} collapsed onto an earlier state`);
      digests.add(digest);
    };

    await remember("clean");
    await Deno.writeTextFile(join(dir, "alpha.txt"), "unstaged\n");
    await remember("unstaged");
    await Deno.writeTextFile(join(dir, "new.txt"), "untracked\n");
    await remember("mixed tracked and untracked");

    const beforeIgnored = (await capture(dir)).state.digest;
    await Deno.writeTextFile(join(dir, "ignored.txt"), "excluded\n");
    assertEquals((await capture(dir)).state.digest, beforeIgnored);

    await git(dir, "mv", "delete.txt", "renamed.txt");
    await remember("staged rename");
    await Deno.remove(join(dir, "alpha.txt"));
    await remember("unstaged delete");
    await Deno.chmod(join(dir, "binary.bin"), 0o755);
    await remember("executable mode");
    await Deno.remove(join(dir, "link.txt"));
    await Deno.symlink("binary.bin", join(dir, "link.txt"));
    await remember("symlink target");
    await Deno.writeFile(
      join(dir, "binary.bin"),
      new Uint8Array([0, 255, 3, 4, 5]),
    );
    await remember("binary content");
  });
});

Deno.test("dirty submodules make validation identity incomplete", async () => {
  await withTempDir(async (outer) => {
    const source = join(outer, "source");
    const project = join(outer, "project");
    await Deno.mkdir(source);
    await Deno.mkdir(project);
    await Deno.writeTextFile(join(source, "payload.txt"), "clean\n");
    await gitInit(source);
    await Deno.writeTextFile(join(project, "root.txt"), "root\n");
    await gitInit(project);
    await git(
      project,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      source,
      "module",
    );
    await git(project, "commit", "-q", "-am", "add submodule");

    const clean = await capture(project);
    assert(clean.state.complete);
    assertEquals(clean.state.counts.submodules, 1);
    await Deno.writeTextFile(join(project, "module", "payload.txt"), "dirty\n");
    const dirty = await capture(project);
    assertEquals(dirty.state.complete, false);
    assertEquals(dirty.state.digest, undefined);
    assert(
      dirty.state.incomplete?.some((entry) =>
        entry.category === "submodules" && entry.reason === "dirty"
      ),
    );
  });
});

Deno.test("path, byte, time, and unreadable budgets fail open without a comparable digest", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    await Deno.writeTextFile(join(dir, "alpha.txt"), "changed\n");
    const cases = [
      {
        label: "path",
        options: { limits: { paths: 0 } },
        reason: "path-limit",
      },
      {
        label: "byte",
        options: { limits: { bytes: 1 } },
        reason: "byte-limit",
      },
      {
        label: "time",
        options: {
          limits: { timeMs: 1 },
          now: (() => {
            let value = 0;
            return () => (value += 2);
          })(),
        },
        reason: "time-limit",
      },
      {
        label: "unreadable",
        options: {
          readFile: () => Promise.reject(new Deno.errors.PermissionDenied()),
        },
        reason: "unreadable",
      },
    ] as const;
    for (const testCase of cases) {
      const evidence = await captureValidationStart(
        dir,
        cfg,
        VALIDATION_RUNS.test,
        group(VALIDATION_RUNS.test),
        testCase.options,
      );
      assertEquals(evidence.state.complete, false, testCase.label);
      assertEquals(evidence.state.digest, undefined, testCase.label);
      assert(
        evidence.state.incomplete?.some((entry) =>
          entry.reason === testCase.reason
        ),
        testCase.label,
      );
    }
  });
});

Deno.test("validation evidence is bounded metadata and remains outside public result JSON", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const secretPath = "private-filename.txt";
    const secretContents = "private file payload";
    const secretCommand = "tool --token private-command-value";
    await Deno.writeTextFile(join(dir, secretPath), secretContents);
    const start = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test, secretCommand),
    );
    const evidence = completeValidationEvidence(start, [{
      step: { label: "test" },
      outcome: "ok",
    }]);
    const serialized = JSON.stringify(evidence);
    assert(!serialized.includes(secretPath));
    assert(!serialized.includes(secretContents));
    assert(!serialized.includes(secretCommand));
    assert(!serialized.includes("private-command-value"));
    assert(start.state.bytes.untracked_content >= secretContents.length);

    const result: DiscernResult = { ok: true, verb: "test" };
    attachValidationEvidence(result, evidence);
    assertEquals(JSON.stringify(result), '{"ok":true,"verb":"test"}');
    assertEquals(validationEvidence(result), evidence);
  });
});

Deno.test("representative validation fixture stays comfortably inside fixed capture limits", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    for (let index = 0; index < 250; index += 1) {
      await Deno.writeTextFile(
        join(dir, `fixture-${index}.txt`),
        `${index}:${"x".repeat(1024)}\n`,
      );
    }
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "representative fixture");
    const evidence = await capture(dir);
    assert(evidence.state.complete);
    assert(
      evidence.state.counts.index_entries <
        VALIDATION_CAPTURE_LIMITS.paths / 10,
    );
    assert(
      evidence.state.bytes.index_manifest <
        VALIDATION_CAPTURE_LIMITS.bytes / 100,
    );
    assert(evidence.state.elapsed_ms < VALIDATION_CAPTURE_LIMITS.timeMs);
  });
});
