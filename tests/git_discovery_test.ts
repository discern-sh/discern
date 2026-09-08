/**
 * Operation-scoped Git discovery: one batched query per checkout inside an
 * operation, exact replay of git's own output, and a fresh administration
 * observation at every boundary — a closed scope, a removed checkout, newly
 * held exclusion, or a topology-changing git command. Answers derived from
 * the administration directories survive a boundary only when the fresh
 * observation is byte-identical to the retained one.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  discoverGit,
  discoverGitDirs,
  type GitDiscoveryQuery,
  type GitDiscoveryResult,
  type GitDiscoveryRunner,
  invalidateGitDiscovery,
  withGitDiscoveryScope,
  withinGitDiscoveryScope,
} from "../src/shared/git_discovery.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  withCompletionPublication,
  withOperationLock,
} from "../src/engine/operation_lock.ts";
import { countedAdminQueries } from "./git_admin_observer.ts";
import { addWorktree, git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./temp_dir.ts";

const DIR_KINDS = [
  "absolute-git-dir",
  "common-dir",
  "toplevel",
  "prefix",
] as const;

const SINGLE_ARGS: Record<(typeof DIR_KINDS)[number], string[]> = {
  "absolute-git-dir": ["rev-parse", "--absolute-git-dir"],
  "common-dir": ["rev-parse", "--git-common-dir"],
  toplevel: ["rev-parse", "--show-toplevel"],
  prefix: ["rev-parse", "--show-prefix"],
};

/** A runner that records every argv it forwards to git. */
function recording(): { calls: string[][]; run: GitDiscoveryRunner } {
  const calls: string[][] = [];
  return {
    calls,
    run: async (cwd, args) => {
      calls.push(args);
      return await runGit(args, { cwd });
    },
  };
}

/** Count every git process the engine constructs during `operation`. */
async function countedGitSpawns<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly spawns: number }> {
  const Command = Deno.Command;
  let spawns = 0;
  Deno.Command = class extends Command {
    /** Count the spawn while retaining the native command. */
    constructor(command: string | URL, options?: Deno.CommandOptions) {
      super(command, options);
      spawns += 1;
    }
  };
  try {
    return { value: await operation(), spawns };
  } finally {
    Deno.Command = Command;
  }
}

/** A committed repository with one seed file. */
async function seededRepository(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
}

Deno.test("discovery outside an operation runs each query fresh with its single argv", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const { calls, run } = recording();
    for (const kind of DIR_KINDS) {
      const fresh = await runGit(SINGLE_ARGS[kind], { cwd: dir });
      assertEquals(
        (await discoverGit(dir, { kind }, run)).stdout,
        fresh.stdout,
        kind,
      );
      assertEquals(
        (await discoverGit(dir, { kind }, run)).stdout,
        fresh.stdout,
      );
    }
    assertEquals(
      calls,
      DIR_KINDS.flatMap((kind) => [
        SINGLE_ARGS[kind],
        SINGLE_ARGS[kind],
      ]),
    );
  });
});

for (const layout of ["main checkout", "subdirectory", "linked worktree"]) {
  Deno.test(`inside an operation a ${layout} shares two batched queries and replays git exactly`, async () => {
    await withTempDir(async (dir) => {
      await seededRepository(dir);
      let cwd = dir;
      if (layout === "subdirectory") {
        cwd = join(dir, "nested");
        await Deno.mkdir(cwd);
      } else if (layout === "linked worktree") {
        cwd = await addWorktree(dir, "discovery");
      }
      const expected: Record<string, string> = {};
      for (const kind of DIR_KINDS) {
        expected[kind] = (await runGit(SINGLE_ARGS[kind], { cwd })).stdout;
      }
      const { calls, run } = recording();
      await withGitDiscoveryScope(async () => {
        for (const pass of [1, 2]) {
          for (const kind of DIR_KINDS) {
            assertEquals(
              (await discoverGit(cwd, { kind }, run)).stdout,
              expected[kind],
              `${kind} on pass ${pass}`,
            );
          }
        }
        assertEquals(await discoverGitDirs(cwd, run), {
          absoluteGitDir: expected["absolute-git-dir"]?.slice(0, -1),
          commonGitDir: expected["common-dir"]?.slice(0, -1),
        });
      });
      assertEquals(calls, [
        ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
        ["rev-parse", "--show-toplevel", "--show-prefix"],
      ]);
    });
  });
}

Deno.test("nested discovery consumers reuse only a live operation and retain boundary invalidation", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const { calls, run } = recording();
    const query = (): Promise<GitDiscoveryResult> =>
      discoverGit(dir, { kind: "common-dir" }, run);
    await withGitDiscoveryScope(async () => {
      await query();
      await withinGitDiscoveryScope(query);
      assertEquals(calls.length, 1);
      invalidateGitDiscovery();
      await withinGitDiscoveryScope(query);
      assertEquals(calls.length, 2);
    });
    await withinGitDiscoveryScope(query);
    await withinGitDiscoveryScope(query);
    assertEquals(
      calls.length,
      4,
      "standalone callers cannot replay a closed operation",
    );
  });
});

Deno.test("registered administrative paths and pinned objects replay after one query", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const fresh = await gitAdminStatePath(dir, "gateProof");
    assert(fresh !== undefined);
    const scoped = await withGitDiscoveryScope(() =>
      countedGitSpawns(async () => {
        const paths = [];
        for (let i = 0; i < 3; i += 1) {
          paths.push(await gitAdminStatePath(dir, "gateProof"));
        }
        return paths;
      })
    );
    assertEquals(scoped.value, [fresh, fresh, fresh]);
    assertEquals(
      scoped.spawns,
      2,
      "one batched directory query, then one exact path query",
    );
    const unscoped = await countedGitSpawns(async () => {
      for (let i = 0; i < 3; i += 1) await gitAdminStatePath(dir, "gateProof");
    });
    assertEquals(unscoped.spawns, 3);

    const head = (await runGit(["rev-parse", "HEAD"], { cwd: dir })).stdout
      .trim();
    const pinned: GitDiscoveryQuery = {
      kind: "object",
      spec: `${head}:./seed.txt`,
    };
    const mutable: GitDiscoveryQuery = {
      kind: "object",
      spec: "HEAD:./seed.txt",
    };
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      assertEquals((await discoverGit(dir, pinned, run)).stdout, "seed\n");
      assertEquals((await discoverGit(dir, pinned, run)).stdout, "seed\n");
      assertEquals((await discoverGit(dir, mutable, run)).stdout, "seed\n");
      assertEquals((await discoverGit(dir, mutable, run)).stdout, "seed\n");
    });
    assertEquals(calls, [
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["show", `${head}:./seed.txt`],
      ["show", "HEAD:./seed.txt"],
      ["show", "HEAD:./seed.txt"],
    ]);
  });
});

Deno.test("publication reuse verifies checkout routing and falls back for changed or uncertain paths", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const linked = await Deno.realPath(
      await addWorktree(dir, "routing-witness"),
    );
    const pointer = join(linked, ".git");
    const originalPointer = await Deno.readTextFile(pointer);
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      const original = await discoverGit(
        linked,
        { kind: "absolute-git-dir" },
        run,
      );
      const publication = async (): Promise<GitDiscoveryResult> => {
        invalidateGitDiscovery("publication");
        return await discoverGit(linked, { kind: "absolute-git-dir" }, run);
      };
      assertEquals((await publication()).stdout, original.stdout);
      const observed = calls.length;
      await Deno.writeTextFile(
        join(dir, ".git", "receipt"),
        "ordinary publication\n",
      );
      assertEquals((await publication()).stdout, original.stdout);
      assertEquals(
        calls.length,
        observed,
        "unchanged routing needs no Git process",
      );

      try {
        await Deno.writeTextFile(pointer, `gitdir: ${join(dir, ".git")}\n`);
        const moved = await publication();
        assert(
          moved.stdout !== original.stdout,
          "changed routing must not replay the old directory",
        );
        assertEquals(calls.length, observed + 1);
      } finally {
        await Deno.writeTextFile(pointer, originalPointer);
      }
      assertEquals((await publication()).stdout, original.stdout);
      const admin = original.stdout.trim();
      const commonPointer = join(admin, "commondir");
      const originalCommon = await Deno.readTextFile(commonPointer);
      // The same destination with changed routing bytes still requires Git.
      await Deno.writeTextFile(commonPointer, join(dir, ".git") + "\n");
      const beforeCommon = calls.length;
      invalidateGitDiscovery("publication");
      const interrupted = await discoverGit(linked, {
        kind: "absolute-git-dir",
      }, async (cwd, args) => {
        const result = await run(cwd, args);
        invalidateGitDiscovery();
        return result;
      });
      assertEquals(interrupted.stdout, original.stdout);
      assertEquals(calls.length, beforeCommon + 1);
      assertEquals((await publication()).stdout, original.stdout);
      assertEquals(
        calls.length,
        beforeCommon + 2,
        "an in-flight observation cannot erase a later topology invalidation",
      );
      await Deno.writeTextFile(commonPointer, originalCommon);

      const alias = join(dir, "routing-alias");
      await Deno.symlink(linked, alias);
      const beforeAlias = calls.length;
      for (let pass = 0; pass < 2; pass += 1) {
        invalidateGitDiscovery("publication");
        assertEquals(
          (await discoverGit(alias, { kind: "absolute-git-dir" }, run)).stdout,
          original.stdout,
        );
      }
      assertEquals(
        calls.length,
        beforeAlias + 2,
        "symlink routing cannot authorize the optimization",
      );
    });
  });
});

Deno.test("failed discovery is never retained", async () => {
  await withTempDir(async (dir) => {
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      for (const pass of [1, 2]) {
        const result = await discoverGit(dir, { kind: "common-dir" }, run);
        assertEquals(result.success, false, `pass ${pass}`);
      }
    });
    assertEquals(calls, [
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--git-common-dir"],
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--git-common-dir"],
    ]);
  });
});

Deno.test("a removed checkout or administration directory bypasses retained answers", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const removedPath = await addWorktree(dir, "removed-path");
    const removedAdmin = await addWorktree(dir, "removed-admin");
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      const pathAnswer = await discoverGit(
        removedPath,
        { kind: "common-dir" },
        run,
      );
      const adminAnswer = await discoverGit(
        removedAdmin,
        { kind: "absolute-git-dir" },
        run,
      );
      assert(pathAnswer.success && adminAnswer.success);
      calls.length = 0;
      // The test harness removes both outside the engine's git funnel.
      await Deno.remove(removedPath, { recursive: true });
      await Deno.remove(adminAnswer.stdout.trim(), { recursive: true });
      const afterPath = await discoverGit(
        removedPath,
        { kind: "common-dir" },
        run,
      );
      const afterAdmin = await discoverGit(
        removedAdmin,
        { kind: "absolute-git-dir" },
        run,
      );
      assertEquals(
        afterPath.success,
        false,
        "a missing checkout has no answer",
      );
      assertEquals(
        afterAdmin.success,
        false,
        "a checkout whose administration vanished has no answer",
      );
    });
    assertEquals(calls, [
      ["rev-parse", "--git-common-dir"],
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--absolute-git-dir"],
    ]);
  });
});

Deno.test("topology-changing git commands invalidate through the shared funnel", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      await discoverGit(dir, { kind: "common-dir" }, run);
      await runGit(["status", "--porcelain"], { cwd: dir });
      await discoverGit(dir, { kind: "common-dir" }, run);
      assertEquals(calls.length, 1, "status changes no topology");
      await runGit(["worktree", "list", "--porcelain"], { cwd: dir });
      await discoverGit(dir, { kind: "common-dir" }, run);
      assertEquals(calls.length, 1, "listing worktrees changes no topology");
      await runGit(["worktree", "prune"], { cwd: dir });
      await discoverGit(dir, { kind: "common-dir" }, run);
      assertEquals(calls.length, 2, "a topology mutation observes again");
    });
  });
});

Deno.test("invalidation reaches enclosing scopes and a finished scope retains nothing", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const { calls, run } = recording();
    let later: (() => Promise<GitDiscoveryResult>) | undefined;
    await withGitDiscoveryScope(async () => {
      await discoverGit(dir, { kind: "common-dir" }, run);
      await withGitDiscoveryScope(async () => {
        await discoverGit(dir, { kind: "common-dir" }, run);
        assertEquals(calls.length, 2, "a nested operation observes for itself");
        invalidateGitDiscovery();
      });
      await discoverGit(dir, { kind: "common-dir" }, run);
      assertEquals(calls.length, 3, "the enclosing scope observed again too");
      later = () => discoverGit(dir, { kind: "common-dir" }, run);
    });
    assert(later !== undefined);
    await later();
    assertEquals(calls.at(-1), ["rev-parse", "--git-common-dir"]);
  });
});

Deno.test("an unchanged checkout re-observes once and keeps its derived answers", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const head = (await runGit(["rev-parse", "HEAD"], { cwd: dir })).stdout
      .trim();
    const pinned: GitDiscoveryQuery = {
      kind: "object",
      spec: `${head}:./seed.txt`,
    };
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      const toplevel = await discoverGit(dir, { kind: "toplevel" }, run);
      const object = await discoverGit(dir, pinned, run);
      invalidateGitDiscovery();
      assertEquals(
        (await discoverGit(dir, { kind: "toplevel" }, run)).stdout,
        toplevel.stdout,
      );
      assertEquals(
        (await discoverGit(dir, pinned, run)).stdout,
        object.stdout,
      );
    });
    assertEquals(calls, [
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--show-toplevel", "--show-prefix"],
      ["show", `${head}:./seed.txt`],
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
    ], "one re-observation, and every unchanged derived answer replays");
  });
});

Deno.test("a changed administration observation discards every derived answer", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    const linked = await addWorktree(dir, "replaced");
    const { calls, run } = recording();
    await withGitDiscoveryScope(async () => {
      const before = await discoverGit(
        linked,
        { kind: "absolute-git-dir" },
        run,
      );
      await discoverGit(linked, { kind: "prefix" }, run);
      // Replace the worktree with an independent repository at the same path.
      await runGit(["worktree", "remove", "--force", linked], { cwd: dir });
      await Deno.mkdir(linked);
      await seededRepository(linked);
      const after = await discoverGit(
        linked,
        { kind: "absolute-git-dir" },
        run,
      );
      assert(
        after.success && after.stdout !== before.stdout,
        "an independent repository administers itself",
      );
      await discoverGit(linked, { kind: "prefix" }, run);
    });
    assertEquals(calls, [
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--show-toplevel", "--show-prefix"],
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      ["rev-parse", "--show-toplevel", "--show-prefix"],
    ], "a changed observation re-runs the derived queries");
  });
});

Deno.test("an operation shares discovery until exclusion is newly held", async () => {
  await withTempDir(async (dir) => {
    await seededRepository(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[project]\nslug = 'discovery-fixture'\n",
    );
    const unscoped = await countedAdminQueries(async () => {
      await gitAdminStatePath(dir, "resources");
      await gitAdminStatePath(dir, "resources");
    });
    assertEquals(unscoped.queries, 2);
    const observed = await countedAdminQueries(() =>
      withOperationLock(dir, { command: "status" }, async () => {
        await gitAdminStatePath(dir, "resources");
        await gitAdminStatePath(dir, "resources");
      })
    );
    assertEquals(observed.queries, 1, "one observation serves the operation");
    const published = await withGitDiscoveryScope(async () => {
      await gitAdminStatePath(dir, "resources");
      return await countedAdminQueries(() =>
        withCompletionPublication(dir, async () => {
          await gitAdminStatePath(dir, "resources");
          await gitAdminStatePath(dir, "resources");
        })
      );
    });
    assertEquals(
      published.queries,
      1,
      "newly held exclusion observes once more, then shares",
    );
    await git(dir, "status");
  });
});
