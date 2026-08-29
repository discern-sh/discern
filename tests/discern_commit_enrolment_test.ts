/** Runtime behavior of discern's attributed, pathspec-limited commit boundary. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
  discernCommitMessage,
  rollbackDiscernOwnedCommit,
} from "../src/shared/discern_commit.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import {
  GIT_ALIAS_BOUNDARY_ERROR,
  GIT_COMMIT_BOUNDARY_ERROR,
  runGit,
} from "../src/shared/subprocess.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { realDelay } from "./waiting.ts";

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
    `Subject\n\nBody\n\n${DISCERN_MACHINE.trailer}`,
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
    `Subject\n\n${DISCERN_MACHINE.trailer}`,
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

Deno.test({
  name: "the attributed commit boundary quiesces backgrounded hook descendants",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const path = "composed.txt";
      await Deno.writeTextFile(join(dir, path), "base\n");
      await gitInit(dir);
      await Deno.writeTextFile(join(dir, path), "committed\n");
      const ready = join(dir, "hook-ready");
      const release = join(dir, "commit-returned");
      const late = join(dir, "hook-late");
      const hook = join(dir, ".git", "hooks", "post-commit");
      await Deno.writeTextFile(
        hook,
        [
          "#!/bin/sh",
          '(touch "$PWD/hook-ready"; while [ ! -f "$PWD/commit-returned" ]; do sleep 0.01; done; mkdir -p "$PWD/hook-late") >/dev/null 2>&1 &',
          'while [ ! -f "$PWD/hook-ready" ]; do sleep 0.01; done',
          "",
        ].join("\n"),
      );
      await Deno.chmod(hook, 0o755);

      const commit = await commitDiscernChanges({
        site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
        cwd: dir,
        subject: "Record composed bytes",
        pathspecs: [path],
      });
      assertEquals(commit.success, true, commit.stderr);
      assertEquals(
        await lstatIfExists(ready) !== undefined,
        true,
        "the post-commit descendant did not reach its planted wait boundary",
      );
      await Deno.writeTextFile(release, "");
      await realDelay("commit-hook-quiescence-window", 350);
      assertEquals(
        await lstatIfExists(late),
        undefined,
        "the commit returned while its hook group could still write",
      );
    });
  },
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
      `#!/bin/sh
printf 'hook staged user bytes\\n' > ${hookPath}
git add -- ${hookPath}
printf 'later hook worktree bytes\\n' > ${hookPath}
`,
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
      `AM ${hookPath}`,
      "rollback must preserve the hook's staged index entry",
    );
    assertEquals(
      await gitOut(dir, "show", `:${hookPath}`),
      "hook staged user bytes",
      "rollback must preserve the exact blob the hook staged",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, hookPath)),
      "later hook worktree bytes\n",
      "rollback must preserve the hook's worktree bytes",
    );
  });
});

Deno.test("the worktree-pathspec commit source rejects a hook-expanded tree without losing the hook's bytes", async () => {
  await withTempDir(async (dir) => {
    const composedPath = "composed.txt";
    const hookPath = "hook-staged-user.txt";
    await Deno.writeTextFile(join(dir, composedPath), "base\n");
    await gitInit(dir);
    const originalHead = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeTextFile(join(dir, composedPath), "discern bytes\n");
    await git(dir, "add", "--", composedPath);
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await Deno.writeTextFile(
      hook,
      `#!/bin/sh
printf 'hook staged user bytes\\n' > ${hookPath}
git add -- ${hookPath}
printf 'later hook worktree bytes\\n' > ${hookPath}
`,
    );
    await Deno.chmod(hook, 0o755);

    const commit = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
      cwd: dir,
      subject: "Record composed bytes",
      pathspecs: [composedPath],
    });

    assertEquals(commit.success, false);
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD"),
      originalHead,
      "the hook-expanded commit must be removed from the branch",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain", "--", hookPath),
      `AM ${hookPath}`,
      "rejection must preserve the hook's staged index entry",
    );
    assertEquals(
      await gitOut(dir, "show", `:${hookPath}`),
      "hook staged user bytes",
      "rejection must preserve the exact blob the hook staged",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, hookPath)),
      "later hook worktree bytes\n",
      "rejection must not restage later hook worktree bytes",
    );
  });
});

Deno.test("the staged-index commit source never rolls back a post-commit later tip", async () => {
  await withTempDir(async (dir) => {
    const proofPath = "proof.txt";
    const laterPath = "later-tip-user.txt";
    const laterOidPath = "later-tip.oid";
    await Deno.writeTextFile(join(dir, proofPath), "base\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, proofPath), "proven staged bytes\n");
    await git(dir, "add", "--", proofPath);
    const stagedProof = {
      branch: await gitOut(dir, "branch", "--show-current"),
      head: await gitOut(dir, "rev-parse", "HEAD"),
      tree: await gitOut(dir, "write-tree"),
    };
    const hook = join(dir, ".git", "hooks", "post-commit");
    await Deno.writeTextFile(
      hook,
      `#!/bin/sh
printf 'later user bytes\\n' > ${laterPath}
git add -- ${laterPath}
parent=$(git rev-parse HEAD)
tree=$(git write-tree)
later=$(printf 'Later tip\\n' | git commit-tree "$tree" -p "$parent")
git update-ref HEAD "$later" "$parent"
printf '%s\\n' "$later" > ${laterOidPath}
`,
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

    const laterTip = (await Deno.readTextFile(join(dir, laterOidPath))).trim();
    const discernChild = await gitOut(dir, "rev-parse", `${laterTip}^`);
    assertEquals(commit.success, false);
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD"),
      laterTip,
      "a later tip must never be moved back with the discern commit",
    );
    assertEquals(
      await gitOut(dir, "rev-parse", `${discernChild}^`),
      stagedProof.head,
      "the hook's tip must remain beyond the direct child Git created",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain", "--", laterPath),
      "",
      "the later commit owns the hook's index and worktree bytes",
    );
  });
});

Deno.test("the staged-index commit source rejects a same-tree post-commit later tip", async () => {
  await withTempDir(async (dir) => {
    const proofPath = "proof.txt";
    const laterOidPath = "later-tip.oid";
    await Deno.writeTextFile(join(dir, proofPath), "base\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, proofPath), "proven staged bytes\n");
    await git(dir, "add", "--", proofPath);
    const stagedProof = {
      branch: await gitOut(dir, "branch", "--show-current"),
      head: await gitOut(dir, "rev-parse", "HEAD"),
      tree: await gitOut(dir, "write-tree"),
    };
    const hook = join(dir, ".git", "hooks", "post-commit");
    await Deno.writeTextFile(
      hook,
      `#!/bin/sh
parent=$(git rev-parse HEAD)
tree=$(git rev-parse "$parent^{tree}")
later=$(printf 'Same-tree later tip\\n' | git commit-tree "$tree" -p "$parent")
git update-ref HEAD "$later" "$parent"
printf '%s\\n' "$later" > ${laterOidPath}
`,
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

    const laterTip = (await Deno.readTextFile(join(dir, laterOidPath))).trim();
    assertEquals(commit.success, false);
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD"),
      laterTip,
      "tree equality must not make a later commit look like our direct child",
    );
  });
});

Deno.test("owned rollback cannot move a branch after an intervening user commit", async () => {
  await withTempDir(async (dir) => {
    const ownedPath = "discern-owned.txt";
    await Deno.writeTextFile(join(dir, ownedPath), "base\n");
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, ownedPath), "owned\n");
    const authored = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
      cwd: dir,
      subject: "Record owned bytes",
      pathspecs: [ownedPath],
      env: fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    });
    assertEquals(authored.success, true, authored.stderr);
    if (authored.owned === undefined) {
      throw new Error("successful discern commit did not return ownership");
    }

    const userPath = "user-follow-up.txt";
    await Deno.writeTextFile(join(dir, userPath), "later user work\n");
    await git(dir, "add", "--", userPath);
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Later user work",
      "--no-gpg-sign",
    );
    const head = await gitOut(dir, "rev-parse", "HEAD");
    const history = await gitOut(dir, "log", "--format=%H%x00%P%x00%s");

    const rollback = await rollbackDiscernOwnedCommit(authored.owned);
    assertEquals(rollback.kind, "retained");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), head);
    assertEquals(
      await gitOut(dir, "log", "--format=%H%x00%P%x00%s"),
      history,
    );
    assertEquals(
      await Deno.readTextFile(join(dir, userPath)),
      "later user work\n",
    );
  });
});
