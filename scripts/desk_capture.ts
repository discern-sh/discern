/**
 * Named production Desk frames, captured in real PTYs from the redesign
 * brief's sandbox fleet and projected by the package.
 *
 * Every phase waits for a settled package frame whose state report names the
 * screen (the selected row, the open layer and whether it waits, the focused
 * control, zoom, the message on the message line, the header's liveness), so
 * the journeys survive copy changes. Words are read only for data a journey
 * typed or a fixture holds. The gallery is for visual judgment against the
 * mockups, not for screenshot comparison tests.
 */
import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import type { TerminalKeyName } from "discern-design-system/cli/interactive";
import { captureTerminalFrame } from "discern-design-system/cli/interactive/testing";
import { withRealPtyBoundary } from "../tests/real_pty.ts";
import {
  deskAtRest as atRest,
  deskEmpty,
  deskFailedAction,
  type DeskFleetFixture,
  deskFleetFixture,
  deskFocused,
  type DeskFrameTest,
  deskLandingAuthority,
  deskLayerOpen as layer,
  deskLayerReady,
  deskMessage,
  deskSettledPhase,
  type DeskTtyInputChunk,
  type DeskTtyInputPhase,
  type DeskTtyProject,
  deskUncommittedListed,
  deskZoomed,
  recordDeskAction,
  runDeskTty,
  withDeskTtyProject,
} from "../tests/fixtures/desk_tty_harness.ts";
import type { PtyGeometry } from "../tests/fixtures/pty_process.ts";
import { assertChildDesignSystemGraph } from "./local_design_system.ts";
import { parseToolArguments } from "./tool_arguments.ts";
import { stepWords } from "../src/shared/step_labels.ts";
import { briefFleet } from "./desk_sandbox.ts";
import { deskSession } from "../tests/fixtures/desk_session.ts";
import { git } from "../tests/engine_helpers.ts";
import { directoryExists } from "../src/shared/fs_presence.ts";
import { DESK_COMMAND_LABELS } from "../src/shared/desk_vocabulary.ts";
import { markdownBrowserItemId } from "../src/lib/terminal_interaction.ts";
import {
  freshDeskPreferences,
  writeDeskPreferences,
} from "../src/engine/desk/preferences.ts";

/** Where the gallery writes, and the Deno config every captured Desk runs under. */
export interface DeskGalleryTarget {
  readonly directory: string;
  /** A linked design-system config; this process must run under it too. */
  readonly config?: string;
  /** Run only these journeys; all of them when absent. */
  readonly only?: readonly string[];
}

/** Read `[<output directory>] [--config <deno.json>] [--only <journeys>]`. */
export function parseDeskCaptureArgs(
  args: readonly string[],
): DeskGalleryTarget {
  const parsed = parseToolArguments(args, {
    values: ["--config", "--only"],
    operand: "output directory",
  });
  const config = parsed.values.get("--config");
  const only = parsed.values.get("--only");
  return {
    directory: resolve(parsed.operand ?? ".scratch/desk-review"),
    ...(config === undefined ? {} : { config: resolve(config) }),
    ...(only === undefined ? {} : { only: only.split(",") }),
  };
}

/** One phase: wait for a settled frame, optionally capture it, then send input. */
const phase = deskSettledPhase;

/** Named keys as one chunk. */
function keys(...names: TerminalKeyName[]): DeskTtyInputChunk {
  return { keys: names };
}

/** Typed text as one chunk. */
function text(input: string): DeskTtyInputChunk {
  return { input };
}

/** Every frame a journey declares, in capture order; each must become one artifact. */
function declaredFrames(input: readonly DeskTtyInputPhase[]): string[] {
  return input.flatMap((step) =>
    step.capture === undefined ? [] : [step.capture.name]
  );
}

/** How one journey's Desk runs. */
interface JourneyOptions {
  /** Capture on a light terminal; journeys capture on a dark one by default. */
  readonly light?: boolean;
  readonly plain?: boolean;
  /** Environment beyond the gallery's own, such as a PATH with agents. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Where the brief's fleet finds its agents, beside the project. */
const GALLERY_AGENT_BIN = "agent-bin";
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * Put Claude Code and Codex on the fleet's PATH, as the brief's owner has
 * them, with Claude Code remembered as the agent they last opened. Opening
 * Claude Code stands in for an agent's session: it changes two files in its
 * checkout and exits.
 */
async function installGalleryAgents(project: DeskTtyProject): Promise<void> {
  const remembered = await writeDeskPreferences(project.root, {
    ...freshDeskPreferences(),
    last_agent: "claude_code",
  });
  assertEquals(remembered.status, "saved");
  const bin = join(project.parent, GALLERY_AGENT_BIN);
  await Deno.mkdir(bin, { recursive: true });
  const agents = {
    claude: "touch return-1.txt return-2.txt",
    codex: "exit 0",
  };
  for (const [agent, body] of Object.entries(agents)) {
    await Deno.writeTextFile(join(bin, agent), `#!/bin/sh\n${body}\n`, {
      mode: 0o755,
    });
  }
}

/** The PATH that finds a project's gallery agents, when it has them. */
async function galleryAgentPath(
  project: DeskTtyProject,
): Promise<Readonly<Record<string, string>>> {
  const bin = join(project.parent, GALLERY_AGENT_BIN);
  return await directoryExists(bin) ? { PATH: `${bin}:${SYSTEM_PATH}` } : {};
}

/** Capture one journey and keep per-viewport evidence, never stitched scrollback. */
async function capture(
  project: DeskTtyProject,
  target: DeskGalleryTarget,
  geometry: PtyGeometry,
  input: readonly DeskTtyInputPhase[],
  options: JourneyOptions = {},
): Promise<string[]> {
  const theme = options.light === true ? "light" : "dark";
  const plain = options.plain === true;
  const result = await runDeskTty(project, {
    ...(target.config === undefined ? {} : { config: target.config }),
    geometry,
    input,
    colorMode: plain ? "no-color-env" : "color",
    theme,
    env: {
      SHELL: "/bin/sh",
      LANG: plain ? "C" : "en_US.UTF-8",
      LC_ALL: plain ? "C" : "en_US.UTF-8",
      ...await galleryAgentPath(project),
      ...options.env,
    },
  });
  assertEquals(result.code, 0, result.transcript.slice(-4000));
  assert(result.terminal.restored && result.terminal.noChild);
  const states = declaredFrames(input);
  assertEquals(Object.keys(result.keyframes), states);
  const artifacts: string[] = [];
  for (const state of states) {
    const raw = result.keyframes[state];
    assert(raw !== undefined, `lost the declared ${state} frame`);
    const id = `${state}-${geometry.columns}x${geometry.rows}${
      plain ? "-ascii" : theme === "light" ? "-light" : ""
    }`;
    artifacts.push(await writeFrame(target, id, raw, geometry, theme));
  }
  return artifacts;
}

/**
 * Write one captured viewport as its gallery page and its projected facts,
 * on a terminal of the named theme, and return the page's file name.
 */
async function writeFrame(
  target: DeskGalleryTarget,
  id: string,
  raw: string,
  geometry: PtyGeometry,
  theme: "light" | "dark",
): Promise<string> {
  const frame = captureTerminalFrame(raw, geometry, { theme });
  // An inline block keeps the screenshot to the terminal's own width.
  await Deno.writeTextFile(
    join(target.directory, `${id}.html`),
    `<!doctype html><meta charset="utf-8"><title>${id}</title><style>pre{display:inline-block}</style>${frame.html}`,
  );
  await Deno.writeTextFile(
    join(target.directory, `${id}.json`),
    `${
      JSON.stringify(
        {
          geometry,
          state: frame.state,
          title: frame.title,
          text: frame.text,
          inspection: frame.geometry,
        },
        null,
        2,
      )
    }\n`,
  );
  console.log(join(target.directory, `${id}.html`));
  return `${id}.html`;
}

const MANUAL = "manual-concision-a1b2c3";
const AUTH = "auth-refactor-d4e5f6";
const STALE = "homepage-session-prototype-b2c3d4";
const SETUP = "release-notes-f6a7b8";
const GLOSSARY = "docs-glossary-e5f6a7";
const RUNNING = "fix-flaky-upload-c3d4e5";
const QUEUED = "search-index-a7b8c9";

/** A review sheet that has read its subject. */
const reviewRead = deskLayerReady;

const LAND = "review-accept-review";
const DROP = "review-drop-review";

/**
 * The wide inbox, its action menu, and the stale task's integrating Land
 * review in the detail column.
 */
function wideJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, "overview", "inbox at rest", atRest(MANUAL), keys("right")),
    // An unavailable action's key unfolds Unavailable and says why.
    phase(size, undefined, "action menu", layer("actions"), text("u")),
    phase(
      size,
      "actions",
      "an unavailable action's reason",
      deskFocused("actions", "unavailable:update"),
      keys("escape"),
    ),
    phase(size, undefined, "menu closed", atRest(MANUAL), text("2")),
    phase(size, undefined, "needs attention", atRest(AUTH), keys("down")),
    phase(size, undefined, "the stale task", atRest(STALE), text("l")),
    phase(size, "review-land", "land review read", reviewRead(LAND), {
      keys: ["escape"],
      allowLoneEscape: true,
    }),
    phase(size, undefined, "review closed", atRest(STALE), text("q")),
  ];
}

/**
 * Every review sheet and form at the standard size: Land and its plan,
 * New task with its live preview, Drop with its challenge half typed, and
 * the Check for updates disclosure.
 */
function sheetsJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  const form = "form-new_task-review";
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("l")),
    phase(size, "review-land", "land review read", reviewRead(LAND), {
      input: "d",
    }),
    phase(
      size,
      "review-land-plan",
      "the technical plan",
      (capture) =>
        reviewRead(LAND)(capture) && capture.text.includes("Acceptance plan"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "review closed", atRest(MANUAL), text("n")),
    phase(
      size,
      undefined,
      "the new task's title",
      (capture) =>
        deskLayerReady(form)(capture) &&
        capture.state?.focusedControlId === `${form}:field:title`,
      text("Tighten upload retries"),
    ),
    phase(
      size,
      "new-task",
      "the new task's preview",
      (capture) =>
        deskLayerReady(form)(capture) &&
        capture.text.includes("Tighten upload retries") &&
        capture.text.includes("tighten-upload-retries"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "form closed", atRest(MANUAL), text("2")),
    phase(size, undefined, "needs attention", atRest(AUTH), keys("down")),
    phase(size, undefined, "the stale task", atRest(STALE), text("D")),
    phase(
      size,
      undefined,
      "the drop challenge",
      (capture) =>
        reviewRead(DROP)(capture) &&
        capture.state?.focusedControlId === `${DROP}:field:challenge`,
      text("agent/homepage-sess"),
    ),
    phase(
      size,
      "review-drop",
      "the challenge half typed",
      (capture) =>
        reviewRead(DROP)(capture) &&
        capture.text.includes("agent/homepage-sess"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "drop closed", atRest(STALE), keys("ctrl-k")),
    phase(
      size,
      undefined,
      "palette",
      layer("palette"),
      text("Check for updates\r"),
    ),
    phase(
      size,
      "updates",
      "the update disclosure",
      reviewRead("review-updates-review"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "disclosure closed", atRest(STALE), text("q")),
  ];
}

/** The manual's contents on screen with `text` in them. */
function manualContents(text: string): DeskFrameTest {
  return (capture) =>
    capture.state?.listId === "contents" &&
    capture.state.focusedControlId === "contents" &&
    capture.text.includes(text);
}

/**
 * The manual's contents with one entry selected, by its corpus id: the
 * manual shows no file paths, so the selection names the previewed page.
 */
function manualSelected(id: string): DeskFrameTest {
  const selected = markdownBrowserItemId(id);
  return (capture) =>
    capture.state?.listId === "contents" &&
    capture.state.focusedControlId === "contents" &&
    capture.state.selectedItemId === selected;
}

/**
 * The manual inside the Desk, as `discern docs` shows it: its contents with
 * a guide previewed, the guide open, and search, then back to the inbox
 * with the same task selected.
 */
function manualJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  // The Start here group promotes the guide ahead of its own section.
  const guide = "promoted:guide-delegate-work";
  // The previewed guide is the document that opens.
  const reading: DeskFrameTest = (capture) =>
    capture.state?.topLayerId === undefined &&
    String(capture.state?.focusedControlId).startsWith("document:");
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), keys("ctrl-k")),
    phase(
      size,
      undefined,
      "palette",
      layer("palette"),
      text(DESK_COMMAND_LABELS.manual),
    ),
    phase(
      size,
      undefined,
      "the manual found",
      (capture) =>
        layer("palette")(capture) &&
        capture.text.includes(DESK_COMMAND_LABELS.manual),
      keys("enter"),
    ),
    phase(
      size,
      undefined,
      "the manual's contents",
      manualContents("Read the docs online"),
      keys("down", "down"),
    ),
    phase(size, "manual", "a guide previewed", manualSelected(guide), {
      keys: ["enter"],
    }),
    phase(size, "manual-document", "the guide open", reading, text("/")),
    phase(size, undefined, "search", layer("search"), text("land")),
    phase(
      size,
      "manual-search",
      "searching the manual",
      (capture) => layer("search")(capture) && capture.text.includes("land"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(
      size,
      undefined,
      "the search cleared",
      (capture) =>
        layer("search")(capture) && capture.text.includes("Search documents"),
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "the guide again", reading, text("q")),
    phase(
      size,
      "manual-return",
      "back at the inbox",
      atRest(MANUAL),
      text("q"),
    ),
  ];
}

/** Land's confirm button focused, on a light terminal. */
function confirmJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("l")),
    phase(size, undefined, "land review read", reviewRead(LAND), {
      keys: ["page-down", "page-down", "page-down"],
    }),
    phase(
      size,
      undefined,
      "land review on its safe choice",
      (capture) =>
        reviewRead(LAND)(capture) &&
        capture.state?.focusedControlId === `${LAND}:button:safe`,
      keys("right"),
    ),
    phase(
      size,
      "review-land-confirm",
      "land review on its confirm",
      (capture) => capture.state?.focusedControlId === `${LAND}:button:confirm`,
      { keys: ["escape"], allowLoneEscape: true },
    ),
    phase(size, undefined, "review closed", atRest(MANUAL), text("q")),
  ];
}

/** One review at a size that needs no other layer. */
function sheetJourney(
  size: PtyGeometry,
  row: string,
  key: string,
  id: string,
  name: string,
): DeskTtyInputPhase[] {
  const reach = row === STALE
    ? [
      phase(size, undefined, "inbox at rest", atRest(MANUAL), text("2")),
      phase(size, undefined, "needs attention", atRest(AUTH), keys("down")),
      phase(size, undefined, "the task", atRest(STALE), text(key)),
    ]
    : [phase(size, undefined, "the task", atRest(row), text(key))];
  return [
    ...reach,
    phase(size, name, "the review read", reviewRead(id), {
      keys: ["escape"],
      allowLoneEscape: true,
    }),
    phase(size, undefined, "review closed", atRest(row), text("q")),
  ];
}

/**
 * A landing that stopped on a conflict, as its result sheet shows it. The
 * sandbox holds no change that conflicts with main, so only the landing's
 * refusal is scripted; the survey, the review and its preview are real.
 */
async function landingFailedJourney(
  project: DeskTtyProject,
  target: DeskGalleryTarget,
): Promise<string[]> {
  const desk = await deskSession({
    production: true,
    columns: STANDARD.columns,
    rows: STANDARD.rows,
    colorDepth: "truecolor",
    runtime: {
      canInteract: () => true,
      inDeskSession: () => false,
      findRoot: () => project.root,
      mainRepoPath: () => project.root,
      // The refusal leaves the failed landing's trace, as acceptance does,
      // so the next survey reads the task as Didn't land.
      accept: async () => {
        await recordDeskAction(
          project,
          STALE,
          deskFailedAction("accept", {
            failedStage: "merge",
            finishedAgoMs: 0,
          }),
        );
        return {
          ok: false,
          verb: "accept",
          error: "precondition_failed",
          message: "Combining it with main stopped: 2 files conflict",
          diagnostics: ["src/session/store.ts", "site/_includes/home.njk"].map((
            file,
          ) => ({
            tool: "integration",
            severity: "error" as const,
            message: `${file} conflicts`,
            reproduce_cmd: "git merge main",
            file,
          })),
        };
      },
    },
  });
  try {
    await desk.select(STALE);
    await desk.press("l");
    await desk.opened(LAND);
    await desk.settleForm();
    for (
      let page = 0;
      page < 12 && desk.state().fullyRead[LAND] !== true;
      page += 1
    ) await desk.press("page-down");
    await desk.confirm();
    await desk.opened("result");
    // The survey after the refusal reads the task as Didn't land, and the
    // sheet's alternatives become its next steps from there.
    await desk.shows("Didn't land");
    return [
      await writeFrame(
        target,
        `landing-failed-${STANDARD.columns}x${STANDARD.rows}`,
        desk.io.output(),
        desk.io.size(),
        "dark",
      ),
    ];
  } finally {
    await desk.quit();
  }
}

/**
 * The agent picker for the failed task, with two agents installed and one
 * missing. The task's own configuration names the three; Git is told to
 * leave that edit out of the task's status, so its row keeps its state.
 */
async function agentJourney(
  project: DeskTtyProject,
  target: DeskGalleryTarget,
): Promise<string[]> {
  const worktree = project.worktrees.get(AUTH);
  assert(worktree !== undefined, `the fleet has no ${AUTH}`);
  const config = join(worktree, "discern.toml");
  const saved = await Deno.readTextFile(config);
  const skip = (flag: string): Promise<void> =>
    git(worktree, "update-index", flag, "discern.toml");
  await skip("--skip-worktree");
  await Deno.writeTextFile(
    config,
    saved.replace(
      'agents = ["claude_code"]',
      'agents = ["claude_code", "codex", "gemini"]',
    ),
  );
  try {
    return await capture(project, target, STANDARD, [
      phase(STANDARD, undefined, "inbox at rest", atRest(MANUAL), text("2")),
      // `a` runs the remembered launch; the actions menu's Open agent asks.
      phase(STANDARD, undefined, "the failed task", atRest(AUTH), text(".")),
      phase(STANDARD, undefined, "its actions", layer("actions"), text("a")),
      phase(STANDARD, "agent", "the agent picker", layer("agents"), {
        keys: ["escape"],
        allowLoneEscape: true,
      }),
      phase(STANDARD, undefined, "picker closed", atRest(AUTH), text("q")),
    ]);
  } finally {
    await Deno.writeTextFile(config, saved);
    await skip("--no-skip-worktree");
  }
}

/** Every task state at the standard width, then the layers. */
function standardJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, "overview", "inbox at rest", atRest(MANUAL), text(" ")),
    phase(
      size,
      "zoom",
      "details zoomed",
      deskZoomed(),
      text(" "),
    ),
    phase(size, undefined, "zoom closed", atRest(MANUAL), text("2")),
    phase(size, "failed", "checks failed", atRest(AUTH), keys("down")),
    phase(size, "stale", "stale task", atRest(STALE), keys("down")),
    phase(size, "degraded", "setup stopped", atRest(SETUP), keys("down")),
    phase(size, undefined, "editing task", atRest(GLOSSARY), keys("down")),
    phase(size, "running", "checks running", atRest(RUNNING), keys("down")),
    phase(size, "queued", "queued task", atRest(QUEUED), text("1")),
    phase(size, undefined, "back to ready", atRest(MANUAL), text(".")),
    phase(size, "actions", "action menu", layer("actions"), keys("escape")),
    phase(size, undefined, "menu closed", atRest(MANUAL), keys("ctrl-k")),
    phase(size, "palette", "palette", layer("palette"), keys("escape")),
    phase(size, undefined, "palette closed", atRest(MANUAL), text("?")),
    phase(size, "help", "keys reader", layer("reader-keys"), keys("escape")),
    phase(size, undefined, "keys closed", atRest(MANUAL), text("q")),
  ];
}

/** The overview alone, at a size that needs no layer. */
function overviewJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [phase(size, "overview", "inbox at rest", atRest(), text("q"))];
}

/** The parked group opened, on a light terminal. */
function parkedJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("6")),
    phase(
      size,
      undefined,
      "parked group",
      (capture) =>
        capture.state?.selectedItemId?.startsWith("parked:") === true,
      keys("down", "down"),
    ),
    phase(
      size,
      "parked",
      "parked branch",
      atRest("parked:agent/spike-cache-e1f2a3"),
      text("q"),
    ),
  ];
}

/** Two failed surveys: the header goes Offline and running rows freeze. */
function offlineJourney(
  size: PtyGeometry,
  project: DeskTtyProject,
): DeskTtyInputPhase[] {
  const config = join(project.root, "discern.toml");
  let saved = "";
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("3"), {
      effect: async () => {
        saved = await Deno.readTextFile(config);
        await Deno.writeTextFile(config, `${saved}\nnot = [valid\n`);
      },
    }),
    phase(
      size,
      "offline",
      "offline",
      (capture) =>
        capture.state?.selectedItemId === GLOSSARY &&
        capture.state.liveness === "stale",
      { effect: async () => await Deno.writeTextFile(config, saved) },
      text("q"),
    ),
  ];
}

/** An agent opened from a task returns with what it changed. */
function returnJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("3")),
    // `a` runs the remembered agent's launch at once.
    phase(size, undefined, "editing task", atRest(GLOSSARY), text("a")),
    phase(
      size,
      "return",
      "back from the agent, with what it changed",
      // The message names the task once the survey after the agent reads
      // its checkout, and the inspector lists the files that survey found.
      (capture) =>
        capture.state?.selectedItemId === GLOSSARY &&
        deskMessage("return")(capture) &&
        capture.text.includes("Docs glossary: ") &&
        deskUncommittedListed()(capture),
      text("q"),
    ),
  ];
}

/** The fleet sizes that need no layer, and the minimum. */
async function sizes(
  project: DeskTtyProject,
  target: DeskGalleryTarget,
): Promise<string[]> {
  const artifacts: string[] = [];
  for (
    const size of [
      { columns: 60, rows: 20 },
      { columns: 80, rows: 13 },
      { columns: 32, rows: 10 },
    ]
  ) {
    artifacts.push(
      ...await capture(project, target, size, overviewJourney(size)),
    );
  }
  const ascii = { columns: 40, rows: 20 };
  artifacts.push(
    ...await capture(project, target, ascii, overviewJourney(ascii), {
      plain: true,
    }),
  );
  const minimum = { columns: 30, rows: 9 };
  artifacts.push(
    ...await capture(project, target, minimum, [
      phase(
        minimum,
        "minimum",
        "too small",
        (capture) => capture.text.includes("Too small"),
        text("q"),
      ),
    ]),
  );
  return artifacts;
}

/** One named journey over the brief's fleet. */
type Journey = (
  project: DeskTtyProject,
  target: DeskGalleryTarget,
) => Promise<string[]>;

const WIDE = { columns: 120, rows: 30 };
const STANDARD = { columns: 80, rows: 24 };
const SHORT = { columns: 80, rows: 13 };
const NARROW = { columns: 40, rows: 24 };

/** Every journey over the brief's fleet, in the order the gallery runs them;
 * journeys that change the fleet run last. */
const FLEET_JOURNEYS: Readonly<Record<string, Journey>> = {
  wide: (project, target) => capture(project, target, WIDE, wideJourney(WIDE)),
  sheets: (project, target) =>
    capture(project, target, STANDARD, sheetsJourney(STANDARD)),
  confirm: (project, target) =>
    capture(project, target, STANDARD, confirmJourney(STANDARD), {
      light: true,
    }),
  "sheet-sizes": async (project, target) => [
    ...await capture(
      project,
      target,
      SHORT,
      sheetJourney(SHORT, MANUAL, "l", LAND, "review-land"),
    ),
    ...await capture(
      project,
      target,
      NARROW,
      sheetJourney(NARROW, STALE, "D", DROP, "review-drop"),
    ),
  ],
  agent: agentJourney,
  manual: async (project, target) => [
    ...await capture(project, target, STANDARD, manualJourney(STANDARD)),
    ...await capture(project, target, WIDE, manualJourney(WIDE)),
  ],
  standard: (project, target) =>
    capture(project, target, STANDARD, standardJourney(STANDARD)),
  sizes,
  offline: (project, target) =>
    capture(project, target, STANDARD, offlineJourney(STANDARD, project)),
  return: (project, target) =>
    capture(project, target, STANDARD, returnJourney(STANDARD)),
  // Opening Parked is remembered for later sessions, so it runs late.
  parked: (project, target) =>
    capture(project, target, WIDE, parkedJourney(WIDE), { light: true }),
  // Its refusal leaves the stale task's failed landing in the logbook, so
  // the task reads Didn't land from then on: it runs last.
  "landing-failed": landingFailedJourney,
};

/**
 * The brief's fleet with Manual concision proven and queued beside Search
 * index, both pre-authorized, and a repository ensure step that builds the
 * site after each landing. With its agent files committed, as a set-up
 * project keeps them, the queue walk's integration checkout starts clean
 * and Search index lands too; without, the walk refuses it.
 */
function landingFleet(committedAgentFiles: boolean): DeskFleetFixture {
  const fleet = briefFleet();
  return {
    ...fleet,
    entries: fleet.entries.map((entry) =>
      entry.name === MANUAL
        ? {
          ...entry,
          queued: true,
          landingAuthority: deskLandingAuthority("effort-grant"),
        }
        : entry
    ),
    repositoryEnsure: [BUILD_SITE],
    committedAgentFiles,
  };
}

/** The ensure step the landing fleet runs. */
const BUILD_SITE = "build-site";

/** That step as its progress row reads. */
const BUILD_SITE_WORDS = stepWords(
  { kind: "repository-ensure", label: BUILD_SITE },
  "main",
);

/**
 * What `build-site` does: inside the gallery's Desk it builds until the
 * gallery has its progress frame; anywhere else it has nothing to do.
 */
const BUILD_SITE_SCRIPT = [
  "#!/bin/sh",
  '[ -n "$DESK_GALLERY_SIGNALS" ] || exit 0',
  'echo "Building the site"',
  'while [ ! -e "$DESK_GALLERY_SIGNALS/built" ]; do sleep 0.05; done',
  'echo "Built the site"',
  "",
].join("\n");

/**
 * Land Manual concision for real, on the landing fleet: from the inbox,
 * through its review, to its progress while the site builds, which the
 * gallery keeps under `progress` when named, then let the build finish and
 * hand the session to `after`.
 */
async function landManual(
  target: DeskGalleryTarget,
  committedAgentFiles: boolean,
  progress: string | undefined,
  after: readonly DeskTtyInputPhase[],
): Promise<string[]> {
  return await withDeskTtyProject(
    landingFleet(committedAgentFiles),
    async (project) => {
      const bin = join(project.parent, "gallery-bin");
      const signals = join(project.parent, "gallery-signals");
      await Deno.mkdir(bin, { recursive: true });
      await Deno.mkdir(signals, { recursive: true });
      await Deno.writeTextFile(join(bin, BUILD_SITE), BUILD_SITE_SCRIPT, {
        mode: 0o755,
      });
      const size = STANDARD;
      return await capture(project, target, size, [
        phase(size, undefined, "inbox at rest", atRest(), text("4")),
        phase(size, undefined, "approved to land", atRest(MANUAL), text("l")),
        phase(size, undefined, "land review read", reviewRead(LAND), {
          keys: ["page-down", "page-down", "page-down"],
        }),
        phase(
          size,
          undefined,
          "land review on its safe choice",
          (capture) =>
            reviewRead(LAND)(capture) &&
            capture.state?.focusedControlId === `${LAND}:button:safe`,
          keys("right"),
        ),
        phase(
          size,
          undefined,
          "land review on its confirm",
          (capture) =>
            capture.state?.focusedControlId === `${LAND}:button:confirm`,
          keys("enter"),
        ),
        phase(
          size,
          progress,
          "the landing building the site",
          (capture) =>
            layer("progress")(capture) &&
            new RegExp(`${BUILD_SITE_WORDS}\\s+[3-9]s`, "u").test(
              capture.text,
            ),
          {
            effect: async () =>
              await Deno.writeTextFile(join(signals, "built"), ""),
          },
        ),
        ...after,
      ], {
        env: {
          PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          DESK_GALLERY_SIGNALS: signals,
        },
      });
    },
  );
}

/**
 * A real landing beside the screen: its progress while the site builds,
 * with Search index waiting under Then, and the message it leaves once
 * both have landed.
 */
async function landingJourney(target: DeskGalleryTarget): Promise<string[]> {
  return await landManual(target, true, "landing-progress", [
    phase(
      STANDARD,
      "toast",
      "the landing's message",
      // The success message itself, with no row still landing, both tasks
      // listed under Landed, and the selection handed to the first task
      // that needs the owner.
      (capture) =>
        capture.state?.topLayerId === undefined &&
        capture.text.includes("✓  Landed Manual concision") &&
        !capture.text.includes("Landing") &&
        /▸ Landed\s+2/u.test(capture.text) &&
        capture.state?.selectedItemId === AUTH,
      text("q"),
    ),
  ]);
}

/**
 * A real landing whose queue walk refuses the next task: Manual concision
 * lands, Search index does not, and the result sheet says both.
 */
async function partialLandingJourney(
  target: DeskGalleryTarget,
): Promise<string[]> {
  return await landManual(target, false, undefined, [
    phase(
      STANDARD,
      "landing-partial",
      "the partial landing's result",
      // Once the survey after the landing reads: no row is landing.
      (capture) =>
        layer("result")(capture) && capture.text.includes("didn't") &&
        !capture.text.includes("Landing"),
      keys("ctrl-c"),
    ),
  ]);
}

/** The empty fleet: no tasks, three parked branches. */
async function emptyJourney(target: DeskGalleryTarget): Promise<string[]> {
  return await withDeskTtyProject(
    deskFleetFixture([], { orphanBranches: briefFleet().orphanBranches }),
    (project) =>
      capture(project, target, STANDARD, [
        phase(
          STANDARD,
          "empty",
          "no tasks yet",
          deskEmpty(),
          text("q"),
        ),
      ]),
  );
}

/** Produce the bounded review gallery. */
async function main(): Promise<void> {
  const target = parseDeskCaptureArgs(Deno.args);
  if (target.config !== undefined) assertChildDesignSystemGraph(target.config);
  await Deno.mkdir(target.directory, { recursive: true });
  const runs = (name: string): boolean =>
    target.only === undefined || target.only.includes(name);
  const artifacts: string[] = [];
  await withRealPtyBoundary({
    name: "production Desk inbox gallery",
    contracts: [
      "control-rendering",
      "terminal-modes",
      "process-lifecycle",
      "platform-transport",
    ],
    canary: false,
  }, async () => {
    const fleet = Object.entries(FLEET_JOURNEYS).filter(([name]) => runs(name));
    if (fleet.length > 0) {
      await withDeskTtyProject(briefFleet(), async (project) => {
        await installGalleryAgents(project);
        for (const [, journey] of fleet) {
          artifacts.push(...await journey(project, target));
        }
      });
    }
    if (runs("empty")) artifacts.push(...await emptyJourney(target));
    if (runs("landing")) artifacts.push(...await landingJourney(target));
    if (runs("landing-partial")) {
      artifacts.push(...await partialLandingJourney(target));
    }
  });
  await Deno.writeTextFile(
    join(target.directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Desk review</title><h1>Production Desk review</h1><p>Each link is a complete terminal viewport from the redesign brief's sandbox fleet. This gallery is for visual judgment, not screenshot comparison tests.</p><ul>${
      artifacts.map((name) => `<li><a href="${name}">${name}</a></li>`).join("")
    }</ul>`,
  );
}
if (import.meta.main) await main();
