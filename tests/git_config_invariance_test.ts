/**
 * Ambient Git configuration must not change discern's safety predicates or
 * merge topology. The generic Git subprocess funnel supplies status defaults,
 * while one merge-argument authority clears per-branch merge options and pins
 * discern's intended fast-forward policy.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { isWorktreeFullyClean } from "../src/engine/gate/proof.ts";
import {
  configInvariantGitArgs,
  discernMergeArgs,
} from "../src/shared/subprocess.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Assert one argv contains a literal option. */
function hasArg(args: readonly string[], arg: string): void {
  assert(args.includes(arg), `${JSON.stringify(args)} should include ${arg}`);
}

Deno.test("every status invocation receives explicit visibility defaults at the Git funnel", () => {
  const cases = [
    ["status", "--porcelain", "-z"],
    ["-C", "/tmp/apollo-11", "status", "--short"],
  ];
  for (const input of cases) {
    const args = configInvariantGitArgs(input);
    hasArg(args, "--untracked-files=normal");
    hasArg(args, "--ignore-submodules=none");
  }

  const explicit = configInvariantGitArgs([
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--ignore-submodules=dirty",
  ]);
  hasArg(explicit, "--untracked-files=no");
  hasArg(explicit, "--ignore-submodules=dirty");
  assert(
    !explicit.includes("--untracked-files=normal"),
    "an explicit untracked policy must win",
  );
  assert(
    !explicit.includes("--ignore-submodules=none"),
    "an explicit submodule policy must win",
  );

  const optionShapedPath = configInvariantGitArgs([
    "status",
    "--porcelain",
    "--",
    "--untracked-files=no",
    "--ignore-submodules=dirty",
  ]);
  hasArg(optionShapedPath, "--untracked-files=normal");
  hasArg(optionShapedPath, "--ignore-submodules=none");
});

Deno.test("status.showUntrackedFiles cannot make the strict clean predicate miss work", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    await git(dir, "config", "status.showUntrackedFiles", "no");
    await Deno.writeTextFile(join(dir, "untracked-work.txt"), "work\n");

    assertEquals(
      await isWorktreeFullyClean(dir),
      false,
      "discern's strict predicate must override ambient status visibility",
    );
  });
});

Deno.test("discern merge arguments clear branch options and pin the requested topology", () => {
  assertEquals(
    discernMergeArgs("agent/margaret", "main"),
    [
      "-c",
      "branch.agent/margaret.mergeOptions=",
      "-c",
      "merge.ff=true",
      "merge",
      "--ff",
      "--commit",
      "--no-squash",
      "--no-edit",
      "main",
    ],
  );
  assertEquals(
    discernMergeArgs("main", "discern-setup", {
      ffOnly: true,
      quiet: true,
    }),
    [
      "-c",
      "branch.main.mergeOptions=",
      "-c",
      "merge.ff=true",
      "merge",
      "--ff-only",
      "--commit",
      "--no-squash",
      "--no-edit",
      "--quiet",
      "discern-setup",
    ],
  );
});

Deno.test("every production branch merge uses the config-invariant argument authority", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard:
        "tests/git_config_invariance_test.ts#production-branch-merge-arguments",
      universe: "authored-ts",
      narrow: {
        reason:
          "The config-invariant merge authority governs production Git invocations beneath src.",
        include: (path) => path.startsWith("src/"),
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const match of source.matchAll(/\[\s*"merge"\s*,/g)) {
      const start = match.index ?? 0;
      const invocation = source.slice(start, start + 80);
      if (!/^\[\s*"merge"\s*,\s*"--abort"/.test(invocation)) {
        offenders.push(`${rel}: ${invocation.split("\n")[0] ?? invocation}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "branch merges must use discernMergeArgs; only merge --abort is a raw cleanup invocation",
  );
});
