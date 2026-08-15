/** Pure width and semantic-state guards for the static status dashboard. */

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
import {
  FLEET_ROW_STATUS_KINDS,
  type FleetRowPresentationOptions,
  type FleetRowStatusKind,
  presentFleetRow,
  renderStatusDashboard,
  sortFleetRows,
  STATUS_REPORT_MAX_WIDTH,
} from "../src/engine/status/tty.ts";

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");
const NOW = Date.parse("2026-08-03T12:00:00.000Z");

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
  return {
    path: "/repo.worktrees/alpha-abc123",
    is_main: false,
    is_current: false,
    branch: "agent/alpha-abc123",
    id: "alpha-abc123",
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: "2026-08-03T11:00:00.000Z",
    gate_proof: { status: "missing" },
    ...patch,
  };
}

/** Main-checkout row carried by the fleet collector. */
function mainEntry(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    path: "/repo",
    is_main: true,
    is_current: true,
    branch: "main",
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: "2026-08-03T11:30:00.000Z",
    ...patch,
  };
}

/** Complete status envelope data for pure dashboard fixtures. */
function data(
  fleet: StatusFleetEntry[] | undefined,
  patch: Partial<StatusData> = {},
): StatusData {
  return {
    location: "main",
    root: "/repo",
    project: "voyager",
    worktree: null,
    git: {
      branch: "main",
      trunk: "main",
      clean: true,
      changed_files: 0,
      behind_trunk: null,
      ahead_trunk: 0,
    },
    standards: ["coverage", "plain_reading_grade"],
    ...(fleet === undefined ? {} : { fleet }),
    ...patch,
  };
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
  collision: {
    patch: {},
    collisions: [{
      branches: ["agent/alpha-abc123", "agent/beta-def456"],
      overlap: ["src/shared.ts"],
      total: 1,
    }],
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

Deno.test("status dashboard: verbose 39, 80, 104, and capped layouts keep equal color-free package facts", () => {
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
    assertEquals(plain(color), noColor, `color changed words at ${width}`);
    assertLinesFit(noColor, width);
    assertLinesFit(color, width);
    assertStringIncludes(noColor, "FLEET");
    assertStringIncludes(noColor, "WORKTREES");
    assertStringIncludes(noColor, "Active worktrees");
    assertStringIncludes(squash(noColor), "Configured checks for this status");
    if (width === 39) {
      assertStringIncludes(noColor, "Branch: agent/alpha-abc123");
    } else {
      assertStringIncludes(noColor, "AGENT");
      assertStringIncludes(noColor, "BRANCH");
    }
  }
  assertEquals(
    render(fixture, 400, false, undefined, true),
    render(fixture, STATUS_REPORT_MAX_WIDTH, false, undefined, true),
  );
  assertStringIncludes(
    render(fixture, 400, false, undefined, true),
    "agent/alpha-abc123",
  );
});

Deno.test("status dashboard: truecolour, 256, 16, no-colour, and ASCII modes retain semantics and inert text", () => {
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
  });
  for (const mode of modes) {
    const context = terminalMode(80, mode);
    assertEquals(context.capabilities.colorDepth, expectedDepth[mode]);
    const output = renderStatusDashboard(fixture, undefined, {
      terminal: context,
      width: 80,
      nowMs: NOW,
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
      assertEquals(words, unicodeBaseline, `${mode} changed status facts`);
    }
    assertLinesFit(output, 80);
  }
});

Deno.test("status dashboard: responsive regions retain status, evidence, and complete actions", () => {
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
});

Deno.test("status dashboard: every long or differing identity survives every layout", () => {
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
    const output = render(fixture, width, true);
    assertStringIncludes(plain(output), branch);
    assertStringIncludes(plain(output), id);
    assertStringIncludes(plain(output), "(detached)");
    assertStringIncludes(plain(output), "current");
    assertLinesFit(output, width, [branch, id]);
  }
  assertEquals(
    plain(render(fixture, 104, true)),
    render(fixture, 104),
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
});

Deno.test("status dashboard: every typed row status is classified and rendered", () => {
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
    assertStringIncludes(output, model.label);
    assertLinesFit(output, 72);
  }
});

const PROOF_LABELS = {
  honored: "honored",
  missing: "missing",
  stale: "stale",
  dirty: "dirty worktree",
  unavailable: "unavailable",
  read_failed: "unreadable",
} as const satisfies Record<GateProofCheckStatus, string>;

Deno.test("status dashboard: every proof-check state auto-enrols in the human vocabulary", () => {
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
      `${status} receipt state is absent from the package-backed Proof row`,
    );
  }
});

Deno.test("status dashboard: activity, failure, divergence, and authority retain their hierarchy", () => {
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
    data([mainEntry(), failed, running, observed, granted, approval, scoped]),
    72,
    true,
    undefined,
    true,
  );
  const words = plain(output);
  assertStringIncludes(words, "last action done failed at test");
  assertStringIncludes(words, "running done 2m · usually 2m");
  assertStringIncludes(words, "Git: 2 files changed · ↑8 ↓3");
  assertStringIncludes(words, "Changed: agent/observed-333ccc. In progress");
  assertStringIncludes(words, "Git: 3 files changed");
  assertStringIncludes(words, "last action status ok");
  assertStringIncludes(words, "Landing: granted · standing grant for map");
  assertStringIncludes(words, "Landing: needs approval");
  assertStringIncludes(words, "Landing: scope-limited");
  assert(!words.includes("2m of ~2m"));
  assert(!words.includes("0 ahead"));
  assertEquals(
    words,
    render(
      data([mainEntry(), failed, running, observed, granted, approval, scoped]),
      72,
      false,
      undefined,
      true,
    ),
    "semantic facts must survive without colour",
  );
  assertLinesFit(output, 72);
});

Deno.test("status dashboard: the fleet brief defers collision paths to verbose evidence", () => {
  const alpha = entry();
  const beta = entry({
    path: "/repo.worktrees/beta-def456",
    branch: "agent/beta-def456",
    id: "beta-def456",
  });
  const longRecord = `project/map/_adr/0253-${"responsive-".repeat(8)}first.md`;
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
  assertStringIncludes(brief, "Collision");
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
});

Deno.test("status dashboard: removed worktree paths report their current contents and cleanup boundary", () => {
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
});

Deno.test("status dashboard: actionable package commands are accented while stored proof stays verbatim", () => {
  const behind = entry({ behind: 2 });
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
    `\`${accentDiscern} ${terminal(104, true).tone("update", "accent")}\``,
  );
  assertStringIncludes(
    color,
    "Run `discern standards` to inspect the measurements.",
  );
  assertLinesFit(color, 104);
});

Deno.test("status dashboard: collision precedence retains proof readiness and landing authority", () => {
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
  assertEquals(model.kind, "collision");
  assertEquals(model.landingReady, true);
  assertEquals(model.authority?.label, "granted");

  const output = render(
    data([mainEntry(), ready], { fleet_collisions: [collision] }),
    72,
    false,
    undefined,
    true,
  );
  assertStringIncludes(output, "1 ready");
  assertStringIncludes(output, "The branch is ready; landing granted.");
  assertStringIncludes(output, "Landing: granted · standing grant for map");
  assertLinesFit(output, 72);
});

Deno.test("status dashboard: main and worktree fleet contexts show main once and keep current beside identity", () => {
  const current = entry({ is_current: true });
  const main = data([mainEntry(), current]);
  const mainOutput = render(main, 72);
  assertEquals(mainOutput.match(/Main checkout/gu)?.length, 1);
  assert(mainOutput.indexOf("FLEET") < mainOutput.indexOf("Main checkout"));
  assertStringIncludes(mainOutput, "voyager");
  assertStringIncludes(mainOutput, "Main checkout main is current.");
  assert(!mainOutput.includes("Tasks"));
  assert(!mainOutput.includes("plain_reading_grade"));
  assert(!mainOutput.includes("CHECKS"), mainOutput);
  assert(!mainOutput.includes("Standards: 2 configured"), mainOutput);
  const mainVerbose = render(main, 72, false, undefined, true);
  assertStringIncludes(mainVerbose, "CHECKS");
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
  assertEquals(worktreeOutput.match(/ MAIN CHECKOUT /gu)?.length, 1);
  assertStringIncludes(worktreeOutput, "agent/alpha-abc123");
  assertStringIncludes(worktreeOutput, "current");
  assertStringIncludes(worktreeOutput, "Changed scopes: web");
  assert(!worktreeOutput.includes("Change: code"));
  assert(!worktreeOutput.includes("previewable"));
  const checksAt = worktreeOutput.indexOf("CHECKS");
  const environmentAt = worktreeOutput.indexOf("LOCAL ENVIRONMENT");
  assert(checksAt >= 0 && environmentAt > checksAt);
  assert(!worktreeOutput.slice(checksAt, environmentAt).includes("Port:"));
  assertStringIncludes(worktreeOutput.slice(environmentAt), "Port: 17123");
  assertStringIncludes(
    worktreeOutput.slice(environmentAt),
    "Resources: cache=voyager-alpha-cache",
  );
});

Deno.test("status dashboard: human hint projection and landing evidence stay concrete", () => {
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
  assertStringIncludes(hints[0] ?? "", "git diff main...<branch>");
  assert(!(hints[0] ?? "").includes("data.fleet"));
  const output = render(
    data([mainEntry(), ready], {
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
          markdown: "### Proof\n\nStored table row that may remain copyable.",
        },
      },
    }),
    72,
    false,
    hints,
    true,
  );
  assertStringIncludes(output, "1 needs attention");
  assertStringIncludes(output, "complete branch beside each worktree");
  assertStringIncludes(output, "Per-worktree actions aren't available");
  assertStringIncludes(output, "6 files changed");
  assertStringIncludes(output, "+20 −4");
  assert(!squash(output).includes("6 files changed · +20 −4"));
  assertStringIncludes(output, "1h ago");
  assert(!output.includes("refs/notes/discern"));
  assert(!output.includes("data.fleet"));
  assertLinesFit(output, 72);

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
});

Deno.test("status dashboard: an empty fleet uses the package EmptyState", () => {
  const output = render(data([mainEntry()]), 72);
  assertStringIncludes(output, "Empty");
  assertStringIncludes(output, "No active worktrees");
  assertLinesFit(output, 72);
});

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
