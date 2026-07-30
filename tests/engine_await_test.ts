/**
 * `await` engine tests — the blocking fleet-condition verb, driven through the
 * real core against scaffolded repos (fast, in-process) plus the CLI for the
 * exit-code and interruption contracts. The behaviour under test:
 *
 *  - each condition grounds in authoritative state: `--landed` in git ancestry
 *    (the tip pinned at call start, so the answer survives acceptance deleting
 *    the branch), `--green` in the sibling worktree's gate receipt (a landing
 *    satisfies it too), `--trunk-moved` in the trunk ref against its at-start
 *    position;
 *  - the wait wakes on git-ref changes mid-hold, not just at the deadline;
 *  - timing out is NOT a failure: `ok` stays true, `met` is false, and
 *    `retry_after_seconds` is priced from the logbook's duration priors —
 *    in-flight work with a prior suggests the remainder, a quiet fleet the
 *    long backoff, a disabled logbook the labelled flat default;
 *  - the CLI exits 0 on met, 124 on "not yet", 1 on a refusal, and dies
 *    promptly on SIGINT with nothing left behind.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  DENO_JSON,
  engineEnv,
  git,
  gitInit,
  gitOut,
  MAIN_TS,
  runAgent,
  scaffoldEngine,
  worktreePath,
} from "./engine_helpers.ts";
import { awaitResult } from "../src/engine/await/await.ts";
import {
  AWAIT_TIMEOUT_EXIT_CODE,
  AWAIT_TIMING_IDLE_SECONDS,
  AWAIT_TIMING_NO_PRIOR_SECONDS,
} from "../src/engine/await/defaults.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { LOGBOOK_SCHEMA_VERSION } from "../src/engine/logbook/schema.ts";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Commit one file in `dir` (add-all, no signing). */
async function commitFile(
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await Deno.writeTextFile(join(dir, file), content);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message, "--no-gpg-sign");
}

/** Stamp an honored-shaped gate receipt for the worktree's current HEAD. */
async function writeHonoredReceipt(worktree: string): Promise<void> {
  const path = await gitAdminStatePath(worktree, "gateReceipt");
  assert(path !== undefined, "receipt path must resolve in a worktree");
  const head = await gitOut(worktree, "rev-parse", "HEAD");
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, `${head}\nline: gate green\n`);
}

/** Append raw logbook lines under the main checkout's common git dir. */
async function appendLogbookLines(
  dir: string,
  lines: readonly unknown[],
): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  const month = `${new Date().toISOString().slice(0, 7)}.jsonl`;
  await Deno.writeTextFile(
    join(logDir, month),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    { append: true },
  );
}

Deno.test("await --landed pins the tip at call start and survives the branch's deletion", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");
    const tip = await gitOut(dep, "rev-parse", "HEAD");

    // Not landed yet: a single evaluation answers immediately.
    const notYet = await awaitResult(dir, {
      landed: "agent/dep",
      timeoutSeconds: 0,
    });
    assert(notYet.ok, "a timeout is not a failure");
    assertEquals(notYet.data?.met, false);
    assertEquals(notYet.data?.observed.landed, false);
    assert(
      typeof notYet.data?.retry_after_seconds === "number",
      "a not-yet answer always says when to come back",
    );

    // Mid-wait, the landing happens the way acceptance performs it: the
    // worktree is removed and the BRANCH DELETED before the sha reaches the
    // trunk — only the pinned tip can still answer.
    const wait = awaitResult(dir, {
      landed: "agent/dep",
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await delay(300);
    await git(dir, "worktree", "remove", "--force", dep);
    await git(dir, "branch", "-D", "agent/dep");
    await git(dir, "merge", "-q", "--ff-only", tip);
    const met = await wait;
    assert(met.ok);
    assertEquals(met.data?.met, true);
    assertEquals(met.data?.observed.landed, true);
    assertEquals(met.data?.observed.tip, tip);
    assert(
      (met.data?.waited_ms ?? Infinity) < 10_000,
      "the wake fires well before the deadline",
    );
    assert(
      met.hints?.some((h) => h.includes("discern update")) === true,
      "a met landing hints the update",
    );
  });
});

Deno.test("await --landed met from a sibling worktree previews what update would bring in", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "shared.txt", "theirs", "dep touches shared");
    const dependent = await addWorktree(dir, "dependent");
    await commitFile(
      dependent,
      "shared.txt",
      "mine",
      "dependent touches shared",
    );

    await git(dir, "merge", "-q", "agent/dep");
    const met = await awaitResult(dependent, {
      landed: "agent/dep",
      timeoutSeconds: 0,
    });
    assert(met.ok);
    assertEquals(met.data?.met, true);
    assert((met.data?.observed.behind ?? 0) >= 1, "the branch is now behind");
    assert(
      met.data?.observed.incoming_overlap?.includes("shared.txt") === true,
      "the hot zone names the file both sides changed",
    );
    assert(
      met.hints?.some((h) => h.includes("overlap")) === true,
      "the hint carries the overlap count",
    );
  });
});

Deno.test("await --green reads the sibling's receipt, and a landing satisfies it too", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");

    // No receipt yet → not met, with the receipt state named.
    const missing = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assert(missing.ok);
    assertEquals(missing.data?.met, false);
    assertEquals(missing.data?.observed.receipt_status, "missing");
    // The observed path is canonicalized (macOS /var → /private/var).
    assertEquals(missing.data?.observed.worktree, await Deno.realPath(dep));

    // An honored receipt over the worktree's clean HEAD meets the condition,
    // and the hint teaches the below-trunk composition move.
    await writeHonoredReceipt(dep);
    const green = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assert(green.ok);
    assertEquals(green.data?.met, true);
    assertEquals(green.data?.observed.receipt_status, "honored");
    assert(
      green.hints?.some((h) => h.includes("--from agent/dep")) === true,
      "a green sibling hints update --from",
    );

    // A branch with NO worktree refuses honestly at call start: a receipt is
    // per-worktree state and can only be recorded inside a checkout, so the
    // condition can never become true — waiting would be dishonest. The
    // pointer routes to the question that CAN be answered.
    await git(dir, "branch", "solo");
    const solo = await awaitResult(dir, { green: "solo", timeoutSeconds: 0 });
    assertEquals(solo.ok, false);
    assert("error" in solo && solo.error === "not_found");
    assert(
      solo.message?.includes("No checkout holds branch") === true,
      solo.message,
    );
    assert(
      solo.hints?.some((h) => h.includes("--landed solo")) === true,
      "the refusal points at the literal arrival question",
    );
  });
});

Deno.test("await --green on a reclaimed stage points at the containing branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The reclaimed-train shape: stage 1's branch survives while its checkout
    // is gone, and stage 2 (forked from it, one commit ahead) carries all of
    // its work. The correct await target was always the containing branch.
    const stage1 = await addWorktree(dir, "stage1");
    await commitFile(stage1, "one.txt", "one", "stage 1 work");
    const stage2 = worktreePath(dir, "stage2");
    await git(
      dir,
      "worktree",
      "add",
      stage2,
      "-b",
      "agent/stage2",
      "agent/stage1",
    );
    await commitFile(stage2, "two.txt", "two", "stage 2 work");
    await git(dir, "worktree", "remove", "--force", stage1);

    const refused = await awaitResult(dir, {
      green: "agent/stage1",
      timeoutSeconds: 0,
    });
    assertEquals(refused.ok, false);
    assert("error" in refused && refused.error === "not_found");
    assert(
      refused.hints?.some((h) => h.includes("--green agent/stage2")) === true,
      `the refusal must point at the containing branch\n${
        JSON.stringify(refused.hints)
      }`,
    );
  });
});

Deno.test("await --green is satisfied by a landing it watched happen", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");

    // The wait observes the branch unreachable, then the landing mid-hold:
    // only a validated tree lands, so the transition proves the gate held —
    // no receipt observation window required.
    const wait = awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await delay(300);
    await git(dir, "merge", "-q", "agent/dep");
    const met = await wait;
    assert(met.ok);
    assertEquals(met.data?.met, true);
    assertEquals(met.data?.observed.landed, true);
    assert((met.data?.waited_ms ?? Infinity) < 10_000);
    assert(
      met.hints?.some((h) => h.includes("discern update")) === true,
      "a landing hints the update",
    );
  });
});

Deno.test("await --trunk-moved wakes on the ref change, not the deadline", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const start = await gitOut(dir, "rev-parse", "HEAD");
    const wait = awaitResult(dir, {
      trunkMoved: true,
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await delay(300);
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "move",
      "--no-gpg-sign",
    );
    const met = await wait;
    assert(met.ok);
    assertEquals(met.data?.met, true);
    assertEquals(met.data?.observed.trunk_start, start);
    assert(met.data?.observed.trunk_head !== start, "the head moved");
    assert((met.data?.waited_ms ?? Infinity) < 10_000);
  });
});

Deno.test("retry advice prices the wait from duration priors, and degrades honestly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "dep");

    // A quiet fleet: the long idle backoff.
    const idle = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(idle.data?.retry_basis, "idle");
    assertEquals(idle.data?.retry_after_seconds, AWAIT_TIMING_IDLE_SECONDS);
    assertEquals(idle.data?.timeout_basis, "explicit");

    const idleAbort = new AbortController();
    idleAbort.abort();
    const automaticIdle = await awaitResult(
      dir,
      { green: "agent/dep" },
      idleAbort.signal,
    );
    assertEquals(automaticIdle.data?.timeout_basis, "idle");
    assertEquals(
      automaticIdle.data?.timeout_seconds,
      AWAIT_TIMING_IDLE_SECONDS,
    );

    // The dependency is mid-`done`, one minute into a run whose observed median
    // is four minutes and whose P90 upper bound is six minutes.
    // Newer coordination calls share the branch but cannot hide that work from
    // the timing consumer: all concurrent begins survive the fleet projection,
    // and the longest credible remainder gives the wait its upper bound.
    const now = Date.now();
    const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
    const completion = (msAgo: number, durationMs: number): unknown => ({
      schema: LOGBOOK_SCHEMA_VERSION,
      at: iso(msAgo),
      kind: "verb",
      verb: "done",
      surface: "cli",
      branch: "agent/dep",
      head: null,
      clean: null,
      outcome: "ok",
      duration_ms: durationMs,
      epoch: null,
    });
    await appendLogbookLines(dir, [
      completion(3_600_000, 180_000),
      completion(1_800_000, 240_000),
      completion(900_000, 360_000),
      {
        schema: LOGBOOK_SCHEMA_VERSION,
        at: iso(600_000),
        kind: "verb",
        invocation: "prior-await",
        verb: "await",
        surface: "mcp",
        branch: "agent/dep",
        head: null,
        clean: null,
        outcome: "ok",
        duration_ms: 45_000,
        epoch: null,
      },
      {
        schema: LOGBOOK_SCHEMA_VERSION,
        at: iso(60_000),
        kind: "begin",
        invocation: "inv-live",
        verb: "done",
        surface: "cli",
        driver: {},
        branch: "agent/dep",
        head: null,
        epoch: null,
      },
      {
        schema: LOGBOOK_SCHEMA_VERSION,
        at: iso(10_000),
        kind: "begin",
        invocation: "current-await",
        verb: "await",
        surface: "mcp",
        driver: {},
        branch: "agent/dep",
        head: null,
        epoch: null,
      },
      {
        schema: LOGBOOK_SCHEMA_VERSION,
        at: iso(5_000),
        kind: "begin",
        invocation: "future-sibling",
        verb: "coordinate",
        surface: "mcp",
        driver: {},
        branch: "agent/dep",
        head: null,
        epoch: null,
      },
    ]);
    const running = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(running.data?.retry_basis, "running");
    assertEquals(running.data?.running?.verb, "done");
    assertEquals(running.data?.running?.branch, "agent/dep");
    assertEquals(running.data?.running?.typical_duration_ms, 240_000);
    assertEquals(running.data?.running?.p90_duration_ms, 360_000);
    assertEquals(running.data?.running?.duration_samples, 3);
    assertEquals(running.data?.timeout_basis, "explicit");
    const seconds = running.data?.retry_after_seconds ?? 0;
    assert(
      seconds >= 297 && seconds <= 301,
      `~5 minutes of the P90 run remain, got ${seconds}s`,
    );
    assert(
      running.hints?.some((h) => h.includes(`${seconds}`)) === true,
      "the not-yet hint names the delay",
    );

    // With no explicit timeout, the same repository evidence prices the first
    // bounded call. Abort immediately so the test observes the chosen bound
    // without waiting for it.
    const abort = new AbortController();
    abort.abort();
    const automatic = await awaitResult(
      dir,
      { green: "agent/dep" },
      abort.signal,
    );
    assertEquals(automatic.data?.timeout_basis, "running");
    assert(
      Math.abs((automatic.data?.timeout_seconds ?? 0) - seconds) <= 1,
      "the omitted timeout uses the same live duration evidence",
    );

    // A first invocation has no history to price it. Active work receives a
    // generous first-run bound rather than being mistaken for an idle fleet.
    await addWorktree(dir, "fresh");
    await appendLogbookLines(dir, [{
      schema: LOGBOOK_SCHEMA_VERSION,
      at: new Date().toISOString(),
      kind: "begin",
      invocation: "first-compile",
      verb: "compile",
      surface: "cli",
      driver: {},
      branch: "agent/fresh",
      head: null,
      epoch: null,
    }]);
    const freshAbort = new AbortController();
    freshAbort.abort();
    const firstRun = await awaitResult(
      dir,
      { green: "agent/fresh" },
      freshAbort.signal,
    );
    assertEquals(firstRun.data?.timeout_basis, "no-prior");
    assertEquals(
      firstRun.data?.timeout_seconds,
      AWAIT_TIMING_NO_PRIOR_SECONDS,
    );

    // With the logbook off the advice is a fallback, and a point-of-use
    // line says why the timing evidence is absent.
    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(
      configPath,
      config.replace("logbook = true", "logbook = false"),
    );
    const off = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(off.data?.retry_basis, "logbook-off");
    assert(
      off.hints?.some((h) => h.includes("fallback")) === true,
      "the degraded advice is labelled at the point of use",
    );
  });
});

Deno.test("the CLI exits 0 on met, 124 on not-yet, 1 on refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const notYet = await runAgent(dir, [
      "await",
      "--trunk-moved",
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(notYet.code, AWAIT_TIMEOUT_EXIT_CODE);
    const envelope = JSON.parse(notYet.stdout) as {
      ok: boolean;
      data: { met: boolean };
    };
    assertEquals(
      envelope.ok,
      true,
      "a timeout reports ok — not yet, not failed",
    );
    assertEquals(envelope.data.met, false);

    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");
    await git(dir, "merge", "-q", "agent/dep");
    const met = await runAgent(dir, [
      "await",
      "--landed",
      "agent/dep",
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(met.code, 0, met.output);

    const refused = await runAgent(dir, [
      "await",
      "--landed",
      "agent/zz-absent",
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(refused.code, 1);
    const refusal = JSON.parse(refused.stdout) as {
      ok: boolean;
      error: string;
    };
    assertEquals(refusal.ok, false);
    assertEquals(refusal.error, "not_found");
  });
});

Deno.test("a SIGINT ends the wait promptly, leaving nothing behind", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const child = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--config",
        DENO_JSON,
        "-A",
        MAIN_TS,
        "await",
        "--trunk-moved",
        "--timeout",
        "60",
      ],
      cwd: dir,
      env: await engineEnv(),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    // Give the process time to reach the wait loop (module load included).
    await delay(2500);
    child.kill("SIGINT");
    const guard = setTimeout(() => child.kill("SIGKILL"), 8_000);
    const killedAt = Date.now();
    const status = await child.output();
    clearTimeout(guard);
    assert(
      Date.now() - killedAt < 5_000,
      "the interrupted wait must die promptly, not run out its timeout",
    );
    assert(!status.success, "an interrupted wait is not a success");
    assert(
      status.code !== AWAIT_TIMEOUT_EXIT_CODE,
      "SIGINT death is distinct from the not-yet exit",
    );
  });
});
