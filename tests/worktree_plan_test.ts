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
  acceptPlanToEngine,
  prunePlanIsEmpty,
  prunePlanToEngine,
  setupPlanToEngine,
  teardownPlanToEngine,
} from "../src/engine/worktree/plan.ts";
import { remapWorktreeLocalTemplatesDir } from "../src/engine/worktree/lifecycle.ts";

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

Deno.test("acceptPlanToEngine: fast-forwards the trunk; resources gate the teardown step", () => {
  const base = {
    worktreeBranch: "agent/x",
    worktreePath: "/repo/.wt/x",
    mainRepo: "/repo",
    trunk: "main",
    ignoredFileChanges: {
      status: "unchanged" as const,
      changed_roots: [],
      changed_total: 0,
      truncated: false,
    },
  };
  const withResources = acceptPlanToEngine({
    ...base,
    hasResources: true,
  });
  assertEquals(withResources.steps.map((s) => s.label), [
    "fast-forward-trunk",
    "teardown resources",
    "remove-worktree",
    "delete-branch",
    "refresh agent files",
  ]);
  assertEquals(
    withResources.steps.find((s) => s.label === "teardown resources")
      ?.disposition,
    "run",
  );

  const clean = acceptPlanToEngine({
    ...base,
    hasResources: false,
  });
  assertEquals(clean.steps.map((s) => s.label), [
    "fast-forward-trunk",
    "teardown resources",
    "remove-worktree",
    "delete-branch",
    "refresh agent files",
  ]);
  // No resources → the teardown step is shown but skipped.
  assertEquals(
    clean.steps.find((s) => s.label === "teardown resources")?.disposition,
    "skip",
  );
  // The landing detail names the trunk fast-forward + branch deletion — the one
  // landing there is (never a review checkout).
  assert(clean.details.some((d) => d.includes("Into trunk:")));
  assert(!clean.steps.some((s) => s.label === "checkout"));
});

Deno.test("remapWorktreeLocalTemplatesDir: only remaps templates sourced from the removed worktree", () => {
  assertEquals(
    remapWorktreeLocalTemplatesDir(
      "/repo.worktrees/task/templates",
      "/repo.worktrees/task",
      "/repo",
    ),
    "/repo/templates",
  );
  assertEquals(
    remapWorktreeLocalTemplatesDir(
      "/opt/discern/templates",
      "/repo.worktrees/task",
      "/repo",
    ),
    undefined,
  );
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
    gitScan: {
      repoRoot: "/repo",
      mainBranch: "main",
      worktreesToRemove: [],
      branchesToDelete: [],
      staleMetadata: [],
      worktreeLines: [],
      branchLines: [],
    },
    orphanScan: {
      mainRepo: "/repo",
      mainBranch: "main",
      removable: [],
      kept: [],
    },
    resourceReclaims: [],
    resourceReclaimsKept: 0,
  };
  assert(prunePlanIsEmpty(empty));
  assertEquals(prunePlanToEngine(empty).steps.length, 0);

  const full = {
    gitScan: {
      repoRoot: "/repo",
      mainBranch: "main",
      worktreesToRemove: [{ path: "/repo/.wt/stale", branch: "agent/stale" }],
      branchesToDelete: ["agent/old"],
      staleMetadata: [{
        path: "/repo/.wt/gone",
        adminDir: "/repo/.git/worktrees/gone",
        gitDir: "/repo/.wt/gone/.git",
      }],
      worktreeLines: [],
      branchLines: [],
    },
    orphanScan: {
      mainRepo: "/repo",
      mainBranch: "main",
      removable: [{ path: "/repo/.wt/orphan", reason: "clean" }],
      kept: [{
        path: "/repo/.wt/dirty",
        reason: "dirty 1 status entries",
      }],
    },
    resourceReclaims: items(entry({ resource_identity: "app-z-db" })),
    resourceReclaimsKept: 1,
  };
  assert(!prunePlanIsEmpty(full));
  const enginePlan = prunePlanToEngine(full);
  const groups = new Set(enginePlan.steps.map((s) => s.group));
  assertEquals(
    groups,
    new Set([
      "Worktrees",
      "Branches",
      "Stale metadata",
      "Orphan directories",
      "Kept orphan directories",
      "Resources",
    ]),
  );
  assert(enginePlan.details.some((d) => d.includes("Stale metadata: 1 entry")));
});
