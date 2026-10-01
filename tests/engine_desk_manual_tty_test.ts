/**
 * The manual inside the Desk on a real terminal: the shared browser opens
 * on the Desk's own screen without releasing it, takes raw input through
 * search and a followed link, and returns to the inbox. The manual's
 * behaviour (pages opened beside the screen, refusals, the reader's place)
 * is held below the boundary by the fake-terminal runtime tests. Phases
 * wait on the package's state reports and on the fixture corpus's own
 * words, never on product wording.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TERMINAL_APPLICATION_STATE_REPORTS_ENV } from "discern-design-system/cli";
import {
  captureTerminalFrame,
  encodeTerminalKeys,
  ptySettledFrame,
  type TerminalFrameCapture,
} from "discern-design-system/cli/interactive/testing";
import {
  type PtyOutputCondition,
  type PtyProcessResult,
  runPtyProcess,
} from "./fixtures/pty_process.ts";
import { APPLICATION_FIXTURE_ROOT } from "./fixtures/terminal_application_capture.ts";
import { realPtyTest } from "./real_pty.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  repoSourceRunArgs,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { DESK_COMMAND_LABELS } from "../src/shared/desk_vocabulary.ts";

const MANUAL_PROCESS = join(
  APPLICATION_FIXTURE_ROOT,
  "tests/fixtures/desk_manual_process.ts",
);

/** The journey runs at 80 by 24. */
const SIZE = { columns: 80, rows: 24 };

/** One settled frame passing `test`. */
function settled(
  description: string,
  test: (capture: TerminalFrameCapture) => boolean,
): PtyOutputCondition {
  return ptySettledFrame(SIZE, description, test);
}

/** The Desk's empty inbox, with nothing open over it. */
const INBOX = settled(
  "the Desk's inbox",
  (capture) =>
    capture.state?.topLayerId === undefined &&
    capture.state?.focusedControlId === "primary",
);

/** The Desk's palette, ready for a query. */
const PALETTE = settled(
  "the Desk's palette",
  (capture) => capture.state?.topLayerId === "palette",
);

/** The manual's contents, in place of the inbox. */
const CONTENTS = settled(
  "the manual's contents",
  (capture) =>
    capture.state?.listId === "contents" &&
    capture.state.focusedControlId === "contents",
);

/** The manual's search, showing a fixture title among its matches. */
function searching(title?: string): PtyOutputCondition {
  return settled(
    `the manual's search${title === undefined ? "" : ` showing ${title}`}`,
    (capture) =>
      capture.state?.topLayerId === "search" &&
      (title === undefined || capture.text.includes(title)),
  );
}

/** A fixture document open in the manual, showing `text`. */
function reading(text: string): PtyOutputCondition {
  return settled(
    `a manual document showing ${text}`,
    (capture) =>
      String(capture.state?.focusedControlId ?? "").startsWith("document:") &&
      capture.text.includes(text),
  );
}

/** A named keyframe's visible text. */
function screen(result: PtyProcessResult, name: string): string {
  const raw = result.keyframes[name];
  assert(raw !== undefined, `the ${name} frame was captured`);
  return captureTerminalFrame(raw, SIZE).text;
}

realPtyTest({
  name:
    "the manual opens on the Desk's own screen, takes raw input through search and a link, and returns to the inbox",
  contracts: ["line-discipline", "terminal-modes", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (root) => {
      await scaffoldEngine(root, { agents: [] });
      const manual = join(root, "manual-fixture");
      await Deno.mkdir(manual);
      await Deno.writeTextFile(
        join(manual, "README.md"),
        "# Manual fixture\n\n- [Alpha guide](alpha.md)\n- [Beta guide](beta.md)\n",
      );
      await Deno.writeTextFile(
        join(manual, "alpha.md"),
        "# Alpha guide\n\n[Next section](beta.md#destination)\n",
      );
      await Deno.writeTextFile(
        join(manual, "beta.md"),
        "# Beta guide\n\n## Destination\n\nAnchor destination text.\n",
      );
      await gitInit(root);
      const anchor = reading("Anchor destination text");
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: repoSourceRunArgs(MANUAL_PROCESS, [manual]),
        cwd: root,
        geometry: SIZE,
        env: {
          NO_COLOR: "1",
          [TERMINAL_APPLICATION_STATE_REPORTS_ENV]: "1",
        },
        input: [
          { waitFor: INBOX, steps: [{ bytes: encodeTerminalKeys("ctrl-k") }] },
          {
            waitFor: PALETTE,
            steps: [{ bytes: `${DESK_COMMAND_LABELS.manual}\r` }],
          },
          {
            waitFor: CONTENTS,
            capture: { name: "manual", when: CONTENTS },
            steps: [{ bytes: "/" }],
          },
          { waitFor: searching(), steps: [{ bytes: "Alpha" }] },
          { waitFor: searching("Alpha guide"), steps: [{ bytes: "\r" }] },
          // Tab focuses the document's link; Enter follows it to a heading.
          {
            waitFor: reading("Next section"),
            steps: [{ bytes: encodeTerminalKeys("tab", "enter") }],
          },
          {
            waitFor: anchor,
            capture: { name: "linked", when: anchor },
            steps: [{ bytes: "q" }],
          },
          { waitFor: INBOX, steps: [{ bytes: "q" }] },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(screen(result, "manual"), "Alpha guide");
      assertStringIncludes(screen(result, "linked"), "Anchor destination text");
      // The manual shares the Desk's screen: the alternate screen is left
      // once, when the session ends.
      assertEquals(
        result.transcript.split("\x1b[?1049l").length - 1,
        1,
        result.transcript,
      );
    });
  },
});
