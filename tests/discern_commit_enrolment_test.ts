/** Runtime and structural enrollment of discern's authored-commit boundary. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
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
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const COMMIT_PRODUCTION_FILES = await structuralGuardScope({
  guard:
    "tests/discern_commit_enrolment_test.ts#discern-authored-commit-callers",
  universe: "authored-ts",
  narrow: {
    reason:
      "Discern-authored commits are production effects, so their caller and message construction boundary is src only.",
    include: (path) => path.startsWith("src/"),
  },
});

interface CommitCallSite {
  readonly path: string;
  readonly registryKey: string;
}

/** Find every production call through the imported commit capability. */
function discernCommitCallSites(
  path: string,
  source: string,
): CommitCallSite[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const parsed = project.createSourceFile(path, source, { overwrite: true });
  const localNames = new Set<string>();
  for (const declaration of parsed.getImportDeclarations()) {
    if (!declaration.getModuleSpecifierValue().endsWith("/discern_commit.ts")) {
      continue;
    }
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === "commitDiscernChanges") {
        localNames.add(named.getAliasNode()?.getText() ?? named.getName());
      }
    }
  }

  const sites: CommitCallSite[] = [];
  for (const call of parsed.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!localNames.has(call.getExpression().getText())) continue;
    const options = call.getArguments()[0];
    assert(
      options !== undefined && Node.isObjectLiteralExpression(options),
      `${path}: commitDiscernChanges must receive one inline typed options object`,
    );
    for (const forbidden of ["subject", "body"]) {
      assertEquals(
        options.getProperty(forbidden),
        undefined,
        `${path}: ${forbidden} must be selected only by DISCERN_AUTHORED_COMMIT_SITES`,
      );
    }
    const site = options.getProperty("site");
    assert(
      site !== undefined && Node.isPropertyAssignment(site),
      `${path}: commitDiscernChanges needs a static registry site`,
    );
    const match = /^DISCERN_AUTHORED_COMMIT_SITES\.([A-Za-z0-9_]+)$/u.exec(
      site.getInitializer()?.getText() ?? "",
    );
    assert(
      match?.[1] !== undefined,
      `${path}: commit site must be a direct DISCERN_AUTHORED_COMMIT_SITES member`,
    );
    sites.push({ path, registryKey: match[1] });
  }
  return sites;
}

Deno.test("every discern-authored commit site has one real typed caller and no ad hoc message", async () => {
  const calls: CommitCallSite[] = [];
  for (const path of COMMIT_PRODUCTION_FILES) {
    calls.push(
      ...discernCommitCallSites(
        path,
        await Deno.readTextFile(join(REPO_ROOT, path)),
      ),
    );
  }
  const definitions = Object.entries(DISCERN_AUTHORED_COMMIT_SITES);
  assertEquals(
    calls.map((call) => call.registryKey).sort(),
    definitions.map(([key]) => key).sort(),
    "registry entries and production commit call sites must remain one-to-one",
  );
  for (const [key, definition] of definitions) {
    assertEquals(
      calls.find((call) => call.registryKey === key)?.path,
      definition.callerModule,
      `${key} must be called only by its registered module`,
    );
  }
});

Deno.test("the commit-message registry renders the five settled subjects and exact attribution", () => {
  const messages = [
    discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.scaffoldWiring,
      values: undefined,
    }, fakeEnv()),
    discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
      values: undefined,
    }, fakeEnv()),
    discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.updateRegeneration,
      values: undefined,
    }, fakeEnv()),
    discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.standardsPin,
      values: {
        pins: [{
          name: "coverage",
          direction: "up",
          previousLimit: 80,
          newLimit: 85,
          measured: "87",
        }],
      },
    }, fakeEnv()),
    discernCommitMessage({
      site: DISCERN_AUTHORED_COMMIT_SITES.standardsLimitProposal,
      values: {
        standard: "bundle_size",
        direction: "down",
        trunkLimit: 100,
        proposedLimit: 90,
        measurement: 88,
        reason: "The smaller build is now repeatable.",
        evidencePaths: ["dist/app.js"],
      },
    }, fakeEnv()),
  ];
  assertEquals(
    messages.map((message) => message.split("\n", 1)[0]),
    [
      "Scaffold discern wiring",
      "Complete discern setup",
      "Regenerate artifacts after discern update",
      "Pin standard baseline: coverage 80 → 85",
      "Propose standard limit: bundle_size",
    ],
  );
  for (const message of messages) {
    assert(
      message.endsWith(`\n\n${DISCERN_MACHINE.trailer}`),
      `missing exact attribution trailer:\n${message}`,
    );
  }
});

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
  const attributed = discernCommitMessage({
    site: DISCERN_AUTHORED_COMMIT_SITES.updateRegeneration,
    values: undefined,
  }, fakeEnv());
  assertEquals(
    attributed,
    `Regenerate artifacts after discern update\n\nRe-derive declared artifacts from the merged sources so their committed bytes match the integrated tree.\n\n${DISCERN_MACHINE.trailer}`,
  );
  assertEquals(
    discernCommitMessage(
      {
        site: DISCERN_AUTHORED_COMMIT_SITES.updateRegeneration,
        values: undefined,
      },
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    ),
    "Regenerate artifacts after discern update\n\nRe-derive declared artifacts from the merged sources so their committed bytes match the integrated tree.",
  );
  assertEquals(
    discernCommitMessage(
      {
        site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
        values: undefined,
      },
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "" }),
    ),
    `Complete discern setup\n\n${DISCERN_MACHINE.trailer}`,
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
      values: undefined,
      cwd: dir,
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
        values: undefined,
        cwd: dir,
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
      values: undefined,
      cwd: dir,
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
      values: undefined,
      cwd: dir,
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
      values: undefined,
      cwd: dir,
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
      values: undefined,
      cwd: dir,
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
      values: undefined,
      cwd: dir,
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
