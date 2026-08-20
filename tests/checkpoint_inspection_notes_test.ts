/** Report-mode checkpoint previews state only what the read model knows. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkpointInspectionNotes,
  type CheckpointInspection,
  type CheckpointObligation,
  type CheckpointObligationUnknown,
} from "../src/engine/checkpoints/inspection.ts";
import type { ResolvedCheckpoint } from "../src/engine/checkpoints/types.ts";
import {
  CHECKPOINT_OBLIGATION_STATES,
  type CheckpointObligationState,
} from "../src/shared/checkpoints.ts";

const DEFINITION: ResolvedCheckpoint = {
  id: "review",
  mode: "stop",
  question: "Is this change ready?",
  unlessChanged: [],
  deletionDominant: false,
  similarNewFile: false,
};

/** One inspection whose sole entry has the requested canonical obligation. */
function inspection(obligation: CheckpointObligation): CheckpointInspection {
  return {
    checkpoints: [DEFINITION],
    entries: [{ definition: DEFINITION, obligation }],
    openQuestions: {},
    storeReadable: true,
    drops: [],
  };
}

const REPORT_EXPECTATION = {
  none: "nothing",
  will_open: "will",
  awaiting_declaration: "will",
  reopened: "will",
  declared_met: "will",
  declared_unmet: "will",
  unknown: "unknown",
} as const satisfies Record<
  CheckpointObligationState,
  "nothing" | "will" | "unknown"
>;

const UNKNOWN_EXPECTATION = {
  when_pending: "may",
  diff_unavailable: "failed_open",
  store_unavailable: "failed_open",
  subject_unavailable: "failed_open",
} as const satisfies Record<
  CheckpointObligationUnknown,
  "may" | "failed_open"
>;

Deno.test("checkpoint report preview: every obligation state uses an exact certainty", () => {
  for (const state of CHECKPOINT_OBLIGATION_STATES) {
    if (state === "unknown") continue;
    const notes = checkpointInspectionNotes(
      inspection({ state, matched: ["src/review.ts"] }),
      "report",
    );
    const expectation = REPORT_EXPECTATION[state];
    if (expectation === "nothing") {
      assertEquals(notes, []);
    } else {
      assertEquals(notes.length, 1);
      assertStringIncludes(notes[0] ?? "", "question will be reported");
    }
  }
});

Deno.test("checkpoint report preview: enrolled unknown reasons never overclaim a report", () => {
  for (const [unknown, expectation] of Object.entries(UNKNOWN_EXPECTATION)) {
    const notes = checkpointInspectionNotes(
      inspection({
        state: "unknown",
        matched: ["src/review.ts"],
        unknown: unknown as CheckpointObligationUnknown,
      }),
      "report",
    );
    assertEquals(notes.length, 1);
    const note = notes[0] ?? "";
    if (expectation === "may") {
      assertStringIncludes(note, "question may be reported");
    } else {
      assertStringIncludes(note, "enforcement is unknown and failed open");
      assertStringIncludes(note, "cannot promise a reported question");
      assert(!note.includes("question will be reported"));
    }
  }
});
