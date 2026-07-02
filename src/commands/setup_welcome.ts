/**
 * `discern setup` (and bare `discern`, pre-bootstrap) — the read-only WELCOME, the
 * first contact for both readers (ADR 0075). It writes NOTHING; the destructive
 * scaffold lives behind `discern setup begin`.
 *
 * Three lifecycle states ({@link SetupPhase}):
 *   - `fresh`       — no `discern.toml` yet. A dual-addressed welcome: reassurance for
 *                     the human, and the `verify` funnel for the agent.
 *   - `in_progress` — `begin` scaffolded but `[meta].bootstrapped` is unset. Show the
 *                     DERIVED progress (markers + capabilities) and point at `done`.
 *   - `done`        — bootstrapped. The router shows normal help instead; reached here
 *                     only by an explicit call, which we point at `status`.
 *
 * Human output is dual-addressed and shown for BOTH a TTY and a pipe — robust where
 * detecting the reader is not (ADR 0075). `--json` carries `phase` + `next_action` so
 * a JSON-consuming agent is funneled the same way.
 */

import { emitResult } from "../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import {
  setupNextAction,
  setupPhaseOf,
  type SetupProgress,
  setupProgress,
} from "../shared/setup_state.ts";

/** Options for the read-only welcome (just the global flags — it takes no input). */
export interface WelcomeOptions {
  json: boolean;
  noColor: boolean;
  /** Test seam for the command-edge TTY read; production leaves it unset. */
  stdoutIsTerminal?: boolean;
}

/** The pure presentation mode the welcome renderers accept. */
export interface WelcomeStyleMode {
  /** True only for an interactive TTY when colour has not been disabled. */
  tty: boolean;
}

/** Inputs at the command edge that decide whether to use the styled render. */
export interface WelcomeStyleInputs {
  stdoutTty: boolean;
  /** Already resolved from `--no-color` and `NO_COLOR` by the CLI plumbing. */
  noColor: boolean;
}

/** Resolve the welcome's presentation mode from the existing no-colour plumbing. */
export function resolveWelcomeStyle(
  inputs: WelcomeStyleInputs,
): WelcomeStyleMode {
  return { tty: inputs.stdoutTty && !inputs.noColor };
}

/**
 * The instructional substance the welcome carries to a JSON-consuming agent, so it
 * is not handed a colder, thinner welcome than one reading the dual-addressed human
 * text (ADR 0075). The human blocks below say the same things in prose; these are
 * the machine-readable mirror, kept in step with them by the welcome JSON tests.
 */
const FRESH_AGENT_GUIDANCE =
  "You are discern's configuration engine for this project — the capable agent already in the loop, here to set discern up for your human. This is a short workflow you DRIVE end to end (verify → begin → author → done), not a status to relay back and stop on; discern only guides you, and nothing is written until you run `discern setup begin`. Your next action now: run `discern setup verify` yourself to preview the plan and open the consent conversation — don't hand the welcome back as a report. It hands you the exact message to relay to your human (what discern is, what it will do and cost, and the points to confirm) — relay that, wait for their answers, then run `begin`.";

const FRESH_HUMAN_FRAMING =
  "discern adds a quality gate, isolated git worktrees, and shared agent instructions to this repo, tailored to your codebase by your own coding agent — isolated, reversible, and with no API key. Expect roughly 20–40 minutes and a meaningful number of tokens. Point your most capable model at it: setup is one-time and high-leverage.";

const IN_PROGRESS_AGENT_GUIDANCE =
  "Finishing setup is YOUR job, not a status to report back. Continue the setup brief, then run `discern setup done` to validate and record completion — and don't tell the user setup is done until it passes. Reprint the brief any time with `discern setup begin` (idempotent; it won't touch your work).";

/**
 * Render the welcome for the cwd's project, resolving its lifecycle phase from config
 * presence + the bootstrap mark. Read-only and non-fatal: an unparseable config is
 * treated as in-progress (the agent can repair it; the real TOML error surfaces on the
 * verbs that parse strictly), never a crash on first contact. Always exits 0.
 */
export async function runSetupWelcome(opts: WelcomeOptions): Promise<number> {
  const root = await findRoot();
  const hasConfig = root !== undefined;
  let config: DiscernConfig | undefined;
  let bootstrapped = false;
  if (root !== undefined) {
    try {
      config = await loadConfig(root);
      bootstrapped = config.meta.bootstrapped;
    } catch {
      // Unparseable config — keep the welcome alive; the strict verbs report the error.
    }
  }
  const phase = setupPhaseOf({ hasConfig, bootstrapped });
  const next = setupNextAction(phase);
  const progress = phase === "in_progress" && root !== undefined &&
      config !== undefined
    ? await setupProgress(root, config)
    : undefined;

  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup",
      data: {
        phase,
        complete: phase === "done",
        next_action: next,
        // The same instructional substance the human render carries, so the agent
        // funnel reads the same warmth and "you drive this; nothing until begin"
        // framing on the JSON path as on the human one (ADR 0075 dual-addressing).
        ...(phase === "fresh"
          ? {
            agent_guidance: FRESH_AGENT_GUIDANCE,
            human_framing: FRESH_HUMAN_FRAMING,
          }
          : {}),
        ...(phase === "in_progress"
          ? { agent_guidance: IN_PROGRESS_AGENT_GUIDANCE }
          : {}),
        // Same snake_case shape as status's `setup_unfinished`, so the two derived-
        // progress surfaces read identically.
        ...(progress !== undefined
          ? {
            progress: {
              pending_markers: progress.pendingMarkers,
              capabilities: progress.capabilities,
            },
          }
          : {}),
      },
    });
    return 0;
  }

  const style = resolveWelcomeStyle({
    stdoutTty: opts.stdoutIsTerminal ?? Deno.stdout.isTerminal(),
    noColor: opts.noColor,
  });

  switch (phase) {
    case "fresh":
      console.log(renderFreshWelcome(style).join("\n"));
      break;
    case "in_progress":
      console.log(inProgressWelcome(progress).join("\n"));
      break;
    case "done":
      console.log(
        "discern is already set up here. Run `discern status` to orient.",
      );
      break;
  }
  return 0;
}

const RULE = `  ${"─".repeat(72)}`;
const TTY_BOX_WIDTH = 78;
const TTY_BOX_INNER_WIDTH = TTY_BOX_WIDTH - 4;
const ACTION_BOX_WIDTH = 56;
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

function sgr(text: string, open: number, close: number): string {
  const start = `${ESC}[${open}m`;
  const end = `${ESC}[${close}m`;
  return `${start}${text.replaceAll(end, start)}${end}`;
}

function bold(text: string): string {
  return sgr(text, 1, 22);
}

function dim(text: string): string {
  return sgr(text, 2, 22);
}

function cyan(text: string): string {
  return sgr(text, 36, 39);
}

function green(text: string): string {
  return sgr(text, 32, 39);
}

function yellow(text: string): string {
  return sgr(text, 33, 39);
}

function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

function padVisible(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
}

function centerVisible(text: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(text));
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}

function border(text: string): string {
  return dim(cyan(text));
}

function boxTop(): string {
  return border(`╭${"─".repeat(TTY_BOX_WIDTH - 2)}╮`);
}

function boxBottom(): string {
  return border(`╰${"─".repeat(TTY_BOX_WIDTH - 2)}╯`);
}

function boxRule(label: string): string {
  const dashes = "─".repeat(Math.max(1, TTY_BOX_WIDTH - label.length - 5));
  return `${border("├─ ")}${bold(label)}${border(` ${dashes}┤`)}`;
}

function boxLine(text = ""): string {
  return `${border("│")} ${padVisible(text, TTY_BOX_INNER_WIDTH)} ${
    border("│")
  }`;
}

function actionBoxLine(text: string): string {
  const innerWidth = ACTION_BOX_WIDTH - 4;
  return `${green("│")} ${padVisible(text, innerWidth)} ${green("│")}`;
}

function actionBox(): string[] {
  const quote = '"Run `discern setup` in this project."';
  return [
    boxLine(
      centerVisible(
        green(`╭${"─".repeat(ACTION_BOX_WIDTH - 2)}╮`),
        TTY_BOX_INNER_WIDTH,
      ),
    ),
    boxLine(
      centerVisible(actionBoxLine(bold(quote)), TTY_BOX_INNER_WIDTH),
    ),
    boxLine(
      centerVisible(
        green(`╰${"─".repeat(ACTION_BOX_WIDTH - 2)}╯`),
        TTY_BOX_INNER_WIDTH,
      ),
    ),
  ];
}

/**
 * The fresh-install welcome, authored as lines and printed in one go — so the text is
 * WYSIWYG and easy to edit (the indentation here IS the output; no escaping). A short
 * orientation block for the human, then the agent's funnel into `verify`. Deliberately
 * compact — the full agent preflight is `verify`'s job, not the welcome's.
 */
const PLAIN_FRESH_WELCOME: readonly string[] = [
  "discern — a stack-neutral quality harness for coding agents and the humans who run them.",
  "",
  "This project isn't set up yet.",
  "",
  "  FOR HUMANS",
  RULE,
  "  Welcome! discern adds a quality gate, isolated git worktrees, and shared",
  "  agent instructions to this repo — tailored to YOUR codebase by your own",
  "  coding agent. To get started, tell your coding agent:",
  "",
  '      "Run `discern setup` in this project."',
  "",
  "  Setup is isolated and reversible. It only touches this project – nothing else.",
  "  Your agent works on a dedicated `discern-setup` branch in small step-by-step",
  "  commits, so you can follow along — and undo everything with one command if",
  "  you change your mind. There's no lock-in, no API key, and no surprises.",
  "",
  "  Point your MOST CAPABLE model at it: setup is a one-time, high-leverage step,",
  "  and discern is only as good as the model that configured it.",
  "  Expect roughly 20–40 minutes and a meaningful number of tokens.",
  "",
  "  FOR CODING AGENTS",
  RULE,
  "  You are discern's configuration engine here: the capable agent already in",
  "  the loop, set to configure discern for your human. This is a short workflow",
  "  you DRIVE end to end (verify → begin → author → done) — not a status to",
  "  relay back and stop on. discern guides each step; NOTHING is written until",
  "  you explicitly run `begin`.",
  "",
  "  Your next action, now — preview the plan and open the consent conversation:",
  "",
  "      discern setup verify        (read-only; add --json for machine output)",
  "",
  "  Run it yourself: it hands you the exact message to relay to your human, then",
  "  points you at the next step. Don't hand this back as a report — carry it through.",
];

/** Render the fresh-install welcome in either plain or TTY-decorated form. */
export function renderFreshWelcome(style: WelcomeStyleMode): string[] {
  return style.tty ? styledFreshWelcome() : [...PLAIN_FRESH_WELCOME];
}

function styledFreshWelcome(): string[] {
  return [
    boxTop(),
    boxLine(`${bold(cyan("discern"))} — a stack-neutral quality harness`),
    boxLine(dim("for coding agents and the humans who run them.")),
    boxRule("This project isn't set up yet."),
    boxLine(""),
    boxLine(bold(cyan("FOR HUMANS"))),
    boxLine(
      "Welcome! discern adds a quality gate, isolated git worktrees, and shared",
    ),
    boxLine(
      "agent instructions to this repo — tailored to YOUR codebase by your own",
    ),
    boxLine("coding agent. To get started, tell your coding agent:"),
    boxLine(""),
    boxLine(
      centerVisible(
        `${cyan("quality gate")}   ${green("isolated git worktrees")}   ${
          yellow("shared agent instructions")
        }`,
        TTY_BOX_INNER_WIDTH,
      ),
    ),
    boxLine(""),
    ...actionBox(),
    boxLine(""),
    boxLine("Setup is isolated and reversible. It only touches this project –"),
    boxLine("nothing else."),
    boxLine("Your agent works on a dedicated `discern-setup` branch in small"),
    boxLine(
      "step-by-step commits, so you can follow along — and undo everything",
    ),
    boxLine(
      "with one command if you change your mind. There's no lock-in, no API",
    ),
    boxLine("key, and no surprises."),
    boxLine(""),
    boxLine("Point your MOST CAPABLE model at it: setup is a one-time,"),
    boxLine(
      "high-leverage step, and discern is only as good as the model that",
    ),
    boxLine("configured it."),
    boxLine("Expect roughly 20–40 minutes and a meaningful number of tokens."),
    boxLine(""),
    boxRule("FOR CODING AGENTS"),
    boxLine(
      dim(
        "You are discern's configuration engine here: the capable agent already in",
      ),
    ),
    boxLine(
      dim("the loop, set to configure discern for your human. This is a short"),
    ),
    boxLine(
      dim("workflow you DRIVE end to end (verify → begin → author → done) —"),
    ),
    boxLine(
      dim("not a status to relay back and stop on. discern guides each step;"),
    ),
    boxLine(dim("NOTHING is written until you explicitly run `begin`.")),
    boxLine(""),
    boxLine(
      dim(
        "Your next action, now — preview the plan and open the consent conversation:",
      ),
    ),
    boxLine(""),
    boxLine(
      centerVisible(
        dim(
          "discern setup verify        (read-only; add --json for machine output)",
        ),
        TTY_BOX_INNER_WIDTH,
      ),
    ),
    boxLine(""),
    boxLine(
      dim(
        "Run it yourself: it hands you the exact message to relay to your human,",
      ),
    ),
    boxLine(
      dim(
        "then points you at the next step. Don't hand this back as a report —",
      ),
    ),
    boxLine(dim("carry it through.")),
    boxBottom(),
  ];
}

/** The in-progress welcome, as lines: the resume view. Lead with DERIVED progress
 * (what's left, unfakeable), then the agent's path to finish and the human's
 * reassurance. */
function inProgressWelcome(progress: SetupProgress | undefined): string[] {
  return [
    "discern setup is IN PROGRESS here — not yet finished.",
    "",
    ...(progress !== undefined ? [...renderProgressLines(progress), ""] : []),
    "Agents: this is YOUR job to finish, not a status to report back. Continue the",
    "setup brief, then run `discern setup done` to validate and record completion.",
    "Reprint the full brief any time with `discern setup begin` (idempotent — it",
    "won't touch your work). Don't tell the user setup is done until `done` passes.",
    "",
    "Humans: your coding agent is mid-setup on the `discern-setup` branch. Follow",
    "along — you can roll it all back by deleting that branch.",
  ];
}

/**
 * Render derived setup progress as human lines — what doc/guidance authoring is left
 * (files still carrying a marker) and which capabilities are wired. Shared shape with
 * `status`, which reads the same {@link SetupProgress}. Exported so `status` renders
 * it identically.
 */
export function renderProgressLines(progress: SetupProgress): string[] {
  const lines: string[] = ["Progress so far:"];

  if (progress.pendingMarkers.length === 0) {
    lines.push("  • docs & guidance: all skeletons filled ✓");
  } else {
    lines.push(
      `  • docs & guidance: ${progress.pendingMarkers.length} file(s) still need filling —`,
    );
    for (const f of progress.pendingMarkers) {
      lines.push(`      ${f}`);
    }
  }

  const wired = progress.capabilities.filter((c) => c.wired).map((c) => c.name);
  const unset = progress.capabilities.filter((c) => !c.wired).map((c) =>
    c.name
  );
  const wiredPart = wired.length > 0 ? wired.join(", ") : "none yet";
  const unsetPart = unset.length > 0 ? ` · unset: ${unset.join(", ")}` : "";
  lines.push(`  • capabilities wired: ${wiredPart}${unsetPart}`);

  return lines;
}
