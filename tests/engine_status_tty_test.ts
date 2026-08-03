/** Pure width and semantic-state guards for the static status dashboard. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { displayWidth } from "../src/lib/text.ts";
import {
  fire,
  type HintDef,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../src/shared/hints.ts";
import {
  GATE_RECEIPT_CHECK_STATUSES,
  type GateReceiptCheckData,
  type GateReceiptCheckStatus,
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
    gate_receipt: { status: "missing" },
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
    width,
    color,
    verbose,
    nowMs: NOW,
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
    const line = plain(styled);
    const identity = overflowIdentities.some((value) => line.includes(value));
    const carriesField =
      /(?:Status|Git|Receipt|Activity|Landing|Fleet|Paths|Records|Branches|Action|Standards):/u
        .test(line);
    assert(
      identity && !carriesField,
      `${budget}-column line is ${displayWidth(styled)} columns: ${line}`,
    );
  }
}

/** Every ordinary line inside a dashboard section begins at or beyond the
 * heading text. Stored receipt Markdown is deliberately verbatim. */
function assertSectionContentColumns(output: string): void {
  let section: string | undefined;
  let contentColumn = 0;
  for (const line of plain(output).split("\n")) {
    const heading = line.match(/^── (.+)$/u)?.[1];
    if (heading !== undefined) {
      section = heading;
      contentColumn = line.indexOf(heading);
      continue;
    }
    if (line === "" || line.startsWith("discern status")) continue;
    if (line.startsWith("Main checkout:")) {
      section = undefined;
      continue;
    }
    if (section === undefined || section === "Receipts") continue;
    const firstVisible = line.search(/\S/u);
    assert(
      firstVisible >= contentColumn,
      `${section} content starts at column ${firstVisible}; expected at least ${contentColumn}: ${line}`,
    );
  }
}

/** Find one required rendered line without allowing two absent values to make
 * a column comparison pass vacuously. */
function requiredLine(lines: readonly string[], text: string): string {
  const line = lines.find((candidate) => candidate.includes(text));
  assert(line !== undefined, `missing rendered line containing ${text}`);
  return line;
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
      gate_receipt: { status: "honored" },
      receipt_honored: true,
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
      gate_receipt: { status: "dirty" },
    },
  },
  stale: {
    patch: {
      clean: false,
      changed_files: 2,
      last_activity: "2026-07-20T12:00:00.000Z",
      gate_receipt: { status: "dirty" },
    },
  },
  "in-progress": {
    patch: {
      clean: false,
      changed_files: 2,
      last_activity: "2026-08-03T11:55:00.000Z",
      gate_receipt: { status: "dirty" },
    },
  },
  "receipt-unreadable": {
    patch: { gate_receipt: { status: "read_failed", reason: "bad marker" } },
  },
  "receipt-unavailable": {
    patch: { gate_receipt: { status: "unavailable", reason: "no admin dir" } },
  },
  "receipt-stale": {
    patch: {
      gate_receipt: {
        status: "stale",
        recorded: "aaaaaaaaaaaa9999",
        head: "bbbbbbbbbbbb9999",
      },
    },
  },
  "needs-gate": { patch: { ahead: 2 } },
  idle: { patch: {} },
};

Deno.test("status dashboard: narrow, ordinary, wide, and capped layouts keep equal color-free facts", () => {
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
  for (const width of [48, 72, 104]) {
    const noColor = render(fixture, width);
    const color = render(fixture, width, true);
    assertEquals(plain(color), noColor, `color changed words at ${width}`);
    assertLinesFit(noColor, width);
    assertLinesFit(color, width);
    if (width < 92) {
      assertStringIncludes(noColor, "Status:");
    } else {
      assertStringIncludes(noColor, "Worktree");
      assertStringIncludes(noColor, "Activity");
    }
  }
  assertEquals(render(fixture, 400), render(fixture, STATUS_REPORT_MAX_WIDTH));
  assert(!render(fixture, 104, true).includes(`${ESC}[32mclean`));
});

Deno.test("status dashboard: sections share one content column and marked details hang from their item text", () => {
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

  for (const width of [48, 72, 104]) {
    for (const color of [false, true]) {
      const output = render(fixture, width, color);
      const lines = plain(output).split("\n");
      assertSectionContentColumns(output);

      const fleetHeading = requiredLine(lines, "── Fleet");
      const summary = requiredLine(lines, "Summary:");
      const identity = requiredLine(lines, branch);
      const detail = requiredLine(lines, "Behind:");
      assertEquals(summary.indexOf("Summary:"), fleetHeading.indexOf("Fleet"));
      assertEquals(identity.indexOf("!"), fleetHeading.indexOf("Fleet"));
      assertEquals(identity.indexOf(branch), detail.indexOf("Behind:"));
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
  for (const width of [48, 72, 104, 400]) {
    const output = render(fixture, width, true);
    assertStringIncludes(plain(output), branch);
    assertStringIncludes(plain(output), id);
    assertStringIncludes(plain(output), "(detached)");
    assertStringIncludes(plain(output), `${branch} ← current`);
    assertLinesFit(output, width, [branch, id]);
  }
  const styled = render(fixture, 104, true);
  assertStringIncludes(styled, `${ESC}[2magent/${ESC}[0m`);
  assertStringIncludes(styled, `${ESC}[2m-abc123${ESC}[0m`);
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
    );
    assertStringIncludes(output, model.label);
    assertLinesFit(output, 72);
  }
});

const RECEIPT_LABELS = {
  honored: "honored",
  missing: "missing",
  stale: "stale",
  dirty: "dirty worktree",
  unavailable: "unavailable",
  read_failed: "unreadable",
} as const satisfies Record<GateReceiptCheckStatus, string>;

Deno.test("status dashboard: every receipt-check state auto-enrols in the human vocabulary", () => {
  for (const status of GATE_RECEIPT_CHECK_STATUSES) {
    const receipt: GateReceiptCheckData = {
      status,
      ...((status === "unavailable" || status === "read_failed")
        ? { reason: "fixture reason" }
        : {}),
    };
    const row = entry({
      clean: status === "dirty" ? false : true,
      changed_files: status === "dirty" ? 1 : 0,
      ahead: status === "honored" ? 1 : 0,
      gate_receipt: receipt,
      ...(status === "honored" ? { receipt_honored: true } : {}),
    });
    const output = render(data([mainEntry(), row]), 72);
    assertStringIncludes(output, `Receipt: ${RECEIPT_LABELS[status]}`);
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
    gate_receipt: { status: "dirty" },
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
    gate_receipt: { status: "dirty" },
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
    gate_receipt: { status: "honored" },
    receipt_honored: true,
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
    gate_receipt: { status: "honored" },
    receipt_honored: true,
    landing_authority: { kind: "conversation-required" },
  });
  const scoped = entry({
    path: "/repo.worktrees/scoped-666fff",
    branch: "agent/scoped-666fff",
    id: "scoped-666fff",
    ahead: 1,
    gate_receipt: { status: "honored" },
    receipt_honored: true,
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
  );
  const words = plain(output);
  assertStringIncludes(words, "done failed at test");
  assertStringIncludes(words, "running done 2m · usually 2m");
  assertStringIncludes(words, "Git 2 files changed · ↑8 ↓3");
  assertStringIncludes(words, "Status: In progress · Git 3 files changed");
  assertStringIncludes(words, "Landing: granted · standing grant for map");
  assertStringIncludes(words, "Landing: needs approval");
  assertStringIncludes(words, "Landing: scope-limited");
  assert(!words.includes("2m of ~2m"));
  assert(!words.includes("0 ahead"));
  assertStringIncludes(output, `${ESC}[31mFailed${ESC}[0m`);
  assertStringIncludes(output, `${ESC}[33mBehind${ESC}[0m`);
  assertStringIncludes(
    output,
    `${ESC}[33m2 files changed · ↑8 ↓3${ESC}[0m`,
  );
  assertStringIncludes(output, `${ESC}[32mReady${ESC}[0m`);
  assertStringIncludes(
    output,
    `${ESC}[36mrunning done 2m · usually 2m${ESC}[0m`,
  );
  assertLinesFit(output, 72);
});

Deno.test("status dashboard: fleet and ADR collision paths are human-visible without machine-field language", () => {
  const alpha = entry();
  const beta = entry({
    path: "/repo.worktrees/beta-def456",
    branch: "agent/beta-def456",
    id: "beta-def456",
  });
  const longRecord = `project/map/_adr/0253-${"responsive-".repeat(8)}first.md`;
  const output = render(
    data([mainEntry(), alpha, beta], {
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
    }),
    60,
  );
  assertStringIncludes(output, "Fleet collision");
  assertStringIncludes(output, "src/shared/result.ts");
  assertStringIncludes(output, "ADR 0253 has multiple claims");
  assertStringIncludes(output.replaceAll(/\s+/gu, ""), longRecord);
  assert(!output.includes("data.fleet"), output);
  assert(!output.includes("data.adr"), output);
  assertLinesFit(output, 60);
});

Deno.test("status dashboard: every backticked discern command is cyan without changing its text", () => {
  const behind = entry({ behind: 2 });
  const receiptUnavailable = entry({
    path: "/repo.worktrees/receipt-def456",
    branch: "agent/receipt-def456",
    id: "receipt-def456",
    gate_receipt: { status: "unavailable", reason: "admin dir missing" },
  });
  const hints = hintTexts([
    fire(HINTS["status-branch-behind"], {
      behind: 2,
      trunk: "main",
      overlap: undefined,
    }),
  ]);
  const fixture = data([mainEntry(), behind, receiptUnavailable], {
    gate_receipt: {
      status: "honored",
      receipt:
        "### Receipt\n\nRun `discern standards` to inspect the measurements.",
    },
  });
  const noColor = render(fixture, 104, false, hints, true);
  const color = render(fixture, 104, true, hints, true);

  assertEquals(plain(color), noColor);
  const commandCount = noColor.split("`discern").length - 1;
  const highlighted = color.split(`\`${ESC}[36mdiscern`).length - 1;
  assert(
    commandCount >= 4,
    "fixture must exercise every command text route",
  );
  assert(!color.includes("`discern"), color);
  assertEquals(highlighted, commandCount);
  assertStringIncludes(
    color,
    `\`${ESC}[36mdiscern${ESC}[0m ${ESC}[36mupdate${ESC}[0m\``,
  );
  assertStringIncludes(
    color,
    `\`${ESC}[36mdiscern${ESC}[0m${ESC}[2m ${ESC}[36mstandards${ESC}[0m${ESC}[2m\``,
  );
  assertLinesFit(color, 104);
});

Deno.test("status dashboard: collision precedence retains receipt readiness and landing authority", () => {
  const ready = entry({
    ahead: 2,
    gate_receipt: { status: "honored" },
    receipt_honored: true,
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
  );
  assertStringIncludes(output, "1 ready");
  assertStringIncludes(output, "Readiness: ready · landing granted");
  assertStringIncludes(output, "Landing: granted · standing grant for map");
  assertLinesFit(output, 72);
});

Deno.test("status dashboard: main and worktree fleet contexts show main once and keep current beside identity", () => {
  const current = entry({ is_current: true });
  const main = data([mainEntry(), current]);
  const mainOutput = render(main, 72);
  assertEquals(mainOutput.match(/Main checkout/gu)?.length, 1);
  assert(mainOutput.indexOf("── Fleet") < mainOutput.indexOf("Main checkout:"));
  assert(mainOutput.indexOf("── Fleet") < mainOutput.indexOf("── Checks"));
  assertStringIncludes(mainOutput, "voyager");
  assertStringIncludes(mainOutput, "main ← current");
  assert(!mainOutput.includes("── Tasks"));
  assert(!mainOutput.includes("plain_reading_grade"));
  assertStringIncludes(mainOutput, "Standards: 2 configured");

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
  assertEquals(worktreeOutput.match(/Main checkout/gu)?.length, 1);
  assertStringIncludes(worktreeOutput, "agent/alpha-abc123 ← current");
  assertStringIncludes(worktreeOutput, "Changed scopes: web");
  assert(!worktreeOutput.includes("Change: code"));
  assert(!worktreeOutput.includes("previewable"));
  const checksAt = worktreeOutput.indexOf("── Checks");
  const environmentAt = worktreeOutput.indexOf("── Local environment");
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
    gate_receipt: { status: "honored" },
    receipt_honored: true,
  });
  const hints = hintTexts([
    fire(HINTS["status-fleet-member-ready"], {
      total: 1,
      names: ["alpha-abc123"],
      trunk: "main",
    }),
    fire(HINTS["status-fleet-logbook-disabled"]),
  ]);
  assertStringIncludes(hints[0] ?? "", "data.fleet");
  const output = render(
    data([mainEntry(), ready], {
      landed_receipt: {
        commit: "abcdef1234567890",
        commit_at: "2026-08-03T11:00:00.000Z",
        ref: "refs/notes/discern",
        receipt: {
          branch: "agent/landed-123abc",
          trunk: "main",
          head: "abcdef123456",
          files_total: 6,
          insertions: 20,
          deletions: 4,
          line: "Receipt: passed",
          markdown: "### Receipt\n\nStored table row that may remain copyable.",
        },
      },
    }),
    72,
    false,
    hints,
  );
  assertStringIncludes(output, "1 needs attention");
  assertStringIncludes(output, "complete branch beside each worktree");
  assertStringIncludes(output, "Per-worktree actions aren't available");
  assertStringIncludes(output, "6 files changed");
  assertStringIncludes(output, "+20 −4");
  assertStringIncludes(output, "1h ago");
  assert(!output.includes("refs/notes/discern"));
  assert(!output.includes("data.fleet"));
  assertLinesFit(output, 72);

  const verbose = render(
    data([mainEntry(), ready], {
      gate_receipt: {
        status: "honored",
        receipt: "### Receipt\n\n| ran | result |\n| --- | --- |",
      },
    }),
    48,
    false,
    undefined,
    true,
  );
  assertStringIncludes(verbose, "| ran | result |");
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
