/** Class guard for validation-start identity and configured-job verdicts. */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { dirname, join } from "@std/path";
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
  VALIDATION_EXECUTION_LIMITS,
  validationBoundaryNotReached,
} from "../src/engine/logbook/validation_state.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { modeOf, withTempDir } from "./helpers.ts";
import { parseLogbookLine } from "../src/engine/logbook/schema.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import {
  validationKey,
  type ValidationKeyResult,
} from "../src/engine/logbook/validation_key.ts";

const cfg = configSchema.parse({});
const SEMANTIC_CAPTURE_TIMEOUT_MS = 180_000;

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

/** Capture semantics with production path/byte limits and a load-safe deadline. */
async function capture(dir: string): Promise<ValidationStart> {
  return await captureValidationStart(
    dir,
    cfg,
    VALIDATION_RUNS.test,
    group(VALIDATION_RUNS.test),
    { limits: { timeMs: SEMANTIC_CAPTURE_TIMEOUT_MS } },
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
    assert(clean.state.complete, JSON.stringify(clean.state));
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

Deno.test("index visibility flags cannot hide job-visible checkout bytes", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);

    const ordinary = await capture(dir);
    await git(dir, "update-index", "--assume-unchanged", "alpha.txt");
    await Deno.writeTextFile(join(dir, "alpha.txt"), "hidden change\n");
    const assumed = await capture(dir);
    assert(assumed.state.complete);
    assertNotEquals(assumed.state.digest, ordinary.state.digest);

    await git(dir, "update-index", "--no-assume-unchanged", "alpha.txt");
    await git(dir, "checkout", "--", "alpha.txt");
    await git(dir, "sparse-checkout", "init", "--no-cone");
    await git(dir, "sparse-checkout", "set", "--no-cone", "/alpha.txt");
    assertEquals(await pathExists(join(dir, "delete.txt")), false);
    const sparse = await capture(dir);
    assert(sparse.state.complete);
    await git(dir, "sparse-checkout", "disable");
    const materialized = await capture(dir);
    assert(materialized.state.complete);
    assertNotEquals(sparse.state.digest, materialized.state.digest);
  });
});

Deno.test("an unknown index visibility class cannot silently become complete", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const object = await gitOut(dir, "rev-parse", "HEAD:alpha.txt");
    const fakeGit = join(dir, "future-index-tag-git");
    await Deno.writeTextFile(
      fakeGit,
      `#!/bin/sh
case " $* " in
  *" ls-files --stage -v -z "*) printf 'Q 100644 ${object} 0\\talpha.txt\\000' ;;
  *) exec git "$@" ;;
esac
`,
    );
    await Deno.chmod(fakeGit, 0o755);
    const evidence = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test),
      { gitBin: fakeGit },
    );
    assertEquals(evidence.state.complete, false);
    assert(
      evidence.state.incomplete?.some((entry) =>
        entry.category === "index" && entry.reason === "invalid"
      ),
    );
  });
});

Deno.test("validation capture has one bounded Git-output authority", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/engine/logbook/validation_state.ts", import.meta.url),
  );
  assertEquals(
    source.match(/await runGit\(/g)?.length,
    1,
    "every validation Git probe must funnel through captureGit",
  );
  assert(
    source.includes("maxOutputBytes: remainingBytes"),
    "the sole Git authority must pass its remaining hard byte ceiling",
  );
  assertEquals(
    source.match(/return await boundedValidationCapture\(/g)?.length,
    source.match(/export async function \w+\(/g)?.length,
    "every present and future exported capture API must enter the one deadline authority",
  );
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
    assert(clean.state.complete, JSON.stringify(clean.state));
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

/** Commit one new payload and return the source repository's HEAD. */
async function commitPayload(source: string, payload: string): Promise<string> {
  await Deno.writeTextFile(join(source, "payload.txt"), `${payload}\n`);
  await git(source, "add", "payload.txt");
  await git(source, "commit", "-q", "-m", payload);
  return await gitOut(source, "rev-parse", "HEAD");
}

Deno.test("unmerged gitlinks make validation identity incomplete", async () => {
  await withTempDir(async (outer) => {
    const source = join(outer, "source");
    const project = join(outer, "project");
    await Deno.mkdir(source);
    await Deno.mkdir(project);
    await Deno.writeTextFile(join(source, "payload.txt"), "base\n");
    await gitInit(source);
    const base = await gitOut(source, "rev-parse", "HEAD");
    const ours = await commitPayload(source, "ours");
    const theirs = await commitPayload(source, "theirs");
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
    const indexInfo = [
      `160000 ${base} 1\tmodule`,
      `160000 ${ours} 2\tmodule`,
      `160000 ${theirs} 3\tmodule`,
      "",
    ].join("\n");
    const update = await runGit(["update-index", "--index-info"], {
      cwd: project,
      stdin: indexInfo,
    });
    assert(update.success, update.stderr);

    const evidence = await capture(project);
    assertEquals(evidence.state.complete, false);
    assertEquals(evidence.state.digest, undefined);
    assert(
      evidence.state.incomplete?.some((entry) =>
        entry.category === "submodules"
      ),
    );
  });
});

Deno.test("deinitialized and recursively incomplete submodules never borrow a parent repository identity", async () => {
  await withTempDir(async (outer) => {
    const nested = join(outer, "nested");
    const parent = join(outer, "parent");
    const project = join(outer, "project");
    for (const dir of [nested, parent, project]) await Deno.mkdir(dir);
    await Deno.writeTextFile(join(nested, "payload.txt"), "nested\n");
    await gitInit(nested);
    await Deno.writeTextFile(join(parent, "payload.txt"), "parent\n");
    await gitInit(parent);
    await git(
      parent,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      nested,
      "nested",
    );
    await git(parent, "commit", "-q", "-am", "add nested");
    await Deno.writeTextFile(join(project, "root.txt"), "root\n");
    await gitInit(project);
    await git(
      project,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      parent,
      "module",
    );
    await git(project, "commit", "-q", "-am", "add parent");

    const nestedUninitialized = await capture(project);
    assertEquals(nestedUninitialized.state.complete, false);
    assert(
      nestedUninitialized.state.incomplete?.some((entry) =>
        entry.category === "submodules"
      ),
    );

    await git(
      project,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive",
    );
    const initialized = await capture(project);
    assert(initialized.state.complete, JSON.stringify(initialized.state));

    await git(
      join(project, "module"),
      "update-index",
      "--assume-unchanged",
      "nested",
    );
    const hiddenNestedGitlink = await capture(project);
    assertEquals(hiddenNestedGitlink.state.complete, false);
    assert(
      hiddenNestedGitlink.state.incomplete?.some((entry) =>
        entry.category === "submodules"
      ),
    );
    await git(
      join(project, "module"),
      "update-index",
      "--no-assume-unchanged",
      "nested",
    );

    await Deno.writeTextFile(
      join(project, "module", "nested", "payload.txt"),
      "dirty nested\n",
    );
    const nestedDirty = await capture(project);
    assertEquals(nestedDirty.state.complete, false);
    assert(
      nestedDirty.state.incomplete?.some((entry) =>
        entry.category === "submodules" && entry.reason === "dirty"
      ),
    );

    await git(project, "submodule", "deinit", "-f", "module");
    const deinitialized = await capture(project);
    assertEquals(deinitialized.state.complete, false);
    assert(
      deinitialized.state.incomplete?.some((entry) =>
        entry.category === "submodules"
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

/** Require a capture to return its categorical deadline result promptly. */
async function assertCaptureDeadline(
  capturePromise: Promise<ValidationStart>,
  timeMs: number,
  label: string,
): Promise<ValidationStart> {
  const toleranceMs = 250;
  const started = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    capturePromise.then((value) => ({ kind: "capture" as const, value })),
    new Promise<{ kind: "hung" }>((resolve) =>
      timeout = setTimeout(
        () => resolve({ kind: "hung" }),
        timeMs + toleranceMs,
      )
    ),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  assert(
    winner.kind === "capture",
    `${label} exceeded its ${timeMs}ms capture deadline plus ${toleranceMs}ms tolerance`,
  );
  assert(
    performance.now() - started <= timeMs + toleranceMs,
    `${label} returned outside the deadline tolerance`,
  );
  assertEquals(winner.value.state.complete, false, label);
  assert(
    winner.value.state.incomplete?.some((entry) =>
      entry.category === "budget" && entry.reason === "time-limit"
    ),
    `${label} must report the shared time-limit category`,
  );
  return winner.value;
}

Deno.test("a stalled tracked-file read cannot hold validation capture past its deadline", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    await Deno.writeTextFile(join(dir, "alpha.txt"), "changed\n");
    const fakeGit = join(dir, "tracked-read-git");
    const object = "0".repeat(40);
    await Deno.writeTextFile(
      fakeGit,
      `#!/bin/sh
case " $* " in
  *" rev-parse --verify HEAD^{commit} "*) printf '${object}\\n' ;;
  *" ls-files --stage -v -z "*) printf 'H 100644 ${object} 0\\talpha.txt\\000' ;;
  *" diff --name-only -z "*) printf 'alpha.txt\\000' ;;
esac
`,
    );
    await Deno.chmod(fakeGit, 0o755);
    let readStartedResolve: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      readStartedResolve = resolve;
    });
    const timeMs = VALIDATION_CAPTURE_LIMITS.timeMs;
    const capturePromise = captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test),
      {
        limits: { timeMs },
        gitBin: fakeGit,
        keyProvider: () => Promise.resolve({ key: new Uint8Array(32).fill(7) }),
        readFile: () => {
          readStartedResolve?.();
          return new Promise<Uint8Array>(() => {});
        },
      },
    );
    const reachedRead = await Promise.race([
      readStarted.then(() => true),
      capturePromise.then(() => false),
    ]);
    assert(
      reachedRead,
      "the deterministic Git prelude must reach the stalled tracked read",
    );
    await assertCaptureDeadline(capturePromise, timeMs, "tracked read");
  });
});

Deno.test("every validation capture API bounds a stalled key provider", async () => {
  const timeMs = 20;
  const keyProvider = (): Promise<ValidationKeyResult> =>
    new Promise<ValidationKeyResult>(() => {});
  const cases = [
    {
      label: "validation start",
      capture: captureValidationStart(
        "/unreachable",
        cfg,
        VALIDATION_RUNS.test,
        group(VALIDATION_RUNS.test),
        { limits: { timeMs }, keyProvider },
      ),
      boundary: false,
    },
    {
      label: "boundary not reached",
      capture: validationBoundaryNotReached(
        "/unreachable",
        cfg,
        VALIDATION_RUNS.done,
        group(VALIDATION_RUNS.done),
        { limits: { timeMs }, keyProvider },
      ),
      boundary: true,
    },
  ];
  for (const testCase of cases) {
    const evidence = await assertCaptureDeadline(
      testCase.capture,
      timeMs,
      testCase.label,
    );
    assertEquals(
      evidence.state.incomplete?.some((entry) =>
        entry.category === "boundary" && entry.reason === "not-reached"
      ) ?? false,
      testCase.boundary,
      `${testCase.label} must preserve its real boundary verdict`,
    );
  }
});

Deno.test("a rejection arriving after the capture deadline is still observed", async () => {
  let rejectKey: ((reason: Error) => void) | undefined;
  const keyProvider = (): Promise<ValidationKeyResult> =>
    new Promise<ValidationKeyResult>((_, reject) => {
      rejectKey = reject;
    });
  await assertCaptureDeadline(
    captureValidationStart(
      "/unreachable",
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test),
      { limits: { timeMs: 20 }, keyProvider },
    ),
    20,
    "late key rejection",
  );
  rejectKey?.(new Error("late forced failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

Deno.test("a real Git producer is killed at the validation byte boundary", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const fakeGit = join(dir, "oversize-git");
    await Deno.writeTextFile(
      fakeGit,
      "#!/bin/sh\ni=0\nwhile [ $i -lt 10000 ]; do printf 0123456789abcdef; i=$((i+1)); done\n",
    );
    await Deno.chmod(fakeGit, 0o755);
    const evidence = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test),
      { limits: { bytes: 1024 }, gitBin: fakeGit },
    );
    assertEquals(evidence.state.complete, false);
    assertEquals(evidence.state.digest, undefined);
    assert(
      evidence.state.incomplete?.some((entry) =>
        entry.category === "budget" && entry.reason === "byte-limit"
      ),
    );
  });
});

Deno.test("validation execution identity has independent entry and byte ceilings", async () => {
  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const byteLimited = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      group(VALIDATION_RUNS.test, "x".repeat(2 * 1024 * 1024)),
    );
    assertEquals(byteLimited.execution.complete, false);
    assert(
      byteLimited.execution.incomplete?.some((entry) =>
        entry.category === "execution" && entry.reason === "byte-limit"
      ),
    );

    const jobs = Array.from(
      { length: VALIDATION_EXECUTION_LIMITS.entries + 1 },
      (_, index) => ({
        label: `test-${index}`,
        command: "true",
        kind: "known",
        reportStage: "test",
        willRun: true,
      }),
    );
    const entryLimited = await validationBoundaryNotReached(
      dir,
      cfg,
      VALIDATION_RUNS.test,
      [{ mode: "parallel", jobs }],
    );
    assertEquals(entryLimited.execution.complete, false);
    assertEquals(entryLimited.execution.jobs, []);
    assert(
      entryLimited.execution.incomplete?.some((entry) =>
        entry.category === "execution" && entry.reason === "entry-limit"
      ),
    );
  });
});

Deno.test("validation keys require a regular 0600 file and creation establishes it", async () => {
  const variants = [
    "group-readable",
    "world-readable",
    "symlink",
    "directory",
  ] as const;
  for (const variant of variants) {
    await withTempDir(async (dir) => {
      await seedRepo(dir);
      const path = await gitAdminStatePath(dir, "validationHmacKey");
      assert(path !== undefined);
      await Deno.mkdir(dirname(path), { recursive: true });
      if (variant === "group-readable" || variant === "world-readable") {
        await Deno.writeFile(path, new Uint8Array(32), {
          mode: variant === "group-readable" ? 0o640 : 0o604,
        });
      } else if (variant === "symlink") {
        const target = join(dir, "key-target");
        await Deno.writeFile(target, new Uint8Array(32), { mode: 0o600 });
        await Deno.symlink(target, path);
      } else {
        await Deno.mkdir(path);
      }
      const evidence = await capture(dir);
      assertEquals(evidence.state.complete, false, variant);
      assert(
        evidence.state.incomplete?.some((entry) =>
          entry.category === "key" && entry.reason === "invalid"
        ),
        variant,
      );
    });
  }

  await withTempDir(async (dir) => {
    await seedRepo(dir);
    const result = await validationKey(dir);
    assert("key" in result);
    assertEquals(
      await modeOf(dirname(resultPath(dir)), "validation-hmac-key"),
      0o600,
    );
  });
});

Deno.test("every validation capture path is total when its dependencies throw", async () => {
  const rejectedKey = (): Promise<never> =>
    Promise.reject(new Error("forced key failure"));
  const preBoundary = await validationBoundaryNotReached(
    "/unreachable",
    cfg,
    VALIDATION_RUNS.done,
    group(VALIDATION_RUNS.done),
    { keyProvider: rejectedKey },
  );
  assertEquals(preBoundary.state.complete, false);
  assert(
    preBoundary.state.incomplete?.some((entry) =>
      entry.category === "boundary" && entry.reason === "not-reached"
    ),
    "the original already-red verdict boundary must survive capture failure",
  );
  assert(
    preBoundary.state.incomplete?.some((entry) =>
      entry.category === "internal" && entry.reason === "unavailable"
    ),
  );

  const boundary = await captureValidationStart(
    "/unreachable",
    cfg,
    VALIDATION_RUNS.test,
    group(VALIDATION_RUNS.test),
    { keyProvider: rejectedKey },
  );
  assertEquals(boundary.state.complete, false);
  assert(
    boundary.state.incomplete?.some((entry) =>
      entry.category === "internal" && entry.reason === "unavailable"
    ),
  );

  const failedClock = await captureValidationStart(
    "/unreachable",
    cfg,
    VALIDATION_RUNS.test,
    group(VALIDATION_RUNS.test),
    {
      now: () => {
        throw new Error("forced clock failure");
      },
    },
  );
  assertEquals(failedClock.state.complete, false);
  assertEquals(failedClock.state.elapsed_ms, 0);
  assert(
    failedClock.state.incomplete?.some((entry) =>
      entry.category === "internal" && entry.reason === "unavailable"
    ),
  );

  const key = await validationKey("/unreachable", {
    resolvePath: () => Promise.reject(new Error("forced Git-admin failure")),
  });
  assert("incomplete" in key);
  assertEquals(key.incomplete, { category: "key", reason: "unavailable" });
});

/** Registered key path asserted present for an initialized fixture. */
function resultPath(dir: string): string {
  return join(dir, ".git", "discern", "validation-hmac-key");
}

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

Deno.test("representative validation fixture stays inside fixed path and byte limits", async () => {
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
  });
});
