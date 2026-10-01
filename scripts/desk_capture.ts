/**
 * Named production Desk frames, captured in real PTYs from the redesign
 * brief's sandbox fleet and projected by the package.
 *
 * Every phase waits for a settled package frame whose state report names the
 * screen (the selected row, the open layer, zoom), never for prose, so the
 * journeys survive copy changes. The gallery is for visual judgment against
 * the mockups, not for screenshot comparison tests.
 */
import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import type { TerminalKeyName } from "discern-design-system/cli/interactive";
import { captureTerminalFrame } from "discern-design-system/cli/interactive/testing";
import { withRealPtyBoundary } from "../tests/real_pty.ts";
import {
  deskAtRest as atRest,
  deskFleetFixture,
  type DeskFrameTest,
  deskLayerOpen as layer,
  deskSettledPhase,
  type DeskTtyInputChunk,
  type DeskTtyInputPhase,
  type DeskTtyProject,
  runDeskTty,
  withDeskTtyProject,
} from "../tests/fixtures/desk_tty_harness.ts";
import type { PtyGeometry } from "../tests/fixtures/pty_process.ts";
import { assertChildDesignSystemGraph } from "./local_design_system.ts";
import { parseToolArguments } from "./tool_arguments.ts";
import { briefFleet } from "./desk_sandbox.ts";
import { deskSession } from "../tests/fixtures/desk_session.ts";
import { git } from "../tests/engine_helpers.ts";

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
    const frame = captureTerminalFrame(raw, geometry, { theme });
    const id = `${state}-${geometry.columns}x${geometry.rows}${
      plain ? "-ascii" : theme === "light" ? "-light" : ""
    }`;
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
    artifacts.push(`${id}.html`);
    console.log(join(target.directory, `${id}.html`));
  }
  return artifacts;
}

const MANUAL = "manual-concision-a1b2c3";
const AUTH = "auth-refactor-d4e5f6";
const STALE = "homepage-session-prototype-b2c3d4";
const SETUP = "release-notes-f6a7b8";
const GLOSSARY = "docs-glossary-e5f6a7";
const RUNNING = "fix-flaky-upload-c3d4e5";
const QUEUED = "search-index-a7b8c9";

/** A review sheet that has read its subject. */
function reviewRead(id: string): DeskFrameTest {
  return (capture) =>
    layer(id)(capture) && !capture.text.includes("Checking current state");
}

const LAND = "review-accept-review";
const DROP = "review-drop-review";

/**
 * The wide inbox, its action menu, and the stale task's integrating Land
 * review in the detail column.
 */
function wideJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, "overview", "inbox at rest", atRest(MANUAL), keys("right")),
    phase(size, "actions", "action menu", layer("actions"), keys("escape")),
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
        capture.state?.focusedControlId === `${form}:field:title` &&
        !capture.text.includes("Checking current state"),
      text("Tighten upload retries"),
    ),
    phase(
      size,
      "new-task",
      "the new task's preview",
      (capture) =>
        layer(form)(capture) &&
        capture.text.includes("Tighten upload retries") &&
        capture.text.includes("Create branch"),
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
      accept: () => ({
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
      }),
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
    const frame = captureTerminalFrame(desk.io.output(), desk.io.size(), {
      theme: "dark",
    });
    const id = `landing-failed-${STANDARD.columns}x${STANDARD.rows}`;
    await Deno.writeTextFile(
      join(target.directory, `${id}.html`),
      `<!doctype html><meta charset="utf-8"><title>${id}</title><style>pre{display:inline-block}</style>${frame.html}`,
    );
    console.log(join(target.directory, `${id}.html`));
    return [`${id}.html`];
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
  const bin = join(project.parent, "agent-bin");
  await Deno.mkdir(bin, { recursive: true });
  for (const agent of ["claude", "codex"]) {
    await Deno.writeTextFile(join(bin, agent), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  }
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
      phase(STANDARD, undefined, "the failed task", atRest(AUTH), text("a")),
      phase(STANDARD, "agent", "the agent picker", layer("agents"), {
        keys: ["escape"],
        allowLoneEscape: true,
      }),
      phase(STANDARD, undefined, "picker closed", atRest(AUTH), text("q")),
    ], { env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` } });
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
      (capture) =>
        capture.state?.zoomed === true && !capture.text.includes("Reading"),
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
        capture.text.includes("Offline"),
      { effect: async () => await Deno.writeTextFile(config, saved) },
      text("q"),
    ),
  ];
}

/** A shell opened from a task returns with what it changed. */
function returnJourney(size: PtyGeometry): DeskTtyInputPhase[] {
  return [
    phase(size, undefined, "inbox at rest", atRest(MANUAL), text("3")),
    phase(size, undefined, "editing task", atRest(GLOSSARY), text("s")),
    {
      waitFor: "Exit the shell to come back here.",
      chunks: [text("touch return-1.txt return-2.txt; exit\r")],
    },
    phase(
      size,
      "return",
      "back from the shell",
      (capture) =>
        capture.state?.selectedItemId === GLOSSARY &&
        capture.text.includes("more files changed"),
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
  // Its scripted refusal leaves the fleet as it found it.
  "landing-failed": landingFailedJourney,
  standard: (project, target) =>
    capture(project, target, STANDARD, standardJourney(STANDARD)),
  sizes,
  offline: (project, target) =>
    capture(project, target, STANDARD, offlineJourney(STANDARD, project)),
  return: (project, target) =>
    capture(project, target, STANDARD, returnJourney(STANDARD)),
  // Opening Parked is remembered for later sessions, so it runs last.
  parked: (project, target) =>
    capture(project, target, WIDE, parkedJourney(WIDE), { light: true }),
};

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
          (capture) =>
            capture.text.includes("No tasks yet") &&
            capture.state?.focusedControlId === "primary",
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
        for (const [, journey] of fleet) {
          artifacts.push(...await journey(project, target));
        }
      });
    }
    if (runs("empty")) artifacts.push(...await emptyJourney(target));
  });
  await Deno.writeTextFile(
    join(target.directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Desk review</title><h1>Production Desk review</h1><p>Each link is a complete terminal viewport from the redesign brief's sandbox fleet. This gallery is for visual judgment, not screenshot comparison tests.</p><ul>${
      artifacts.map((name) => `<li><a href="${name}">${name}</a></li>`).join("")
    }</ul>`,
  );
}
if (import.meta.main) await main();
