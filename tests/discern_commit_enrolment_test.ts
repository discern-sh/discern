/** Runtime behavior of discern's attributed, pathspec-limited commit boundary. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
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
      const hook = join(dir, ".git", "hooks", "post-commit");
      await Deno.writeTextFile(
        hook,
        [
          "#!/bin/sh",
          '(sleep 0.15; mkdir -p "$PWD/hook-late") >/dev/null 2>&1 &',
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
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      const late = await Deno.lstat(join(dir, "hook-late")).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      });
      assertEquals(
        late,
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
