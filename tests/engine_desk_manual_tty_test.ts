/**
 * The manual inside the Desk on a real terminal: the shared browser opens
 * on the Desk's own screen, owns input through search, links and a refused
 * link, and returns to the inbox. Phases wait on the package's state
 * reports, never on prose.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { TERMINAL_APPLICATION_STATE_REPORTS_ENV } from "discern-design-system/cli";
import {
  captureTerminalFrame,
  ptySettledFrame,
  type TerminalFrameCapture,
} from "discern-design-system/cli/interactive/testing";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import {
  type PtyInputPhase,
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
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { encodeTerminalKeys } from "discern-design-system/cli/interactive/testing";

const MANUAL_PROCESS = join(
  APPLICATION_FIXTURE_ROOT,
  "tests/fixtures/desk_manual_process.ts",
);

/** Both journeys run at 80 by 24. */
const SIZE = { columns: 80, rows: 24 };

/** One settled frame passing `test`. */
function settled(
  description: string,
  test: (capture: TerminalFrameCapture) => boolean,
): PtyOutputCondition {
  return ptySettledFrame(SIZE, description, test);
}

/** The Desk's inbox, with nothing open over it. */
const INBOX = settled(
  "the Desk's inbox",
  (capture) =>
    capture.state !== undefined && capture.state.topLayerId === undefined &&
    capture.state.listId !== "contents" &&
    capture.text.includes("No tasks yet"),
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

/** The manual's search, showing `text` among its matches. */
function searching(text: string): PtyOutputCondition {
  return settled(
    `the manual's search showing ${text}`,
    (capture) =>
      capture.state?.topLayerId === "search" && capture.text.includes(text),
  );
}

/** A document open in the manual, showing `text`, and whether a link has focus. */
function reading(text: string, link = false): PtyOutputCondition {
  return settled(`a manual document showing ${text}`, (capture) => {
    const focused = String(capture.state?.focusedControlId ?? "");
    return focused.startsWith("document:") &&
      focused.includes(":link:") === link && capture.text.includes(text);
  });
}

/** Open the manual from the empty Desk's palette. */
const OPEN_MANUAL: readonly PtyInputPhase[] = [
  { waitFor: INBOX, steps: [{ bytes: encodeTerminalKeys("ctrl-k") }] },
  { waitFor: PALETTE, steps: [{ bytes: "Read the manual\r" }] },
];

/** A named keyframe's visible text. */
function screen(result: PtyProcessResult, name: string): string {
  const raw = result.keyframes[name];
  assert(raw !== undefined, `the ${name} frame was captured`);
  return captureTerminalFrame(raw, SIZE).text;
}

/** The bundled page the Desk opens: addressed by path, never by its prose. */
const BUNDLED_PAGE = "20-guides/delegate-work.md";

/** What the bundled reader shows for that page, read from the live manual. */
interface BundledPageView {
  readonly title: string;
  readonly opening: string;
  readonly firstLinkTitle: string;
}

/**
 * Derive the page's title, the first words of its opening paragraph, and the
 * title of the page its first link opens, so rewriting the page's prose can't
 * turn this navigation test red.
 */
async function bundledPageView(): Promise<BundledPageView> {
  const pageTitle = async (rel: string): Promise<string> => {
    const { meta } = parseFrontmatter(
      await Deno.readTextFile(join(REPO_AUTHORED_PATHS.manual, rel)),
    );
    assert(typeof meta.title === "string", `${rel} needs a title`);
    return meta.title;
  };
  const { body } = parseFrontmatter(
    await Deno.readTextFile(join(REPO_AUTHORED_PATHS.manual, BUNDLED_PAGE)),
  );
  const paragraphs = body.split(/\n\s*\n/).map((block) => block.trim());
  const opening = paragraphs.find((block) =>
    block.length > 0 && !block.startsWith("#") && !block.startsWith("<!--")
  );
  assert(opening !== undefined, `${BUNDLED_PAGE} needs an opening paragraph`);
  const firstLink = /\]\(([^)\s]+)\)/.exec(body)?.[1];
  assert(
    firstLink !== undefined && /^[^:#]+\.md(?:#|$)/.test(firstLink),
    `${BUNDLED_PAGE}'s first link must open another manual page`,
  );
  const target = normalize(
    join(dirname(BUNDLED_PAGE), firstLink.split("#")[0] ?? ""),
  );
  return {
    title: await pageTitle(BUNDLED_PAGE),
    opening: opening
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .split(/\s+/)
      .slice(0, 3)
      .join(" "),
    firstLinkTitle: await pageTitle(target),
  };
}

realPtyTest({
  name:
    "the manual opens inside the Desk and owns input across search, links, refusal, and return at 80 by 24",
  contracts: [
    "line-discipline",
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
  ],
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
        "# Alpha guide\n\n[Next section](beta.md#destination)\n\n[Unsupported external](file:///unavailable)\n",
      );
      await Deno.writeTextFile(
        join(manual, "beta.md"),
        "# Beta guide\n\n## Destination\n\nAnchor destination text.\n\n[Unsupported external](file:///unavailable)\n",
      );
      await gitInit(root);
      const env = {
        NO_COLOR: "1",
        [TERMINAL_APPLICATION_STATE_REPORTS_ENV]: "1",
      };
      const anchor = reading("Anchor destination text");
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: repoSourceRunArgs(MANUAL_PROCESS, [manual]),
        cwd: root,
        geometry: SIZE,
        env,
        input: [
          ...OPEN_MANUAL,
          {
            waitFor: CONTENTS,
            capture: { name: "manual", when: CONTENTS },
            steps: [{ bytes: "/" }],
          },
          { waitFor: searching("›"), steps: [{ bytes: "Alpha" }] },
          { waitFor: searching("Alpha guide"), steps: [{ bytes: "\r" }] },
          // Tab focuses the first link; Enter follows it to a heading.
          {
            waitFor: reading("Next section"),
            steps: [{ bytes: encodeTerminalKeys("tab", "enter") }],
          },
          {
            waitFor: anchor,
            capture: { name: "linked", when: anchor },
            steps: [{ bytes: encodeTerminalKeys("tab", "enter") }],
          },
          // The refused link says why inside the manual, which stays open.
          {
            waitFor: settled(
              "the refusal",
              (capture) =>
                capture.text.includes("only http:// and https://") &&
                String(capture.state?.focusedControlId).startsWith(
                  "document:",
                ),
            ),
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: INBOX,
            capture: { name: "returned", when: INBOX },
            steps: [{ bytes: "q" }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(screen(result, "manual"), "Alpha guide");
      assertStringIncludes(screen(result, "linked"), "Anchor destination text");
      assertStringIncludes(screen(result, "returned"), "No tasks yet");

      const view = await bundledPageView();
      const opened = reading(view.opening);
      const bundled = await runPtyProcess({
        command: Deno.execPath(),
        args: repoSourceRunArgs(MANUAL_PROCESS, []),
        cwd: root,
        geometry: SIZE,
        env,
        input: [
          ...OPEN_MANUAL,
          { waitFor: CONTENTS, steps: [{ bytes: "/" }] },
          { waitFor: searching("›"), steps: [{ bytes: view.title }] },
          {
            waitFor: searching(BUNDLED_PAGE.split("/").at(-1) ?? BUNDLED_PAGE),
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: opened,
            capture: { name: "bundled", when: opened },
            steps: [{ bytes: encodeTerminalKeys("tab", "enter") }],
          },
          {
            waitFor: reading(view.firstLinkTitle),
            steps: [{ bytes: "q" }],
          },
          { waitFor: INBOX, steps: [{ bytes: "q" }] },
        ],
      });
      assertEquals(bundled.code, 0, bundled.transcript);
      assertStringIncludes(screen(bundled, "bundled"), view.opening);
    });
  },
});
