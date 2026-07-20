/**
 * The desk's pure model (ADR 0119): the decision-order bucketing and the
 * action-legality table. Time is injected, so every case here is a plain
 * input→output check — the whole classification table is pinned as a class,
 * not as scattered examples.
 */

import { assert, assertEquals } from "@std/assert";
import { configSchema } from "../src/shared/config_schema.ts";
import type { StatusFleetEntry } from "../src/shared/result_schemas.ts";
import type { ProjectScript } from "../src/engine/project_scripts.ts";
import type { DetectedAgentBinary } from "../src/lib/detect_agents.ts";
import {
  buildAgentLaunches,
  buildDeskRows,
  classifyBucket,
  type DeskAction,
  type DeskAgentLaunch,
  type DeskBucket,
  legalActions,
  rowSummary,
  taskLabel,
} from "../src/engine/desk/model.ts";

/** A fixed "now" every case measures idleness against. */
const NOW = Date.parse("2026-07-11T12:00:00Z");

/** An ISO timestamp `days` days before {@link NOW}. */
function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

/** A healthy linked-worktree row; override per case. */
function entry(over: Partial<StatusFleetEntry> = {}): StatusFleetEntry {
  return {
    path: `/tmp/fleet/${over.branch ?? "agent/x"}`,
    is_main: false,
    is_current: false,
    branch: "agent/x",
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: daysAgo(0),
    ...over,
  };
}

// ── the bucket table: every classification rule as one row ─────────────────────

const BUCKET_CASES: ReadonlyArray<{
  name: string;
  entry: StatusFleetEntry;
  receipt: boolean;
  expect: DeskBucket;
}> = [
  {
    name: "broken checkout → attention, whatever else is true",
    entry: entry({ broken: true, ahead: 3 }),
    receipt: true,
    expect: "attention",
  },
  {
    name: "unreadable git state → attention (never assumed clean)",
    entry: entry({ git_unavailable: true, clean: undefined }),
    receipt: false,
    expect: "attention",
  },
  {
    name: "clean, ahead, receipt honored → ready to land",
    entry: entry({ ahead: 3 }),
    receipt: true,
    expect: "ready",
  },
  {
    name: "clean, ahead, receipt honored, but behind trunk → in flight",
    entry: entry({ ahead: 3, behind: 2, last_activity: daysAgo(20) }),
    receipt: true,
    expect: "in_flight",
  },
  {
    name: "unknown behind state keeps the degraded-state leniency",
    entry: entry({ ahead: 3, behind: undefined }),
    receipt: true,
    expect: "ready",
  },
  {
    name: "clean and ahead but no receipt → still in flight",
    entry: entry({ ahead: 3 }),
    receipt: false,
    expect: "in_flight",
  },
  {
    name: "dirty and recently active → in flight",
    entry: entry({ clean: false, changed_files: 4 }),
    receipt: false,
    expect: "in_flight",
  },
  {
    name: "dirty and idle past the staleness threshold → attention",
    entry: entry({ clean: false, changed_files: 2, last_activity: daysAgo(8) }),
    receipt: false,
    expect: "attention",
  },
  {
    name: "unlanded commits idle past the threshold, no receipt → attention",
    entry: entry({ ahead: 2, last_activity: daysAgo(9) }),
    receipt: false,
    expect: "attention",
  },
  {
    name: "idle but empty-handed (clean, nothing ahead) → in flight, not stale",
    entry: entry({ last_activity: daysAgo(30) }),
    receipt: false,
    expect: "in_flight",
  },
  {
    name: "ready outranks stale: clean+ahead+receipt even when idle",
    entry: entry({ ahead: 1, last_activity: daysAgo(20) }),
    receipt: true,
    expect: "ready",
  },
];

Deno.test("classifyBucket: the decision-order table", () => {
  for (const c of BUCKET_CASES) {
    assertEquals(classifyBucket(c.entry, c.receipt, NOW), c.expect, c.name);
  }
});

// ── the action-legality table ──────────────────────────────────────────────────

const ACTION_CASES: ReadonlyArray<{
  name: string;
  entry: StatusFleetEntry;
  scripts?: readonly ProjectScript[];
  agentLaunches?: readonly DeskAgentLaunch[];
  expect: readonly DeskAction[];
}> = [
  {
    name: "broken → drop is the only honest offer",
    entry: entry({ broken: true }),
    expect: ["drop"],
  },
  {
    name: "unreadable → drop only",
    entry: entry({ git_unavailable: true, clean: undefined }),
    expect: ["drop"],
  },
  {
    name: "clean and ahead → accept leads; no update when not behind",
    entry: entry({ ahead: 2 }),
    expect: ["accept", "jump", "inspect", "drop"],
  },
  {
    name: "scripts available in this checkout → run script before jump",
    entry: entry({ ahead: 2 }),
    scripts: [{ name: "deploy", description: "deploy the project" }],
    expect: ["accept", "script", "jump", "inspect", "drop"],
  },
  {
    name: "configured agent available on PATH → agent launcher before jump",
    entry: entry({ ahead: 2 }),
    agentLaunches: [{
      id: "codex:open",
      agent: "codex",
      providerLabel: "Codex",
      binary: "codex",
      kind: "open",
      label: "Open in Codex",
      args: [],
    }],
    expect: ["accept", "agent", "jump", "inspect", "drop"],
  },
  {
    name: "dirty and behind → update offered, accept not",
    entry: entry({ clean: false, changed_files: 1, behind: 4 }),
    expect: ["update", "jump", "inspect", "drop"],
  },
  {
    name: "clean, ahead AND behind → both accept and update",
    entry: entry({ ahead: 2, behind: 1 }),
    expect: ["accept", "update", "jump", "inspect", "drop"],
  },
  {
    name: "clean, nothing ahead → no accept (nothing to land)",
    entry: entry({}),
    expect: ["jump", "inspect", "drop"],
  },
  {
    name: "broken with scripts and agents present → still drop only",
    entry: entry({ broken: true }),
    scripts: [{ name: "unsafe" }],
    agentLaunches: [{
      id: "codex:open",
      agent: "codex",
      providerLabel: "Codex",
      binary: "codex",
      kind: "open",
      label: "Open in Codex",
      args: [],
    }],
    expect: ["drop"],
  },
];

Deno.test("legalActions: the legality table", () => {
  for (const c of ACTION_CASES) {
    assertEquals(
      [...legalActions(c.entry, c.scripts ?? [], c.agentLaunches ?? [])],
      [...c.expect],
      c.name,
    );
  }
});

// ── ordering and exclusions ────────────────────────────────────────────────────

Deno.test("buildDeskRows: main is excluded; buckets sort into decision order; recency wins within a bucket", () => {
  const main = entry({
    is_main: true,
    branch: "main",
    path: "/tmp/fleet/main",
  });
  const stale = entry({
    branch: "agent/stale",
    path: "/p/stale",
    clean: false,
    changed_files: 2,
    last_activity: daysAgo(10),
  });
  const readyOld = entry({
    branch: "agent/ready-old",
    path: "/p/ready-old",
    ahead: 1,
    last_activity: daysAgo(2),
  });
  const readyNew = entry({
    branch: "agent/ready-new",
    path: "/p/ready-new",
    ahead: 3,
    last_activity: daysAgo(1),
  });
  const flying = entry({
    branch: "agent/flying",
    path: "/p/flying",
    clean: false,
    changed_files: 7,
  });

  const receipts = new Map<string, boolean>([
    ["/p/ready-old", true],
    ["/p/ready-new", true],
  ]);
  const scripts = new Map<string, readonly ProjectScript[]>([
    ["/p/ready-new", [{ name: "ship" }]],
  ]);
  const rows = buildDeskRows(
    [stale, main, readyOld, flying, readyNew],
    receipts,
    scripts,
    new Map(),
    NOW,
  );

  assertEquals(
    rows.map((r) => r.entry.branch),
    ["agent/ready-new", "agent/ready-old", "agent/flying", "agent/stale"],
  );
  assert(
    rows.every((r) => !r.entry.is_main),
    "the main checkout must never appear as a desk row",
  );
  assertEquals(rows[0]?.scripts, [{ name: "ship" }]);
  assertEquals(rows[1]?.scripts, []);
});

Deno.test("buildDeskRows: a path absent from the receipt map is never treated as vouched", () => {
  const rows = buildDeskRows(
    [entry({ ahead: 5, path: "/p/unvouched" })],
    new Map(),
    new Map(),
    new Map(),
    NOW,
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.receiptHonored, false);
  assertEquals(rows[0]?.bucket, "in_flight");
});

// ── configured agent × live PATH intersection ────────────────────────────────

Deno.test("buildAgentLaunches: configured order wins and detected-only agents stay hidden", () => {
  const config = configSchema.parse({
    project: { slug: "demo" },
    repository: { trunk: "main" },
    guidance: { agents: ["gemini", "claude_code", "codex"] },
  });
  const detected = [
    { name: "claude_code", binary: "claude" },
    { name: "gemini", binary: "gemini" },
    { name: "cursor", binary: "cursor-agent" },
  ] satisfies readonly DetectedAgentBinary[];

  const launches = buildAgentLaunches(config, detected);
  assertEquals(
    launches.map((launch) => launch.id),
    [
      "gemini:open",
      "gemini:continue",
      "claude_code:open",
      "claude_code:continue",
    ],
  );
  assertEquals(
    launches.map((launch) => launch.binary),
    ["gemini", "gemini", "claude", "claude"],
  );
  assertEquals(launches[1]?.args, ["--resume", "latest"]);
});

Deno.test("buildAgentLaunches: an explicitly empty agent set stays empty", () => {
  const config = configSchema.parse({
    project: { slug: "demo" },
    repository: { trunk: "main" },
    guidance: { agents: [] },
  });
  assertEquals(
    buildAgentLaunches(config, [{ name: "codex", binary: "codex" }]),
    [],
  );
});

// ── the row summary strings ────────────────────────────────────────────────────

Deno.test("taskLabel: minted ids become task names with separate disambiguators", () => {
  assertEquals(
    taskLabel(entry({
      id: "google-font-preview-eb4ace",
      branch: "agent/google-font-preview-eb4ace",
      path: "/p/google-font-preview-eb4ace",
    })),
    { name: "Google font preview", disambiguator: "eb4ace" },
  );
  assertEquals(
    taskLabel(entry({ id: undefined, path: "/p/brisk-otter-a3f9c1" })),
    { name: "Brisk otter", disambiguator: "a3f9c1" },
  );
  assertEquals(
    taskLabel(entry({ id: "hand-made-worktree", path: "/p/ignored" })),
    { name: "Hand made worktree" },
  );
});

Deno.test("rowSummary: states lead with the decision a person needs", () => {
  assertEquals(
    rowSummary(entry({ ahead: 3, last_activity: daysAgo(1) }), true, NOW),
    "Gate passed · 3 ahead · 1d ago",
  );
  assertEquals(
    rowSummary(
      entry({ clean: false, changed_files: 1, behind: 2 }),
      false,
      NOW,
    ),
    "Update needed · 1 file changed · 2 behind · now",
  );
  assertEquals(
    rowSummary(entry({ broken: true }), false, NOW),
    "Setup incomplete",
  );
  assertEquals(
    rowSummary(entry({ git_unavailable: true, clean: undefined }), false, NOW),
    "Git state unreadable",
  );
  assertEquals(
    rowSummary(entry({ ahead: 2 }), false, NOW),
    "Awaiting gate · 2 ahead · now",
  );
  assertEquals(
    rowSummary(entry({}), false, NOW),
    "No changes · now",
  );
});
