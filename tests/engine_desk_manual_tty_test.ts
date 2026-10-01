/** Real foreground input ownership, shared document navigation, and Desk return. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { ptyOutputContains, runPtyProcess } from "./fixtures/pty_process.ts";
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
import { deskScreenShows } from "./fixtures/desk_tty_harness.ts";

const MANUAL_PROCESS = join(
  APPLICATION_FIXTURE_ROOT,
  "tests/fixtures/desk_manual_process.ts",
);

/** Both journeys run at 80 by 24. */
const SIZE = { columns: 80, rows: 24 };

/** Ctrl+K opens the Desk's command palette. */
const OPEN_PALETTE = encodeTerminalKeys("ctrl-k");

/** The palette's query is ready for typing. */
const PALETTE_READY = "Search tasks and commands";

/** The Desk again, saying where it came back from. */
const RETURNED = ["No tasks yet", "Back from the manual"] as const;

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
    "Desk foreground shared browser owns input across search, links, refusal, and return at 80 by 24",
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
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: repoSourceRunArgs(MANUAL_PROCESS, [manual]),
        cwd: root,
        geometry: SIZE,
        env: { NO_COLOR: "1" },
        input: [
          { waitFor: "No tasks yet", steps: [{ bytes: OPEN_PALETTE }] },
          {
            waitFor: PALETTE_READY,
            steps: [{ bytes: "Read the manual\r" }],
          },
          {
            waitFor: ["DISCERN MAP", "Enter open/action  Esc cancel"],
            capture: {
              name: "manual",
              when: ptyOutputContains([
                "DISCERN MAP",
                "Enter open/action  Esc cancel",
              ]),
            },
            steps: [{ bytes: "Alpha" }],
          },
          {
            waitFor: deskScreenShows(SIZE, "Search: Alpha", "Alpha guide"),
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: ["Alpha guide", "Tab picker  Esc/q close"],
            steps: [{ bytes: "]\r" }],
          },
          {
            waitFor: ["Anchor destination text", "Tab picker  Esc/q close"],
            capture: {
              name: "linked",
              when: ptyOutputContains([
                "Anchor destination text",
                "Tab picker  Esc/q close",
              ]),
            },
            steps: [{ bytes: "]\r" }],
          },
          { waitFor: "only http:// and https://", steps: [{ bytes: "\r" }] },
          {
            waitFor: ["Anchor destination text", "Tab picker"],
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b", allowLoneEscape: true }],
          },
          {
            waitFor: RETURNED,
            capture: { name: "returned", when: ptyOutputContains(RETURNED) },
            steps: [{ bytes: "q" }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(
        result.keyframes.linked ?? "",
        "Anchor destination text",
      );
      assertStringIncludes(
        result.keyframes.returned ?? "",
        "Back from the manual",
      );
      assert(result.keyframes.manual !== undefined);
      const view = await bundledPageView();
      const bundled = await runPtyProcess({
        command: Deno.execPath(),
        args: repoSourceRunArgs(MANUAL_PROCESS, []),
        cwd: root,
        geometry: SIZE,
        env: { NO_COLOR: "1" },
        input: [
          { waitFor: "No tasks yet", steps: [{ bytes: OPEN_PALETTE }] },
          {
            waitFor: PALETTE_READY,
            steps: [{ bytes: "Read the manual\r" }],
          },
          {
            waitFor: ["DISCERN DOCS", "Enter open/action  Esc cancel"],
            steps: [{ bytes: view.title }],
          },
          {
            waitFor: deskScreenShows(
              SIZE,
              `Search: ${view.title}`,
              BUNDLED_PAGE,
            ),
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: [view.opening, "Tab picker  Esc/q close"],
            capture: {
              name: "bundled",
              when: ptyOutputContains([
                view.opening,
                "Tab picker  Esc/q close",
              ]),
            },
            steps: [{ bytes: "]\r" }],
          },
          {
            waitFor: [view.firstLinkTitle, "Tab picker  Esc/q close"],
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b", allowLoneEscape: true }],
          },
          { waitFor: RETURNED, steps: [{ bytes: "q" }] },
        ],
      });
      assertEquals(bundled.code, 0, bundled.transcript);
      assertStringIncludes(
        bundled.keyframes.bundled ?? "",
        view.opening,
      );
    });
  },
});
