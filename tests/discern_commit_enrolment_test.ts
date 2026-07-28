/** Runtime behavior of discern's attributed, pathspec-limited commit boundary. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_BOT } from "../src/shared/brand.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
  discernCommitMessage,
} from "../src/shared/discern_commit.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import {
  GIT_ALIAS_BOUNDARY_ERROR,
  GIT_COMMIT_BOUNDARY_ERROR,
  runGit,
} from "../src/shared/subprocess.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";

Deno.test("the generic git runner refuses commit through aliases and wrappers", async () => {
  await withTempDir(async (cwd) => {
    const ferry = runGit;
    const wrapped = (args: string[]) => ferry(args, { cwd });
    const result = await wrapped([
      "-c",
      "user.name=Unrelated",
      "commit",
      "-m",
      "Bypass",
    ]);
    assertEquals(result.code, 2);
    assertEquals(result.success, false);
    assertEquals(result.stderr, GIT_COMMIT_BOUNDARY_ERROR);
  });
});

Deno.test("the generic git runner permits commit only as later data", async () => {
  await withTempDir(async (cwd) => {
    await Deno.mkdir(`${cwd}/commit`);
    const result = await runGit(
      [
        "-C",
        "commit",
        "check-ref-format",
        "--allow-onelevel",
        "commit",
      ],
      { cwd },
    );
    assertEquals(result.success, true);
    assertEquals(result.code, 0);
  });
});

Deno.test("git aliases cannot smuggle commit through the generic runner", async () => {
  await withTempDir(async (cwd) => {
    await Deno.writeTextFile(`${cwd}/seed.txt`, "seed\n");
    await gitInit(cwd);
    await git(cwd, "config", "alias.ship", "commit");
    const before = await gitOut(cwd, "rev-parse", "HEAD");

    const configured = await runGit(
      ["ship", "--allow-empty", "-m", "Bypass"],
      { cwd },
    );
    assertEquals(configured.success, false);
    assertEquals(await gitOut(cwd, "rev-parse", "HEAD"), before);

    const inline = await runGit(
      ["-c", "alias.ship=commit", "ship", "--allow-empty", "-m", "Bypass"],
      { cwd },
    );
    assertEquals(inline.success, false);
    assertEquals(inline.code, 2);
    assertEquals(inline.stderr, GIT_ALIAS_BOUNDARY_ERROR);
    assertEquals(await gitOut(cwd, "rev-parse", "HEAD"), before);
  });
});

Deno.test("discern commit messages use an injectable non-empty opt-out", () => {
  const attributed = discernCommitMessage("Subject", "Body", fakeEnv());
  assertEquals(
    attributed,
    `Subject\n\nBody\n\n${DISCERN_BOT.trailer}`,
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      "Body",
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    ),
    "Subject\n\nBody",
  );
  assertEquals(
    discernCommitMessage(
      "Subject",
      undefined,
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "" }),
    ),
    `Subject\n\n${DISCERN_BOT.trailer}`,
  );
});

Deno.test("the staged-index commit source consumes staged proof bytes, not later worktree bytes", async () => {
  await withTempDir(async (dir) => {
    const path = "proof.txt";
    await Deno.writeTextFile(join(dir, path), "base\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, path), "proven staged bytes\n");
    await git(dir, "add", "--", path);
    const stagedProof = {
      branch: await gitOut(dir, "branch", "--show-current"),
      head: await gitOut(dir, "rev-parse", "HEAD"),
      tree: await gitOut(dir, "write-tree"),
    };
    await Deno.writeTextFile(join(dir, path), "later worktree bytes\n");

    const commit = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.scaffoldWiring,
      cwd: dir,
      subject: "Record proven bytes",
      pathspecs: [path],
      source: "staged-index",
      stagedProof,
      env: fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    });

    assertEquals(commit.success, true, commit.stderr);
    assertEquals(
      await gitOut(dir, "show", `HEAD:${path}`),
      "proven staged bytes",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, path)),
      "later worktree bytes\n",
      "the staged commit must not restage current worktree bytes",
    );
  });
});

Deno.test("the staged-index commit source rolls back a hook-expanded tree without losing the hook's staged bytes", async () => {
  await withTempDir(async (dir) => {
    const proofPath = "proof.txt";
    const hookPath = "hook-staged-user.txt";
    await Deno.writeTextFile(join(dir, proofPath), "base\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, proofPath), "proven staged bytes\n");
    await git(dir, "add", "--", proofPath);
    const stagedProof = {
      branch: await gitOut(dir, "branch", "--show-current"),
      head: await gitOut(dir, "rev-parse", "HEAD"),
      tree: await gitOut(dir, "write-tree"),
    };
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await Deno.writeTextFile(
      hook,
      `#!/bin/sh\nprintf 'hook staged user bytes\\n' > ${hookPath}\ngit add -- ${hookPath}\n`,
    );
    await Deno.chmod(hook, 0o755);

    const commit = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.scaffoldWiring,
      cwd: dir,
      subject: "Record proven bytes",
      pathspecs: [proofPath],
      source: "staged-index",
      stagedProof,
    });

    assertEquals(commit.success, false);
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD"),
      stagedProof.head,
      "the out-of-scope commit must be removed from the branch",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain", "--", hookPath),
      `A  ${hookPath}`,
      "rollback must preserve the hook's staged index entry",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, hookPath)),
      "hook staged user bytes\n",
      "rollback must preserve the hook's worktree bytes",
    );
  });
});
