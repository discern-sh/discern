/**
 * `discern setup accept` coverage — the deterministic way to land a finished setup onto
 * the integration branch (A11), the main-checkout counterpart to `discern accept`.
 *
 * A fresh `discern setup` isolates its commits on a `discern-setup` branch, so without
 * a landing path the work sits off `main` and a novice can appear to "lose" discern by
 * switching branches. These tests drive the real CLI through every landing outcome —
 * fast-forward, merge, the refusals (dirty tree, conflict, missing target), and the
 * no-ops (already landed, no repo) — asserting both the result envelope and the git
 * state it leaves behind.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HINTS } from "../src/shared/hints.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  reconcileOpenQuestion,
  recordDeclaration,
} from "../src/engine/checkpoints/open_questions.ts";
import {
  defaultMapPath,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { ACCEPT_COMMAND_REF } from "../src/commands/setup_accept.ts";
import { SETUP_BRANCH } from "../src/shared/setup_state.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";

/** Scaffold a bootstrapped project, commit setup work, and record current Proof. */
async function setupBranchRepo(
  dir: string,
): Promise<{ head: string; proofLine: string }> {
  await scaffoldEngine(dir); // bootstrapped by default
  await gitInit(dir); // commits the scaffold on `main`
  await git(dir, "checkout", "-b", "discern-setup");
  await Deno.writeTextFile(join(dir, "setup-work.txt"), "harness\n");
  const refreshed = await runAgent(dir, ["refresh"]);
  assertEquals(refreshed.code, 0, refreshed.output);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
  const done = await runAgent(dir, ["done", "--json"]);
  assertEquals(done.code, 0, done.output);
  const result = JSON.parse(done.stdout);
  const head = await gitOut(dir, "rev-parse", "HEAD");
  assertEquals(result.data.proof.head, head.slice(0, 12));
  return { head, proofLine: result.data.proof.line };
}

/** True when `branch` no longer exists in the repo. */
async function branchGone(dir: string, branch: string): Promise<boolean> {
  const branches = (await gitOut(dir, "branch", "--format=%(refname:short)"))
    .split("\n").map((b) => b.trim());
  return !branches.includes(branch);
}

/** Run setup acceptance and prove a refusal changed no branch or ref. */
async function readOnlySetupRefusal(
  dir: string,
): Promise<Record<string, unknown>> {
  const mainBefore = await gitOut(dir, "rev-parse", "main");
  const setupBefore = await gitOut(dir, "rev-parse", "discern-setup");
  const accepted = await runAgent(dir, ["setup", "accept", "--json"]);
  assertEquals(accepted.code, 1, accepted.output);
  assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
  assertEquals(await gitOut(dir, "rev-parse", "discern-setup"), setupBefore);
  assertEquals(
    await gitOut(dir, "branch", "--show-current"),
    "discern-setup",
  );
  const result: unknown = JSON.parse(accepted.stdout);
  assert(
    result !== null && typeof result === "object" && !Array.isArray(result),
  );
  const envelope = result as Record<string, unknown>;
  assert(typeof envelope.message === "string");
  assertStringIncludes(
    envelope.message,
    "make it clean, run `discern setup done`, then retry",
  );
  return envelope;
}

/** Resolve the current worktree's canonical Gate Proof path. */
async function proofPath(dir: string): Promise<string> {
  const path = await gitAdminStatePath(dir, "gateProof");
  assert(path !== undefined);
  return path;
}

Deno.test("setup accept fast-forwards the setup branch onto main and deletes it", async () => {
  await withTempDir(async (dir) => {
    const proved = await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    const result = JSON.parse(res.stdout);
    assertEquals(result.message, "Setup landed onto main.");
    const data = result.data;
    assertEquals(data.landed, true);
    assertEquals(data.fast_forward, true);
    assertEquals(data.branch, "discern-setup");
    assertEquals(data.target, "main");
    assertEquals(data.branch_deleted, true);
    assertEquals(data.proof_line, proved.proofLine);
    assertEquals(data.validated_commit, proved.head);
    assertEquals(data.proof_note.write.commit, proved.head);
    assert(
      ["recorded", "already_present"].includes(data.proof_note.write.status),
    );
    assertEquals(data.local_artifacts_converged, true);
    assert(
      data.reactivation.per_agent.some((agent: { check: string }) =>
        agent.check === "discern_status"
      ),
    );
    assertStringIncludes(data.activation_context, "load MCP servers");
    assertStringIncludes(data.activation_context, "session start");
    assertEquals(data.optional_improvement, {
      command: "discern improvement --json",
      after: "activation_verified",
    });
    assert(
      result.hints.some((hint: string) =>
        hint.includes("Only after every applicable activation check succeeds")
      ),
    );

    // Now on main, the merged branch is gone, and the setup work landed.
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(await branchGone(dir, "discern-setup"));
    assertEquals(
      await Deno.readTextFile(join(dir, "setup-work.txt")),
      "harness\n",
    );

    const status = await runAgent(dir, ["status", "--verbose", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusData = JSON.parse(status.stdout).data;
    assertEquals(statusData.stale_generated, undefined);
    assertEquals(statusData.stale_materialized, undefined);
    assertEquals(statusData.stale_integrations, undefined);
    assertEquals(statusData.pending_tracked_refresh, undefined);
    assert(statusData.landed_proof !== undefined, status.output);
    assertEquals(statusData.landed_proof.commit, proved.head);
    assertEquals(statusData.landed_proof.proof.line, proved.proofLine);
  });
});

Deno.test("setup accept merges when the integration branch has advanced", async () => {
  await withTempDir(async (dir) => {
    const proved = await setupBranchRepo(dir);
    // main moves on after the branch point → no fast-forward is possible.
    await git(dir, "checkout", "main");
    await Deno.writeTextFile(join(dir, "main-work.txt"), "trunk\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main advanced", "--no-gpg-sign");
    await git(dir, "checkout", "discern-setup");
    await git(dir, "config", "merge.ff", "only");
    await git(dir, "config", "branch.main.mergeOptions", "--ff-only");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    const data = JSON.parse(res.stdout).data;
    assertEquals(data.landed, true);
    assertEquals(data.fast_forward, false);
    assertEquals(data.branch_deleted, true);
    assertEquals(data.merge_validated, true);
    assert(data.validated_commit !== proved.head);
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      data.validated_commit,
    );
    assertEquals(data.proof_note.write.commit, data.validated_commit);

    // Both lines of work are on main now.
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(await branchGone(dir, "discern-setup"));
    assert(await fileExists(join(dir, "setup-work.txt")));
    assert(await fileExists(join(dir, "main-work.txt")));
  });
});

Deno.test("setup accept --dry-run previews the fast-forward and changes nothing", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);

    const res = await runAgent(dir, ["setup", "accept", "--dry-run"]);
    assertEquals(res.code, 0, res.output);
    assert(res.stdout.includes("fast-forward main to the proved setup commit"));
    // Still on the setup branch; nothing landed, nothing deleted.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup accept refuses denied planned writes before checkout, ref advance, or branch deletion", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    const mainBefore = await gitOut(dir, "rev-parse", "main");
    const setupBefore = await gitOut(dir, "rev-parse", SETUP_BRANCH);
    const gitDir = join(dir, ".git");
    const originalMode = (await Deno.stat(gitDir)).mode;
    assert(originalMode !== null);
    await Deno.chmod(gitDir, 0o555);
    try {
      const denied = await runAgent(dir, ["setup", "accept", "--json"]);
      assertEquals(denied.code, 1, denied.output);
      const envelope = JSON.parse(denied.stdout);
      assertEquals(envelope.error, "write_access");
      assertEquals(envelope.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        "discern setup accept",
      );
      assertStringIncludes(envelope.message, gitDir);
      assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
      assertEquals(
        await gitOut(dir, "rev-parse", SETUP_BRANCH),
        setupBefore,
      );
      assertEquals(
        await gitOut(dir, "branch", "--show-current"),
        SETUP_BRANCH,
      );
      assertEquals(await branchGone(dir, SETUP_BRANCH), false);
    } finally {
      await Deno.chmod(gitDir, originalMode & 0o777);
    }
  });
});

Deno.test("setup accept refuses a tree with uncommitted tracked changes", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "setup-work.txt"), "edited\n"); // tracked, dirty

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "dirty_worktree");
    // Untouched: still on the branch, nothing landed.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup accept refuses every tracked mutation made after Proof", async () => {
  await withTempDir(async (dir) => {
    const proved = await setupBranchRepo(dir);
    const provedHead = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(proved.head, provedHead);

    // An unrelated future sibling of the observed marker mutation: the
    // acceptance invariant is about every post-Proof tree change, regardless
    // of the file or feature that produced it.
    await Deno.writeTextFile(join(dir, "unrelated-after-proof.txt"), "later\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "mutate after proof",
      "--no-gpg-sign",
    );
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const accepted = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    assertTerminalTextIncludes(
      JSON.parse(accepted.stdout).message,
      "run `discern setup done`, then retry",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
  });
});

Deno.test("setup accept refuses missing, unreadable, mismatched, and declaration-stale Proof read-only", async () => {
  // Missing marker file.
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.remove(await proofPath(dir));
    const result = await readOnlySetupRefusal(dir);
    assertEquals(result.error, "precondition_failed");
  });

  // An unreadable marker target. A directory at the file path makes the
  // canonical reader return read_failed without relying on process privileges.
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    const path = await proofPath(dir);
    await Deno.remove(path);
    await Deno.mkdir(path);
    const result = await readOnlySetupRefusal(dir);
    assertEquals(result.error, "precondition_failed");
  });

  // The structured Proof contradicts the commit recorded by the marker. This
  // exercises the shared Proof reader, not a setup-local comparison.
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    const path = await proofPath(dir);
    const lines = (await Deno.readTextFile(path)).split("\n");
    const mainHead = await gitOut(dir, "rev-parse", "main");
    const rewritten = lines.map((line) => {
      if (!line.startsWith("data: ")) {
        return line;
      }
      const parsed: unknown = JSON.parse(line.slice("data: ".length));
      assert(
        parsed !== null && typeof parsed === "object" &&
          !Array.isArray(parsed),
      );
      return `data: ${
        JSON.stringify({
          ...(parsed as Record<string, unknown>),
          head: mainHead.slice(0, 12),
        })
      }`;
    });
    await Deno.writeTextFile(path, rewritten.join("\n"));
    const result = await readOnlySetupRefusal(dir);
    assertEquals(result.error, "precondition_failed");
    assertStringIncludes(String(result.message), "does not identify");
  });

  // Declaration evidence changes without moving HEAD or dirtying the tree.
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    const opened = await reconcileOpenQuestion(dir, {
      checkpoint: "setup-proof",
      definitionHash: "definition-v1",
      subject: "setup-subject",
      matchedPaths: ["setup-work.txt"],
      relatedPaths: [],
    }, "2026-08-23T00:00:00.000Z");
    assert(opened.ok);
    const declared = await recordDeclaration(
      dir,
      {
        conclusion: "met",
        definitionHash: "definition-v1",
        subject: "setup-subject",
      },
      "setup-proof",
      "2026-08-23T00:00:00.000Z",
    );
    assert(declared.ok);
    const result = await readOnlySetupRefusal(dir);
    assertEquals(result.error, "precondition_failed");
    assertStringIncludes(String(result.message), "declarations changed");
  });
});

Deno.test("setup accept refuses an unproved forced completion and a proved branch without the completion marker", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    await git(dir, "checkout", "-b", "discern-setup");
    const forced = await runAgent(dir, [
      "setup",
      "done",
      "--force",
      "--json",
    ]);
    assertEquals(forced.code, 0, forced.output);
    const forcedResult = JSON.parse(forced.stdout);
    assertEquals(forcedResult.data.gate_proven, false);
    assertEquals(forcedResult.data.proof, undefined);
    assertEquals(forcedResult.data.proof_line, undefined);
    const refused = await readOnlySetupRefusal(dir);
    assertEquals(refused.error, "precondition_failed");
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    await git(dir, "checkout", "-b", "discern-setup");
    await Deno.writeTextFile(join(dir, "setup-work.txt"), "harness\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
    const done = await runAgent(dir, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(JSON.parse(done.stdout).data.gate_proof.status, "recorded");
    const refused = await readOnlySetupRefusal(dir);
    assertEquals(refused.error, "precondition_failed");
    assertStringIncludes(
      String(refused.message),
      "does not record [meta].bootstrapped = true",
    );
  });
});

Deno.test("setup accept refuses untracked scratch because current Proof requires a fully clean tree", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir);
    await Deno.writeTextFile(join(dir, "scratch.tmp"), "noise\n"); // untracked

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "dirty_worktree");
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
  });
});

Deno.test("setup accept is a clean no-op when already on the integration branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir); // stays on `main`

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 0, res.output);
    const obj = JSON.parse(res.stdout);
    assertEquals(obj.ok, true);
    assert(obj.data === undefined, "a no-op carries no landing data");
  });
});

Deno.test("setup accept refuses to land a branch that is not the setup branch", async () => {
  // `setup accept` fast-forwards (or merges) the CURRENT branch onto the
  // integration branch — run from an ordinary feature branch it would sweep
  // that branch's own commits onto `main` with no review. It must only land
  // the `discern-setup` branch; any other branch is merged by hand.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir); // commits the scaffold on `main`
    await git(dir, "checkout", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");
    const mainBefore = await gitOut(dir, "rev-parse", "main");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "not_setup_branch");

    // main untouched, still on the feature branch, its commits intact.
    assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "feature-x");
  });
});

Deno.test("setup done steers a non-setup branch to a manual merge, never `setup accept`", async () => {
  // An --allow-dirty setup lives in place on the user's own branch. `setup
  // done` must not recommend `discern setup accept` there — the command lands
  // whatever branch it is run from, and this one carries the user's own
  // commits. Every recommendation surface (the JSON hints, the relay
  // instructions, the landing data) derives from the one landingSummary field,
  // so this drives the full envelope.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits on `main`
    // A remote default branch so detection stamps `main` even from feature-x.
    const sha = await gitOut(dir, "rev-parse", "main");
    await git(dir, "update-ref", "refs/remotes/origin/main", sha);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    await git(dir, "checkout", "-q", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");

    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--allow-dirty",
      "--agents",
      "claude_code",
      "--json",
    ]);
    assertEquals(begin.code, 0, begin.output);

    await Deno.remove(defaultMapPath(dir), { recursive: true });
    await Deno.mkdir(defaultMapPath(dir));
    await Deno.writeTextFile(defaultMapPath(dir, "README.md"), "# Real Map\n");
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"));
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "design-principles.md"),
      "# Design principles\n\n## 1. First\n\nA.\n\n" +
        "## 2. Second\n\nB.\n\n## 3. Third\n\nC.\n",
    );
    await Deno.mkdir(defaultMapPath(dir, "10-runtime"));
    await Deno.writeTextFile(
      defaultMapPath(dir, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin at `main.ts`.\n\n" +
        "## Boundary\n\nThe runtime owns execution.\n\n" +
        "## Non-obvious invariant\n\nPreserve the process exit status.\n",
    );
    await Deno.writeTextFile(
      join(dir, "discern/instructions.md"),
      "# Project instructions\n\nA real project pitch.\n\n## Conventions\n\nReal conventions.\n",
    );
    const wired = await runAgent(dir, ["config", "set-job", "test", "true"]);
    assertEquals(wired.code, 0, wired.output);
    const refreshed = await runAgent(dir, ["refresh"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const obj = JSON.parse(done.stdout);
    assertEquals(obj.data.landing.branch, "feature-x");
    assertEquals(obj.data.landing.on_setup_branch, false);
    assertEquals(obj.data.reactivation, undefined);
    assertEquals(obj.data.optional_improvement, undefined);
    assert(
      !obj.hints.some((hint: string) =>
        hint.includes("restart") || hint.includes("improvement")
      ),
    );
    assertLacksHint(obj, HINTS["setup-done-land-dedicated"], {
      branch: "feature-x",
      target: "main",
      acceptCommand: ACCEPT_COMMAND_REF,
    });
    assertHasHint(obj, HINTS["setup-done-land-manually"], {
      branch: "feature-x",
      target: "main",
      acceptCommand: ACCEPT_COMMAND_REF,
      setupBranch: "discern-setup",
    });
    assertStringIncludes(
      obj.data.instructions,
      "usual Git workflow",
      "the relay message steers to a manual merge for a non-setup branch",
    );
    assert(
      !obj.data.instructions.includes(
        "landing it now with `discern setup accept`",
      ),
      `the relay message must not recommend setup accept here:\n${obj.data.instructions}`,
    );
  });
});

Deno.test("setup accept refuses when the integration branch does not exist", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Init on a non-default branch so `main` is absent.
    await git(dir, "init", "-q", "-b", "trunk");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    await git(dir, "config", "commit.gpgsign", "false");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "init", "--no-gpg-sign");
    await git(dir, "checkout", "-b", "discern-setup");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "no_target");
  });
});

Deno.test("setup accept conflicting changes are refused and stepped aside, leaving the branch intact", async () => {
  await withTempDir(async (dir) => {
    await setupBranchRepo(dir); // discern-setup edits setup-work.txt's successor below
    // Make BOTH branches change the same file divergently → a merge conflict.
    await git(dir, "checkout", "discern-setup");
    await Deno.writeTextFile(join(dir, "contested.txt"), "from setup\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "setup edits contested",
      "--no-gpg-sign",
    );
    const proved = await runAgent(dir, ["done", "--json"]);
    assertEquals(proved.code, 0, proved.output);
    await git(dir, "checkout", "main");
    await Deno.writeTextFile(join(dir, "contested.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "main edits contested",
      "--no-gpg-sign",
    );
    await git(dir, "checkout", "discern-setup");

    const res = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(res.code, 1, res.output);
    assertEquals(JSON.parse(res.stdout).error, "conflict");
    // The conflict was aborted: back on the setup branch, branch intact, tree clean.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "discern-setup",
    );
    assert(!(await branchGone(dir, "discern-setup")));
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
  });
});

/** True when `path` exists. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
