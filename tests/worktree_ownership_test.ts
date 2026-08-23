/** Canonical positive-ownership predicate for automatic branch cleanup. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  branchWithoutOwnershipReason,
  classifyAutomaticBranchOwnership,
} from "../src/engine/worktree/ownership.ts";

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

  for (const branch of [
    "main-pre-discern",
    "agentish/task-123",
    "agent/manual-prefix-only",
    "discern-setup",
    "",
  ]) {
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
