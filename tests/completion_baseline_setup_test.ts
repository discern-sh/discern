/** Completion rollback retains unrelated work and reports exact Git failures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  commitCompletionMarker,
  gitFailureLine,
  markerCommitFailureDetail,
  restorePendingCompletionMarker,
} from "../src/commands/setup_completion_git.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
  rollbackDiscernOwnedCommit,
} from "../src/shared/discern_commit.ts";
import { git, gitInit, gitOut, writeExecutable } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("completion commit reports missing Git and selects the last actionable failure", async () => {
  assertEquals(
    gitFailureLine("\n note\nerror: first\nfatal: last\n"),
    "fatal: last",
  );
  assertEquals(gitFailureLine(" \n explanation\n later"), "explanation");
  assertEquals(gitFailureLine(" \n"), "git did not report a cause");
  await withTempDir(async (root) => {
    const result = await commitCompletionMarker(
      root,
      join(root, "discern.toml"),
      "proven",
      undefined,
      false,
    );
    assertEquals(result, { state: "no-git" });
    assertStringIncludes(
      markerCommitFailureDetail(result),
      "initialize the repository",
    );
    assertStringIncludes(
      markerCommitFailureDetail({ state: "skipped" }),
      "refused to commit",
    );
    assertStringIncludes(
      markerCommitFailureDetail({ state: "failed", detail: "index locked" }),
      "index locked",
    );
  });
});

Deno.test("pending completion restoration preserves intervening work and diagnoses a locked index", async () => {
  await withTempDir(async (root) => {
    const config = join(root, "discern.toml");
    const original = "[meta]\nbootstrapped = false\n";
    const pending =
      '[meta]\nbootstrapped = true\nsetup_completion = "proven"\n';
    await Deno.writeTextFile(config, original);
    await gitInit(root);
    const predecessor = await gitOut(root, "rev-parse", "HEAD");
    await Deno.writeTextFile(config, pending);
    await Deno.writeTextFile(join(root, "owner.txt"), "owner bytes\n");
    const unrelated = await restorePendingCompletionMarker(
      root,
      config,
      original,
      predecessor,
    );
    assertEquals(unrelated.state, "retained");
    assertEquals(await Deno.readTextFile(config), pending);
    assertEquals(
      await Deno.readTextFile(join(root, "owner.txt")),
      "owner bytes\n",
    );
    await Deno.remove(join(root, "owner.txt"));
    await git(root, "add", "discern.toml");
    const lock = join(root, ".git", "index.lock");
    await Deno.writeTextFile(lock, "held\n");
    const locked = await restorePendingCompletionMarker(
      root,
      config,
      original,
      predecessor,
    );
    assert(locked.state === "retained");
    assertStringIncludes(locked.detail, "could not restore its index");
    assertEquals(await Deno.readTextFile(config), original);
    await Deno.remove(lock);
    assertEquals(
      await restorePendingCompletionMarker(root, config, original, predecessor),
      { state: "not_needed" },
    );
    await git(root, "commit", "--allow-empty", "-m", "Owner moved the branch");
    await Deno.writeTextFile(config, pending);
    const moved = await restorePendingCompletionMarker(
      root,
      config,
      original,
      predecessor,
    );
    assert(moved.state === "retained");
    assertStringIncludes(moved.detail, "HEAD moved");
    assertEquals(await Deno.readTextFile(config), pending);
  });
});

Deno.test("completion commit refuses index contention and hook failures without inventing ownership", async () => {
  await withTempDir(async (root) => {
    const config = join(root, "discern.toml");
    await Deno.writeTextFile(config, "[meta]\nbootstrapped = false\n");
    await gitInit(root);
    const before = await gitOut(root, "rev-parse", "HEAD");
    await Deno.writeTextFile(
      config,
      '[meta]\nbootstrapped = true\nsetup_completion = "proven"\n',
    );
    const lock = join(root, ".git", "index.lock");
    await Deno.writeTextFile(lock, "held\n");
    const locked = await commitCompletionMarker(
      root,
      config,
      "proven",
      undefined,
      false,
    );
    assert(locked.state === "failed");
    assertStringIncludes(locked.detail, "index.lock");
    await Deno.remove(lock);
    await writeExecutable(
      join(root, ".git/hooks/pre-commit"),
      "#!/bin/sh\necho 'error: owner hook declined' >&2\nexit 1\n",
    );
    const declined = await commitCompletionMarker(
      root,
      config,
      "proven",
      undefined,
      false,
    );
    assert(declined.state === "failed");
    assertStringIncludes(declined.detail, "owner hook declined");
    assertEquals(await gitOut(root, "rev-parse", "HEAD"), before);
  });
});

Deno.test("owned rollback preserves dirty bytes and a checkout on another branch", async () => {
  await withTempDir(async (root) => {
    const path = join(root, "owned.txt");
    await Deno.writeTextFile(path, "base\n");
    await gitInit(root);
    await Deno.writeTextFile(path, "owned\n");
    const authored = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
      values: undefined,
      cwd: root,
      pathspecs: ["owned.txt"],
    });
    assert(authored.owned !== undefined, authored.stderr);
    await Deno.writeTextFile(path, "later edit\n");
    const dirty = await rollbackDiscernOwnedCommit(authored.owned);
    assert(dirty.kind === "retained");
    assertStringIncludes(dirty.detail, "checkout changed");
    assertEquals(await Deno.readTextFile(path), "later edit\n");
    await git(root, "switch", "-c", "owner-follow-up");
    const switched = await rollbackDiscernOwnedCommit(authored.owned);
    assert(switched.kind === "retained");
    assertStringIncludes(switched.detail, "no longer on");
    assertEquals(await gitOut(root, "rev-parse", "HEAD"), authored.owned.head);
  });
});

Deno.test("authored commits refuse empty and duplicate scopes before changing Git state", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "scope.txt"), "base\n");
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    await Deno.writeTextFile(join(root, "scope.txt"), "owner edit\n");
    const status = await gitOut(root, "status", "--porcelain");
    for (
      const [pathspecs, diagnostic] of [[[], "no pathspecs"], [[
        "scope.txt",
        "scope.txt",
      ], "duplicate declared paths"]] as const
    ) {
      const result = await commitDiscernChanges({
        site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
        values: undefined,
        cwd: root,
        pathspecs: [...pathspecs],
      });
      assertEquals(result.success, false);
      assertEquals(result.owned, undefined);
      assertStringIncludes(result.stderr, diagnostic);
      assertEquals(await gitOut(root, "rev-parse", "HEAD"), head);
      assertEquals(await gitOut(root, "status", "--porcelain"), status);
    }
  });
});
