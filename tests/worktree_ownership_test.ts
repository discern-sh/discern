/** Canonical positive-ownership predicate for automatic branch cleanup. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  branchWithoutOwnershipReason,
  classifyAutomaticBranchOwnership,
} from "../src/engine/worktree/ownership.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const WORKTREE_RUNTIME_FILES = await structuralGuardScope({
  guard: "tests/worktree_ownership_test.ts#worktree-runtime-ownership",
  universe: "authored-ts",
  narrow: {
    reason:
      "Automatic branch ownership and worktree cleanup are production contracts implemented beneath src.",
    include: (path) => path.startsWith("src/"),
  },
});

const SETTINGS = { slug: "project", branchPrefix: "agent/" } as const;

Deno.test("automatic worktree ownership requires the exact configured branch derived from identity", () => {
  assertEquals(
    classifyAutomaticBranchOwnership({
      kind: "worktree",
      branch: "agent/task-123",
      id: "task-123",
      settings: SETTINGS,
      source: "registered",
    }).owned,
    true,
  );

  for (
    const branch of [
      "main-pre-discern",
      "agentish/task-123",
      "agent/manual-prefix-only",
      "discern-setup",
      "",
    ]
  ) {
    const decision = classifyAutomaticBranchOwnership({
      kind: "worktree",
      branch,
      id: "task-123",
      settings: SETTINGS,
      source: "registered",
    });
    assert(!decision.owned, `${branch || "(detached)"} must not be owned`);
  }

  const custom = { slug: "project", branchPrefix: "task/" } as const;
  assertEquals(
    classifyAutomaticBranchOwnership({
      kind: "worktree",
      branch: "task/task-123",
      id: "task-123",
      settings: custom,
      source: "registered",
    }).owned,
    true,
  );
  assertEquals(
    classifyAutomaticBranchOwnership({
      kind: "worktree",
      branch: "agent/task-123",
      id: "task-123",
      settings: custom,
      source: "registered",
    }).owned,
    false,
  );
});

Deno.test("the dedicated setup branch belongs only to setup's lifecycle", () => {
  assertEquals(
    classifyAutomaticBranchOwnership({
      kind: "setup",
      branch: "discern-setup",
    }).owned,
    true,
  );
  assertEquals(
    classifyAutomaticBranchOwnership({
      kind: "setup",
      branch: "agent/task-123",
    }).owned,
    false,
  );
});

Deno.test("merged refs without identity evidence remain observation, never ownership", () => {
  assertStringIncludes(
    branchWithoutOwnershipReason("agent/old", SETTINGS),
    "without worktree identity evidence",
  );
  assertStringIncludes(
    branchWithoutOwnershipReason("main-pre-discern", SETTINGS),
    "outside discern branch ownership",
  );
  assertStringIncludes(
    branchWithoutOwnershipReason("discern-setup", SETTINGS),
    "setup lifecycle only",
  );
});

/** Count production calls to one destructive lifecycle chokepoint. */
async function productionCallers(
  symbol: string,
  declarationFile: string,
): Promise<Record<string, number>> {
  const callers: Record<string, number> = {};
  const call = new RegExp(`\\b${symbol}\\s*\\(`, "gu");
  for (
    const rel of WORKTREE_RUNTIME_FILES
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    let count = [...source.matchAll(call)].length;
    if (rel === declarationFile) count--;
    if (count > 0) callers[rel] = count;
  }
  return callers;
}

Deno.test("automatic branch deletion and worktree removal stay enrolled in their canonical primitives", async () => {
  assertEquals(
    await productionCallers(
      "deleteAutomaticallyOwnedBranch",
      "src/engine/worktree/ownership.ts",
    ),
    {
      "src/commands/setup_accept.ts": 1,
      "src/engine/worktree/git.ts": 1,
      "src/engine/worktree/lifecycle.ts": 3,
    },
    "a new automatic branch-deletion caller must enroll through the ownership primitive and this registry",
  );
  assertEquals(
    await productionCallers(
      "removeWorktreeSafely",
      "src/engine/worktree/git.ts",
    ),
    {
      "src/engine/worktree/git.ts": 2,
      "src/engine/worktree/lifecycle.ts": 4,
      "src/engine/worktree/park.ts": 1,
    },
    "a new worktree-removal caller must enroll through the absence-verifying primitive and this registry",
  );

  const rawBranchDeletion: string[] = [];
  const rawRefDeletion: string[] = [];
  for (
    const rel of WORKTREE_RUNTIME_FILES
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\[\s*["']branch["']\s*,\s*["']-(?:d|D)["']/u.test(source)) {
      rawBranchDeletion.push(rel);
    }
    if (/\[\s*["']update-ref["'][\s\S]{0,240}?["']-d["']/u.test(source)) {
      rawRefDeletion.push(rel);
    }
  }
  assertEquals(
    rawBranchDeletion,
    [],
    "production code must not bypass positive ownership with raw git branch deletion",
  );
  assertEquals(
    rawRefDeletion,
    [
      "src/engine/worktree/ownership.ts",
      "src/shared/discern_commit.ts",
    ],
    "raw ref deletion belongs only to owned-branch CAS or exact failed-commit rollback",
  );
});
