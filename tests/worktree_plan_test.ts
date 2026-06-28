/**
 * Fast unit coverage for the worktree lifecycle's PURE pieces (ADR 0027): the
 * orphan-reclaim DECISION `classifyOrphans` (the load-bearing prune-GC safety
 * logic) and the plan→`EnginePlan` projections. No subprocess, no git, no fs — the
 * decisions are exercised in microseconds. The end-to-end lifecycle is driven
 * through the CLI in `engine_worktree_*_test.ts`; this pins the decisions directly.
 */

import { assert, assertEquals } from "@std/assert";
import {
  classifyOrphans,
  type LedgerItem,
  type ResourceEntry,
} from "../src/engine/worktree/resources.ts";
import {
  graduatePlanToEngine,
  prunePlanIsEmpty,
  prunePlanToEngine,
  setupPlanToEngine,
  teardownPlanToEngine,
} from "../src/engine/worktree/plan.ts";

/** A ledger entry fixture with sensible defaults, overridable per field. */
function entry(over: Partial<ResourceEntry> = {}): ResourceEntry {
  return {
    schema: 1,
    seq: 0,
    project_slug: "app",
    git_key: "wt-a",
    worktree_id: "a",
    worktree_path: "/repo/.wt/a",
    resource_name: "db",
    resource_identity: "app-a-db",
    destroy_command: "drop app-a-db",
    token_map: {},
    retries: 0,
    gc: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Wrap entries as ledger items (path is irrelevant to the pure decision). */
function items(...entries: ResourceEntry[]): LedgerItem[] {
  return entries.map((e, i) => ({ path: `/ledger/${i}.json`, entry: e }));
}

const NO_LIVE = {
  gitKeys: new Set<string>(),
  paths: new Set<string>(),
  identities: new Set<string>(),
};

Deno.test("classifyOrphans: an entry whose worktree is gone is reclaimable", () => {
  const { reclaimable, kept } = classifyOrphans(items(entry()), NO_LIVE);
  assertEquals(kept, 0);
  assertEquals(reclaimable.map((i) => i.entry.resource_identity), ["app-a-db"]);
});

Deno.test("classifyOrphans: a live git_key, path, OR handle keeps the entry", () => {
  const byKey = classifyOrphans(items(entry()), {
    ...NO_LIVE,
    gitKeys: new Set(["wt-a"]),
  });
  assertEquals(byKey.reclaimable.length, 0);
  assertEquals(byKey.kept, 1);

  const byPath = classifyOrphans(items(entry()), {
    ...NO_LIVE,
    paths: new Set(["/repo/.wt/a"]),
  });
  assertEquals(byPath.reclaimable.length, 0);

  const byHandle = classifyOrphans(items(entry()), {
    ...NO_LIVE,
    identities: new Set(["app-a-db"]),
  });
  assertEquals(byHandle.reclaimable.length, 0);
});

Deno.test("classifyOrphans: a gc=false entry is never reclaimed (teardown-only)", () => {
  const { reclaimable, kept } = classifyOrphans(
    items(entry({ gc: false })),
    NO_LIVE,
  );
  assertEquals(reclaimable.length, 0);
  assertEquals(kept, 1);
});

Deno.test("classifyOrphans: partitions a mixed ledger, preserving order", () => {
  const live = entry({ git_key: "live", resource_identity: "app-live-db" });
  const orphanA = entry({ git_key: "x", resource_identity: "app-x-db" });
  const guarded = entry({
    git_key: "y",
    gc: false,
    resource_identity: "app-y",
  });
  const orphanB = entry({ git_key: "z", resource_identity: "app-z-db" });
  const { reclaimable, kept } = classifyOrphans(
    items(live, orphanA, guarded, orphanB),
    { ...NO_LIVE, gitKeys: new Set(["live"]) },
  );
  assertEquals(reclaimable.map((i) => i.entry.resource_identity), [
    "app-x-db",
    "app-z-db",
  ]);
  assertEquals(kept, 2); // the live one + the gc=false one
});

// ── plan projections ───────────────────────────────────────────────────────────

Deno.test("teardownPlanToEngine: one destroy step per ledger entry", () => {
  const plan = teardownPlanToEngine({
    entries: items(entry(), entry({ resource_name: "cache" })),
  });
  assertEquals(plan.steps.map((s) => s.label), ["db", "cache"]);
  assert(plan.steps.every((s) => s.kind === "resource-destroy"));
});

Deno.test("graduatePlanToEngine: dirty worktree adds WIP-commit/unstage; resources gate the teardown step", () => {
  const base = {
    to: "branch" as const,
    worktreeBranch: "agent/x",
    worktreePath: "/repo/.wt/x",
    mainRepo: "/repo",
    mainBranch: "main",
    trunk: "main",
  };
  const dirty = graduatePlanToEngine({
    ...base,
    worktreeDirty: true,
    hasResources: true,
  });
  assertEquals(dirty.steps.map((s) => s.label), [
    "teardown resources",
    "wip-commit",
    "remove-worktree",
    "checkout",
    "unstage-wip",
  ]);
  assertEquals(
    dirty.steps.find((s) => s.label === "teardown resources")?.disposition,
    "run",
  );

  const clean = graduatePlanToEngine({
    ...base,
    worktreeDirty: false,
    hasResources: false,
  });
  assertEquals(clean.steps.map((s) => s.label), [
    "teardown resources",
    "remove-worktree",
    "checkout",
  ]);
  // No resources → the teardown step is shown but skipped.
  assertEquals(
    clean.steps.find((s) => s.label === "teardown resources")?.disposition,
    "skip",
  );
  // `branch` mode lands the worktree branch in the main checkout for review.
  assert(clean.details.some((d) => d.includes("Into main checkout:")));
});

Deno.test("graduatePlanToEngine: to=trunk fast-forwards the trunk and deletes the branch instead of a checkout", () => {
  const base = {
    to: "trunk" as const,
    worktreeBranch: "agent/x",
    worktreePath: "/repo/.wt/x",
    mainRepo: "/repo",
    mainBranch: "main",
    trunk: "main",
  };
  const dirty = graduatePlanToEngine({
    ...base,
    worktreeDirty: true,
    hasResources: true,
  });
  // The checkout step is replaced by fast-forward-trunk + delete-branch, and the
  // unstage still trails (soft-reset runs after the branch is deleted).
  assertEquals(dirty.steps.map((s) => s.label), [
    "teardown resources",
    "wip-commit",
    "remove-worktree",
    "fast-forward-trunk",
    "delete-branch",
    "unstage-wip",
  ]);

  const clean = graduatePlanToEngine({
    ...base,
    worktreeDirty: false,
    hasResources: false,
  });
  assertEquals(clean.steps.map((s) => s.label), [
    "teardown resources",
    "remove-worktree",
    "fast-forward-trunk",
    "delete-branch",
  ]);
  // The landing detail names the trunk fast-forward + branch deletion, not a checkout.
  assert(clean.details.some((d) => d.includes("Into trunk:")));
  assert(!clean.steps.some((s) => s.label === "checkout"));
});

Deno.test("setupPlanToEngine: every step runs, branch surfaced as a detail", () => {
  const plan = setupPlanToEngine({
    branch: "agent/x",
    steps: [
      { kind: "git", label: "ensure-branch", note: "agent/x" },
      { kind: "resource-create", label: "db", note: "app-x-db" },
    ],
  });
  assert(plan.details.some((d) => d.includes("agent/x")));
  assert(plan.steps.every((s) => s.disposition === "run"));
});

Deno.test("prunePlanToEngine + prunePlanIsEmpty: groups reclaims; empty is empty", () => {
  const empty = {
    worktreesToRemove: [],
    branchesToDelete: [],
    orphanDirs: [],
    resourceReclaims: [],
  };
  assert(prunePlanIsEmpty(empty));
  assertEquals(prunePlanToEngine(empty).steps.length, 0);

  const full = {
    worktreesToRemove: ["/repo/.wt/stale"],
    branchesToDelete: ["agent/old"],
    orphanDirs: ["/repo/.wt/orphan"],
    resourceReclaims: ["app-z-db"],
  };
  assert(!prunePlanIsEmpty(full));
  const groups = new Set(prunePlanToEngine(full).steps.map((s) => s.group));
  assertEquals(
    groups,
    new Set(["Worktrees", "Branches", "Orphan directories", "Resources"]),
  );
});
