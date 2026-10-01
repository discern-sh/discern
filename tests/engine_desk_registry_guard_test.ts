/**
 * The Desk's control registries stay one coherent authority: one meaning per
 * key per layer, mnemonics clear of the package's keys, labels that promise a
 * question exactly when one follows, one next step per row state, at most
 * three keyed alternatives, Drop never offered as a next step, and a revision
 * binding behind everything that changes the project. Every check iterates the
 * registries and status's state table, so a new action, command, key, or
 * state enrolls itself.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertNamedCases } from "./assert_cases.ts";
import { fleetEntry } from "./fixtures/status_fleet.ts";
import { NOW, TABLE_ROWS } from "./fixtures/row_state_table.ts";
import {
  asksBeforeRunning,
  DESK_COMMAND_TOGGLED_LABELS,
} from "../src/shared/desk_vocabulary.ts";
import { FLEET_ROW_STATE_IDS } from "../src/shared/fleet_row_vocabulary.ts";
import {
  type FleetTaskRowStateId,
  TASK_ROW_SENTENCES,
} from "../src/engine/status/row_sentences.ts";
import {
  buildDeskDecision,
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  type DeskAction,
  type DeskActionMetadata,
  type DeskAgentLaunch,
  deskAlsoActions,
  type DeskDecision,
  deskNextAction,
} from "../src/engine/desk/model.ts";
import {
  commandConsequenceLines,
  commandDisclosure,
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  DESK_PALETTE_SECTION_TITLES,
  DESK_PALETTE_SECTIONS,
  type DeskCommandMetadata,
} from "../src/engine/desk/commands.ts";
import {
  DESK_KEYS,
  DESK_LAYERS,
  EDITOR_RESERVED_CHORDS,
  PACKAGE_RESERVED_KEYS,
  sheetFieldChords,
} from "../src/engine/desk/keys.ts";
import { deskApplicationView } from "../src/engine/desk/application_view.ts";
import { statusData } from "./fixtures/status_fleet.ts";

/** Every live task state, from status's own sentence table. */
const TASK_STATES: readonly FleetTaskRowStateId[] = FLEET_ROW_STATE_IDS.filter(
  (id): id is FleetTaskRowStateId => Object.hasOwn(TASK_ROW_SENTENCES, id),
);

/** One action's metadata, read through its declared contract type. */
function action(id: DeskAction): DeskActionMetadata {
  return DESK_ACTION_REGISTRY[id];
}

/** One command's metadata, read through its declared contract type. */
function command(id: (typeof DESK_COMMANDS)[number]): DeskCommandMetadata {
  return DESK_COMMAND_REGISTRY[id];
}

/** The states status reaches through its degraded kinds. */
const DEGRADED_STATES = new Set<FleetTaskRowStateId>(
  TABLE_ROWS.flatMap((row) =>
    row.state !== "parked" && row.state !== "landed" &&
      (row.entry.broken === true || row.entry.git_unavailable === true ||
        row.entry.setup !== undefined)
      ? [row.state]
      : []
  ),
);

/** An installed agent, so a state whose next step opens one can run it. */
const AGENT: DeskAgentLaunch = {
  id: "claude_code:open",
  agent: "claude_code",
  providerLabel: "Claude Code",
  binary: "claude",
  kind: "open",
  label: "Open",
  args: [],
  availability: "enabled",
};

/** A Desk decision for one written table row, with its queue and landing. */
function tableDecision(row: (typeof TABLE_ROWS)[number]): DeskDecision {
  const integration = row.context?.integration;
  return buildDeskDecision(row.entry, {
    trunk: "main",
    nowMs: NOW,
    agentLaunches: [AGENT],
    queue: row.context?.queueRow === undefined ? [] : [row.context.queueRow],
    fleet: [
      row.entry,
      ...(integration === undefined ? [] : [
        fleetEntry({ branch: "integration/task", integration }),
      ]),
    ],
  });
}

Deno.test("Desk registry guard: keys", () => {
  assertNamedCases({
    "every layer gives each key one meaning": () => {
      for (const layer of DESK_LAYERS) {
        const keys = DESK_KEYS[layer].map((binding) => binding.key);
        assertEquals(
          keys.filter((key, index) => keys.indexOf(key) !== index),
          [],
          `${layer}: a key with two meanings`,
        );
      }
    },
    "task mnemonics, global command keys, and the package's keys stay disjoint":
      () => {
        const mnemonics = DESK_ACTIONS.flatMap((id) => action(id).key ?? []);
        // A branch row's keys live in their own layer, so only global
        // command keys share the task layer with mnemonics.
        const commandKeys = DESK_COMMANDS.flatMap((id) =>
          command(id).scope === "global" ? command(id).key ?? [] : []
        );
        const reserved: readonly string[] = PACKAGE_RESERVED_KEYS;
        assertEquals(
          mnemonics.filter((key, index) => mnemonics.indexOf(key) !== index),
          [],
          "two actions share a mnemonic",
        );
        assertEquals(
          mnemonics.filter((key) => commandKeys.includes(key)),
          [],
          "a mnemonic shadows a command key",
        );
        assertEquals(
          [...mnemonics, ...commandKeys].filter((key) =>
            reserved.includes(key)
          ),
          [],
          "a registry key takes a key the package owns",
        );
      },
    "every registry key reaches the key map, in its scope's layer": () => {
      for (const id of DESK_ACTIONS) {
        const key = action(id).key;
        if (key === undefined) continue;
        assert(
          DESK_KEYS.inbox.some((binding) =>
            binding.key === key && binding.meaning.kind === "action" &&
            binding.meaning.action === id
          ),
          `${id}: ${key}`,
        );
      }
      for (const id of DESK_COMMANDS) {
        const metadata = command(id);
        if (metadata.key === undefined) continue;
        const layer = metadata.scope === "parked-row" ? "branch" : "inbox";
        assert(
          DESK_KEYS[layer].some((binding) =>
            binding.key === metadata.key &&
            binding.meaning.kind === "command" &&
            binding.meaning.command === id
          ),
          `${id}: ${metadata.key} in ${layer}`,
        );
      }
    },
    "sheet chords work inside a text field and avoid the editor's chords":
      () => {
        const editor: readonly string[] = EDITOR_RESERVED_CHORDS;
        const chords = sheetFieldChords();
        assertEquals(
          chords.filter((binding) => editor.includes(binding.key)),
          [],
        );
        for (const disclosure of ["toggle-plan", "toggle-command"] as const) {
          const bindings = DESK_KEYS.sheet.filter((binding) =>
            binding.meaning.kind === "gesture" &&
            binding.meaning.gesture === disclosure
          );
          assert(
            bindings.some((binding) => binding.key.length === 1) &&
              chords.some((binding) => bindings.includes(binding)),
            `${disclosure}: a letter and a field chord`,
          );
        }
      },
  });
});

Deno.test("Desk registry guard: labels and bindings", () => {
  assertNamedCases({
    "a label ends with an ellipsis exactly when it asks before running": () => {
      for (const id of DESK_ACTIONS) {
        const metadata = action(id);
        assertEquals(
          asksBeforeRunning(metadata.label),
          metadata.confirmation.kind !== "none" || metadata.parameters,
          `${id}: ${metadata.label}`,
        );
      }
      for (const id of DESK_COMMANDS) {
        const metadata = command(id);
        for (
          const label of [metadata.label, metadata.toggledLabel ?? []].flat()
        ) {
          assertEquals(
            asksBeforeRunning(label),
            metadata.confirmation.kind !== "none" || metadata.parameters,
            `${id}: ${label}`,
          );
        }
      }
      assertEquals(
        Object.keys(DESK_COMMAND_TOGGLED_LABELS).every((id) =>
          DESK_COMMANDS.some((candidate) =>
            candidate === id &&
            command(candidate).toggledLabel !== undefined
          )
        ),
        true,
      );
    },
    "everything that changes the project or launches a child declares its binding":
      () => {
        const contracts = [
          ...DESK_ACTIONS.map((id) => [id, action(id)] as const),
          ...DESK_COMMANDS.map((id) => [id, command(id)] as const),
        ];
        for (const [id, metadata] of contracts) {
          const reads = metadata.effect === "read";
          assertEquals(
            metadata.binding.length === 0,
            reads,
            `${id}: a ${metadata.effect} control binds ${
              JSON.stringify(metadata.binding)
            }`,
          );
          if (metadata.confirmation.kind !== "none") {
            assert(!reads, `${id}: a confirmed control must change something`);
          }
        }
      },
    "every global command sits in one palette section and projects its facts":
      () => {
        assertEquals(Object.keys(DESK_PALETTE_SECTION_TITLES), [
          ...DESK_PALETTE_SECTIONS,
        ]);
        const busy = {
          version: "9.8.7",
          trunk: "main",
          sessionOperations: 2,
          data: statusData([], {
            git: {
              branch: "main",
              trunk: "main",
              clean: false,
              changed_files: 1,
              behind_trunk: 0,
              ahead_trunk: 0,
            },
            release_reminder: "2026-01-01T00:00:00.000Z",
            unlanded_branches: ["agent/kept", "agent/old"],
            parked_tasks: [{
              id: "kept",
              branch: "agent/kept",
              head: "abc1234",
              parked_at: "2026-01-01T00:00:00.000Z",
              task: {
                id: "kept",
                branch: "agent/kept",
                title: "Kept",
                title_source: "recorded",
              },
            }],
            recent_completed_tasks: [{
              branch: "agent/done",
              completed_at: "2026-01-01T00:00:00.000Z",
            }],
          }),
        };
        for (const id of DESK_COMMANDS) {
          const metadata = command(id);
          assertEquals(
            metadata.section !== undefined,
            metadata.scope === "global",
            id,
          );
          for (const facts of [{ version: "9.8.7" }, busy]) {
            assert(metadata.summary.length > 0, id);
            metadata.meta?.(facts);
            const evidence = metadata.command?.(facts);
            assert(evidence === undefined || evidence.argv.length > 0, id);
            assert(
              commandConsequenceLines(id, facts).every((line) =>
                line.text.length > 0
              ),
              id,
            );
          }
        }
        assertEquals(
          DESK_COMMANDS.flatMap((id) => command(id).meta?.(busy) ?? []),
          [
            "0 queued · 1 landed",
            "2 branches",
            "has changes",
            "2 this session",
            "check due",
          ],
        );
      },
    "Check for updates discloses the browser and the running version": () => {
      const facts = { version: "9.8.7", data: statusData([]) };
      const disclosure = commandDisclosure("updates", facts);
      assertStringIncludes(disclosure, "browser");
      assertStringIncludes(disclosure, "discern.sh");
      assertStringIncludes(disclosure, "9.8.7");
      assertStringIncludes(disclosure, "Nothing is installed");
      const commands = deskApplicationView(
        { data: statusData([]), rows: [], phase: "fresh" },
        "overview",
      ).regions[1];
      assert(commands?.kind === "choices");
      const updates = commands.entries.find((entry) => entry.id === "releases");
      assert(updates !== undefined && updates.kind !== "group-heading");
      assertStringIncludes(updates.description ?? "", "browser");
      assertStringIncludes(updates.description ?? "", "you run");
    },
  });
});

Deno.test("Desk registry guard: next steps", () => {
  assertNamedCases({
    "every live state has exactly one next step, and Drop is never it": () => {
      for (const state of TASK_STATES) {
        const owners = DESK_ACTIONS.filter((id) =>
          action(id).next.includes(state)
        );
        assertEquals(owners.length, 1, `${state}: ${owners.join(", ")}`);
        assert(deskNextAction(state) !== "drop", state);
      }
    },
    "a state's alternatives are keyed, at most three, and spare degraded tasks from Drop":
      () => {
        assert(DEGRADED_STATES.size > 0);
        for (const state of TASK_STATES) {
          const also = deskAlsoActions(state);
          assert(also.length <= 3, `${state}: ${also.join(", ")}`);
          for (const id of also) {
            assert(action(id).key !== undefined, `${state}: ${id} unkeyed`);
            assert(id !== deskNextAction(state), `${state}: ${id} twice`);
          }
          if (DEGRADED_STATES.has(state)) {
            assert(!also.includes("drop"), `${state} offers Drop`);
          }
        }
      },
    "a decision the landing cores always refuse is never offered from the desk":
      () => {
        const owed = TABLE_ROWS.filter((row) =>
          row.state === "exception" ||
          row.context?.integration?.judgment?.decision === "declaration"
        );
        assert(owed.length >= 5, "every exception kind and the declaration");
        for (const row of owed) {
          const decision = tableDecision(row);
          for (const id of ["accept", "submit"] as const) {
            const offer = decision.actions.find((each) => each.action === id);
            assertEquals(
              offer?.availability,
              "disabled",
              `row ${row.row} (${decision.state}): ${id}`,
            );
          }
        }
      },
    "every written state's decision offers every action once and never an unavailable step":
      () => {
        const covered = new Set<string>();
        for (const row of TABLE_ROWS) {
          const decision = tableDecision(row);
          assertEquals(decision.state, row.state, `row ${row.row}`);
          covered.add(decision.state);
          assertEquals(
            decision.actions.map((offer) => offer.action),
            [...DESK_ACTIONS],
            `row ${row.row}`,
          );
          assertEquals(decision.next?.action, deskNextAction(decision.state));
          assertEquals(
            decision.next?.action,
            row.next,
            `row ${row.row} (${row.state}): the table's Next column`,
          );
          assertEquals(
            decision.next?.availability,
            "enabled",
            `row ${row.row} (${row.state}): its own next step can run`,
          );
          assert(
            decision.also.every((offer) => offer.availability === "enabled"),
            `row ${row.row}`,
          );
        }
        assertEquals([...covered].sort(), [...TASK_STATES].sort());
      },
  });
});
