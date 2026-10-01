/**
 * The desk tip engine's contract (ADR 0234): predicate evaluation over the
 * survey the desk already holds, and the deterministic selection order — new
 * arrivals, then contextual, then the curriculum, then rotation. Synthetic
 * registries pin the order exhaustively; the shipped registry has its own
 * closed-set guard.
 */

import { assertCases } from "./assert_cases.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import type { StatusFleetEntry } from "../src/shared/result_schemas.ts";
import { fleetEntry, mainFleetEntry, statusData } from "./status_fleet.ts";
import {
  defineTip,
  type RegisteredTip,
  type TipDef,
} from "../src/shared/tips.ts";
import {
  freshTipSeenState,
  markTipShown,
  renderTipLine,
  selectTip,
  type TipContext,
  tipPredicateHolds,
  type TipSeenState,
} from "../src/engine/desk/tips.ts";
import {
  inspectTipSeenState,
  readTipSeenState,
  tipStatePath,
  writeTipSeenState,
} from "../src/engine/desk/tip_state.ts";
import { writeNewerOnDiskJsonFixture } from "./on_disk_format_fixtures.ts";

const CONFIG = configSchema.parse({
  project: { slug: "demo" },
  repository: { trunk: "main" },
});

/** Build a clean worktree row and override only the status facts a tip predicate needs. */
function worktree(
  branch: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return fleetEntry({ branch, ...patch });
}

/** Construct a tip survey with a canonical main row plus chosen standards and worktrees. */
function contextOf(
  patch: { standards?: string[]; fleet?: StatusFleetEntry[] } = {},
): TipContext {
  const data = statusData(
    [mainFleetEntry(), ...(patch.fleet ?? [])],
    { git: null, standards: patch.standards ?? ["coverage"] },
  );
  return { data, config: CONFIG };
}

/** Register a minimal deterministic tip while allowing cadence or predicate variation. */
function tipOf(
  id: string,
  patch: Partial<Pick<TipDef, "predicate" | "since">> = {},
): RegisteredTip {
  return defineTip({
    id,
    when: "Test fixture.",
    features: ["desk"],
    example: undefined,
    template: (): string => `Teaches ${id}.`,
    ...patch,
  });
}

/** Replay timestamped displays through the production seen-state transition. */
function seen(
  base: TipSeenState,
  shown: ReadonlyArray<readonly [string, string]>,
): TipSeenState {
  return shown.reduce(
    (state, [id, at]) => markTipShown(state, id, at),
    base,
  );
}

Deno.test("tip predicates evaluate over the survey the desk already holds", () => {
  assertEquals(
    tipPredicateHolds(
      { kind: "standards-empty" },
      contextOf({
        standards: [],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds({ kind: "standards-empty" }, contextOf()),
    false,
  );
  assertEquals(
    tipPredicateHolds({ kind: "standards-present" }, contextOf()),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "standards-present" },
      contextOf({ standards: [] }),
    ),
    false,
  );

  const unauthorized = [worktree("agent/a"), worktree("agent/b")];
  assertEquals(
    tipPredicateHolds(
      { kind: "no-landing-authority" },
      contextOf({
        fleet: unauthorized,
      }),
    ),
    true,
    "two efforts with no recorded authority are the grant tip's moment",
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "no-landing-authority" },
      contextOf({
        fleet: [worktree("agent/a")],
      }),
    ),
    false,
    "one effort is below the fleet floor",
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "no-landing-authority" },
      contextOf({
        fleet: [
          worktree("agent/a", {
            landing_authority: { kind: "authorized", source: "effort-grant" },
          }),
          worktree("agent/b"),
        ],
      }),
    ),
    false,
    "one authorized effort retires the moment",
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "no-landing-authority" },
      contextOf({
        fleet: [
          worktree("agent/a", {
            landing_authority: {
              kind: "conversation-required",
              standing_scopes: ["map"],
            },
          }),
          worktree("agent/b"),
        ],
      }),
    ),
    true,
    "a conversation-required row carries no landing authority",
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "branch-behind-trunk" },
      contextOf({
        fleet: [worktree("agent/a", { behind: 2 })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "branch-behind-trunk" },
      contextOf({
        fleet: [worktree("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "ready-to-review" },
      contextOf({
        fleet: [worktree("agent/a", { proof_honored: true })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "ready-to-review" },
      contextOf({
        fleet: [worktree("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "contained-worktree" },
      contextOf({
        fleet: [worktree("agent/a", { contained_in: "agent/b" })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "contained-worktree" },
      contextOf({
        fleet: [worktree("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "fleet-min-size", min: 2 },
      contextOf({
        fleet: [worktree("agent/a"), worktree("agent/b")],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "fleet-min-size", min: 3 },
      contextOf({
        fleet: [worktree("agent/a"), worktree("agent/b")],
      }),
    ),
    false,
  );
});

Deno.test("selectTip follows applicability, arrival, curriculum, and rotation precedence", () => {
  const filteredTips = [
    tipOf("contextual", { predicate: { kind: "standards-empty" } }),
    tipOf("evergreen"),
  ];
  const filteredState = seen(freshTipSeenState("3.0.0"), [
    ["contextual", "2026-07-01T00:00:00.000Z"],
    ["evergreen", "2026-07-02T00:00:00.000Z"],
  ]);
  const rotationTips = [tipOf("a"), tipOf("b"), tipOf("c")];
  const cases: ReadonlyArray<{
    name: string;
    tips: RegisteredTip[];
    context: TipContext;
    state: TipSeenState;
    expected:
      | { id?: string; newIn?: string | undefined; rendered?: string }
      | undefined;
  }> = [
    {
      name: "unseen tips follow authored order — the curriculum",
      tips: [tipOf("first"), tipOf("second"), tipOf("third")],
      context: contextOf(),
      state: freshTipSeenState("3.0.0"),
      expected: { id: "first", newIn: undefined },
    },
    {
      name: "an unseen tip whose predicate holds outranks the curriculum",
      tips: [
        tipOf("opener"),
        tipOf("contextual", { predicate: { kind: "standards-empty" } }),
      ],
      context: contextOf({ standards: [] }),
      state: freshTipSeenState("3.0.0"),
      expected: { id: "contextual" },
    },
    {
      name:
        "a tip whose predicate does not hold is not applicable, even for rotation",
      tips: filteredTips,
      context: contextOf(),
      state: filteredState,
      expected: { id: "evergreen" },
    },
    {
      name: "an all-filtered pool selects nothing",
      tips: filteredTips.slice(0, 1),
      context: contextOf(),
      state: filteredState,
      expected: undefined,
    },
    {
      name:
        "an unseen tip newer than the baseline ranks first and carries its release",
      tips: [
        tipOf("contextual", { predicate: { kind: "standards-empty" } }),
        tipOf("arrived", { since: "3.1.0" }),
      ],
      context: contextOf({ standards: [] }),
      state: freshTipSeenState("3.0.0"),
      expected: {
        id: "arrived",
        newIn: "3.1.0",
        rendered: "New in 3.1.0: Teaches arrived.",
      },
    },
    {
      name:
        "a fresh state baselines at the current version, so nothing renders as new",
      tips: [tipOf("shipped", { since: "1.4.0" }), tipOf("older")],
      context: contextOf(),
      state: freshTipSeenState("1.4.0"),
      expected: {
        id: "shipped",
        newIn: undefined,
        rendered: "Teaches shipped.",
      },
    },
    {
      name: "a malformed since tag orders low instead of throwing",
      tips: [tipOf("odd", { since: "next" }), tipOf("plain")],
      context: contextOf(),
      state: freshTipSeenState("3.0.0"),
      expected: { id: "odd", newIn: undefined },
    },
    {
      name: "version comparison is numeric per segment, not lexicographic",
      tips: [tipOf("ten", { since: "1.10.0" })],
      context: contextOf(),
      state: freshTipSeenState("1.9.0"),
      expected: { newIn: "1.10.0" },
    },
    {
      name: "rotation picks the least-recently-shown tip",
      tips: rotationTips,
      context: contextOf(),
      state: seen(freshTipSeenState("3.0.0"), [
        ["a", "2026-07-03T00:00:00.000Z"],
        ["b", "2026-07-01T00:00:00.000Z"],
        ["c", "2026-07-02T00:00:00.000Z"],
      ]),
      expected: { id: "b" },
    },
    {
      name: "equal timestamps fall back to authored order",
      tips: rotationTips,
      context: contextOf(),
      state: seen(freshTipSeenState("3.0.0"), [
        ["b", "2026-07-01T00:00:00.000Z"],
        ["a", "2026-07-01T00:00:00.000Z"],
        ["c", "2026-07-02T00:00:00.000Z"],
      ]),
      expected: { id: "a" },
    },
    {
      name: "an empty registry selects nothing",
      tips: [],
      context: contextOf(),
      state: freshTipSeenState("3.0.0"),
      expected: undefined,
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    const selected = selectTip(row.tips, row.context, row.state);
    if (row.expected === undefined) {
      assertEquals(selected, undefined, row.name);
      return;
    }
    assert(selected !== undefined, row.name);
    if ("id" in row.expected) {
      assertEquals(selected.tip.id, row.expected.id, row.name);
    }
    if ("newIn" in row.expected) {
      assertEquals(selected.newIn, row.expected.newIn, row.name);
    }
    if ("rendered" in row.expected) {
      assertEquals(renderTipLine(selected), row.expected.rendered, row.name);
    }
  });
});

Deno.test("no tip repeats until the applicable pool exhausts", () => {
  const tips = [tipOf("a"), tipOf("b"), tipOf("c")];
  const ctx = contextOf();
  let state = freshTipSeenState("3.0.0");
  const shown: string[] = [];
  for (let round = 0; round < 4; round++) {
    const selected = selectTip(tips, ctx, state);
    assert(selected !== undefined);
    shown.push(selected.tip.id);
    state = markTipShown(
      state,
      selected.tip.id,
      `2026-07-0${round + 1}T00:00:00.000Z`,
    );
  }
  assertEquals(shown, ["a", "b", "c", "a"]);
});

Deno.test("selection is deterministic: identical inputs pick the identical tip", () => {
  const tips = [tipOf("a"), tipOf("b")];
  const ctx = contextOf();
  const state = seen(freshTipSeenState("3.0.0"), [
    ["a", "2026-07-01T00:00:00.000Z"],
  ]);
  const first = selectTip(tips, ctx, state);
  const second = selectTip(tips, ctx, state);
  assertEquals(first?.tip.id, second?.tip.id);
});

Deno.test("marking a tip shown counts showings and advances the timestamp", () => {
  let state = freshTipSeenState("3.0.0");
  state = markTipShown(state, "a", "2026-07-01T00:00:00.000Z");
  state = markTipShown(state, "a", "2026-07-02T00:00:00.000Z");
  assertEquals(state.tips["a"], {
    count: 2,
    last_shown: "2026-07-02T00:00:00.000Z",
  });
  assertEquals(state.baseline_version, "3.0.0");
});

// ── the seen-state store ────────────────────────────────────────────────────

Deno.test("tip seen-state: a missing file reads as the fresh state", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    assertEquals(
      await readTipSeenState(dir, "1.2.3"),
      freshTipSeenState("1.2.3"),
    );
  });
});

Deno.test("tip seen-state: writes round-trip and linked worktrees share one file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const state = markTipShown(
      freshTipSeenState("3.0.0"),
      "patterns-practice-report",
      "2026-07-11T12:00:00.000Z",
    );
    await writeTipSeenState(dir, state);
    assertEquals(await readTipSeenState(dir, "9.9.9"), state);
    const linked = await addWorktree(dir, "tips-shared");
    assertEquals(
      await readTipSeenState(linked, "9.9.9"),
      state,
      "the common git dir shares one seen-state across linked worktrees",
    );
  });
});

Deno.test("tip seen-state: torn, newer, or malformed files fall back gracefully", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const path = await tipStatePath(dir);
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });

    await Deno.writeTextFile(path, "{ torn");
    assertEquals(
      await readTipSeenState(dir, "3.0.0"),
      freshTipSeenState("3.0.0"),
      "a torn write resets",
    );

    const newerBytes = await writeNewerOnDiskJsonFixture(
      path,
      "deskTipState",
      {
        baseline_version: "0.1.0",
        tips: {},
      },
    );
    const newer = await inspectTipSeenState(dir);
    assert(newer.status === "newer");
    assertStringIncludes(newer.reason, "written by a newer discern");
    assertEquals(
      await readTipSeenState(dir, "3.0.0"),
      freshTipSeenState("3.0.0"),
      "a newer schema contributes no defaults",
    );
    await writeTipSeenState(dir, freshTipSeenState("3.0.0"));
    assertEquals(
      await Deno.readTextFile(path),
      newerBytes,
      "the best-effort writer must preserve newer state",
    );

    await Deno.writeTextFile(
      path,
      JSON.stringify({
        schema_version: 1,
        baseline_version: "0.1.0",
        tips: { x: { count: "many", last_shown: 7 } },
      }),
    );
    assertEquals(
      await readTipSeenState(dir, "3.0.0"),
      freshTipSeenState("3.0.0"),
      "a malformed entry resets",
    );
  });
});

Deno.test("tip seen-state: outside a repository, reads reset and writes are silent", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await tipStatePath(dir), undefined);
    assertEquals(
      await readTipSeenState(dir, "3.0.0"),
      freshTipSeenState("3.0.0"),
    );
    await writeTipSeenState(dir, freshTipSeenState("3.0.0"));
  });
});
