/**
 * Status's row-state vocabulary: the table's look guards, every row of the
 * written state table, the precedence over an explicit matrix of facts, the
 * human fact wording, and the exception hand-off command.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertCases, assertCasesAsync } from "./assert_cases.ts";
import { exceptionProof as proofData } from "./fixtures/status_fleet.ts";
import {
  daysAgo,
  honored,
  INTEGRATION,
  landable,
  LAST,
  minutesAgo,
  NOW,
  queueRow,
  RECEIPT,
  RUNNING,
  SETUP,
  TABLE_ROWS,
  task,
} from "./fixtures/row_state_table.ts";
import { displayWidth } from "../src/lib/text.ts";
import {
  FLEET_BRANCH_GROUPS,
  FLEET_ROW_DECISIONS,
  FLEET_ROW_GROUPS,
  FLEET_ROW_STATE_IDS,
  type FleetRowStateId,
} from "../src/shared/fleet_row_vocabulary.ts";
import type {
  GateProofCheckData,
  Proof,
  StatusFleetEntry,
  SubmissionRowData,
} from "../src/shared/result_schemas.ts";
import {
  branchRowState,
  classifyRowKind,
  FLEET_ROW_GROUP_TITLES,
  FLEET_ROW_STATES,
  type RowStateContext,
  rowStateFor,
  rowStateLabel,
  taskRowState,
} from "../src/engine/status/row_states.ts";
import {
  authorityHuman,
  exceptionArgv,
  FLEET_ROW_STATUS_KINDS,
  type FleetRowIntegration,
  type FleetRowStatusKind,
  type FleetTaskRowFacts,
  proofHuman,
  queueHuman,
} from "../src/engine/status/row_facts.ts";
import {
  BRANCH_ROW_SENTENCES,
  type FleetTaskRowStateId,
  TASK_ROW_SENTENCES,
} from "../src/engine/status/row_sentences.ts";
import { standardLimitApprovalRequests } from "../src/engine/worktree/standard_approval.ts";

/** The states whose glyph or label may be green: only work that can land. */
const LANDABLE_STATES: ReadonlySet<FleetRowStateId> = new Set([
  "awaiting-owner",
  "ready",
  "approved",
  "queued",
]);

/** Fold-row markers share the state column, so no state may claim them. */
const FOLD_MARKERS = { "▸": "+", "▾": "-" } as const;

/** Resolve a fixture the way status does: classify, then refine. */
function resolve(
  entry: StatusFleetEntry,
  context: RowStateContext = {},
): { kind: FleetRowStatusKind; state: FleetTaskRowStateId } {
  const kind = classifyRowKind(entry, NOW);
  return {
    kind,
    state: rowStateFor(kind, entry, {
      ...context,
      proofData: context.proofData ?? entry.gate_proof?.proof_data,
    }),
  };
}

Deno.test("row-state table: every state's look keeps the shared contract", () => {
  assertCases(
    [
      {
        name: "the table covers exactly the published state ids",
        check: () => {
          assertEquals(
            Object.keys(FLEET_ROW_STATES).sort(),
            [...FLEET_ROW_STATE_IDS].sort(),
          );
          assertEquals(
            [
              ...Object.keys(TASK_ROW_SENTENCES),
              ...Object.keys(BRANCH_ROW_SENTENCES),
            ]
              .sort(),
            [...FLEET_ROW_STATE_IDS].sort(),
          );
        },
      },
      {
        name: "labels fit thirteen cells, including the widest queue place",
        check: () => {
          for (const id of FLEET_ROW_STATE_IDS) {
            const label = rowStateLabel(id, { position: 99 });
            assert(displayWidth(label) <= 13, `${id}: ${label}`);
          }
        },
      },
      {
        name: "every glyph is one cell and its ASCII form is unique",
        check: () => {
          const asciiByGlyph = new Map<string, string>(
            Object.entries(FOLD_MARKERS),
          );
          const glyphByAscii = new Map<string, string>(
            Object.entries(FOLD_MARKERS).map((
              [glyph, ascii],
            ) => [ascii, glyph]),
          );
          for (const [id, look] of Object.entries(FLEET_ROW_STATES)) {
            assertEquals(displayWidth(look.glyph), 1, id);
            assertEquals(look.ascii.length, 1, id);
            assertEquals(
              asciiByGlyph.get(look.glyph) ?? look.ascii,
              look.ascii,
              id,
            );
            assertEquals(
              glyphByAscii.get(look.ascii) ?? look.glyph,
              look.glyph,
              id,
            );
            asciiByGlyph.set(look.glyph, look.ascii);
            glyphByAscii.set(look.ascii, look.glyph);
          }
        },
      },
      {
        name: "green marks only states that can land",
        check: () => {
          for (const id of FLEET_ROW_STATE_IDS) {
            const look = FLEET_ROW_STATES[id];
            const green = look.glyphTone === "success" ||
              look.labelTone === "success";
            assertEquals(green, LANDABLE_STATES.has(id), id);
          }
        },
      },
      {
        name: "live states group by decision and branch states by branch group",
        check: () => {
          for (const id of FLEET_ROW_STATE_IDS) {
            const group = FLEET_ROW_STATES[id].group;
            const decision = FLEET_ROW_DECISIONS.some((each) => each === group);
            assertEquals(decision, id !== "parked" && id !== "landed", id);
          }
          assertEquals(FLEET_ROW_STATES.parked.group, "parked");
          assertEquals(FLEET_ROW_STATES.landed.group, "landed");
          assertEquals(FLEET_ROW_GROUPS, [
            ...FLEET_ROW_DECISIONS,
            ...FLEET_BRANCH_GROUPS,
          ]);
          assertEquals(Object.keys(FLEET_ROW_GROUP_TITLES), [
            ...FLEET_ROW_GROUPS,
          ]);
        },
      },
    ],
    (row) => row.name,
    (row) => {
      row.check();
    },
  );
});

Deno.test("row-state table: every written row resolves to its state", () => {
  assertCases(TABLE_ROWS, (row) => `row ${row.row}: ${row.state}`, (row) => {
    assertEquals(resolve(row.entry, row.context).state, row.state);
  });
  const covered = new Set<FleetRowStateId>([
    ...TABLE_ROWS.map((row) => row.state),
    "parked",
    "landed",
  ]);
  assertEquals([...covered].sort(), [...FLEET_ROW_STATE_IDS].sort());
});

Deno.test("row-state table: the owner's stale example reads Stale, never Proof valid", () => {
  const entry = landable({ behind: 361, last_activity: daysAgo(11) });
  const { kind, state } = resolve(entry, {
    queueRow: queueRow("pre-authorized"),
  });
  assertEquals(kind, "stale");
  assertEquals(state, "stale-proven");
  const facts: FleetTaskRowFacts = {
    entry,
    kind,
    trunk: "main",
    nowMs: NOW,
    queueRow: queueRow("pre-authorized"),
  };
  const sentences = taskRowState(state);
  assertEquals(sentences.label, "Stale");
  assertEquals(sentences.glyph, "!");
  assertEquals(sentences.qualifier(facts), "idle 11 days");
  assertEquals(
    sentences.explanation(facts),
    "No activity for 11 days. Its checks passed then, and main has 361 new commits since. Landing combines them and reruns every check first. Land it, park it, or drop it. It is queued and pre-authorized, so it may land with the next landing.",
  );
});

/** Dimensions that decide a row's kind. */
const DEGRADED = {
  none: {},
  broken: { broken: true },
  unreadable: { git_unavailable: true },
  "setup-retry": SETUP("incomplete", "retry"),
  "setup-manual": SETUP("incomplete", "manual"),
  "setup-no-repair": SETUP("incomplete"),
  "setup-unavailable": SETUP("unavailable"),
} as const satisfies Record<string, Partial<StatusFleetEntry>>;

const ACTIVITY = {
  none: {},
  "running done": RUNNING("done"),
  "running accept": RUNNING("accept"),
  "running update": RUNNING("update"),
  "running refresh": RUNNING("refresh"),
  "failed done": LAST("done", "failed"),
  "failed accept": LAST("accept", "failed"),
  "partial refresh": LAST("refresh", "partial"),
  "refused consent": LAST("accept", "refused", "awaiting_consent"),
  "refused variance": LAST("accept", "refused", "awaiting_variance"),
  "refused standard": LAST(
    "accept",
    "refused",
    "awaiting_standard_approval",
  ),
  "refused other": LAST("accept", "refused"),
  "ok done": LAST("done", "ok"),
} as const satisfies Record<string, Partial<StatusFleetEntry>>;

const PROOFS = {
  honored: honored(),
  "honored with exception": honored(proofData(["exactness"], ["sources"])),
  missing: { status: "missing" },
  stale: { status: "stale" },
  unreadable: { status: "read_failed", reason: "bad marker" },
  unavailable: { status: "unavailable", reason: "no admin dir" },
} as const satisfies Record<string, GateProofCheckData>;

const AHEAD = [0, 3, "unknown"] as const;
const BEHIND = [0, 361] as const;

/** Dimensions that never decide the kind but can refine the state. */
const AUTHORITY = {
  none: {},
  conversation: { landing_authority: { kind: "conversation-required" } },
  "effort grant": {
    landing_authority: { kind: "authorized", source: "effort-grant" },
  },
} as const satisfies Record<string, Partial<StatusFleetEntry>>;

const QUEUE = {
  none: undefined,
  "pre-authorized": queueRow("pre-authorized"),
  "awaiting owner": queueRow("awaiting-owner"),
} as const satisfies Record<string, SubmissionRowData | undefined>;

const INTEGRATIONS = {
  none: undefined,
  live: INTEGRATION("live"),
  interrupted: INTEGRATION("interrupted"),
  "awaiting judgment": INTEGRATION("interrupted", true),
  "awaiting variance": INTEGRATION("interrupted", true, "variance"),
  "awaiting declaration": INTEGRATION("interrupted", true, "declaration"),
  "resumed judgment": INTEGRATION("live", true),
} as const satisfies Record<string, FleetRowIntegration | undefined>;

/**
 * The written precedence, restated as the specification reads: P1 degraded
 * kinds, P2 integration facts, P3 running by verb, P4 failed by verb, P5
 * refusals by slug while landable, P6 stale unless clean and contained, P7
 * editing, P8 ready by exception, queue and authority, then containment, P9
 * and P10.
 */
function specifiedState(
  kind: FleetRowStatusKind,
  entry: StatusFleetEntry,
  context: RowStateContext,
): FleetTaskRowStateId {
  const honoredProof = entry.gate_proof?.status === "honored";
  const landableFacts = honoredProof && entry.clean === true &&
    typeof entry.ahead === "number" && entry.ahead > 0;
  const error = entry.last_action?.error;
  const verb = entry.running?.verb ?? entry.last_action?.verb;
  const exceptionFacts =
    (context.proofData?.checkpoints?.declared_unmet.length ?? 0) +
        (context.proofData?.standard_proposals?.length ?? 0) > 0;
  const authorizedFacts = entry.landing_authority?.kind === "authorized" ||
    context.queueRow?.authority === "pre-authorized";
  if (kind === "broken") return "broken";
  if (kind === "unreadable") return "unreadable";
  if (kind === "setup-incomplete") {
    return entry.setup?.state === "unavailable"
      ? "setup-unknown"
      : entry.setup?.repair?.kind === "retry"
      ? "setup-retry"
      : "setup-manual";
  }
  if (context.integration?.owner === "live") return "landing";
  if (context.integration?.awaiting_judgment === true) {
    return context.integration.judgment?.decision === "declaration"
      ? "refused"
      : "exception";
  }
  if (context.integration?.owner === "interrupted") return "interrupted";
  if (kind === "running") {
    return verb === "done"
      ? "checking"
      : verb === "accept"
      ? "landing"
      : verb === "update"
      ? "updating"
      : "running";
  }
  if (kind === "failed") {
    return verb === "done"
      ? "checks-failed"
      : verb === "accept"
      ? "land-failed"
      : "failed";
  }
  if (kind === "blocked") {
    if (landableFacts && error === "awaiting_consent") return "awaiting-owner";
    if (
      landableFacts &&
      (error === "awaiting_variance" || error === "awaiting_standard_approval")
    ) return "exception";
    return "refused";
  }
  if (kind === "stale") {
    if (entry.contained_in !== undefined && entry.clean === true) {
      return "contained";
    }
    return honoredProof ? "stale-proven" : "stale";
  }
  if (kind === "in-progress") return "editing";
  if (kind === "ready") {
    if (exceptionFacts) return "exception";
    if (context.queueRow?.authority === "awaiting-owner") {
      return "awaiting-owner";
    }
    if (authorizedFacts) {
      return context.queueRow === undefined ? "approved" : "queued";
    }
    return "ready";
  }
  if (entry.contained_in !== undefined) return "contained";
  if (kind === "behind") {
    return entry.clean === true && entry.ahead === 0 ? "empty" : "behind";
  }
  if (kind === "proof-unreadable") return "proof-error";
  if (kind === "proof-unavailable") return "proof-unknown";
  if (kind === "proof-stale") return "recheck";
  if (kind === "needs-gate") return "needs-checks";
  return entry.clean === true && entry.ahead === 0 ? "empty" : "idle-unknown";
}

interface MatrixCase {
  readonly name: string;
  readonly entry: StatusFleetEntry;
  readonly context: RowStateContext;
}

/** Every combination of the kind-deciding facts, with no refining context. */
function kindMatrix(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const [degraded, degradedPatch] of Object.entries(DEGRADED)) {
    for (const [activity, activityPatch] of Object.entries(ACTIVITY)) {
      for (const dirty of [false, true]) {
        for (const ahead of AHEAD) {
          for (const behind of BEHIND) {
            for (const [proof, gateProof] of Object.entries(PROOFS)) {
              for (const idle of [false, true]) {
                cases.push({
                  name: `${degraded} · ${activity} · ${
                    dirty ? "dirty" : "clean"
                  } · ahead ${ahead} · behind ${behind} · ${proof} · ${
                    idle ? "idle" : "fresh"
                  }`,
                  entry: task({
                    ...degradedPatch,
                    ...activityPatch,
                    clean: !dirty,
                    changed_files: dirty ? 2 : 0,
                    ahead,
                    behind,
                    last_activity: idle ? daysAgo(11) : minutesAgo(5),
                    gate_proof: dirty ? { status: "dirty" } : gateProof,
                  }),
                  context: {},
                });
              }
            }
          }
        }
      }
    }
  }
  return cases;
}

/** Representative rows of every kind, each under every refining fact. */
function contextMatrix(): MatrixCase[] {
  const representatives: ReadonlyArray<readonly [string, StatusFleetEntry]> = [
    ...Object.entries(DEGRADED).map(([name, patch]) =>
      [name, task(patch)] as const
    ),
    ["ready", landable()],
    [
      "ready with exception",
      landable({ gate_proof: PROOFS["honored with exception"] }),
    ],
    ["behind ready", landable({ behind: 361 })],
    ["stale ready", landable({ behind: 361, last_activity: daysAgo(11) })],
    ["stale unproven", task({ ahead: 2, last_activity: daysAgo(11) })],
    [
      "dirty",
      task({ clean: false, changed_files: 3, gate_proof: { status: "dirty" } }),
    ],
    ["needs checks", task({ ahead: 2 })],
    ["behind", task({ ahead: 2, behind: 4 })],
    ["empty", task()],
    ["unknown counts", task({ ahead: "unknown" })],
    ...Object.entries(ACTIVITY).map(([name, patch]) =>
      [name, landable(patch)] as const
    ),
  ];
  const cases: MatrixCase[] = [];
  for (const [row, base] of representatives) {
    for (const [authority, authorityPatch] of Object.entries(AUTHORITY)) {
      for (const [queue, queued] of Object.entries(QUEUE)) {
        for (const [integration, copy] of Object.entries(INTEGRATIONS)) {
          for (const contained of [false, true]) {
            const entry: StatusFleetEntry = {
              ...base,
              ...authorityPatch,
              ...(contained ? { contained_in: "agent/later" } : {}),
            };
            cases.push({
              name:
                `${row} · ${authority} · queue ${queue} · integration ${integration}${
                  contained ? " · contained" : ""
                }`,
              entry,
              context: {
                ...(queued === undefined ? {} : { queueRow: queued }),
                ...(copy === undefined ? {} : { integration: copy }),
                ...(entry.gate_proof?.proof_data === undefined
                  ? {}
                  : { proofData: entry.gate_proof.proof_data }),
              },
            });
          }
        }
      }
    }
  }
  return cases;
}

Deno.test("row-state precedence: every combination resolves to exactly the specified state", () => {
  const kinds = new Set<FleetRowStatusKind>();
  const states = new Set<FleetTaskRowStateId>();
  const mismatches: string[] = [];
  const sentenceFaults: string[] = [];
  for (const matrixCase of [...kindMatrix(), ...contextMatrix()]) {
    const kind = classifyRowKind(matrixCase.entry, NOW);
    const state = rowStateFor(kind, matrixCase.entry, matrixCase.context);
    const expected = specifiedState(kind, matrixCase.entry, matrixCase.context);
    kinds.add(kind);
    states.add(state);
    if (state !== expected) {
      mismatches.push(
        `${matrixCase.name}: ${kind} → ${state}, not ${expected}`,
      );
    }
    const facts: FleetTaskRowFacts = {
      entry: matrixCase.entry,
      kind,
      trunk: "main",
      nowMs: NOW,
      queueRow: matrixCase.context.queueRow,
      integration: matrixCase.context.integration,
    };
    const sentences = TASK_ROW_SENTENCES[state];
    const explanation = sentences.explanation(facts);
    const written = [
      explanation,
      sentences.qualifier(facts) ?? "",
      sentences.attention(facts) ?? "",
    ];
    if (
      explanation.includes("`") ||
      written.some((text) => /\bundefined\b|\bNaN\b|\s\.|^\s|\s$/u.test(text))
    ) {
      sentenceFaults.push(
        `${matrixCase.name} (${state}): ${written.join(" | ")}`,
      );
    }
  }
  assertEquals(mismatches.slice(0, 10), [], `${mismatches.length} mismatches`);
  assertEquals(
    sentenceFaults.slice(0, 10),
    [],
    `${sentenceFaults.length} faults`,
  );
  assertEquals([...kinds].sort(), [...FLEET_ROW_STATUS_KINDS].sort());
  assertEquals(
    [...states].sort(),
    Object.keys(TASK_ROW_SENTENCES).sort(),
    "the matrix must reach every live task state",
  );
});

Deno.test("row-state facts: Proof, authority, and queue read as people say them", () => {
  assertCases(
    [
      {
        name: "Proof inspections",
        check: () => {
          assertEquals(proofHuman(undefined, NOW), "None yet");
          assertEquals(proofHuman({ status: "missing" }, NOW), "None yet");
          assertEquals(proofHuman({ status: "honored" }, NOW), "Passed");
          assertEquals(
            proofHuman({ status: "dirty" }, NOW),
            "Not run on these changes",
          );
          assertEquals(
            proofHuman({ status: "stale" }, NOW),
            "Outdated: for an older commit",
          );
          assertEquals(
            proofHuman({ status: "read_failed", reason: "bad marker" }, NOW),
            "Unreadable: bad marker",
          );
        },
      },
      {
        name: "authority never says scope-limited or unknown",
        check: () => {
          const cases: ReadonlyArray<
            [Partial<StatusFleetEntry>, string | undefined]
          > = [
            [{}, "Needs your approval"],
            [
              { landing_authority: { kind: "conversation-required" } },
              "Needs your approval",
            ],
            [
              {
                landing_authority: {
                  kind: "authorized",
                  source: "effort-grant",
                },
              },
              "Pre-authorized by you",
            ],
            [
              {
                landing_authority: {
                  kind: "authorized",
                  source: "standing-grant",
                  scopes: ["map"],
                },
              },
              "Covered by your standing approval (map)",
            ],
            [
              {
                landing_authority: {
                  kind: "conversation-required",
                  standing_scopes: ["map"],
                  uncovered: [
                    { path: "src/a.ts", scopes: [] },
                    { path: "src/b.ts", scopes: [] },
                    { path: "src/c.ts", scopes: [] },
                  ],
                },
              },
              "Needs your approval · 3 paths aren't covered",
            ],
            [{ broken: true }, undefined],
            [{ git_unavailable: true }, undefined],
          ];
          for (const [patch, expected] of cases) {
            assertEquals(
              authorityHuman(task(patch)),
              expected,
              JSON.stringify(patch),
            );
          }
        },
      },
      {
        name: "queue places",
        check: () => {
          assertEquals(queueHuman(undefined), "Not queued");
          assertEquals(
            queueHuman(queueRow("pre-authorized")),
            "#1 · lands with any landing",
          );
          assertEquals(
            queueHuman(queueRow("awaiting-owner", { position: 2 })),
            "#2 · needs your approval",
          );
          assertEquals(
            queueHuman(
              queueRow("pre-authorized", {
                position: 2,
                readiness: "waiting",
                reason: "Its Proof can't be read.",
              }),
            ),
            "#2 · waiting: Its Proof can't be read.",
          );
          assertEquals(rowStateLabel("queued", { position: 2 }), "Queued #2");
          assertEquals(rowStateLabel("queued", undefined), "Queued");
          assertEquals(rowStateLabel("ready", { position: 2 }), "Ready");
        },
      },
      {
        name: "branch rows say where the work went",
        check: () => {
          const facts = { branch: "agent/spike", at: daysAgo(5), nowMs: NOW };
          assertEquals(
            branchRowState("parked").qualifier(facts),
            "no checkout",
          );
          assertEquals(
            branchRowState("parked").attention(facts),
            "Resume it with `discern start --from agent/spike`.",
          );
          assertEquals(branchRowState("landed").qualifier(facts), "5d ago");
          assertEquals(
            branchRowState("landed").explanation(facts),
            "It landed on main 5d ago.",
          );
        },
      },
    ],
    (row) => row.name,
    (row) => {
      row.check();
    },
  );
});

Deno.test("row-state exceptions: the hand-off names every decision exactly", async () => {
  const branch = "agent/task";
  const checkpointOnly = proofData(["exactness", "naming"]);
  const standardOnly = proofData([], ["sources"]);
  const mixed = proofData(["exactness"], ["sources", "coverage"]);
  const tokens = async (proof: Proof): Promise<string[]> =>
    (await standardLimitApprovalRequests(proof.standard_proposals ?? []))
      .map(({ token }) => token);
  const head = ["discern", "accept", "--target", branch, "--confirmed"];
  assertEquals(await exceptionArgv(branch, checkpointOnly), [
    ...head,
    "--variance",
    "exactness",
    "--variance",
    "naming",
  ]);
  const [sources] = await tokens(standardOnly);
  assert(sources !== undefined && /^[0-9a-f]{64}$/u.test(sources));
  assertEquals(await exceptionArgv(branch, standardOnly), [
    ...head,
    "--approve-standard",
    sources,
  ]);
  const mixedTokens = await tokens(mixed);
  assertEquals(await exceptionArgv(branch, mixed), [
    ...head,
    "--variance",
    "exactness",
    ...mixedTokens.flatMap((token) => ["--approve-standard", token]),
  ]);
  assertNotEquals(mixedTokens[0], mixedTokens[1]);

  const entry = landable({ gate_proof: honored(mixed) });
  const facts: FleetTaskRowFacts = {
    entry,
    kind: "ready",
    trunk: "main",
    nowMs: NOW,
  };
  const attention = taskRowState("exception").attention(facts) ?? "";
  assert(
    attention.includes(
      "`discern accept --target agent/task --confirmed --variance exactness --approve-standard <sources-token> --approve-standard <coverage-token>`",
    ),
    attention,
  );
  assertEquals(
    taskRowState("exception").explanation(facts),
    "Its checks passed, but 1 checkpoint answer is unmet and 2 standard limit changes are proposed. Landing needs your exception first.",
  );
});

Deno.test("row-state exceptions: a retained landing names its own decision", async () => {
  const branch = "agent/task";
  const variance = INTEGRATION("interrupted", true, "variance");
  const declaration = INTEGRATION("interrupted", true, "declaration");
  const factsFor = (
    entry: StatusFleetEntry,
    integration?: FleetRowIntegration,
  ): FleetTaskRowFacts => ({
    entry,
    kind: classifyRowKind(entry, NOW),
    trunk: "main",
    nowMs: NOW,
    integration,
  });
  await assertCasesAsync(
    [
      {
        name: "row 7: a variance continuation binds its ids and receipt",
        check: async () => {
          assertEquals(
            await exceptionArgv(branch, undefined, variance.judgment),
            [
              "discern",
              "accept",
              "--target",
              branch,
              "--confirmed",
              "--variance",
              "exactness",
              "--composition-receipt",
              RECEIPT,
            ],
          );
          const attention = taskRowState("exception").attention(
            factsFor(landable(), variance),
          ) ?? "";
          assert(
            attention.includes(
              `\`discern accept --target ${branch} --confirmed --variance exactness --composition-receipt ${RECEIPT}\``,
            ),
            attention,
          );
        },
      },
      {
        name: "row 7: a declaration continuation is the agent's to answer",
        check: () => {
          const facts = factsFor(landable(), declaration);
          assertEquals(
            resolve(landable(), { integration: declaration }).state,
            "refused",
          );
          assertStringIncludes(
            taskRowState("refused").attention(facts) ?? "",
            `--composition-receipt ${RECEIPT}`,
          );
          assert(
            !(taskRowState("refused").attention(facts) ?? "").includes(
              "--confirmed",
            ),
          );
        },
      },
      {
        name:
          "row 16: a refusal without named decisions never claims a command",
        check: () => {
          const entry = landable(
            LAST("accept", "refused", "awaiting_variance"),
          );
          const attention = taskRowState("exception").attention(
            factsFor(entry),
          ) ?? "";
          assertStringIncludes(
            attention,
            `\`discern accept --target ${branch}\`; it serves the exact decision to record.`,
          );
          assert(!attention.includes("--confirmed"), attention);
        },
      },
    ],
    (row) => row.name,
    async (row) => {
      await row.check();
    },
  );
});
