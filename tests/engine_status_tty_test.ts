/** Pure width and semantic-state guards for the static status dashboard. */

import { assertCases } from "./assert_cases.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { unexpectedTerminalControls } from "./helpers.ts";
import { displayWidth } from "../src/lib/text.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import {
  fire,
  type HintDef,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../src/shared/hints.ts";
import {
  GATE_PROOF_CHECK_STATUSES,
  type GateProofCheckData,
  type GateProofCheckStatus,
  type StatusData,
  type StatusFleetCollision,
  type StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { fleetEntry, mainFleetEntry, statusData } from "./status_fleet.ts";
import {
  renderStatusDashboard,
  STATUS_REPORT_MAX_WIDTH,
} from "../src/engine/status/tty.ts";
import {
  type FleetRowPresentationOptions,
  listedFleetTasks,
  presentFleetRow,
  sortFleetRows,
} from "../src/engine/status/fleet_rows.ts";
import {
  FLEET_ROW_STATUS_KINDS,
  type FleetRowStatusKind,
} from "../src/engine/status/row_facts.ts";
import { prioritizeStatusFleet } from "../src/engine/status/status.ts";
import { projectStatusData } from "../src/shared/result_wire.ts";

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");
const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

/** Strip styling while preserving every visible word and glyph. */
function plain(text: string): string {
  return text.replace(ANSI, "");
}

/** Compare responsive prose without treating package wrapping as text loss. */
function squash(text: string): string {
  return plain(text).replaceAll(/\s+/gu, " ").trim();
}

/** One ordinary healthy fleet row, patched by a semantic-state case. */
function entry(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return fleetEntry({
    path: "/repo.worktrees/alpha-abc123",
    branch: "agent/alpha-abc123",
    id: "alpha-abc123",
    last_activity: "2026-08-03T11:00:00.000Z",
    gate_proof: { status: "missing" },
    ...patch,
  });
}

/** Main-checkout row carried by the fleet collector. */
function mainEntry(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return mainFleetEntry("/repo", {
    last_activity: "2026-08-03T11:30:00.000Z",
    ...patch,
  });
}

/** Complete status envelope data for pure dashboard fixtures. */
function data(
  fleet: StatusFleetEntry[] | undefined,
  patch: Partial<StatusData> = {},
): StatusData {
  return statusData(fleet, {
    root: "/repo",
    project: "voyager",
    git: {
      branch: "main",
      trunk: "main",
      clean: true,
      changed_files: 0,
      behind_trunk: null,
      ahead_trunk: 0,
    },
    standards: ["coverage", "plain_reading_grade"],
    ...patch,
  });
}

/** Render a fixture at a deterministic clock. */
function render(
  value: StatusData,
  width: number,
  color = false,
  hints?: readonly string[],
  verbose = false,
): string {
  return renderStatusDashboard(value, hints, {
    terminal: terminal(width, color),
    width,
    verbose,
    nowMs: NOW,
  });
}

/** Explicit process facts for one deterministic package capability mode. */
function terminal(width: number, color: boolean): TerminalContext {
  return terminalMode(width, color ? "truecolor" : "no-color");
}

type TerminalFixtureMode =
  | "no-color"
  | "ansi16"
  | "ansi256"
  | "truecolor"
  | "ascii";

/** Resolve every supported package degradation mode from explicit facts. */
function terminalMode(
  width: number,
  mode: TerminalFixtureMode,
): TerminalContext {
  const values: Readonly<Record<string, string>> = mode === "ascii"
    ? { TERM: "dumb", LANG: "C", LC_ALL: "C" }
    : mode === "ansi16"
    ? { TERM: "xterm-color", LANG: "en_US.UTF-8" }
    : mode === "truecolor"
    ? { TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" }
    : { TERM: "xterm-256color", LANG: "en_US.UTF-8" };
  return resolveTerminalContext({
    noColor: mode === "no-color" || mode === "ascii",
    env: { get: (name: string): string | undefined => values[name] },
    isTerminal: () => true,
    consoleSize: () => ({ columns: width, rows: 24 }),
  });
}

/** Assert the width cure: only isolated, explicitly named identities may overflow. */
function assertLinesFit(
  output: string,
  width: number,
  overflowIdentities: readonly string[] = [],
): void {
  const budget = Math.min(width, STATUS_REPORT_MAX_WIDTH);
  for (const styled of output.split("\n")) {
    if (displayWidth(styled) <= budget) continue;
    const line = plain(styled).trimStart();
    const identity = overflowIdentities.some((value) =>
      line === value || line === `Persona: ${value}` ||
      line === `Worktree: ${value}` ||
      line === `Branch: ${value}`
    );
    assert(
      identity,
      `${budget}-column line is ${displayWidth(styled)} columns: ${line}`,
    );
  }
}

interface StatusCase {
  patch: Partial<StatusFleetEntry>;
  collisions?: readonly StatusFleetCollision[];
}

const STATUS_CASES: Record<FleetRowStatusKind, StatusCase> = {
  broken: { patch: { broken: true } },
  "setup-incomplete": {
    patch: {
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
  unreadable: { patch: { git_unavailable: true } },
  failed: {
    patch: {
      last_action: {
        verb: "done",
        outcome: "failed",
        at: "2026-08-03T11:50:00.000Z",
        failed_stage: "test",
      },
    },
  },
  blocked: {
    patch: {
      last_action: {
        verb: "accept",
        outcome: "refused",
        at: "2026-08-03T11:50:00.000Z",
      },
    },
  },
  behind: { patch: { behind: 3 } },
  ready: {
    patch: {
      ahead: 2,
      gate_proof: { status: "honored" },
      proof_honored: true,
    },
  },
  running: {
    patch: {
      clean: false,
      changed_files: 2,
      running: {
        verb: "done",
        started: "2026-08-03T11:58:00.000Z",
        elapsed_ms: 120_000,
        typical_duration_ms: 120_000,
      },
      last_action: {
        verb: "done",
        outcome: "failed",
        at: "2026-08-03T11:30:00.000Z",
        failed_stage: "test",
      },
      gate_proof: { status: "dirty" },
    },
  },
  stale: {
    patch: {
      clean: false,
      changed_files: 2,
      last_activity: "2026-07-20T12:00:00.000Z",
      gate_proof: { status: "dirty" },
    },
  },
  "in-progress": {
    patch: {
      clean: false,
      changed_files: 2,
      last_activity: "2026-08-03T11:55:00.000Z",
      gate_proof: { status: "dirty" },
    },
  },
  "proof-unreadable": {
    patch: { gate_proof: { status: "read_failed", reason: "bad marker" } },
  },
  "proof-unavailable": {
    patch: { gate_proof: { status: "unavailable", reason: "no admin dir" } },
  },
  "proof-stale": {
    patch: {
      gate_proof: {
        status: "stale",
        recorded: "aaaaaaaaaaaa9999",
        head: "bbbbbbbbbbbb9999",
      },
    },
  },
  "needs-gate": { patch: { ahead: 2 } },
  idle: { patch: {} },
};

Deno.test("status dashboards preserve complete facts across layout and terminal capabilities", () => {
  const cases = [
    {
      name:
        "status dashboard: verbose 39, 80, 104, and capped layouts keep equal color-free package facts",
      check: () => {
        const fixture = data([
          mainEntry(),
          entry(),
          entry({
            path: "/repo.worktrees/beta-def456",
            branch: "agent/beta-def456",
            id: "beta-def456",
            last_activity: "2026-08-03T10:00:00.000Z",
          }),
        ]);
        for (const width of [39, 80, 104]) {
          const noColor = render(fixture, width, false, undefined, true);
          const color = render(fixture, width, true, undefined, true);
          assertEquals(
            plain(color),
            noColor,
            `color changed words at ${width}`,
          );
          assertLinesFit(noColor, width);
          assertLinesFit(color, width);
          assertStringIncludes(noColor, "Fleet · 2 active worktrees");
          assertStringIncludes(noColor, "Worktrees");
          assertStringIncludes(
            squash(noColor),
            "Configured checks for this status",
          );
          assertStringIncludes(noColor, "DRIFT");
          assertStringIncludes(noColor, "Worktree: alpha-abc123");
          assertStringIncludes(noColor, "Branch: agent/alpha-abc123");
          assert(!noColor.includes("AGENT"), noColor);
        }
        assertEquals(
          render(fixture, 400, false, undefined, true),
          render(fixture, STATUS_REPORT_MAX_WIDTH, false, undefined, true),
        );
        assertStringIncludes(
          render(fixture, 400, false, undefined, true),
          "agent/alpha-abc123",
        );
      },
    },
    {
      name:
        "status dashboard: truecolour, 256, 16, no-colour, and ASCII modes retain semantics and inert text",
      check: () => {
        const branch = "agent/evil\u001b[31m\tbell\u0007line\nend";
        const id = "persona\u009bhidden";
        const safeBranch = "agent/evil␛[31m␉bell␇line␊end";
        const safeId = "persona<U+009B>hidden";
        const fixture = data([
          mainEntry(),
          entry({
            path: `/repo.worktrees/${id}`,
            branch,
            id,
            ahead: 1,
            behind: 2,
            is_current: true,
          }),
        ]);
        const modes = [
          "no-color",
          "ansi16",
          "ansi256",
          "truecolor",
          "ascii",
        ] as const satisfies readonly TerminalFixtureMode[];
        const expectedDepth = {
          "no-color": "none",
          ansi16: "ansi16",
          ansi256: "ansi256",
          truecolor: "truecolor",
          ascii: "none",
        } as const;
        const unicodeBaseline = renderStatusDashboard(fixture, undefined, {
          terminal: terminalMode(80, "no-color"),
          width: 80,
          nowMs: NOW,
          verbose: true,
        });
        for (const mode of modes) {
          const context = terminalMode(80, mode);
          assertEquals(context.capabilities.colorDepth, expectedDepth[mode]);
          const output = renderStatusDashboard(fixture, undefined, {
            terminal: context,
            width: 80,
            nowMs: NOW,
            verbose: true,
          });
          const words = plain(output);
          assertStringIncludes(words, safeBranch);
          assertStringIncludes(words, safeId);
          assertStringIncludes(words, "Behind");
          assertStringIncludes(words, "current");
          assert(!words.includes("\u001b[31m"));
          assert(!words.includes("\u009b"));
          assert(
            unexpectedTerminalControls(words).length === 0,
            `${mode} left a raw terminal control in package output`,
          );
          if (mode !== "ascii") {
            assertEquals(
              words,
              unicodeBaseline,
              `${mode} changed status facts`,
            );
          }
          assertLinesFit(output, 80);
        }
      },
    },
    {
      name:
        "status dashboard: responsive regions retain status, evidence, and complete actions",
      check: () => {
        const branch = "agent/behind-abc123";
        const fixture = data([
          mainEntry({ is_current: false }),
          entry({
            path: "/repo.worktrees/behind-abc123",
            branch,
            id: "behind-abc123",
            behind: 5,
            is_current: true,
          }),
        ]);

        const hints = hintTexts([
          fire(HINTS["status-branch-behind"], {
            behind: 5,
            trunk: "main",
            overlap: undefined,
          }),
        ]);
        const expectedAction = interactiveHintTexts(hints)[0];
        assert(expectedAction !== undefined);
        for (const width of [39, 80, 104, 400]) {
          for (const color of [false, true]) {
            const output = render(fixture, width, color, hints, true);
            const words = plain(output);
            assertStringIncludes(words, branch);
            assertStringIncludes(words, "Behind");
            assertStringIncludes(words, "Git");
            assertStringIncludes(words, "Proof");
            assertStringIncludes(squash(words), expectedAction);
            assertStringIncludes(words, "current");
            assertLinesFit(output, width);
          }
        }
      },
    },
    {
      name:
        "status dashboard: every long or differing identity survives every layout",
      check: () => {
        const id = `alternate-${"identity-".repeat(12)}abc123`;
        const branch = `agent/${"canonical-".repeat(12)}branch-abc123`;
        const fixture = data([
          mainEntry(),
          entry({
            path: `/repo.worktrees/${id}`,
            branch,
            id,
            is_current: true,
          }),
          entry({
            path: "/repo.worktrees/detached-def456",
            branch: "",
            id: "detached-def456",
          }),
        ]);
        for (const width of [39, 80, 104, 400]) {
          const brief = render(fixture, width, true);
          assert(!plain(brief).includes(branch), brief);
          assert(!plain(brief).includes("abc123"), brief);
          assert(!plain(brief).includes("def456"), brief);
          assertStringIncludes(plain(brief), "Alternate identity");
          assertLinesFit(brief, width);

          const output = render(fixture, width, true, undefined, true);
          const compactOutput = plain(output).replaceAll(/[\s│]/gu, "");
          assertStringIncludes(compactOutput, branch);
          assertStringIncludes(compactOutput, id);
          assertStringIncludes(plain(output), "(detached)");
          assertStringIncludes(plain(output), "current");
          assertLinesFit(output, width);
        }
        assertEquals(
          plain(render(fixture, 104, true, undefined, true)),
          render(fixture, 104, false, undefined, true),
          "styling must not alter either operational identity",
        );
        assertEquals(
          presentFleetRow(entry({ branch: "plain-id", id: "plain-id" }), {
            trunk: "main",
            nowMs: NOW,
          }).identity.secondary,
          undefined,
          "an equal unprefixed branch and worktree id must not render twice",
        );
      },
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    row.check();
  });
});

Deno.test("status dashboards preserve fleet identity, evidence, priorities, and next actions", () => {
  const cases = [
    {
      name:
        "status dashboard: task labels hide minted identity until duplicate names need it",
      check: () => {
        const unique = render(data([mainEntry(), entry()]), 72);
        assertStringIncludes(unique, "Alpha");
        assert(!unique.includes("alpha-abc123"), unique);
        assert(!unique.includes("agent/alpha-abc123"), unique);

        const duplicate = render(
          data([
            mainEntry(),
            entry(),
            entry({
              path: "/repo.worktrees/alpha-def456",
              branch: "agent/alpha-def456",
              id: "alpha-def456",
            }),
          ]),
          72,
        );
        assertStringIncludes(duplicate, "Alpha · abc123");
        assertStringIncludes(duplicate, "Alpha · def456");
      },
    },
    {
      name:
        "status dashboard: every typed row status is classified and rendered",
      check: () => {
        for (const kind of FLEET_ROW_STATUS_KINDS) {
          const testCase = STATUS_CASES[kind];
          const row = entry(testCase.patch);
          const options: FleetRowPresentationOptions = {
            trunk: "main",
            nowMs: NOW,
            ...(testCase.collisions === undefined
              ? {}
              : { collisions: testCase.collisions }),
          };
          const model = presentFleetRow(row, options);
          assertEquals(model.kind, kind);
          const output = render(
            data([mainEntry(), row], {
              ...(testCase.collisions === undefined
                ? {}
                : { fleet_collisions: [...testCase.collisions] }),
            }),
            72,
            false,
            undefined,
            true,
          );
          assertStringIncludes(
            output,
            kind === "running" ? `${model.label} · 2m` : model.label,
          );
          assertLinesFit(output, 72);
        }
      },
    },
    {
      name:
        "status dashboard: every proof-check state auto-enrols in the human vocabulary",
      check: () => {
        for (const status of GATE_PROOF_CHECK_STATUSES) {
          const proof: GateProofCheckData = {
            status,
            ...((status === "unavailable" || status === "read_failed")
              ? { reason: "fixture reason" }
              : {}),
          };
          const row = entry({
            clean: status === "dirty" ? false : true,
            changed_files: status === "dirty" ? 1 : 0,
            ahead: status === "honored" ? 1 : 0,
            gate_proof: proof,
            ...(status === "honored" ? { proof_honored: true } : {}),
          });
          const output = render(
            data([mainEntry(), row]),
            72,
            false,
            undefined,
            true,
          );
          assert(
            plain(output).split("\n").some((line) =>
              line.includes("Proof") && line.includes(PROOF_LABELS[status])
            ),
            `${status} state is absent from the package-backed Proof row`,
          );
        }
      },
    },
    {
      name:
        "status dashboard: activity, failure, divergence, and authority retain their hierarchy",
      check: () => {
        const failed = entry({
          path: "/repo.worktrees/failed-111aaa",
          branch: "agent/failed-111aaa",
          id: "failed-111aaa",
          last_action: {
            verb: "done",
            outcome: "failed",
            failed_stage: "test",
            at: "2026-08-03T11:50:00.000Z",
          },
        });
        const running = entry({
          path: "/repo.worktrees/running-222bbb",
          branch: "agent/running-222bbb",
          id: "running-222bbb",
          clean: false,
          changed_files: 2,
          ahead: 8,
          behind: 3,
          gate_proof: { status: "dirty" },
          running: {
            verb: "done",
            started: "2026-08-03T11:58:00.000Z",
            elapsed_ms: 120_000,
            typical_duration_ms: 120_000,
          },
        });
        const observed = entry({
          path: "/repo.worktrees/observed-333ccc",
          branch: "agent/observed-333ccc",
          id: "observed-333ccc",
          clean: false,
          changed_files: 3,
          gate_proof: { status: "dirty" },
          last_action: {
            verb: "status",
            outcome: "ok",
            at: "2026-08-03T11:59:00.000Z",
          },
        });
        const granted = entry({
          path: "/repo.worktrees/granted-444ddd",
          branch: "agent/granted-444ddd",
          id: "granted-444ddd",
          ahead: 1,
          gate_proof: { status: "honored" },
          proof_honored: true,
          landing_authority: {
            kind: "authorized",
            source: "standing-grant",
            scopes: ["map"],
            standing_scopes: ["map"],
          },
        });
        const approval = entry({
          path: "/repo.worktrees/approval-555eee",
          branch: "agent/approval-555eee",
          id: "approval-555eee",
          ahead: 1,
          gate_proof: { status: "honored" },
          proof_honored: true,
          landing_authority: { kind: "conversation-required" },
        });
        const scoped = entry({
          path: "/repo.worktrees/scoped-666fff",
          branch: "agent/scoped-666fff",
          id: "scoped-666fff",
          ahead: 1,
          gate_proof: { status: "honored" },
          proof_honored: true,
          landing_authority: {
            kind: "conversation-required",
            standing_scopes: ["map"],
            uncovered: [{ path: "src/engine/status/tty.ts", scopes: ["code"] }],
          },
        });
        const output = render(
          data([
            mainEntry(),
            failed,
            running,
            observed,
            granted,
            approval,
            scoped,
          ]),
          72,
          true,
          undefined,
          true,
        );
        const words = plain(output);
        assertStringIncludes(words, "last action done failed at test");
        assertStringIncludes(words, "Checking · 2m");
        assertStringIncludes(words, "Activity: just now · usually 2m");
        assertStringIncludes(words, "Git: 2 files changed · ↑8 ↓3");
        assertStringIncludes(words, "Changed: Observed · Editing");
        assertStringIncludes(words, "Git: 3 files changed");
        assertStringIncludes(words, "last action status ok");
        assertStringIncludes(
          words,
          "Landing: Covered by your standing approval (map)",
        );
        assertStringIncludes(words, "Landing: Needs your approval");
        assertStringIncludes(
          words,
          "Landing: Needs your approval · 1 path isn't covered",
        );
        assert(!/scope.limited|authority unknown/iu.test(words), words);
        assert(!words.includes("2m of ~2m"));
        assert(!words.includes("↓0"));
        assert(!words.includes("▴────"));
        assert(!words.includes("0 ahead"));
        assertStringIncludes(output, terminal(72, true).tone("↑1", "accent"));
        assertStringIncludes(output, terminal(72, true).tone("↓3", "warning"));
        assertEquals(
          words,
          render(
            data([
              mainEntry(),
              failed,
              running,
              observed,
              granted,
              approval,
              scoped,
            ]),
            72,
            false,
            undefined,
            true,
          ),
          "semantic facts must survive without colour",
        );
        assertLinesFit(output, 72);
      },
    },
    {
      name: "status dashboard: activity and staleness outrank branch lag",
      check: () => {
        const dirty = presentFleetRow(
          entry({
            clean: false,
            changed_files: 2,
            behind: 5,
            gate_proof: { status: "dirty" },
          }),
          { trunk: "main", nowMs: NOW },
        );
        assertEquals(dirty.kind, "in-progress");

        const stale = presentFleetRow(
          entry({
            clean: false,
            changed_files: 2,
            ahead: 1,
            behind: 5,
            last_activity: "2026-07-20T12:00:00.000Z",
            gate_proof: { status: "dirty" },
          }),
          { trunk: "main", nowMs: NOW },
        );
        assertEquals(stale.kind, "stale");
      },
    },
    {
      name:
        "status dashboard: the fleet brief separates landing risks from worktree state",
      check: () => {
        const alpha = entry();
        const beta = entry({
          path: "/repo.worktrees/beta-def456",
          branch: "agent/beta-def456",
          id: "beta-def456",
        });
        const longRecord = `project/map/_adr/0253-${
          "responsive-".repeat(8)
        }first.md`;
        const fixture = data([mainEntry(), alpha, beta], {
          fleet_collisions: [{
            branches: ["agent/alpha-abc123", "agent/beta-def456"],
            overlap: ["src/shared/result.ts", "tests/result_test.ts"],
            total: 2,
          }],
          adr_collisions: [{
            number: "0253",
            branches: ["agent/alpha-abc123", "agent/beta-def456"],
            paths: [
              longRecord,
              "project/map/_adr/0253-second.md",
            ],
          }],
        });
        const brief = render(fixture, 60);
        assertStringIncludes(brief, "Landing risks");
        assertStringIncludes(brief, "2 shared files");
        assertStringIncludes(brief, "ADR 0253");
        assert(!brief.includes("Collision"), brief);
        assert(!brief.includes("ATTENTION"), brief);
        assert(!brief.includes("src/shared/result.ts"), brief);

        const output = render(
          fixture,
          60,
          false,
          undefined,
          true,
        );
        assertStringIncludes(output, "Fleet collision");
        assertStringIncludes(output, "src/shared/result.ts");
        assertStringIncludes(output, "ADR 0253 has multiple claims");
        assertStringIncludes(output.replaceAll(/\s+/gu, ""), longRecord);
        assert(!output.includes("data.fleet"), output);
        assert(!output.includes("data.adr"), output);
        assertLinesFit(output, 60);
      },
    },
    {
      name:
        "status dashboard: removed worktree paths report their current contents and cleanup boundary",
      check: () => {
        const output = plain(render(
          data([], {
            reappeared_worktree_paths: [{
              path: "/repo.worktrees/apollo-11",
              removed_at: "2026-08-03T11:55:00.000Z",
              kind: "directory",
              contents: ["observer-state/checkpoint.bin"],
              contents_truncated: false,
              entries: 2,
            }, {
              path: "/repo.worktrees/voyager",
              removed_at: "2026-08-03T11:50:00.000Z",
              kind: "directory",
              contents: ["project/.git/config"],
              contents_truncated: false,
              entries: 3,
              cleanup_blocked_reason: "the path contains Git metadata",
            }],
          }),
          80,
          false,
          undefined,
          true,
        ));

        assertStringIncludes(output, "ATTENTION");
        assertStringIncludes(output, "/repo.worktrees/apollo-11");
        assertStringIncludes(
          output,
          "discern removed the worktree 5m ago; the path is present again",
        );
        assertStringIncludes(output, "observer-state/checkpoint.bin");
        assertStringIncludes(output, "Kept: the path contains Git metadata");
        assertLinesFit(output, 80);
      },
    },
    {
      name:
        "status dashboard: actionable package commands are accented while stored proof stays verbatim",
      check: () => {
        const behind = entry({ ahead: 1, behind: 2 });
        const proofUnavailable = entry({
          path: "/repo.worktrees/proof-def456",
          branch: "agent/proof-def456",
          id: "proof-def456",
          gate_proof: { status: "unavailable", reason: "admin dir missing" },
        });
        const hints = hintTexts([
          fire(HINTS["status-branch-behind"], {
            behind: 2,
            trunk: "main",
            overlap: undefined,
          }),
        ]);
        const fixture = data([mainEntry(), behind, proofUnavailable], {
          gate_proof: {
            status: "honored",
            proof:
              "### Proof\n\nRun `discern standards` to inspect the measurements.",
          },
        });
        const noColor = render(fixture, 104, false, hints, true);
        const color = render(fixture, 104, true, hints, true);

        assertEquals(plain(color), noColor);
        const accentDiscern = terminal(104, true).tone("discern", "accent");
        const highlighted = color.split(`\`${accentDiscern}`).length - 1;
        assert(
          highlighted >= 5,
          "fixture must exercise every actionable command route",
        );
        assertStringIncludes(
          color,
          `\`${accentDiscern} ${
            terminal(104, true).tone("update", "accent")
          }\``,
        );
        assertStringIncludes(
          color,
          "Run `discern standards` to inspect the measurements.",
        );
        assertLinesFit(color, 104);
      },
    },
    {
      name:
        "status dashboard: landing risks do not replace proof readiness and landing authority",
      check: () => {
        const ready = entry({
          ahead: 2,
          gate_proof: { status: "honored" },
          proof_honored: true,
          landing_authority: {
            kind: "authorized",
            source: "standing-grant",
            scopes: ["map"],
            standing_scopes: ["map"],
          },
        });
        const collision: StatusFleetCollision = {
          branches: ["agent/alpha-abc123", "agent/beta-def456"],
          overlap: ["project/map/shared.md"],
          total: 1,
        };
        const model = presentFleetRow(ready, {
          trunk: "main",
          nowMs: NOW,
          collisions: [collision],
        });
        assertEquals(model.kind, "ready");
        assertEquals(model.state, "approved");
        assertEquals(model.landingReady, true);
        assertEquals(
          model.authority,
          "Covered by your standing approval (map)",
        );

        const output = render(
          data([mainEntry(), ready], { fleet_collisions: [collision] }),
          72,
          false,
          undefined,
          true,
        );
        assertStringIncludes(output, "Approved to land  1");
        assertStringIncludes(output, "Landing risks");
        assertStringIncludes(
          output,
          "Landing: Covered by your standing approval (map)",
        );
        assertLinesFit(output, 72);
      },
    },
    {
      name: "status dashboard: unknown divergence is visible and never ready",
      check: () => {
        const unknown = entry({
          ahead: "unknown",
          behind: "unknown",
          gate_proof: { status: "honored" },
          proof_honored: true,
        });
        const model = presentFleetRow(unknown, {
          trunk: "main",
          nowMs: NOW,
        });
        assertEquals(model.landingReady, false);
        assertEquals(model.kind, "idle");

        const output = render(
          data([mainEntry(), unknown]),
          104,
          false,
          undefined,
          true,
        );
        assertStringIncludes(output, "↑?");
        assertStringIncludes(output, "↓?");
      },
    },
    {
      name:
        "status dashboard: main and worktree fleet contexts show main once and keep current beside identity",
      check: () => {
        const current = entry({ is_current: true });
        const main = data([mainEntry(), current]);
        const mainOutput = render(main, 72);
        assertEquals(mainOutput.match(/Main checkout/gu)?.length, 1);
        assert(
          mainOutput.indexOf("Main checkout") < mainOutput.indexOf("Fleet ·"),
        );
        assertStringIncludes(mainOutput, "voyager");
        assertStringIncludes(
          mainOutput,
          "Main checkout main is clean and current.",
        );
        assert(!mainOutput.includes("Tasks"));
        assert(!mainOutput.includes("plain_reading_grade"));
        assert(!mainOutput.includes("Checks"), mainOutput);
        assert(!mainOutput.includes("Standards: 2 configured"), mainOutput);
        const mainVerbose = render(main, 72, false, undefined, true);
        assertStringIncludes(mainVerbose, "Checks");
        assertStringIncludes(mainVerbose, "Standards: 2 configured");

        const worktree = data([mainEntry({ is_current: false }), current], {
          location: "worktree",
          root: "/repo.worktrees/alpha-abc123",
          worktree: {
            id: "alpha-abc123",
            branch: "agent/alpha-abc123",
            site: "voyager-alpha",
            port: 17123,
            db: "voyager_alpha",
            seed: 3223225200,
            resources: { cache: "voyager-alpha-cache" },
          },
          scopes: ["code", "previewable", "web"],
          gate: { jobs: ["format", "test"], scope_gates: ["web"] },
          git: {
            branch: "agent/alpha-abc123",
            trunk: "main",
            clean: true,
            changed_files: 0,
            behind_trunk: 0,
            ahead_trunk: 0,
          },
        });
        const worktreeOutput = render(worktree, 72);
        assertEquals(worktreeOutput.match(/Main checkout/gu)?.length, 1);
        assertStringIncludes(worktreeOutput, "agent/alpha-abc123");
        assertStringIncludes(worktreeOutput, "current");
        assertStringIncludes(worktreeOutput, "Changed scopes: web");
        assert(!worktreeOutput.includes("Change: code"));
        assert(!worktreeOutput.includes("previewable"));
        const checksAt = worktreeOutput.indexOf("Checks");
        const environmentAt = worktreeOutput.indexOf("Local environment");
        assert(checksAt >= 0 && environmentAt > checksAt);
        assert(
          !worktreeOutput.slice(checksAt, environmentAt).includes("Port:"),
        );
        assertStringIncludes(
          worktreeOutput.slice(environmentAt),
          "Port: 17123",
        );
        assertStringIncludes(
          worktreeOutput.slice(environmentAt),
          "Resources: cache=voyager-alpha-cache",
        );
      },
    },
    {
      name:
        "status dashboard: the main brief separates owner attention, landing risks, and next actions",
      check: () => {
        const stale = entry({
          path: "/repo.worktrees/stale-def456",
          branch: "agent/stale-def456",
          id: "stale-def456",
          clean: false,
          changed_files: 2,
          ahead: 4,
          last_activity: "2026-07-20T12:00:00.000Z",
          gate_proof: { status: "dirty" },
        });
        const collision: StatusFleetCollision = {
          branches: ["agent/alpha-abc123", "agent/stale-def456"],
          overlap: ["src/shared.ts"],
          total: 1,
        };
        const hints = hintTexts([
          fire(HINTS["status-fleet-member-stale"], {
            total: 1,
            names: ["stale-def456"],
          }),
          fire(HINTS["status-fleet-collisions"], {
            total: 1,
            pairs: ["alpha-abc123 ↔ stale-def456"],
          }),
        ]);
        const output = render(
          data([mainEntry(), entry(), stale], {
            fleet_collisions: [collision],
          }),
          80,
          false,
          hints,
        );

        assertStringIncludes(output, "Owner attention");
        assertStringIncludes(output, "Landing risks");
        assertStringIncludes(output, "Activity: 2w ago");
        assert(!output.includes("Next steps"), output);
        assert(
          !output.includes("Blocked: Status recommends an action."),
          output,
        );
        assert(
          output.indexOf("Owner attention") < output.indexOf("Landing risks"),
        );
        assertLinesFit(output, 80);
      },
    },
    {
      name:
        "status dashboard: human hint projection and landing evidence stay concrete",
      check: () => {
        const ready = entry({
          ahead: 1,
          gate_proof: { status: "honored" },
          proof_honored: true,
        });
        const hints = hintTexts([
          fire(HINTS["status-fleet-member-ready"], {
            total: 1,
            names: ["alpha-abc123"],
            trunk: "main",
          }),
          fire(HINTS["status-fleet-logbook-disabled"]),
        ]);
        assert(!(hints[0] ?? "").includes("git diff"));
        assertStringIncludes(hints[0] ?? "", "The owner reviews");
        assert(!(hints[0] ?? "").includes("data.fleet"));
        const value = data([mainEntry(), ready], {
          landed_proof: {
            commit: "abcdef1234567890",
            commit_at: "2026-08-03T11:00:00.000Z",
            ref: "refs/notes/discern",
            proof: {
              branch: "agent/landed-123abc",
              trunk: "main",
              head: "abcdef123456",
              files_total: 6,
              insertions: 20,
              deletions: 4,
              line: "Proof: passed",
              markdown:
                "### Proof\n\nStored table row that may remain copyable.",
            },
          },
        });
        const output = render(value, 72, false, hints, true);
        assertStringIncludes(output, "1 needs you");
        assertStringIncludes(output, "git diff main...<branch>");
        assertStringIncludes(output, "discern status --verbose");
        assertStringIncludes(squash(output), "complete branch and Proof");
        assertStringIncludes(output, "Per-worktree actions aren't available");
        assertStringIncludes(output, "6 files changed");
        assertStringIncludes(output, "+20 −4");
        assert(!squash(output).includes("6 files changed · +20 −4"));
        assertStringIncludes(output, "1h ago");
        assert(!output.includes("refs/notes/discern"));
        assert(!output.includes("data.fleet"));
        assertLinesFit(output, 72);

        assert(value.landed_proof !== undefined);
        for (
          const [elapsed, age] of [
            [0, "just now"],
            [60_000, "1m ago"],
            [3_600_000, "1h ago"],
          ] as const
        ) {
          const aged = render(
            {
              ...value,
              landed_proof: {
                ...value.landed_proof,
                commit_at: new Date(NOW - elapsed).toISOString(),
              },
            },
            72,
            false,
            undefined,
            true,
          );
          assertStringIncludes(squash(aged), `Age: ${age}`);
        }

        const verbose = render(
          data([mainEntry(), ready], {
            gate_proof: {
              status: "honored",
              proof: "### Proof\n\n| ran | result |\n| --- | --- |",
            },
          }),
          48,
          false,
          undefined,
          true,
        );
        assertStringIncludes(verbose, "| ran | result |");
      },
    },
    {
      name: "status dashboard: an empty fleet uses the package EmptyState",
      check: () => {
        const output = render(data([mainEntry()]), 72);
        assertStringIncludes(output, "Empty");
        assertStringIncludes(output, "No active worktrees");
        assertLinesFit(output, 72);
      },
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    row.check();
  });
});

const PROOF_LABELS = {
  honored: "Passed",
  report_only: "Reported only: not a landing Proof",
  missing: "None yet",
  stale: "Outdated: for an older commit",
  dirty: "Not run on these changes",
  unavailable: "Unavailable: fixture reason",
  read_failed: "Unreadable: fixture reason",
} as const satisfies Record<GateProofCheckStatus, string>;

Deno.test("status dashboard: every interactive status hint avoids machine-field directions", () => {
  const definitions = Object.values(HINTS) as unknown as readonly HintDef<
    unknown
  >[];
  for (
    const definition of definitions.filter((entry) =>
      entry.id.startsWith("status-")
    )
  ) {
    const wire = hintTexts([fire(definition, definition.example)]);
    const human = interactiveHintTexts(wire);
    for (const hint of human) {
      assert(
        !/\bdata\./u.test(hint),
        `${definition.id} exposes a machine field in human output: ${hint}`,
      );
    }
  }
});

/** A named task row; `title` becomes its recorded task title. */
function titled(
  id: string,
  title: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return entry({
    path: `/repo.worktrees/${id}`,
    branch: `agent/${id}`,
    id,
    task: {
      id,
      branch: `agent/${id}`,
      title,
      title_source: "recorded",
    },
    ...patch,
  });
}

Deno.test("status dashboard: the owner's stale task reads Stale under Needs attention", () => {
  const stale = titled("homepage-a1b2c3", "Homepage session prototype", {
    ahead: 1,
    behind: 361,
    last_activity: new Date(NOW - 11 * 86_400_000).toISOString(),
    gate_proof: { status: "honored" },
  });
  const model = presentFleetRow(stale, { trunk: "main", nowMs: NOW });
  assertEquals([model.kind, model.state, model.group], [
    "stale",
    "stale-proven",
    "attention",
  ]);
  for (const mode of ["no-color", "ascii"] as const) {
    const words = plain(
      renderStatusDashboard(data([mainEntry(), stale]), undefined, {
        terminal: terminalMode(80, mode),
        width: 80,
        nowMs: NOW,
      }),
    );
    const row = words.split("\n").find((line) =>
      line.includes("Homepage session prototype")
    );
    assert(row !== undefined, words);
    assertStringIncludes(row, "· ! Stale · DRIFT");
    assert(!/Ready|Proof valid|✓/u.test(row), row);
    assert(
      words.indexOf("Needs attention  1") < words.indexOf(row),
      `${mode}: the row sits under its group`,
    );
  }
});

Deno.test("status dashboard: groups follow the decision order with case-folded titles inside", () => {
  const honored = { gate_proof: { status: "honored" as const }, ahead: 1 };
  const fleet = [
    titled("zeta-000001", "zeta idle"),
    titled("emile-000002", "Émile idle"),
    titled("alpha-000003", "alpha idle"),
    titled("queued-000004", "Queued work", {
      ...honored,
      landing_authority: { kind: "authorized", source: "effort-grant" },
    }),
    titled("editing-000005", "Editing work", {
      clean: false,
      changed_files: 1,
      gate_proof: { status: "dirty" },
    }),
    titled("failed-000006", "Failed work", {
      last_action: { verb: "done", outcome: "failed", at: NOW_ISO },
    }),
    titled("ready-000007", "Ready work", honored),
  ];
  const words = plain(render(data([mainEntry(), ...fleet]), 104));
  const order = [
    "Ready for review  1",
    "Ready work",
    "Needs attention  1",
    "Failed work",
    "Working  1",
    "Editing work",
    "Approved to land  1",
    "Queued work",
    "Idle  3",
    "alpha idle",
    "Émile idle",
    "zeta idle",
  ].map((text) => words.indexOf(text));
  assert(order.every((at) => at >= 0), words);
  assertEquals(order, [...order].sort((left, right) => left - right), words);
  assertStringIncludes(words, "Fleet · 7 active worktrees · 2 need you");
});

Deno.test("status dashboard: a landing's integration copy reads as its task's state", () => {
  const task = titled("search-000001", "Search index", {
    ahead: 3,
    gate_proof: { status: "honored" },
  });
  const copy = entry({
    path: "/repo.worktrees/integration-000002",
    branch: "discern/integration/search-000001",
    id: "integration-000002",
    integration: { owner: "live", for_branch: "agent/search-000001" },
  });
  const orphan = entry({
    path: "/repo.worktrees/integration-000003",
    branch: "discern/integration/gone-000003",
    id: "integration-000003",
    integration: { owner: "interrupted", for_branch: "agent/gone-000003" },
  });
  const words = plain(render(data([mainEntry(), task, copy, orphan]), 104));
  assertStringIncludes(words, "Search index · ◐ Landing");
  assert(!words.includes("integration-000002"), words);
  assertStringIncludes(words, "! Interrupted");
  assertStringIncludes(words, "Fleet · 2 active worktrees · 1 needs you");
});

Deno.test("status dashboard: importance sorting is stable and current wins only inside its class", () => {
  const rows = [
    entry({ branch: "agent/zulu-111aaa", id: "zulu-111aaa", is_current: true }),
    entry({
      branch: "agent/failed-222bbb",
      id: "failed-222bbb",
      last_action: {
        verb: "done",
        outcome: "failed",
        at: "2026-08-03T10:00:00.000Z",
      },
    }),
    entry({ branch: "agent/alpha-333ccc", id: "alpha-333ccc" }),
  ].map((row) => presentFleetRow(row, { trunk: "main", nowMs: NOW }));
  const sorted = sortFleetRows(rows);
  assertEquals(sorted.map((row) => row.identity.primary), [
    "agent/failed-222bbb",
    "agent/zulu-111aaa",
    "agent/alpha-333ccc",
  ]);
});

Deno.test("status lists and counts a landing copy that speaks for its task once, as the task", () => {
  const task = entry({
    path: "/repo.worktrees/task",
    branch: "agent/task",
    id: "task",
    ahead: 1,
    gate_proof: { status: "honored" },
  });
  const copy = entry({
    path: "/repo.worktrees/integration-task",
    branch: "discern/integration/task-000002",
    id: "integration-task",
    ahead: 3,
    integration: {
      owner: "interrupted",
      for_branch: "agent/task",
      awaiting_judgment: true,
    },
  });
  const orphan = entry({
    path: "/repo.worktrees/integration-gone",
    branch: "discern/integration/gone-000003",
    id: "integration-gone",
    integration: { owner: "interrupted", for_branch: "agent/gone" },
  });
  const fleet = [mainEntry(), task, copy, orphan];
  assertEquals(
    listedFleetTasks(fleet).map((row) => row.branch),
    [task.branch, orphan.branch],
  );
  const ordered = prioritizeStatusFleet(fleet, { trunk: "main", nowMs: NOW });
  assertEquals(
    ordered.filter((row) => row.group === "review").map((row) => row.branch),
    [task.branch],
    "the copy never joins its task's group a second time",
  );
  const stamped = ordered.find((row) => row.branch === copy.branch);
  assertEquals([stamped?.state, stamped?.group], [undefined, undefined]);
  assertEquals(
    ordered.find((row) => row.branch === orphan.branch)?.state,
    "interrupted",
  );
});

Deno.test("status orientation samples main plus six in the dashboard order: decision group, current, then title", () => {
  const main = entry({
    path: "/repo",
    branch: "main",
    id: "main",
    is_main: true,
  });
  const ordinary = Array.from({ length: 7 }, (_, index) =>
    entry({
      path: `/repo.worktrees/ordinary-${index}`,
      branch: `agent/ordinary-${index}`,
      id: `ordinary-${index}`,
      last_activity: `2026-08-03T0${index}:00:00.000Z`,
    }));
  const current = entry({
    path: "/repo.worktrees/current",
    branch: "agent/current",
    id: "current",
    is_current: true,
    last_activity: "2026-08-03T01:00:00.000Z",
  });
  const failed = entry({
    path: "/repo.worktrees/failed",
    branch: "agent/failed",
    id: "failed",
    last_action: {
      verb: "done",
      outcome: "failed",
      at: "2026-08-03T00:00:00.000Z",
    },
  });
  const ordered = prioritizeStatusFleet(
    [main, ...ordinary.reverse(), current, failed],
    { trunk: "main", nowMs: NOW },
  );
  const projected = projectStatusData({
    location: "main",
    project: "fixture",
    fleet: ordered,
  });
  const sampled = projected.fleet as StatusFleetEntry[];
  assertEquals(sampled.length, 7);
  assertEquals(sampled[0]?.branch, "main");
  assertEquals(sampled[1]?.branch, "agent/failed");
  assertEquals(
    [sampled[1]?.state, sampled[1]?.group],
    ["checks-failed", "attention"],
    "every structured task row names its state and group",
  );
  assertEquals(sampled[0]?.state, undefined, "the main checkout is no task");
  assertEquals(sampled[2]?.branch, "agent/current");
  assertEquals(
    (projected.projection as { omitted: Record<string, number> }).omitted.fleet,
    3,
  );
});
