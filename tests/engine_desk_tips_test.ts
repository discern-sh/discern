/**
 * The desk tip engine's contract (ADR 0234): predicate evaluation over the
 * survey the desk already holds, and the deterministic selection order — new
 * arrivals, then contextual, then the curriculum, then rotation. Synthetic
 * registries pin the order exhaustively; the shipped registry has its own
 * closed-set guard.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
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

const CONFIG = configSchema.parse({
  project: { slug: "demo" },
  repository: { trunk: "main" },
});

/** Build a clean worktree row and override only the status facts a tip predicate needs. */
function fleetEntry(
  branch: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    path: `/worktrees/${branch}`,
    is_main: false,
    is_current: false,
    branch,
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    ...patch,
  };
}

/** Construct a tip survey with a canonical main row plus chosen standards and worktrees. */
function contextOf(
  patch: { standards?: string[]; fleet?: StatusFleetEntry[] } = {},
): TipContext {
  const data: StatusData = {
    location: "main",
    root: "/project",
    worktree: null,
    git: null,
    standards: patch.standards ?? ["coverage"],
    fleet: [
      fleetEntry("main", { is_main: true, is_current: true, path: "/project" }),
      ...(patch.fleet ?? []),
    ],
  };
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

  const unauthorized = [fleetEntry("agent/a"), fleetEntry("agent/b")];
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
        fleet: [fleetEntry("agent/a")],
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
          fleetEntry("agent/a", {
            landing_authority: { kind: "authorized", source: "effort-grant" },
          }),
          fleetEntry("agent/b"),
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
          fleetEntry("agent/a", {
            landing_authority: {
              kind: "conversation-required",
              standing_scopes: ["map"],
            },
          }),
          fleetEntry("agent/b"),
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
        fleet: [fleetEntry("agent/a", { behind: 2 })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "branch-behind-trunk" },
      contextOf({
        fleet: [fleetEntry("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "ready-to-review" },
      contextOf({
        fleet: [fleetEntry("agent/a", { proof_honored: true })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "ready-to-review" },
      contextOf({
        fleet: [fleetEntry("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "contained-worktree" },
      contextOf({
        fleet: [fleetEntry("agent/a", { contained_in: "agent/b" })],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "contained-worktree" },
      contextOf({
        fleet: [fleetEntry("agent/a")],
      }),
    ),
    false,
  );

  assertEquals(
    tipPredicateHolds(
      { kind: "fleet-min-size", min: 2 },
      contextOf({
        fleet: [fleetEntry("agent/a"), fleetEntry("agent/b")],
      }),
    ),
    true,
  );
  assertEquals(
    tipPredicateHolds(
      { kind: "fleet-min-size", min: 3 },
      contextOf({
        fleet: [fleetEntry("agent/a"), fleetEntry("agent/b")],
      }),
    ),
    false,
  );
});

Deno.test("unseen tips follow authored order — the curriculum", () => {
  const tips = [tipOf("first"), tipOf("second"), tipOf("third")];
  const state = freshTipSeenState("3.0.0");
  const selected = selectTip(tips, contextOf(), state);
  assertEquals(selected?.tip.id, "first");
  assertEquals(selected?.newIn, undefined);
});

Deno.test("an unseen tip whose predicate holds outranks the curriculum", () => {
  const tips = [
    tipOf("opener"),
    tipOf("contextual", { predicate: { kind: "standards-empty" } }),
  ];
  const selected = selectTip(
    tips,
    contextOf({ standards: [] }),
    freshTipSeenState("3.0.0"),
  );
  assertEquals(selected?.tip.id, "contextual");
});

Deno.test("a tip whose predicate does not hold is not applicable, even for rotation", () => {
  const tips = [
    tipOf("contextual", { predicate: { kind: "standards-empty" } }),
    tipOf("evergreen"),
  ];
  const ctx = contextOf();
  const state = seen(freshTipSeenState("3.0.0"), [
    ["contextual", "2026-07-01T00:00:00.000Z"],
    ["evergreen", "2026-07-02T00:00:00.000Z"],
  ]);
  assertEquals(
    selectTip(tips, ctx, state)?.tip.id,
    "evergreen",
    "rotation may only pick from the applicable pool",
  );
  assertEquals(
    selectTip([tips[0] as RegisteredTip], ctx, state),
    undefined,
    "an all-filtered pool selects nothing",
  );
});

Deno.test("an unseen tip newer than the baseline ranks first and carries its release", () => {
  const tips = [
    tipOf("contextual", { predicate: { kind: "standards-empty" } }),
    tipOf("arrived", { since: "3.1.0" }),
  ];
  const selected = selectTip(
    tips,
    contextOf({ standards: [] }),
    freshTipSeenState("3.0.0"),
  );
  assertEquals(selected?.tip.id, "arrived");
  assertEquals(selected?.newIn, "3.1.0");
  assertEquals(
    renderTipLine(selected as NonNullable<typeof selected>),
    "New in 3.1.0: Teaches arrived.",
  );
});

Deno.test("a fresh state baselines at the current version, so nothing renders as new", () => {
  const tips = [tipOf("shipped", { since: "1.4.0" }), tipOf("older")];
  const selected = selectTip(tips, contextOf(), freshTipSeenState("1.4.0"));
  assertEquals(
    selected?.tip.id,
    "shipped",
    "the entry still leads in authored order",
  );
  assertEquals(
    selected?.newIn,
    undefined,
    "since equal to the baseline is not an arrival",
  );
  assertEquals(
    renderTipLine(selected as NonNullable<typeof selected>),
    "Teaches shipped.",
  );
});

Deno.test("a malformed since tag orders low instead of throwing", () => {
  const tips = [tipOf("odd", { since: "next" }), tipOf("plain")];
  const selected = selectTip(tips, contextOf(), freshTipSeenState("3.0.0"));
  assertEquals(selected?.tip.id, "odd");
  assertEquals(selected?.newIn, undefined);
});

Deno.test("version comparison is numeric per segment, not lexicographic", () => {
  const tips = [tipOf("ten", { since: "1.10.0" })];
  const selected = selectTip(tips, contextOf(), freshTipSeenState("1.9.0"));
  assertEquals(selected?.newIn, "1.10.0", "1.10.0 is newer than 1.9.0");
});

Deno.test("rotation picks the least-recently-shown tip, ties in authored order", () => {
  const tips = [tipOf("a"), tipOf("b"), tipOf("c")];
  const ctx = contextOf();
  const state = seen(freshTipSeenState("3.0.0"), [
    ["a", "2026-07-03T00:00:00.000Z"],
    ["b", "2026-07-01T00:00:00.000Z"],
    ["c", "2026-07-02T00:00:00.000Z"],
  ]);
  assertEquals(selectTip(tips, ctx, state)?.tip.id, "b");

  const tied = seen(freshTipSeenState("3.0.0"), [
    ["b", "2026-07-01T00:00:00.000Z"],
    ["a", "2026-07-01T00:00:00.000Z"],
    ["c", "2026-07-02T00:00:00.000Z"],
  ]);
  assertEquals(
    selectTip(tips, ctx, tied)?.tip.id,
    "a",
    "equal timestamps fall back to authored order",
  );
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

Deno.test("an empty registry selects nothing", () => {
  assertEquals(
    selectTip([], contextOf(), freshTipSeenState("3.0.0")),
    undefined,
  );
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

    await Deno.writeTextFile(
      path,
      JSON.stringify({
        schema_version: 99,
        baseline_version: "0.1.0",
        tips: {},
      }),
    );
    const newer = await inspectTipSeenState(dir);
    assert(newer.status === "newer");
    assertStringIncludes(newer.reason, "written by a newer discern");
    assertEquals(
      await readTipSeenState(dir, "3.0.0"),
      freshTipSeenState("3.0.0"),
      "a newer schema contributes no defaults",
    );
    const newerBytes = await Deno.readTextFile(path);
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
