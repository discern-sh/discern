/**
 * `await` engine tests — the blocking fleet-condition verb, driven through the
 * real core against scaffolded repos (fast, in-process) plus the CLI for the
 * exit-code and interruption contracts. The behaviour under test:
 *
 *  - each condition grounds in authoritative state: `--landed` in git ancestry
 *    (the latest observed branch transition survives acceptance deleting the
 *    branch), `--green` in the sibling worktree's gate receipt (a landing
 *    satisfies it too), `--trunk-moved` in the trunk ref against its at-start
 *    position;
 *  - the wait wakes on git-ref changes mid-hold, not just at the deadline;
 *  - timing out is NOT a failure: `ok` stays true, `met` is false, and
 *    a continuation preserves the original pins across calls; each caller
 *    profile uses its longest reliable transport-safe bound;
 *  - the CLI exits 0 on met, 124 on "not yet", 1 on a refusal, and dies
 *    promptly on SIGINT with nothing left behind.
 */

import { assert, assertEquals } from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
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
import { type AwaitOptions, awaitResult } from "../src/engine/await/await.ts";
import {
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_STRICT_CALL_SECONDS,
  AWAIT_TIMEOUT_EXIT_CODE,
} from "../src/engine/await/defaults.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  AWAIT_CONDITIONS,
  type AwaitConditionKind,
} from "../src/shared/result_schemas.ts";
import {
  AWAIT_CALL_PROFILES,
  type AwaitCallProfile,
} from "../src/shared/mcp_timeout_policy.ts";
import { writeProofNote } from "../src/engine/gate/proof_notes.ts";
import { resolveCommonGitDir } from "../src/engine/worktree/git.ts";

const AWAIT_READINESS_TIMEOUT_MS = 180_000;
const AWAIT_READINESS_POLL_MS = 25;

type AwaitReadinessProbe = (
  pending: Promise<unknown>,
  what: string,
) => Promise<void>;

/** List await's repository-local, post-baseline continuation markers. */
async function awaitContinuations(directory: string): Promise<Set<string>> {
  const records = new Set<string>();
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      records.add(entry.name);
    }
  }
  return records;
}

/**
 * Snapshot await's continuation store before an operation starts, then return
 * a probe that waits for that operation's new post-baseline marker. Marker
 * creation supplies readiness; polling and the timer only bound observation.
 */
async function armAwaitReadinessProbe(
  root: string,
): Promise<AwaitReadinessProbe> {
  const directory = await gitAdminStatePath(root, "continuations");
  assert(directory !== undefined, "continuation path must resolve in a repo");
  await Deno.mkdir(directory, { recursive: true });
  const before = await awaitContinuations(directory);
  return async (pending: Promise<unknown>, what: string): Promise<void> => {
    let settled:
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: unknown }
      | undefined;
    void pending.then(
      (value) => {
        settled = { ok: true, value };
      },
      (error: unknown) => {
        settled = { ok: false, error };
      },
    );
    const deadline = Date.now() + AWAIT_READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const after = await awaitContinuations(directory);
      if ([...after].some((record) => !before.has(record))) {
        return;
      }
      if (settled !== undefined) {
        if (settled.ok) {
          throw new Error(
            `${what} settled before recording readiness: ${
              JSON.stringify(settled.value)
            }`,
          );
        }
        if (settled.error instanceof Error) {
          throw settled.error;
        }
        throw new Error(
          `${what} rejected before readiness: ${settled.error}`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, AWAIT_READINESS_POLL_MS)
      );
    }
    throw new Error(
      `timed out after ${AWAIT_READINESS_TIMEOUT_MS}ms waiting for ${what} readiness`,
    );
  };
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
async function writeHonoredProof(worktree: string): Promise<void> {
  const path = await gitAdminStatePath(worktree, "gateProof");
  assert(path !== undefined, "receipt path must resolve in a worktree");
  const head = await gitOut(worktree, "rev-parse", "HEAD");
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, `${head}\nline: gate green\n`);
}

Deno.test("await --landed tracks the branch tip and survives its deletion", async () => {
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
    // trunk — only the last observed tip can still answer.
    const readiness = await armAwaitReadinessProbe(dir);
    const wait = awaitResult(dir, {
      landed: "agent/dep",
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await readiness(wait, "await --landed");
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
      met.hints?.some((h) => h.includes("discern start")) === true,
      "a main-rooted landing starts a fresh worktree",
    );
  });
});

Deno.test("await --landed arms on branch work and follows its tip across continuations", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");

    const empty = await awaitResult(dir, {
      landed: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(
      empty.data?.met,
      false,
      "a fresh branch at the trunk has not landed any work",
    );
    assertEquals(empty.data?.observed.landed, false);
    const emptyResume = empty.data?.resume;
    assert(typeof emptyResume === "string");

    await commitFile(dep, "dep.txt", "work", "dep work");
    const workTip = await gitOut(dep, "rev-parse", "HEAD");
    const armed = await awaitResult(dir, {
      resume: emptyResume,
      timeoutSeconds: 0,
    });
    assertEquals(armed.data?.met, false);
    assertEquals(armed.data?.observed.tip, workTip);
    assertEquals(armed.data?.observed.landed, false);
    const armedResume = armed.data?.resume;
    assert(typeof armedResume === "string");

    await commitFile(dep, "more.txt", "more", "more dep work");
    const advancedTip = await gitOut(dep, "rev-parse", "HEAD");
    await git(dir, "merge", "-q", "--ff-only", advancedTip);
    const landed = await awaitResult(dir, {
      resume: armedResume,
      timeoutSeconds: 0,
    });
    assertEquals(landed.data?.met, true);
    assertEquals(landed.data?.observed.tip, advancedTip);
    assertEquals(landed.data?.observed.landed, true);
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

    const armed = await awaitResult(dependent, {
      landed: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(armed.data?.met, false);
    const resume = armed.data?.resume;
    assert(typeof resume === "string");

    await git(dir, "merge", "-q", "agent/dep");
    const met = await awaitResult(dependent, {
      resume,
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
    assert(
      met.hints?.some((h) => h.includes("discern update")) === true,
      "a worktree-rooted landing updates that worktree",
    );
  });
});

Deno.test("await --green reads the sibling's receipt, and a landing satisfies it too", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");
    const depTip = await gitOut(dep, "rev-parse", "HEAD");

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
    await writeHonoredProof(dep);
    const green = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assert(green.ok);
    assertEquals(green.data?.met, true);
    assertEquals(green.data?.observed.receipt_status, "honored");
    assert(
      green.hints?.some((h) => h.includes(`discern start --from ${depTip}`)) ===
        true,
      "a main-rooted green wait starts from the immutable green tip",
    );
    assert(
      green.hints?.every((hint) => !hint.includes("--from agent/dep")) === true,
      "the follow-up does not race branch deletion",
    );

    const caller = await addWorktree(dir, "caller");
    const greenFromWorktree = await awaitResult(caller, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(greenFromWorktree.data?.met, true);
    assert(
      greenFromWorktree.hints?.some((h) =>
        h.includes(`discern update --from ${depTip}`)
      ) === true,
      "a worktree-rooted green wait composes the immutable green tip",
    );
    assert(
      (greenFromWorktree.data?.observed.behind ?? 0) >= 1,
      "the immutable green tip also drives the update preview",
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
    const readiness = await armAwaitReadinessProbe(dir);
    const wait = awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await readiness(wait, "await --green");
    await git(dir, "merge", "-q", "agent/dep");
    const met = await wait;
    assert(met.ok);
    assertEquals(met.data?.met, true);
    assertEquals(met.data?.observed.landed, true);
    assert((met.data?.waited_ms ?? Infinity) < 10_000);
    assert(
      met.hints?.some((h) => h.includes("discern start")) === true,
      "a main-rooted green watch starts from the landed trunk",
    );
  });
});

Deno.test("await does not mistake an abandoned branch reset for a landing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");

    const armed = await awaitResult(dir, {
      landed: "agent/dep",
      timeoutSeconds: 0,
    });
    assertEquals(armed.data?.met, false);
    const resume = armed.data?.resume;
    assert(typeof resume === "string");

    await git(dep, "reset", "--hard", "main");
    const reset = await awaitResult(dir, {
      resume,
      timeoutSeconds: 0,
    });
    assertEquals(reset.data?.met, false);
    assertEquals(reset.data?.observed.landed, false);
  });
});

Deno.test("a fresh branch wait recovers accepted work after branch cleanup", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "dep");
    await commitFile(dep, "dep.txt", "work", "dep work");
    const tip = await gitOut(dep, "rev-parse", "HEAD");
    await git(dir, "merge", "-q", "--ff-only", tip);
    const receipt = await writeProofNote(dir, tip, {
      branch: "agent/dep",
      trunk: "main",
      head: tip.slice(0, 12),
      files_total: 1,
      insertions: 1,
      deletions: 0,
      line: "gate green",
      markdown: "gate green",
    });
    assertEquals(receipt.status, "recorded");
    await git(dir, "worktree", "remove", "--force", dep);
    await git(dir, "branch", "-D", "agent/dep");

    for (
      const options of [
        { green: "agent/dep" },
        { landed: "agent/dep" },
      ] satisfies AwaitOptions[]
    ) {
      const recovered = await awaitResult(dir, {
        ...options,
        timeoutSeconds: 0,
      });
      assertEquals(recovered.data?.met, true);
      assertEquals(recovered.data?.observed.tip, tip);
      assert(
        recovered.hints?.some((hint) => hint.includes("discern start")) ===
          true,
        "a main-rooted recovered landing starts a fresh worktree",
      );
      assert(
        recovered.hints?.every((hint) => !hint.includes("discern update")) ===
          true,
        "a main-rooted wait never prescribes update",
      );
    }
  });
});

Deno.test("await --trunk-moved wakes on the ref change, not the deadline", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const start = await gitOut(dir, "rev-parse", "HEAD");
    const mainReadiness = await armAwaitReadinessProbe(dir);
    const wait = awaitResult(dir, {
      trunkMoved: true,
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await mainReadiness(wait, "main-rooted await --trunk-moved");
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
    assert(
      met.hints?.some((hint) => hint.includes("discern start")) === true,
      "a main-rooted trunk watch starts a fresh worktree",
    );

    const dependent = await addWorktree(dir, "dependent");
    const worktreeReadiness = await armAwaitReadinessProbe(dependent);
    const worktreeWait = awaitResult(dependent, {
      trunkMoved: true,
      timeoutSeconds: 10,
      pollIntervalMs: 100,
    });
    await worktreeReadiness(
      worktreeWait,
      "worktree-rooted await --trunk-moved",
    );
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "move again",
      "--no-gpg-sign",
    );
    const worktreeMet = await worktreeWait;
    assertEquals(worktreeMet.data?.met, true);
    assert(
      worktreeMet.hints?.some((hint) => hint.includes("discern update")) ===
        true,
      "a worktree-rooted trunk watch updates that worktree",
    );
  });
});

Deno.test("every await condition resumes across the gap between bounded calls", async () => {
  interface RetryGapFixture {
    options: AwaitOptions;
    crossGap: () => Promise<void>;
  }
  type RetryGapCase = (
    dir: string,
  ) => RetryGapFixture | Promise<RetryGapFixture>;

  // `satisfies Record<AwaitConditionKind, …>` makes a new condition enroll in
  // this guard at the same source of truth that enrolls the CLI and schema.
  const cases = {
    green: async (dir: string): Promise<RetryGapFixture> => {
      const dep = await addWorktree(dir, "dep");
      return {
        options: { green: "agent/dep" },
        crossGap: async (): Promise<void> => {
          await commitFile(dep, "dep.txt", "work", "dep work");
          const tip = await gitOut(dep, "rev-parse", "HEAD");
          await git(dir, "worktree", "remove", "--force", dep);
          await git(dir, "branch", "-D", "agent/dep");
          await git(dir, "merge", "-q", "--ff-only", tip);
          const receipt = await writeProofNote(dir, tip, {
            branch: "agent/dep",
            trunk: "main",
            head: tip.slice(0, 12),
            files_total: 1,
            insertions: 1,
            deletions: 0,
            line: "gate green",
            markdown: "gate green",
          });
          assert(
            receipt.status === "recorded" ||
              receipt.status === "already_present",
            "the simulated acceptance must leave its durable receipt note",
          );
        },
      };
    },
    landed: async (dir: string): Promise<RetryGapFixture> => {
      const dep = await addWorktree(dir, "dep");
      await commitFile(dep, "dep.txt", "work", "dep work");
      const tip = await gitOut(dep, "rev-parse", "HEAD");
      return {
        options: { landed: "agent/dep" },
        crossGap: async (): Promise<void> => {
          await git(dir, "worktree", "remove", "--force", dep);
          await git(dir, "branch", "-D", "agent/dep");
          await git(dir, "merge", "-q", "--ff-only", tip);
        },
      };
    },
    "trunk-moved": (dir: string): RetryGapFixture => ({
      options: { trunkMoved: true },
      crossGap: async (): Promise<void> => {
        await git(
          dir,
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "move trunk between calls",
          "--no-gpg-sign",
        );
      },
    }),
  } satisfies Record<AwaitConditionKind, RetryGapCase>;

  for (const condition of AWAIT_CONDITIONS) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const fixture = await cases[condition](dir);
      const first = await awaitResult(dir, {
        ...fixture.options,
        timeoutSeconds: 0,
      });
      assertEquals(first.data?.met, false);
      const resume = (first.data as { resume?: unknown } | undefined)?.resume;
      assert(
        typeof resume === "string",
        `${condition} must return a continuation handle when not met`,
      );

      await fixture.crossGap();
      const resumedOptions = {
        resume,
        timeoutSeconds: 0,
      } as AwaitOptions & { resume: string };
      const resumed = await awaitResult(dir, resumedOptions);
      assert(resumed.ok, `${condition} continuation must remain valid`);
      assertEquals(
        resumed.data?.met,
        true,
        `${condition} must observe a condition crossed between calls`,
      );
    });
  }
});

const AWAIT_HANDLE_PATTERN =
  /^C1-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/u;

Deno.test("await continuation handles stay short as their saved payload grows", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const longName = `dep-${"payload".repeat(20)}`;
    await addWorktree(dir, longName);

    const first = await awaitResult(dir, {
      green: `agent/${longName}`,
      timeoutSeconds: 0,
    });
    const resume = first.data?.resume;
    assert(typeof resume === "string");
    assertEquals(resume.length, 15);
    assert(
      AWAIT_HANDLE_PATTERN.test(resume),
      `continuation ${resume} must use the fixed agent-relay handle grammar`,
    );

    const changed = resume[3] === "0" ? "1" : "0";
    const mistyped = `${resume.slice(0, 3)}${changed}${resume.slice(4)}`;
    const rejected = await awaitResult(dir, {
      resume: mistyped,
      timeoutSeconds: 0,
    });
    assertEquals(rejected.ok, false);
    assertEquals(rejected.error, "invalid_arguments");
    assert(
      rejected.message?.includes("typo") === true,
      "the refusal must identify a damaged agent-relay handle",
    );
  });
});

Deno.test("await handles persist across CLI processes and sibling worktrees", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const caller = await addWorktree(dir, "caller");

    const first = await runAgent(dir, [
      "await",
      "--trunk-moved",
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(first.code, AWAIT_TIMEOUT_EXIT_CODE, first.output);
    const firstEnvelope = JSON.parse(first.stdout) as {
      data?: { resume?: unknown };
    };
    const resume = firstEnvelope.data?.resume;
    assert(typeof resume === "string" && AWAIT_HANDLE_PATTERN.test(resume));

    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "move trunk between processes",
      "--no-gpg-sign",
    );
    const resumed = await runAgent(caller, [
      "await",
      "--resume",
      resume,
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(resumed.code, 0, resumed.output);
    const resumedEnvelope = JSON.parse(resumed.stdout) as {
      data?: { met?: unknown };
    };
    assertEquals(resumedEnvelope.data?.met, true);
  });
});

Deno.test("await continuation handles are closed, versioned, and repository-bound", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "dep");
    const first = await awaitResult(dir, {
      green: "agent/dep",
      timeoutSeconds: 0,
    });
    const resume = first.data?.resume;
    assert(typeof resume === "string");

    const mixed = await awaitResult(dir, {
      green: "agent/dep",
      resume,
      timeoutSeconds: 0,
    });
    assertEquals(mixed.ok, false);
    assertEquals(mixed.error, "invalid_arguments");

    const malformed = await awaitResult(dir, {
      resume: "v1.not-base64url-json",
      timeoutSeconds: 0,
    });
    assertEquals(malformed.ok, false);
    assertEquals(malformed.error, "invalid_arguments");

    await withTempDir(async (other) => {
      await scaffoldEngine(other);
      await gitInit(other);
      const foreign = await awaitResult(other, {
        resume,
        timeoutSeconds: 0,
      });
      assertEquals(foreign.ok, false);
      assertEquals(foreign.error, "invalid_arguments");
      assert(
        foreign.message?.includes("not found in this repository") === true,
        "the refusal names the repository-local lookup",
      );
    });
  });
});

Deno.test("legacy self-contained await tokens resume and migrate to short handles", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const dep = await addWorktree(dir, "legacy-dep");
    await commitFile(dep, "dep.txt", "work", "legacy dep work");
    const tip = await gitOut(dep, "rev-parse", "HEAD");
    const trunkStart = await gitOut(dir, "rev-parse", "main");
    const repository = await resolveCommonGitDir(dir);
    assert(repository !== undefined);
    const encoded = encodeBase64(
      new TextEncoder().encode(JSON.stringify({
        version: 1,
        repository,
        condition: "landed",
        branch: "agent/legacy-dep",
        trunk: "main",
        tip,
        trunk_start: trunkStart,
        branch_ever_unreachable: true,
      })),
    ).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

    const migrated = await awaitResult(dir, {
      resume: `v1.${encoded}`,
      timeoutSeconds: 0,
    });
    assertEquals(migrated.data?.met, false);
    const resume = migrated.data?.resume;
    assert(typeof resume === "string" && AWAIT_HANDLE_PATTERN.test(resume));

    await git(dir, "merge", "-q", "--ff-only", tip);
    const landed = await awaitResult(dir, { resume, timeoutSeconds: 0 });
    assertEquals(landed.data?.met, true);
  });
});

Deno.test("await uses the longest reliable call for every caller profile", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "dep");

    const expected = {
      cli: AWAIT_LONG_CALL_SECONDS,
      "long-client": AWAIT_LONG_CALL_SECONDS,
      "strict-client": AWAIT_STRICT_CALL_SECONDS,
      "unknown-client": AWAIT_STRICT_CALL_SECONDS,
    } satisfies Record<AwaitCallProfile, number>;

    for (const profile of AWAIT_CALL_PROFILES) {
      const abort = new AbortController();
      abort.abort();
      const automatic = await awaitResult(
        dir,
        { green: "agent/dep" },
        abort.signal,
        { callProfile: profile },
      );
      assertEquals(automatic.data?.timeout_basis, profile);
      assertEquals(automatic.data?.timeout_seconds, expected[profile]);
      assertEquals(automatic.data?.retry_basis, profile);
      assertEquals(automatic.data?.retry_after_seconds, expected[profile]);
    }

    // A strict client cannot honor a longer request. It receives a complete,
    // resumable answer before the transport kills the call.
    const cappedAbort = new AbortController();
    cappedAbort.abort();
    const capped = await awaitResult(
      dir,
      { green: "agent/dep", timeoutSeconds: 300 },
      cappedAbort.signal,
      { callProfile: "strict-client" },
    );
    assertEquals(capped.data?.timeout_seconds, AWAIT_STRICT_CALL_SECONDS);
    assertEquals(capped.data?.timeout_basis, "strict-client");
    assertEquals(capped.data?.requested_timeout_seconds, 300);
    assertEquals(capped.data?.retry_after_seconds, AWAIT_STRICT_CALL_SECONDS);
    assert(
      capped.hints?.some((hint) =>
        hint.includes("--resume") && !hint.includes("--green")
      ) === true,
      "the retry continues the original pins instead of starting a fresh wait",
    );

    // A short explicit bound remains caller-owned. A zero-second probe gets the
    // profile maximum for its continuation rather than recommending zero again.
    const explicitAbort = new AbortController();
    explicitAbort.abort();
    const explicit = await awaitResult(
      dir,
      { green: "agent/dep", timeoutSeconds: 30 },
      explicitAbort.signal,
      { callProfile: "long-client" },
    );
    assertEquals(explicit.data?.timeout_seconds, 30);
    assertEquals(explicit.data?.timeout_basis, "explicit");
    assertEquals(explicit.data?.retry_after_seconds, 30);
    assertEquals(explicit.data?.retry_basis, "explicit");

    const probe = await awaitResult(
      dir,
      { green: "agent/dep", timeoutSeconds: 0 },
      undefined,
      { callProfile: "long-client" },
    );
    assertEquals(probe.data?.timeout_seconds, 0);
    assertEquals(probe.data?.timeout_basis, "explicit");
    assertEquals(probe.data?.retry_after_seconds, AWAIT_LONG_CALL_SECONDS);
    assertEquals(probe.data?.retry_basis, "long-client");

    // The direct CLI has no MCP transport deadline, so an explicit longer
    // caller bound stays exact.
    const cliAbort = new AbortController();
    cliAbort.abort();
    const cliExplicit = await awaitResult(
      dir,
      { green: "agent/dep", timeoutSeconds: 4_000 },
      cliAbort.signal,
    );
    assertEquals(cliExplicit.data?.timeout_seconds, 4_000);
    assertEquals(cliExplicit.data?.timeout_basis, "explicit");
    assertEquals(cliExplicit.data?.requested_timeout_seconds, undefined);
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
    await writeHonoredProof(dep);
    const met = await runAgent(dir, [
      "await",
      "--green",
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
    const readiness = await armAwaitReadinessProbe(dir);
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
    await readiness(child.status, "CLI await --trunk-moved");
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
