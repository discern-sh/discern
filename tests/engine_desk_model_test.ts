/**
 * The Desk's forcing function: status owns row meaning, the Desk adapts every
 * status kind into one human decision, and every action is represented exactly
 * once with an observed availability reason.
 */

import { assertCases } from "./assert_cases.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { configSchema } from "../src/shared/config_schema.ts";
import {
  GATE_PROOF_CHECK_STATUSES,
  type GateProofCheckStatus,
  type StatusData,
  type StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import type { DetectedAgentBinary } from "../src/lib/detect_agents.ts";
import { exceptionProof, observedFleetEntry } from "./status_fleet.ts";
import {
  agentLaunchArgs,
  buildAgentLaunches,
  buildDeskDecision,
  buildDeskRows,
  consequenceLines,
  DESK_ACTION_REGISTRY,
  DESK_ACTION_SECTIONS,
  DESK_ACTIONS,
  type DeskAction,
  type DeskActionOffer,
  type DeskAgentLaunch,
  type DeskConsequenceMark,
  type DeskDecision,
  deskExceptionArgvs,
  deskMainCheckoutFacts,
  taskLabel,
} from "../src/engine/desk/model.ts";
import type { DeskPlanFacts } from "../src/engine/desk/review_facts.ts";
import { presentFleetRow } from "../src/engine/status/fleet_rows.ts";
import {
  exceptionArgv,
  FLEET_ROW_STATUS_KINDS,
  type FleetRowStatusKind,
} from "../src/engine/status/row_facts.ts";
import { commandEvidence } from "../src/shared/command_evidence.ts";

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
  return observedFleetEntry({
    branch,
    path: `/tmp/fleet/${branch}`,
    last_activity: daysAgo(0),
    gate_proof: { status: "missing" },
    ...over,
  });
}

/**
 * Build a complete decision from the standard fixture and optional evidence,
 * after discovery found no agents unless `options` says otherwise.
 */
function decide(
  over: Partial<StatusFleetEntry> = {},
  options: Partial<Parameters<typeof buildDeskDecision>[1]> = {},
): DeskDecision {
  return buildDeskDecision(entry(over), {
    trunk: TRUNK,
    nowMs: NOW,
    agentLaunches: [],
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

/** One action's consequence lines that carry a mark, for a decision and
 * what its preview found. */
function lines(
  decision: DeskDecision,
  action: DeskAction,
  mark: DeskConsequenceMark,
  plan: DeskPlanFacts = {},
): string[] {
  return consequenceLines(action, { context: decision.context, plan })
    .flatMap((line) => line.mark === mark ? [line.text] : []);
}

/** Every fact line a decision lists, for substring checks. */
function detailText(decision: DeskDecision): string {
  return decision.details.map((detail) => detail.text).join(" · ");
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

Deno.test("Desk decisions preserve typed state, evidence, authority, and action contracts", () => {
  const cases = [
    {
      name: "every status kind maps to exactly one Desk decision state",
      check: () => {
        assertEquals(
          STATUS_KIND_CASES.map((testCase) => testCase.kind).sort(),
          [...FLEET_ROW_STATUS_KINDS].sort(),
          "a new status kind must add an explicit Desk fixture",
        );
        for (const testCase of STATUS_KIND_CASES) {
          const surveyEntry = entry(testCase.over);
          const status = presentFleetRow(surveyEntry, {
            trunk: TRUNK,
            nowMs: NOW,
          });
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
      },
    },
    {
      name: "status precedence boundaries remain identical in the Desk",
      check: () => {
        const cases: ReadonlyArray<{
          name: string;
          over: Partial<StatusFleetEntry>;
          kind: FleetRowStatusKind;
        }> = [
          {
            name: "broken outranks a running Gate",
            over: {
              broken: true,
              running: {
                verb: "done",
                started: minutesAgo(1),
                elapsed_ms: 1_000,
              },
            },
            kind: "broken",
          },
          {
            name: "running outranks a previous failed action and branch lag",
            over: {
              ahead: 1,
              behind: 2,
              last_action: {
                verb: "done",
                outcome: "failed",
                at: minutesAgo(2),
              },
              running: {
                verb: "done",
                started: minutesAgo(1),
                elapsed_ms: 1_000,
              },
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
      },
    },
    {
      name:
        "running, failed, refused, partial, and successful outcomes stay factual",
      check: () => {
        const cases: ReadonlyArray<{
          over: Partial<StatusFleetEntry>;
          kind: FleetRowStatusKind;
          state: DeskDecision["state"];
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
            state: "checks-failed",
          },
          {
            over: {
              ahead: 1,
              last_action: {
                verb: "refresh",
                outcome: "partial",
                at: minutesAgo(3),
              },
            },
            kind: "failed",
            state: "failed",
          },
          {
            over: {
              ahead: 1,
              last_action: {
                verb: "accept",
                outcome: "refused",
                at: minutesAgo(3),
              },
            },
            kind: "blocked",
            state: "refused",
          },
          {
            over: {
              ahead: 1,
              last_action: { verb: "status", outcome: "ok", at: minutesAgo(3) },
            },
            kind: "needs-gate",
            state: "needs-checks",
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
            state: "checking",
          },
        ];
        for (const testCase of cases) {
          const decision = decide(testCase.over);
          assertEquals(decision.statusKind, testCase.kind);
          assertEquals(decision.state, testCase.state);
        }
        const running = decide(cases[4]?.over ?? {});
        assertEquals(
          running.details.filter((detail) => detail.kind === "activity").map((
            detail,
          ) => detail.text),
          ["active now", "Usually 2m"],
        );
      },
    },
    {
      name:
        "every gate-Proof status reaches the decision without compatibility drift",
      check: () => {
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
              ...(["stale", "unavailable", "read_failed"].includes(
                  testCase.status,
                )
                ? { reason: `${testCase.status} reason` }
                : {}),
            },
          });
          assertEquals(decision.proof.status, testCase.status, testCase.status);
          assertEquals(decision.proof.honored, testCase.status === "honored");
          assertEquals(decision.statusKind, testCase.kind, testCase.status);
        }
      },
    },
    {
      name:
        "the complete gate-Proof inspection outranks honored compatibility text",
      check: () => {
        const decision = decide({
          ahead: 2,
          gate_proof: { status: "stale", recorded: "aaa", head: "bbb" },
          proof_honored: true,
          proof: "old rendered Proof",
          proof_line: "old Proof line",
        });
        assertEquals(decision.proof.status, "stale");
        assertEquals(decision.statusKind, "proof-stale");
      },
    },
    {
      name:
        "task activity and the exact Proof line cross the decision boundary",
      check: () => {
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
        // Activity reads in status's words: one vocabulary for one fact.
        assertEquals(running.activity, "just now · usually 2m");
        assertEquals(
          running.proof.line,
          "Proof: agent/x abcdef0 · gate passed",
        );

        const completed = decide({
          last_action: {
            verb: "done",
            outcome: "failed",
            at: minutesAgo(3),
            failed_stage: "test",
          },
        });
        assertStringIncludes(
          completed.activity,
          "last action done failed at test",
        );
        assertEquals(
          decide({ last_activity: undefined }).activity,
          "no activity recorded",
        );
      },
    },
    {
      name: "standing, effort, scoped, and absent authority remain distinct",
      check: () => {
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

        assertEquals(effort.authority, {
          status: "granted",
          source: "effort-grant",
          summary: "Pre-authorized by you",
        });
        assertEquals(offer(effort, "revoke_grant").availability, "enabled");
        assertEquals(offer(effort, "grant").availability, "disabled");

        assertEquals(standing.authority, {
          status: "granted",
          source: "standing-grant",
          summary: "Covered by your standing approval (map)",
        });
        assertEquals(offer(standing, "grant").availability, "enabled");

        assertEquals(scoped.authority, {
          status: "needs_approval",
          summary: "Needs your approval · 1 path isn't covered",
        });
        assertEquals(absent.authority, {
          status: "needs_approval",
          summary: "Needs your approval",
        });
      },
    },
    {
      name:
        "advisory collisions retain facts without changing state or recommending an action",
      check: () => {
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
        assertEquals(
          decision.statusKind,
          "ready",
          "collision is not a row status",
        );
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
        assertStringIncludes(detailText(decision), "3 changed files overlap");
        assertStringIncludes(detailText(decision), "ADR 0284");

        const unrelated = decide({ branch: "agent/delta", ahead: 1 }, {
          fleetCollisions: [{
            branches: ["agent/alpha", "agent/beta"],
            overlap: ["src/shared.ts"],
            total: 1,
          }],
        });
        assertEquals(unrelated.collisions, []);
      },
    },
    {
      name: "a contained task names its live successor and offers reclaim",
      check: () => {
        const decision = decide({
          ahead: 2,
          contained_in: "agent/next-stage",
        });
        assertEquals(decision.state, "contained");
        assertEquals(decision.next?.action, "reclaim");
        assertEquals(offer(decision, "reclaim").availability, "enabled");
        assertStringIncludes(
          offer(decision, "reclaim").summary,
          "agent/next-stage",
        );
      },
    },
    {
      name: "Park, Reclaim, and Drop retain distinct artifact contracts",
      check: () => {
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
        const parked = decide(base);
        const parkPlan = { endsGrant: true, removesProof: true };
        assertStringIncludes(
          lines(parked, "park", "keeps").join(" "),
          task.branch,
        );
        assertStringIncludes(
          lines(parked, "park", "keeps").join(" "),
          "title and brief",
        );
        assertEquals(lines(parked, "park", "removes", parkPlan), [
          "Removes its Proof",
          "Ends its pre-authorization",
          "Destroys its ports and services",
        ]);
        assertEquals(lines(parked, "park", "discards", parkPlan), []);
        assertStringIncludes(
          lines(parked, "park", "recoverable").join(" "),
          "Resume",
        );

        const reclaimed = decide({
          ...base,
          contained_in: "agent/later-stage",
        });
        assertEquals(lines(reclaimed, "reclaim", "keeps"), [
          "Keeps the branch",
        ]);
        assertStringIncludes(
          lines(reclaimed, "reclaim", "changes").join(" "),
          "agent/later-stage",
        );
        assertStringIncludes(
          lines(reclaimed, "reclaim", "recoverable").join(" "),
          "cleans itself up",
        );

        const dropped = decide({ ...base, clean: false, changed_files: 2 });
        const dropPlan = {
          discards: ["3 commits not on main", "2 uncommitted changes"],
          endsGrant: true,
        };
        assertEquals(lines(dropped, "drop", "discards", dropPlan), [
          "Discards 3 commits not on main",
          "Discards 2 uncommitted changes",
        ]);
        assertEquals(lines(dropped, "drop", "removes", dropPlan), [
          `Removes its checkout and branch ${task.branch}`,
          "Removes its title and brief",
          "Removes its Proof",
          "Ends its pre-authorization",
          "Destroys its ports and services",
        ]);
        assertStringIncludes(
          lines(dropped, "drop", "recoverable").join(" "),
          "last commit is kept",
        );

        assertEquals(
          lines(decide({ ahead: 1 }), "park", "removes", {
            removesProof: false,
          }),
          [],
        );
      },
    },
    {
      name:
        "every action is offered once with closed metadata and concrete availability",
      check: () => {
        const enabledPopulation = new Set<DeskAction>();
        const disabledPopulation = new Set<DeskAction>();
        for (const testCase of ACTION_CASES) {
          const decision = testCase.decision();
          assertEquals(
            decision.actions.map((candidate) => candidate.action),
            [...DESK_ACTIONS],
            `${testCase.name}: every action exactly once and in canonical order`,
          );
          assertEquals(
            enabledActions(decision),
            testCase.enabled,
            testCase.name,
          );
          for (const candidate of decision.actions) {
            assert(
              candidate.label.trim().length > 0,
              `${candidate.action}: label`,
            );
            assert(
              DESK_ACTION_SECTIONS.includes(candidate.section),
              `${candidate.action}: canonical section`,
            );
            assert(
              candidate.command.argv.length > 0,
              `${candidate.action}: command`,
            );
            assert(
              candidate.command.argv.every((argument) =>
                argument.trim().length > 0
              ),
              `${candidate.action}: command argument`,
            );
            const consequences = consequenceLines(candidate.action, {
              context: decision.context,
              plan: {},
            });
            assert(
              consequences.length > 0 &&
                consequences.every((line) => line.text.trim().length > 0),
              `${candidate.action}: consequence`,
            );
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
      },
    },
    {
      name: "each unreadable subject names what discern could not read",
      check: () => {
        const cases: ReadonlyArray<{
          name: string;
          over: Partial<StatusFleetEntry>;
          attention: string;
          finalChecks: string;
          failure: string;
          nextStep: string;
        }> = [
          {
            name: "Git state",
            over: {
              git_unavailable: true,
              git_failure: {
                command: "git status",
                reason: "index unreadable",
              },
              clean: undefined,
              changed_files: undefined,
              ahead: undefined,
              behind: undefined,
            },
            attention: "Git could not read this checkout.",
            finalChecks:
              "Git state is unreadable. Repair Git before final checks.",
            failure: "index unreadable",
            nextStep: "Run discern doctor.",
          },
          {
            name: "an env file",
            over: { read_failure: { file: ".env.local", reason: "denied" } },
            attention:
              "discern could not read the env file `.env.local` in this checkout.",
            finalChecks:
              "The env file .env.local is unreadable. Make it readable before final checks.",
            failure: "denied",
            nextStep:
              "Make .env.local a readable file, then run discern status.",
          },
          {
            name: "the checkout's other files",
            over: { read_failure: { reason: "denied" } },
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
          assertEquals(decision.state, "unreadable", testCase.name);
          assertEquals(decision.next?.action, "recovery", testCase.name);
          const done = offer(decision, "done");
          assert(done.availability === "disabled", testCase.name);
          assertEquals(done.reason, testCase.finalChecks, testCase.name);
          assertEquals(
            decision.recovery?.failure,
            testCase.failure,
            testCase.name,
          );
          assertEquals(decision.recovery?.nextStep, testCase.nextStep);
        }
      },
    },
    {
      name: "cleanup never claims no resources when their record is unreadable",
      check: () => {
        const known = lines(decide({ resources: {} }), "drop", "warning");
        assert(
          !known.some((text) => text.includes("ports")),
          JSON.stringify(known),
        );
        const unknown = lines(
          decide({ read_failure: { file: ".env.local", reason: "denied" } }),
          "drop",
          "warning",
        );
        assert(
          unknown.includes("Its recorded ports and services can't be read"),
          JSON.stringify(unknown),
        );
      },
    },
    {
      name: "landing authority stays editable while final checks run",
      check: () => {
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
      },
    },
    {
      name:
        "a proven branch behind main keeps Accept enabled : the landing composes the moved trunk",
      check: () => {
        const decision = decide({
          clean: true,
          ahead: 2,
          behind: 1,
          gate_proof: { status: "honored" },
        });
        assertEquals(offer(decision, "accept").availability, "enabled");
        assertEquals(offer(decision, "update").availability, "enabled");
      },
    },
    {
      name: "an unproven branch behind main disables Accept",
      check: () => {
        const decision = decide({
          clean: true,
          ahead: 2,
          behind: 1,
        });
        const accept = offer(decision, "accept");
        assertEquals(accept.availability, "disabled");
        if (accept.availability === "disabled") {
          assertEquals(
            accept.reason,
            "1 commit behind main. Update it, then run checks.",
          );
        }
        assertEquals(offer(decision, "update").availability, "enabled");
      },
    },
    {
      name:
        "unknown divergence disables actions that require trustworthy counts",
      check: () => {
        const decision = decide({
          ahead: "unknown",
          behind: "unknown",
          gate_proof: { status: "honored" },
        });
        for (const action of ["accept", "update"] as const) {
          const candidate = offer(decision, action);
          assertEquals(candidate.availability, "disabled");
          if (candidate.availability === "disabled") {
            assertEquals(
              candidate.reason,
              "Git divergence from main is unknown.",
            );
          }
        }
        assertStringIncludes(
          detailText(decision),
          "Ahead count versus main unavailable",
        );
        assertStringIncludes(
          detailText(decision),
          "Behind count versus main unavailable",
        );
      },
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    row.check();
  });
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

// ── collision and desk-only capability evidence ─────────────────────────────

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
    // Landing and queueing need an honored Proof, so unproven work offers
    // only the checks that would make it landable.
    name: "clean committed work awaiting final checks",
    decision: () => decide({ ahead: 2 }),
    enabled: [
      "done",
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
    // Unproven work behind main updates first; it cannot queue.
    name: "branch behind main",
    decision: () => decide({ ahead: 2, behind: 1 }),
    enabled: [
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
      }, { agentLaunches: [AGENT_LAUNCH] }),
    // Uncommitted work cannot queue: the queue records a proven commit.
    enabled: [
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
      }, { agentLaunches: [AGENT_LAUNCH] }),
    // Project code holds no exclusion boundary: an agent may look in while
    // the task's own checks run.
    enabled: ["agent", "follow_up", "jump", "inspect", "grant"],
  },
  {
    name: "empty task",
    decision: () => decide(),
    enabled: [
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

// ── row construction, ordering, and factual copy ────────────────────────────
Deno.test("buildDeskRows excludes main and integration copies, and sorts by group, then title", () => {
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
    entry({
      branch: "integration/ready",
      path: "/p/integration-ready",
      integration: { owner: "live", for_branch: "agent/ready" },
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
    rows.map((row) => [row.decision.group, row.entry.branch]),
    [
      ["review", "agent/attention-new"],
      ["attention", "agent/attention-old"],
      ["working", "agent/ready"],
      ["working", "agent/working"],
      ["idle", "agent/empty"],
      ["idle", "agent/paused"],
    ],
  );
  assertEquals(
    rows.find((row) => row.entry.branch === "agent/ready")?.decision.state,
    "landing",
    "a landing's integration copy speaks through its task's row",
  );
  assertEquals(
    buildDeskRows(
      [
        entry({ branch: "agent/zebra", path: "/p/zebra" }),
        entry({ branch: "agent/eclair", path: "/p/éclair" }),
        entry({ branch: "agent/apple", path: "/p/Apple" }),
      ],
      new Map(),
      new Map(),
      { trunk: TRUNK, nowMs: NOW },
    ).map((row) => row.task.name),
    ["Apple", "Éclair", "Zebra"],
    "titles collate case-folded and accent-aware",
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
  assertEquals(dirty.state, "editing");
  assertStringIncludes(detailText(dirty), "1 uncommitted file");
  assertStringIncludes(detailText(dirty), "2 commits ahead of main");
  assertStringIncludes(detailText(dirty), "active now");
  assertStringIncludes(detailText(dirty), "Checks: Not run on these changes");
  assert(!detailText(dirty).includes(" · now"));

  const gate = decide({ ahead: 2 });
  assertEquals(gate.state, "needs-checks");
  assertEquals(gate.next?.action, "done");
  assertEquals(
    offer(gate, "done").summary,
    "Run this project's checks on the committed work",
  );

  const empty = decide();
  assertEquals(empty.state, "empty");
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

Deno.test("Desk agent launches preserve configured availability and provider brief contracts", () => {
  const cases = [
    {
      name:
        "buildAgentLaunches preserves configured agents and explains missing binaries",
      check: () => {
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
      },
    },
    {
      name: "buildAgentLaunches respects an explicitly empty agent set",
      check: () => {
        const config = configSchema.parse({
          project: { slug: "demo", agents: [] },
          repository: { trunk: TRUNK },
        });
        assertEquals(
          buildAgentLaunches(config, [{ name: "codex", binary: "codex" }]),
          [],
        );
      },
    },
    {
      name:
        "stored briefs change argv only through a documented provider contract",
      check: () => {
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
        assertEquals(
          agentLaunchArgs(documented, "Keep Unicode wording 修复."),
          {
            args: ["open", "--prompt", "Keep Unicode wording 修复."],
            briefPassed: true,
          },
        );
        assertEquals(agentLaunchArgs(documented, undefined), {
          args: ["open"],
          briefPassed: false,
        });
      },
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    row.check();
  });
});

// ── known landing refusals stay disabled with their exact reason ────────────

Deno.test("Land hands owner exceptions to the CLI and waits for a landable main", async () => {
  const branch = "agent/x";
  const cases = [
    { name: "checkpoint only", proof: exceptionProof(["exactness"]) },
    { name: "standard only", proof: exceptionProof([], ["sources"]) },
    {
      name: "mixed",
      proof: exceptionProof(["exactness", "naming"], ["sources", "coverage"]),
    },
  ];
  for (const testCase of cases) {
    const surveyed = entry({
      ahead: 1,
      gate_proof: { status: "honored", proof_data: testCase.proof },
    });
    const argvs = await deskExceptionArgvs({ fleet: [surveyed] });
    const exact = await exceptionArgv(branch, testCase.proof);
    assertEquals(argvs.get(branch), exact, testCase.name);
    const decision = buildDeskDecision(surveyed, {
      trunk: TRUNK,
      nowMs: NOW,
      exceptionArgvs: argvs,
    });
    assertEquals(decision.state, "exception", testCase.name);
    const accept = offer(decision, "accept");
    assert(accept.availability === "disabled", testCase.name);
    assertEquals(
      accept.reason,
      `Needs your exception, which the desk can't record yet. Run in a terminal: ${
        commandEvidence(exact)
      }`,
      testCase.name,
    );
    const unobserved = offer(decide(surveyed), "accept");
    assert(unobserved.availability === "disabled", testCase.name);
    assertEquals(
      unobserved.reason.includes("<standard-token>"),
      (testCase.proof.standard_proposals?.length ?? 0) > 0,
      `${testCase.name}: without the observation's tokens the reason names their place`,
    );
  }

  const proven = { ahead: 1, gate_proof: { status: "honored" as const } };
  const mainGit = (patch: Partial<NonNullable<StatusData["git"]>>) =>
    deskMainCheckoutFacts({
      git: {
        branch: "main",
        trunk: "main",
        clean: true,
        changed_files: 0,
        tracked_changes: 0,
        behind_trunk: 0,
        ahead_trunk: 0,
        ...patch,
      },
    });
  const refusals = [
    [
      "tracked changes",
      mainGit({ clean: false, changed_files: 1, tracked_changes: 1 }),
      "The main checkout has uncommitted tracked changes",
    ],
    [
      "another branch",
      mainGit({ branch: "spike" }),
      "The main checkout is on spike, not main",
    ],
  ] as const;
  for (const [name, mainCheckout, reason] of refusals) {
    const decision = decide(proven, { mainCheckout });
    const accept = offer(decision, "accept");
    assert(accept.availability === "disabled", name);
    assertStringIncludes(accept.reason, reason, name);
    assertEquals(
      offer(decision, "submit").availability,
      "enabled",
      `${name}: queueing records the version without touching main`,
    );
  }
  // Acceptance refuses only on tracked changes and the checked-out branch:
  // an untracked file, or generated files a landing refreshes afterwards,
  // never block it.
  for (
    const [name, mainCheckout] of [
      [
        "an untracked file",
        mainGit({ clean: false, changed_files: 1, tracked_changes: 0 }),
      ],
      [
        "an older observation of a clean checkout",
        deskMainCheckoutFacts({
          git: {
            branch: "main",
            trunk: "main",
            clean: true,
            changed_files: 0,
            behind_trunk: 0,
            ahead_trunk: 0,
          },
        }),
      ],
      ["no observation", {}],
    ] as const
  ) {
    assertEquals(
      offer(decide(proven, { mainCheckout }), "accept").availability,
      "enabled",
      name,
    );
  }
});
