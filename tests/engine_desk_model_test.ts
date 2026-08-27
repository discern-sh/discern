/**
 * The Desk's forcing function: status owns row meaning, the Desk adapts every
 * status kind into one human decision, and every action is represented exactly
 * once with an observed availability reason.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { configSchema } from "../src/shared/config_schema.ts";
import {
  GATE_PROOF_CHECK_STATUSES,
  type GateProofCheckStatus,
  type StatusData,
  type StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import type { DetectedAgentBinary } from "../src/lib/detect_agents.ts";
import {
  buildAgentLaunches,
  buildDeskBoardDecision,
  buildDeskDecision,
  buildDeskRows,
  decisionSummary,
  DESK_ACTION_GROUPS,
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  DESK_STATE_BY_STATUS_KIND,
  DESK_STATES,
  type DeskAction,
  type DeskActionOffer,
  type DeskAgentLaunch,
  type DeskDecision,
  type DeskState,
  stateTitle,
  taskLabel,
} from "../src/engine/desk/model.ts";
import {
  FLEET_ROW_STATUS_KINDS,
  type FleetRowStatusKind,
  presentFleetRow,
} from "../src/engine/status/tty.ts";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const TRUNK = "main";

/** Return an ISO timestamp a whole number of days before the fixed clock. */
function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

/** Return an ISO timestamp a whole number of minutes before the fixed clock. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

/** A healthy linked-worktree survey row; override only the fact under test. */
function entry(over: Partial<StatusFleetEntry> = {}): StatusFleetEntry {
  const branch = over.branch ?? "agent/x";
  return {
    path: `/tmp/fleet/${branch}`,
    is_main: false,
    is_current: false,
    branch,
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: daysAgo(0),
    gate_proof: { status: "missing" },
    ...over,
  };
}

/** Build a complete decision from the standard fixture and optional evidence. */
function decide(
  over: Partial<StatusFleetEntry> = {},
  options: Partial<Parameters<typeof buildDeskDecision>[1]> = {},
): DeskDecision {
  return buildDeskDecision(entry(over), {
    trunk: TRUNK,
    nowMs: NOW,
    ...options,
  });
}

/** Find one canonical action offer in a complete decision. */
function offer(
  decision: DeskDecision,
  action: DeskAction,
): DeskActionOffer {
  const found = decision.actions.find((candidate) =>
    candidate.action === action
  );
  assert(found !== undefined, `missing ${action} offer`);
  return found;
}

/** Project enabled action ids without discarding the canonical offers. */
function enabledActions(decision: DeskDecision): DeskAction[] {
  return decision.actions.flatMap((candidate) =>
    candidate.availability === "enabled" ? [candidate.action] : []
  );
}

const AGENT_LAUNCH: DeskAgentLaunch = {
  id: "codex:open",
  agent: "codex",
  providerLabel: "Codex",
  binary: "codex",
  kind: "open",
  label: "Open in Codex",
  args: [],
};

// ── status → decision: one exhaustive adaptation, no second precedence ──────

const STATUS_KIND_CASES = [
  {
    kind: "broken",
    state: "needs_attention",
    over: { broken: true },
  },
  {
    kind: "unreadable",
    state: "needs_attention",
    over: {
      git_unavailable: true,
      clean: undefined,
      changed_files: undefined,
      ahead: undefined,
      behind: undefined,
    },
  },
  {
    kind: "failed",
    state: "needs_attention",
    over: {
      ahead: 1,
      last_action: {
        verb: "done",
        outcome: "failed",
        failed_stage: "test",
        at: minutesAgo(2),
      },
    },
  },
  {
    kind: "blocked",
    state: "needs_attention",
    over: {
      ahead: 1,
      last_action: {
        verb: "accept",
        outcome: "refused",
        at: minutesAgo(2),
      },
    },
  },
  {
    // Behind is paused, not attention: status has already established that no
    // live, stale, dirty, or failed condition outranks its deterministic Update.
    kind: "behind",
    state: "paused",
    over: { ahead: 2, behind: 1, gate_proof: { status: "honored" } },
  },
  {
    kind: "ready",
    state: "ready_to_review",
    over: { ahead: 2, gate_proof: { status: "honored" } },
  },
  {
    kind: "running",
    state: "working",
    over: {
      ahead: 1,
      running: { verb: "done", started: minutesAgo(1), elapsed_ms: 42_000 },
    },
  },
  {
    kind: "stale",
    state: "needs_attention",
    over: { ahead: 1, last_activity: daysAgo(8) },
  },
  {
    kind: "in-progress",
    state: "paused",
    over: {
      clean: false,
      changed_files: 2,
      gate_proof: { status: "dirty" },
    },
  },
  {
    kind: "proof-unreadable",
    state: "needs_attention",
    over: {
      ahead: 1,
      gate_proof: { status: "read_failed", reason: "invalid marker" },
    },
  },
  {
    // An unavailable inspection needs attention because the Desk cannot turn
    // missing observation into an ordinary "run the Gate" claim.
    kind: "proof-unavailable",
    state: "needs_attention",
    over: {
      ahead: 1,
      gate_proof: { status: "unavailable", reason: "admin dir missing" },
    },
  },
  {
    // A stale Proof is paused: the known next condition is a Gate on this HEAD.
    kind: "proof-stale",
    state: "paused",
    over: {
      ahead: 1,
      gate_proof: { status: "stale", recorded: "aaa", head: "bbb" },
    },
  },
  {
    kind: "needs-gate",
    state: "paused",
    over: { ahead: 1 },
  },
  {
    kind: "idle",
    state: "empty",
    over: {},
  },
] as const satisfies ReadonlyArray<{
  readonly kind: FleetRowStatusKind;
  readonly state: DeskState;
  readonly over: Partial<StatusFleetEntry>;
}>;

Deno.test("every status kind maps to exactly one Desk decision state", () => {
  assertEquals(
    STATUS_KIND_CASES.map((testCase) => testCase.kind).sort(),
    [...FLEET_ROW_STATUS_KINDS].sort(),
    "a new status kind must add an explicit Desk fixture",
  );
  assertEquals(
    [...new Set(STATUS_KIND_CASES.map((testCase) => testCase.state))].sort(),
    [...DESK_STATES].sort(),
    "the table must exercise every Desk state",
  );
  for (const testCase of STATUS_KIND_CASES) {
    const surveyEntry = entry(testCase.over);
    const status = presentFleetRow(surveyEntry, { trunk: TRUNK, nowMs: NOW });
    const decision = buildDeskDecision(surveyEntry, {
      trunk: TRUNK,
      nowMs: NOW,
    });
    assertEquals(
      status.kind,
      testCase.kind,
      `${testCase.kind}: status fixture`,
    );
    assertEquals(
      decision.statusKind,
      status.kind,
      `${testCase.kind}: Desk must consume status's classifier`,
    );
    assertEquals(
      decision.state,
      DESK_STATE_BY_STATUS_KIND[status.kind],
      `${testCase.kind}: the exhaustive adaptation is authoritative`,
    );
    assertEquals(decision.state, testCase.state, `${testCase.kind}: decision`);
  }
});

Deno.test("status precedence boundaries remain identical in the Desk", () => {
  const cases: ReadonlyArray<{
    name: string;
    over: Partial<StatusFleetEntry>;
    kind: FleetRowStatusKind;
    state: DeskState;
  }> = [
    {
      name: "broken outranks a running Gate",
      over: {
        broken: true,
        running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
      },
      kind: "broken",
      state: "needs_attention",
    },
    {
      name: "running outranks a previous failed action and branch lag",
      over: {
        ahead: 1,
        behind: 2,
        last_action: { verb: "done", outcome: "failed", at: minutesAgo(2) },
        running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
      },
      kind: "running",
      state: "working",
    },
    {
      name: "stale work outranks dirty and behind facts",
      over: {
        clean: false,
        changed_files: 1,
        ahead: 1,
        behind: 2,
        last_activity: daysAgo(8),
        gate_proof: { status: "dirty" },
      },
      kind: "stale",
      state: "needs_attention",
    },
    {
      name: "uncommitted work outranks branch lag",
      over: {
        clean: false,
        changed_files: 1,
        behind: 2,
        gate_proof: { status: "dirty" },
      },
      kind: "in-progress",
      state: "paused",
    },
    {
      name: "branch lag blocks otherwise honored readiness",
      over: { ahead: 2, behind: 1, gate_proof: { status: "honored" } },
      kind: "behind",
      state: "paused",
    },
  ];
  for (const testCase of cases) {
    const decision = decide(testCase.over);
    assertEquals(decision.statusKind, testCase.kind, testCase.name);
    assertEquals(decision.state, testCase.state, testCase.name);
  }
});

Deno.test("running, failed, refused, partial, and successful outcomes stay factual", () => {
  const cases: ReadonlyArray<{
    over: Partial<StatusFleetEntry>;
    kind: FleetRowStatusKind;
    headline: string;
  }> = [
    {
      over: {
        ahead: 1,
        last_action: {
          verb: "done",
          outcome: "failed",
          failed_stage: "test",
          at: minutesAgo(3),
        },
      },
      kind: "failed",
      headline: "Checks failed: test",
    },
    {
      over: {
        ahead: 1,
        last_action: { verb: "refresh", outcome: "partial", at: minutesAgo(3) },
      },
      kind: "failed",
      headline: "discern refresh completed only part of the work",
    },
    {
      over: {
        ahead: 1,
        last_action: { verb: "accept", outcome: "refused", at: minutesAgo(3) },
      },
      kind: "blocked",
      headline: "discern accept was refused",
    },
    {
      over: {
        ahead: 1,
        last_action: { verb: "status", outcome: "ok", at: minutesAgo(3) },
      },
      kind: "needs-gate",
      headline: "Final checks needed",
    },
    {
      over: {
        ahead: 1,
        running: {
          verb: "done",
          started: minutesAgo(1),
          elapsed_ms: 42_000,
          typical_duration_ms: 120_000,
        },
      },
      kind: "running",
      headline: "Running discern done · 42s",
    },
  ];
  for (const testCase of cases) {
    const decision = decide(testCase.over);
    assertEquals(decision.statusKind, testCase.kind);
    assertEquals(decision.headline, testCase.headline);
  }
  const running = decide(cases[4]?.over ?? {});
  assertEquals(
    running.details.filter((detail) => detail.kind === "activity").map((
      detail,
    ) => detail.text),
    ["active now", "Usually 2m"],
  );
});

// ── complete Proof and authority evidence ───────────────────────────────────

const PROOF_CASES = [
  { status: "honored", kind: "ready", state: "ready_to_review" },
  { status: "report_only", kind: "needs-gate", state: "paused" },
  { status: "missing", kind: "needs-gate", state: "paused" },
  { status: "stale", kind: "proof-stale", state: "paused" },
  { status: "dirty", kind: "needs-gate", state: "paused" },
  {
    status: "unavailable",
    kind: "proof-unavailable",
    state: "needs_attention",
  },
  {
    status: "read_failed",
    kind: "proof-unreadable",
    state: "needs_attention",
  },
] as const satisfies ReadonlyArray<{
  readonly status: GateProofCheckStatus;
  readonly kind: FleetRowStatusKind;
  readonly state: DeskState;
}>;

Deno.test("every gate-Proof status reaches the decision without compatibility drift", () => {
  assertEquals(
    PROOF_CASES.map((testCase) => testCase.status).sort(),
    [...GATE_PROOF_CHECK_STATUSES].sort(),
    "a new Proof status must add a Desk fixture",
  );
  for (const testCase of PROOF_CASES) {
    const decision = decide({
      ahead: 1,
      gate_proof: {
        status: testCase.status,
        ...(["stale", "unavailable", "read_failed"].includes(testCase.status)
          ? { reason: `${testCase.status} reason` }
          : {}),
      },
    });
    assertEquals(decision.proof.status, testCase.status, testCase.status);
    assertEquals(decision.proof.honored, testCase.status === "honored");
    assertEquals(decision.statusKind, testCase.kind, testCase.status);
    assertEquals(decision.state, testCase.state, testCase.status);
  }
});

Deno.test("the complete gate-Proof inspection outranks honored compatibility text", () => {
  const decision = decide({
    ahead: 2,
    gate_proof: { status: "stale", recorded: "aaa", head: "bbb" },
    proof_honored: true,
    proof: "old rendered Proof",
    proof_line: "old Proof line",
  });
  assertEquals(decision.proof.status, "stale");
  assertEquals(decision.statusKind, "proof-stale");
  assertEquals(decision.landingReady, false);
});

Deno.test("task activity and the exact Proof line cross the decision boundary", () => {
  const running = decide({
    ahead: 1,
    running: {
      verb: "done",
      started: minutesAgo(1),
      elapsed_ms: 42_000,
      typical_duration_ms: 120_000,
    },
    gate_proof: {
      status: "honored",
      proof_line: "Proof: agent/x abcdef0 · gate passed",
    },
  });
  assertEquals(running.activity, {
    status: "running",
    summary: "Running discern done",
    detail: "Elapsed 42s; usually 2m",
  });
  assertEquals(running.proof.line, "Proof: agent/x abcdef0 · gate passed");

  const completed = decide({
    last_action: {
      verb: "done",
      outcome: "failed",
      at: minutesAgo(3),
      failed_stage: "test",
    },
  });
  assertEquals(completed.activity, {
    status: "last_action",
    summary: "discern done failed",
    detail: "Recorded 3m ago; failed check: test",
  });

  assertEquals(decide({ last_activity: undefined }).activity, {
    status: "unrecorded",
    summary: "No activity recorded",
  });
});

Deno.test("standing, effort, scoped, and absent authority remain distinct", () => {
  const proof = { status: "honored" } as const;
  const effort = decide({
    ahead: 1,
    gate_proof: proof,
    landing_authority: { kind: "authorized", source: "effort-grant" },
  });
  const standing = decide({
    ahead: 1,
    gate_proof: proof,
    landing_authority: {
      kind: "authorized",
      source: "standing-grant",
      scopes: ["map"],
    },
  });
  const scoped = decide({
    ahead: 1,
    gate_proof: proof,
    landing_authority: {
      kind: "conversation-required",
      standing_scopes: ["map"],
      uncovered: [{ path: "src/main.ts", scopes: ["engine"] }],
    },
  });
  const absent = decide({ ahead: 1, gate_proof: proof });

  assertEquals(effort.authority.source, "effort-grant");
  assertEquals(effort.authority.status, "granted");
  assertEquals(effort.needsHumanDecision, false);
  assertEquals(offer(effort, "revoke_grant").availability, "enabled");
  assertEquals(offer(effort, "grant").availability, "disabled");

  assertEquals(standing.authority.source, "standing-grant");
  assertEquals(standing.authority.scopes, ["map"]);
  assertEquals(standing.needsHumanDecision, false);
  assertEquals(offer(standing, "grant").availability, "enabled");

  assertEquals(scoped.authority.status, "scope_limited");
  assertEquals(scoped.authority.uncoveredPaths, ["src/main.ts"]);
  assertEquals(scoped.needsHumanDecision, true);
  assertStringIncludes(scoped.authority.summary, "outside the standing grant");

  assertEquals(absent.authority.status, "unknown");
  assertEquals(absent.needsHumanDecision, true);
});

// ── collision and desk-only capability evidence ─────────────────────────────

Deno.test("changed-file and ADR collisions enter attention without changing status meaning", () => {
  const decision = decide(
    {
      branch: "agent/alpha",
      path: "/p/alpha",
      ahead: 2,
      gate_proof: { status: "honored" },
    },
    {
      fleetCollisions: [{
        branches: ["agent/alpha", "agent/beta"],
        overlap: ["src/shared.ts"],
        total: 3,
      }],
      adrCollisions: [{
        number: "0284",
        branches: ["agent/alpha", "agent/gamma"],
        paths: [
          "project/map/_adr/0284-alpha.md",
          "project/map/_adr/0284-gamma.md",
        ],
      }],
    },
  );
  assertEquals(decision.statusKind, "ready", "collision is not a row status");
  assertEquals(decision.state, "needs_attention");
  assertEquals(decision.needsHumanDecision, true);
  assertEquals(decision.recommendedAction, "inspect");
  assertEquals(decision.collisions, [
    {
      kind: "changed_files",
      otherBranch: "agent/beta",
      paths: ["src/shared.ts"],
      total: 3,
    },
    {
      kind: "adr",
      number: "0284",
      otherBranches: ["agent/gamma"],
      paths: [
        "project/map/_adr/0284-alpha.md",
        "project/map/_adr/0284-gamma.md",
      ],
    },
  ]);
  assertStringIncludes(decisionSummary(decision), "3 changed files overlap");
  assertStringIncludes(decisionSummary(decision), "ADR 0284");

  const unrelated = decide({ branch: "agent/delta", ahead: 1 }, {
    fleetCollisions: [{
      branches: ["agent/alpha", "agent/beta"],
      overlap: ["src/shared.ts"],
      total: 1,
    }],
  });
  assertEquals(unrelated.collisions, []);
  assertEquals(unrelated.state, "paused");
});

Deno.test("a contained task names its live successor and recommends reclaim", () => {
  const decision = decide({
    ahead: 2,
    contained_in: "agent/next-stage",
  });
  assertEquals(decision.state, "paused");
  assertEquals(decision.headline, "Work continues in agent/next-stage");
  assertEquals(decision.needsHumanDecision, true);
  assertEquals(decision.recommendedAction, "reclaim");
  assertEquals(offer(decision, "reclaim").availability, "enabled");
  assertStringIncludes(
    offer(decision, "reclaim").label,
    "agent/next-stage",
  );
});

// ── one action representation, with the behind/Accept class guard ───────────

const ACTION_CASES: ReadonlyArray<{
  name: string;
  decision: () => DeskDecision;
  enabled: readonly DeskAction[];
  recommended?: DeskAction;
}> = [
  {
    name: "broken checkout",
    decision: () => decide({ broken: true }),
    enabled: ["jump", "inspect", "drop"],
  },
  {
    name: "unreadable checkout",
    decision: () =>
      decide({ git_unavailable: true, clean: undefined, ahead: undefined }),
    enabled: ["jump", "drop"],
  },
  {
    name: "clean committed work awaiting final checks",
    decision: () => decide({ ahead: 2 }),
    enabled: ["done", "accept", "jump", "inspect", "grant", "drop"],
    recommended: "done",
  },
  {
    name: "ready work with an effort grant",
    decision: () =>
      decide({
        ahead: 2,
        gate_proof: { status: "honored" },
        landing_authority: { kind: "authorized", source: "effort-grant" },
      }),
    enabled: ["done", "accept", "jump", "inspect", "revoke_grant", "drop"],
    recommended: "accept",
  },
  {
    name: "branch behind main",
    decision: () => decide({ ahead: 2, behind: 1 }),
    enabled: ["update", "jump", "inspect", "grant", "drop"],
    recommended: "update",
  },
  {
    name: "contained branch",
    decision: () => decide({ ahead: 2, contained_in: "agent/next" }),
    enabled: [
      "done",
      "accept",
      "jump",
      "inspect",
      "grant",
      "reclaim",
      "drop",
    ],
    recommended: "reclaim",
  },
  {
    name: "task with scripts and an agent",
    decision: () =>
      decide({
        clean: false,
        changed_files: 1,
        gate_proof: { status: "dirty" },
      }, {
        scripts: [{ name: "verify" }],
        agentLaunches: [AGENT_LAUNCH],
      }),
    enabled: ["agent", "scripts", "jump", "inspect", "grant", "drop"],
    recommended: "agent",
  },
  {
    name: "live discern operation",
    decision: () =>
      decide({
        ahead: 2,
        running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
      }, { scripts: [{ name: "verify" }], agentLaunches: [AGENT_LAUNCH] }),
    enabled: ["jump", "inspect"],
  },
  {
    name: "empty task",
    decision: () => decide(),
    enabled: ["jump", "inspect", "grant", "drop"],
  },
];

Deno.test("every action is offered once with closed metadata and concrete availability", () => {
  const enabledPopulation = new Set<DeskAction>();
  const disabledPopulation = new Set<DeskAction>();
  for (const testCase of ACTION_CASES) {
    const decision = testCase.decision();
    assertEquals(
      decision.actions.map((candidate) => candidate.action),
      [...DESK_ACTIONS],
      `${testCase.name}: every action exactly once and in canonical order`,
    );
    assertEquals(enabledActions(decision), testCase.enabled, testCase.name);
    assertEquals(
      decision.recommendedAction,
      testCase.recommended,
      testCase.name,
    );
    assertEquals(
      decision.actions.filter((candidate) => candidate.recommended).length,
      testCase.recommended === undefined ? 0 : 1,
      `${testCase.name}: at most one recommendation`,
    );
    for (const candidate of decision.actions) {
      assert(candidate.label.trim().length > 0, `${candidate.action}: label`);
      assert(
        DESK_ACTION_GROUPS.includes(candidate.group),
        `${candidate.action}: canonical group`,
      );
      assert(candidate.command.argv.length > 0, `${candidate.action}: command`);
      assert(
        candidate.command.argv.every((argument) => argument.trim().length > 0),
        `${candidate.action}: command argument`,
      );
      for (
        const consequence of [
          candidate.consequence.keeps,
          candidate.consequence.changes,
          candidate.consequence.removes,
          candidate.consequence.recoverable,
        ]
      ) {
        assert(Array.isArray(consequence), `${candidate.action}: consequence`);
      }
      if (candidate.confirmation.kind !== "none") {
        assertEquals(
          candidate.confirmation.defaultTo,
          false,
          `${candidate.action}: safe confirmation default`,
        );
        assert(candidate.confirmation.yesLabel.trim().length > 0);
        assert(candidate.confirmation.noLabel.trim().length > 0);
      }
      if (candidate.availability === "disabled") {
        disabledPopulation.add(candidate.action);
        assert(
          candidate.reason.trim().length > 0,
          `${candidate.action}: concrete disabled reason`,
        );
        assertEquals(candidate.recommended, false);
      } else {
        enabledPopulation.add(candidate.action);
      }
    }
  }
  assertEquals([...enabledPopulation].sort(), [...DESK_ACTIONS].sort());
  assertEquals(
    [...disabledPopulation].sort(),
    DESK_ACTIONS.filter((action) => action !== "jump").sort(),
    "every conditionally available action must have a refusal case",
  );
  assertEquals(
    Object.keys(DESK_ACTION_REGISTRY).sort(),
    [...DESK_ACTIONS].sort(),
    "a new action must add label and group metadata",
  );
});

Deno.test("a clean branch behind main disables Accept and recommends Update", () => {
  const decision = decide({
    clean: true,
    ahead: 2,
    behind: 1,
    gate_proof: { status: "honored" },
  });
  const accept = offer(decision, "accept");
  assertEquals(accept.availability, "disabled");
  if (accept.availability === "disabled") {
    assertEquals(accept.reason, "1 commit behind main.");
  }
  assertEquals(offer(decision, "update").availability, "enabled");
  assertEquals(decision.recommendedAction, "update");
});

Deno.test("unknown divergence disables actions that require trustworthy counts", () => {
  const decision = decide({
    ahead: "unknown",
    behind: "unknown",
    gate_proof: { status: "honored" },
  });
  for (const action of ["accept", "update"] as const) {
    const candidate = offer(decision, action);
    assertEquals(candidate.availability, "disabled");
    if (candidate.availability === "disabled") {
      assertEquals(candidate.reason, "Git divergence from main is unknown.");
    }
  }
  assertStringIncludes(
    decisionSummary(decision),
    "Ahead count versus main unavailable",
  );
  assertStringIncludes(
    decisionSummary(decision),
    "Behind count versus main unavailable",
  );
});

// ── row construction, ordering, and factual copy ────────────────────────────

Deno.test("the board decision carries project, main, counts, and bounded notices", () => {
  const main = entry({
    branch: "main",
    path: "/tmp/project",
    is_main: true,
    is_current: true,
    clean: false,
    changed_files: 2,
  });
  const fleet = [
    main,
    entry({ branch: "agent/attention", path: "/tmp/attention", broken: true }),
    entry({
      branch: "agent/ready",
      path: "/tmp/ready",
      ahead: 1,
      gate_proof: { status: "honored" },
      landing_authority: { kind: "authorized", source: "effort-grant" },
    }),
  ];
  const taskRows = buildDeskRows(fleet, new Map(), new Map(), {
    trunk: TRUNK,
    nowMs: NOW,
  });
  const data: StatusData = {
    location: "main",
    root: "/tmp/project",
    project: "demo",
    worktree: null,
    git: null,
    standards: [],
    fleet,
    unlanded_branches: ["agent/orphan"],
    contained_refs: [{
      branch: "agent/reclaimed",
      contained_in: "agent/ready",
    }],
    reappeared_worktree_paths: [{
      path: "/tmp/returned",
      removed_at: daysAgo(1),
      kind: "directory",
      contents: [],
      contents_truncated: false,
      entries: 0,
    }],
  };

  assertEquals(buildDeskBoardDecision(data, taskRows), {
    project: "demo",
    main: { state: "changed", headline: "main has 2 uncommitted changes" },
    taskCount: 2,
    needsPersonCount: 1,
    readyToReviewCount: 1,
    refreshedAge: "just now",
    notices: [{
      id: "unlanded",
      state: "attention",
      headline: "1 branch has no worktree",
      detail: "agent/orphan",
      nextAction:
        "Open a branch with discern start --from <branch> before continuing it.",
    }, {
      id: "contained",
      state: "information",
      headline: "1 reclaimed branch remains inside live work",
      detail: "agent/reclaimed remains inside agent/ready until it lands",
    }, {
      id: "reappeared",
      state: "attention",
      headline: "1 removed worktree path is present again",
      nextAction: "Review with discern worktree prune --dry-run.",
    }],
  });
});

Deno.test("buildDeskRows excludes main, carries collisions, and sorts by human decision", () => {
  const fleet = [
    entry({ is_main: true, branch: "main", path: "/p/main" }),
    entry({
      branch: "agent/empty",
      path: "/p/empty",
      last_activity: daysAgo(1),
    }),
    entry({
      branch: "agent/paused",
      path: "/p/paused",
      ahead: 1,
      last_activity: daysAgo(2),
    }),
    entry({
      branch: "agent/working",
      path: "/p/working",
      ahead: 1,
      running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
    }),
    entry({
      branch: "agent/ready",
      path: "/p/ready",
      ahead: 1,
      gate_proof: { status: "honored" },
    }),
    entry({
      branch: "agent/attention-old",
      path: "/p/attention-old",
      ahead: 1,
      last_activity: daysAgo(10),
    }),
    entry({
      branch: "agent/attention-new",
      path: "/p/attention-new",
      ahead: 1,
      gate_proof: { status: "honored" },
    }),
  ];
  const rows = buildDeskRows(
    fleet,
    new Map([["/p/ready", [{ name: "verify" }]]]),
    new Map(),
    {
      trunk: TRUNK,
      nowMs: NOW,
      fleetCollisions: [{
        branches: ["agent/attention-new", "agent/other"],
        overlap: ["src/x.ts"],
        total: 1,
      }],
    },
  );
  assertEquals(
    rows.map((row) => row.entry.branch),
    [
      "agent/attention-new",
      "agent/attention-old",
      "agent/ready",
      "agent/working",
      "agent/paused",
      "agent/empty",
    ],
  );
  assertEquals(rows.map((row) => row.decision.state), [
    "needs_attention",
    "needs_attention",
    "ready_to_review",
    "working",
    "paused",
    "empty",
  ]);
  assert(rows.every((row) => !row.entry.is_main));
  assertEquals(
    rows.find((row) => row.entry.branch === "agent/ready")?.scripts,
    [
      { name: "verify" },
    ],
  );
});

Deno.test("human copy names units, commands, and recency without lossy shorthand", () => {
  const dirty = decide({
    clean: false,
    changed_files: 1,
    ahead: 2,
    gate_proof: { status: "dirty" },
  });
  assertEquals(dirty.headline, "Uncommitted work is paused");
  assertStringIncludes(decisionSummary(dirty), "1 uncommitted file");
  assertStringIncludes(decisionSummary(dirty), "2 commits ahead of main");
  assertStringIncludes(decisionSummary(dirty), "active now");
  assert(!decisionSummary(dirty).includes("Awaiting gate"));
  assert(!decisionSummary(dirty).includes(" · now"));

  const gate = decide({ ahead: 2 });
  assertEquals(gate.headline, "Final checks needed");
  assertStringIncludes(
    decisionSummary(gate),
    "Run discern done from this task",
  );

  const empty = decide();
  assertEquals(empty.state, "empty");
  assertEquals(empty.headline, "No work to review");
});

Deno.test("state headings cover the canonical vocabulary", () => {
  assertEquals(DESK_STATES.map(stateTitle), [
    "Needs attention",
    "Ready to review",
    "Working",
    "Paused",
    "Empty",
  ]);
});

Deno.test("taskLabel keeps task identity separate from its disambiguator", () => {
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
    taskLabel(entry({
      id: "unicode-a1b2c3",
      path: "/p/unicode-修复终端布局和证明显示-a1b2c3",
    })),
    {
      name: "Unicode 修复终端布局和证明显示",
      disambiguator: "a1b2c3",
    },
  );
  assertEquals(
    taskLabel(entry({
      id: "canonical-a1b2c3",
      path: "/p/unrelated-folder",
    })),
    { name: "Canonical", disambiguator: "a1b2c3" },
  );
});

// ── configured agent × live PATH intersection ──────────────────────────────

Deno.test("buildAgentLaunches preserves configured agents and explains missing binaries", () => {
  const config = configSchema.parse({
    project: { slug: "demo", agents: ["gemini", "claude_code", "codex"] },
    repository: { trunk: TRUNK },
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
      "codex:open",
      "codex:continue",
    ],
  );
  assertEquals(launches[1]?.args, ["--resume", "latest"]);
  assertEquals(launches[4]?.availability, "disabled");
  assertStringIncludes(launches[4]?.reason ?? "", "Codex is configured");
  assertStringIncludes(launches[4]?.reason ?? "", "not on PATH");
  assertStringIncludes(launches[4]?.reason ?? "", "discern.toml");
});

Deno.test("buildAgentLaunches respects an explicitly empty agent set", () => {
  const config = configSchema.parse({
    project: { slug: "demo", agents: [] },
    repository: { trunk: TRUNK },
  });
  assertEquals(
    buildAgentLaunches(config, [{ name: "codex", binary: "codex" }]),
    [],
  );
});
