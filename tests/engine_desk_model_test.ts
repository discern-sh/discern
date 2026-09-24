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
  type StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import type { DetectedAgentBinary } from "../src/lib/detect_agents.ts";
import {
  agentLaunchArgs,
  buildAgentLaunches,
  buildDeskDecision,
  buildDeskRows,
  decisionSummary,
  DESK_ACTION_GROUPS,
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  type DeskAction,
  type DeskActionOffer,
  type DeskAgentLaunch,
  type DeskDecision,
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
    branch_reachable: true,
    filesystem: { state: "directory" },
    setup: { state: "ready", marker: "present" },
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
    over: { broken: true },
  },
  {
    kind: "setup-incomplete",
    over: {
      setup: {
        state: "incomplete",
        marker: "missing",
        repair: {
          kind: "retry",
          command: "discern worktree setup",
          reason: "The ready marker is missing.",
        },
      },
    },
  },
  {
    kind: "unreadable",
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
    // live, stale, dirty, or failed condition outranks its deterministic
    // Update. Only UNPROVEN work classifies behind — honored Proof routes to
    // acceptance, which composes the moved trunk itself.
    kind: "behind",
    over: { ahead: 2, behind: 1 },
  },
  {
    kind: "ready",
    over: { ahead: 2, gate_proof: { status: "honored" } },
  },
  {
    kind: "running",
    over: {
      ahead: 1,
      running: { verb: "done", started: minutesAgo(1), elapsed_ms: 42_000 },
    },
  },
  {
    kind: "stale",
    over: { ahead: 1, last_activity: daysAgo(8) },
  },
  {
    kind: "in-progress",
    over: {
      clean: false,
      changed_files: 2,
      gate_proof: { status: "dirty" },
    },
  },
  {
    kind: "proof-unreadable",
    over: {
      ahead: 1,
      gate_proof: { status: "read_failed", reason: "invalid marker" },
    },
  },
  {
    // An unavailable inspection needs attention because the Desk cannot turn
    // missing observation into an ordinary "run the Gate" claim.
    kind: "proof-unavailable",
    over: {
      ahead: 1,
      gate_proof: { status: "unavailable", reason: "admin dir missing" },
    },
  },
  {
    // A stale Proof is paused: the known next condition is a Gate on this HEAD.
    kind: "proof-stale",
    over: {
      ahead: 1,
      gate_proof: { status: "stale", recorded: "aaa", head: "bbb" },
    },
  },
  {
    kind: "needs-gate",
    over: { ahead: 1 },
  },
  {
    kind: "idle",
    over: {},
  },
] as const satisfies ReadonlyArray<{
  readonly kind: FleetRowStatusKind;
  readonly over: Partial<StatusFleetEntry>;
}>;

Deno.test("every status kind maps to exactly one Desk decision state", () => {
  assertEquals(
    STATUS_KIND_CASES.map((testCase) => testCase.kind).sort(),
    [...FLEET_ROW_STATUS_KINDS].sort(),
    "a new status kind must add an explicit Desk fixture",
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
  }
});

Deno.test("status precedence boundaries remain identical in the Desk", () => {
  const cases: ReadonlyArray<{
    name: string;
    over: Partial<StatusFleetEntry>;
    kind: FleetRowStatusKind;
  }> = [
    {
      name: "broken outranks a running Gate",
      over: {
        broken: true,
        running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
      },
      kind: "broken",
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
    },
    {
      name: "branch lag pauses unproven work",
      over: { ahead: 2, behind: 1 },
      kind: "behind",
    },
    {
      name:
        "honored Proof outranks branch lag: acceptance composes the moved trunk",
      over: { ahead: 2, behind: 1, gate_proof: { status: "honored" } },
      kind: "ready",
    },
  ];
  for (const testCase of cases) {
    const decision = decide(testCase.over);
    assertEquals(decision.statusKind, testCase.kind, testCase.name);
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
  { status: "honored", kind: "ready" },
  { status: "report_only", kind: "needs-gate" },
  { status: "missing", kind: "needs-gate" },
  { status: "stale", kind: "proof-stale" },
  { status: "dirty", kind: "needs-gate" },
  {
    status: "unavailable",
    kind: "proof-unavailable",
  },
  {
    status: "read_failed",
    kind: "proof-unreadable",
  },
] as const satisfies ReadonlyArray<{
  readonly status: GateProofCheckStatus;
  readonly kind: FleetRowStatusKind;
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
  assertEquals(offer(effort, "revoke_grant").availability, "enabled");
  assertEquals(offer(effort, "grant").availability, "disabled");

  assertEquals(standing.authority.source, "standing-grant");
  assertEquals(standing.authority.scopes, ["map"]);
  assertEquals(offer(standing, "grant").availability, "enabled");

  assertEquals(scoped.authority.status, "scope_limited");
  assertEquals(scoped.authority.uncoveredPaths, ["src/main.ts"]);
  assertStringIncludes(scoped.authority.summary, "outside the standing grant");

  assertEquals(absent.authority.status, "unknown");
});

// ── collision and desk-only capability evidence ─────────────────────────────

Deno.test("advisory collisions retain facts without changing state or recommending an action", () => {
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
});

Deno.test("a contained task names its live successor and offers reclaim", () => {
  const decision = decide({
    ahead: 2,
    contained_in: "agent/next-stage",
  });
  assertEquals(decision.headline, "Work continues in agent/next-stage");
  assertEquals(offer(decision, "reclaim").availability, "enabled");
  assertStringIncludes(
    offer(decision, "reclaim").label,
    "agent/next-stage",
  );
});

Deno.test("Park, Reclaim, and Drop retain distinct artifact contracts", () => {
  const task = {
    id: "artifact-contract",
    branch: "agent/artifact-contract",
    title: "Artifact contract",
    title_source: "recorded" as const,
  };
  const base = {
    branch: task.branch,
    task,
    ahead: 3,
    resources: { database: "demo-artifact-contract" },
    landing_authority: {
      kind: "authorized" as const,
      source: "effort-grant" as const,
    },
    gate_proof: { status: "honored" as const },
  };
  const parked = offer(decide(base), "park").consequence;
  assert(parked.keeps.includes(`Branch ${task.branch}`));
  assert(parked.keeps.includes("Task title, brief, and creation source"));
  assert(parked.removes.includes("Task checkout"));
  assert(parked.removes.includes("Task landing grant"));
  assert(parked.removes.includes("Task-local Proof"));
  assertStringIncludes(parked.recoverable.join(" "), "commands");
  assertStringIncludes(parked.recoverable.join(" "), "Resume");
  assert(
    !parked.removes.some((fact) => fact.includes(`Branch ${task.branch}`)),
  );

  const reclaimed = offer(
    decide({ ...base, contained_in: "agent/later-stage" }),
    "reclaim",
  ).consequence;
  assert(reclaimed.keeps.includes(`Branch ${task.branch}`));
  assert(reclaimed.keeps.includes("Containing branch agent/later-stage"));
  assert(reclaimed.removes.includes("Task checkout"));
  assertStringIncludes(reclaimed.recoverable.join(" "), "self-cleans");

  const dropped = offer(
    decide({ ...base, clean: false, changed_files: 2 }),
    "drop",
  ).consequence;
  assert(dropped.removes.includes("Task checkout"));
  assert(dropped.removes.includes("2 uncommitted changes"));
  assert(dropped.removes.includes("3 commits not on the trunk"));
  assert(dropped.removes.includes("Task metadata"));
  assert(dropped.removes.includes("Task landing grant"));
  assert(dropped.removes.includes("Task-local Proof"));
  assertStringIncludes(dropped.recoverable.join(" "), "recovery ref");

  const noProof = offer(decide({ ahead: 1 }), "park").consequence;
  assert(!noProof.removes.includes("Task-local Proof"));
});

// ── one action representation, with the behind/Accept class guard ───────────

const ACTION_CASES: ReadonlyArray<{
  name: string;
  decision: () => DeskDecision;
  enabled: readonly DeskAction[];
}> = [
  {
    name: "broken checkout",
    decision: () => decide({ broken: true }),
    enabled: ["recovery", "jump", "drop"],
  },
  {
    name: "unreadable checkout",
    decision: () =>
      decide({ git_unavailable: true, clean: undefined, ahead: undefined }),
    enabled: ["recovery", "jump", "drop"],
  },
  {
    name: "missing checkout directory",
    decision: () =>
      decide({
        git_unavailable: true,
        clean: undefined,
        ahead: undefined,
        filesystem: { state: "missing" },
      }),
    enabled: ["recovery", "drop"],
  },
  {
    name: "unreadable env file",
    decision: () =>
      decide({
        read_failure: { file: ".env.local", reason: "Permission denied" },
      }),
    enabled: ["recovery", "jump", "drop"],
  },
  {
    name: "repairable setup",
    decision: () =>
      decide({
        setup: {
          state: "incomplete",
          marker: "missing",
          repair: {
            kind: "retry",
            command: "discern worktree setup",
            reason: "The ready marker is missing.",
          },
        },
      }),
    enabled: ["recovery", "retry_setup", "jump", "drop"],
  },
  {
    name: "clean committed work awaiting final checks",
    decision: () => decide({ ahead: 2 }),
    enabled: [
      "done",
      "accept",
      "submit",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "grant",
      "park",
      "drop",
    ],
  },
  {
    name: "ready work with an effort grant",
    decision: () =>
      decide({
        ahead: 2,
        gate_proof: { status: "honored" },
        landing_authority: { kind: "authorized", source: "effort-grant" },
      }),
    enabled: [
      "done",
      "accept",
      "submit",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "revoke_grant",
      "park",
      "drop",
    ],
  },
  {
    name: "branch behind main",
    decision: () => decide({ ahead: 2, behind: 1 }),
    enabled: [
      "submit",
      "update",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "grant",
      "park",
      "drop",
    ],
  },
  {
    name: "contained branch",
    decision: () => decide({ ahead: 2, contained_in: "agent/next" }),
    enabled: [
      "done",
      "accept",
      "submit",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "grant",
      "reclaim",
      "drop",
    ],
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
    enabled: [
      "submit",
      "agent",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "grant",
      "drop",
    ],
  },
  {
    name: "live discern operation",
    decision: () =>
      decide({
        ahead: 2,
        running: { verb: "done", started: minutesAgo(1), elapsed_ms: 1_000 },
      }, { scripts: [{ name: "verify" }], agentLaunches: [AGENT_LAUNCH] }),
    enabled: ["follow_up", "jump", "inspect", "grant"],
  },
  {
    name: "empty task",
    decision: () => decide(),
    enabled: [
      "submit",
      "follow_up",
      "scripts",
      "jump",
      "inspect",
      "rename",
      "grant",
      "park",
      "drop",
    ],
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
      } else {
        enabledPopulation.add(candidate.action);
      }
    }
  }
  assertEquals([...enabledPopulation].sort(), [...DESK_ACTIONS].sort());
  assertEquals(
    [...disabledPopulation].sort(),
    [...DESK_ACTIONS].sort(),
    "every conditionally available action must have a refusal case",
  );
  assertEquals(
    Object.keys(DESK_ACTION_REGISTRY).sort(),
    [...DESK_ACTIONS].sort(),
    "a new action must add label and group metadata",
  );
});

Deno.test("each unreadable subject names what discern could not read", () => {
  const cases: ReadonlyArray<{
    name: string;
    over: Partial<StatusFleetEntry>;
    headline: string;
    attention: string;
    finalChecks: string;
    failure: string;
    nextStep: string;
  }> = [
    {
      name: "Git state",
      over: {
        git_unavailable: true,
        git_failure: { command: "git status", reason: "index unreadable" },
        clean: undefined,
        changed_files: undefined,
        ahead: undefined,
        behind: undefined,
      },
      headline: "Git state unreadable",
      attention: "Git could not read this checkout.",
      finalChecks: "Git state is unreadable. Repair Git before final checks.",
      failure: "index unreadable",
      nextStep: "Run discern doctor.",
    },
    {
      name: "an env file",
      over: { read_failure: { file: ".env.local", reason: "denied" } },
      headline: "Env file unreadable",
      attention:
        "discern could not read the env file `.env.local` in this checkout.",
      finalChecks:
        "The env file .env.local is unreadable. Make it readable before final checks.",
      failure: "denied",
      nextStep: "Make .env.local a readable file, then run discern status.",
    },
    {
      name: "the checkout's other files",
      over: { read_failure: { reason: "denied" } },
      headline: "Checkout files unreadable",
      attention: "discern could not read this checkout's files.",
      finalChecks:
        "The checkout's files are unreadable. Follow the task's recovery steps before final checks.",
      failure: "denied",
      nextStep: "Run discern doctor.",
    },
  ];
  for (const testCase of cases) {
    const row = presentFleetRow(entry(testCase.over), {
      trunk: TRUNK,
      nowMs: NOW,
    });
    assertEquals(row.kind, "unreadable", testCase.name);
    assertStringIncludes(row.attention ?? "", testCase.attention);
    const decision = decide(testCase.over);
    assertEquals(decision.headline, testCase.headline, testCase.name);
    const done = offer(decision, "done");
    assert(done.availability === "disabled", testCase.name);
    assertEquals(done.reason, testCase.finalChecks, testCase.name);
    assertEquals(decision.recovery?.failure, testCase.failure, testCase.name);
    assertEquals(decision.recovery?.nextStep, testCase.nextStep);
  }
});

Deno.test("cleanup never claims no resources when their record is unreadable", () => {
  const known = offer(decide({ resources: {} }), "drop").consequence;
  assert(known.changes.includes("No external resources are recorded"));
  const unknown = offer(
    decide({ read_failure: { file: ".env.local", reason: "denied" } }),
    "drop",
  ).consequence;
  assert(
    unknown.changes.includes("Recorded resource handles cannot be read"),
    JSON.stringify(unknown.changes),
  );
});

Deno.test("landing authority stays editable while final checks run", () => {
  const running = {
    verb: "done",
    started: minutesAgo(1),
    elapsed_ms: 1_000,
    typical_duration_ms: 60_000,
  };
  const ungranted = decide({ ahead: 2, running });
  const runningReason = "discern done is running. It usually takes 1m.";
  for (const candidate of ungranted.actions) {
    const blockedByRunning = candidate.availability === "disabled" &&
      candidate.reason === runningReason;
    assertEquals(
      blockedByRunning,
      !DESK_ACTION_REGISTRY[candidate.action].availableWhileRunning,
      `${candidate.action}: running compatibility must come from its canonical metadata`,
    );
  }
  assertEquals(offer(ungranted, "grant").availability, "enabled");
  const rename = offer(ungranted, "rename");
  assertEquals(rename.availability, "disabled");
  assert(rename.availability === "disabled");
  assertEquals(rename.reason, runningReason);

  const granted = decide({
    ahead: 2,
    running,
    landing_authority: { kind: "authorized", source: "effort-grant" },
  });
  assertEquals(offer(granted, "revoke_grant").availability, "enabled");
});

Deno.test("a proven branch behind main keeps Accept enabled : the landing composes the moved trunk", () => {
  const decision = decide({
    clean: true,
    ahead: 2,
    behind: 1,
    gate_proof: { status: "honored" },
  });
  assertEquals(offer(decision, "accept").availability, "enabled");
  assertEquals(offer(decision, "update").availability, "enabled");
});

Deno.test("an unproven branch behind main disables Accept", () => {
  const decision = decide({
    clean: true,
    ahead: 2,
    behind: 1,
  });
  const accept = offer(decision, "accept");
  assertEquals(accept.availability, "disabled");
  if (accept.availability === "disabled") {
    assertEquals(accept.reason, "1 commit behind main.");
  }
  assertEquals(offer(decision, "update").availability, "enabled");
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
Deno.test("buildDeskRows excludes main, carries collisions, and sorts by title and stable identity", () => {
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
      "agent/empty",
      "agent/paused",
      "agent/ready",
      "agent/working",
    ],
  );
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
  assertEquals(empty.headline, "No work to review");
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

Deno.test("stored briefs change argv only through a documented provider contract", () => {
  const config = configSchema.parse({
    project: {
      slug: "demo",
      agents: ["gemini", "claude_code", "codex", "cursor", "copilot"],
    },
    repository: { trunk: TRUNK },
  });
  const current = buildAgentLaunches(config, [
    { name: "gemini", binary: "gemini" },
    { name: "claude_code", binary: "claude" },
    { name: "codex", binary: "codex" },
    { name: "cursor", binary: "cursor-agent" },
    { name: "copilot", binary: "copilot" },
  ]);
  for (const launch of current) {
    assertEquals(launch.promptArgument, undefined, launch.id);
    assertEquals(agentLaunchArgs(launch, "Keep Unicode wording 修复."), {
      args: launch.args,
      briefPassed: false,
    });
  }

  const documented: DeskAgentLaunch = {
    ...AGENT_LAUNCH,
    args: ["open"],
    promptArgument: {
      kind: "option",
      flag: "--prompt",
      documentation: "https://provider.example/cli#prompt",
    },
  };
  assertEquals(agentLaunchArgs(documented, "Keep Unicode wording 修复."), {
    args: ["open", "--prompt", "Keep Unicode wording 修复."],
    briefPassed: true,
  });
  assertEquals(agentLaunchArgs(documented, undefined), {
    args: ["open"],
    briefPassed: false,
  });
});
