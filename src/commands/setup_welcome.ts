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

import { Logger } from "../lib/log.ts";
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
}

/**
 * The instructional substance the welcome carries to a JSON-consuming agent, so it
 * is not handed a colder, thinner welcome than one reading the dual-addressed human
 * text (ADR 0075). The human blocks below say the same things in prose; these are
 * the machine-readable mirror, kept in step with them by the welcome JSON tests.
 */
const FRESH_AGENT_GUIDANCE =
  "You drive setup — discern only guides you, and nothing is written until you run `discern setup begin`. Before any consent checklist, open warmly and explain what discern is to your human (they may be meeting it for the first time): a quality gate, isolated git worktrees, and shared agent instructions, tailored to their codebase by you. Reassure them it is safe and reversible — setup touches only this folder, runs on a dedicated `discern-setup` branch in small revertible commits, needs no API key, and undoes by deleting the branch. Then preview the plan with `discern setup verify`.";

const FRESH_HUMAN_FRAMING =
  "discern adds a quality gate, isolated git worktrees, and shared agent instructions to this repo, tailored to your codebase by your own coding agent — safe, reversible, and with no API key. Point your most capable model at it: setup is one-time and high-leverage.";

const IN_PROGRESS_AGENT_GUIDANCE =
  "Finishing setup is YOUR job, not a status to report back. Continue the setup brief, then run `discern setup done` to validate and record completion — and don't tell the user setup is done until it passes. Reprint the brief any time with `discern setup begin` (idempotent; it won't touch your work).";

/**
 * Render the welcome for the cwd's project, resolving its lifecycle phase from config
 * presence + the bootstrap mark. Read-only and non-fatal: an unparseable config is
 * treated as in-progress (the agent can repair it; the real TOML error surfaces on the
 * verbs that parse strictly), never a crash on first contact. Always exits 0.
 */
export async function runSetupWelcome(opts: WelcomeOptions): Promise<number> {
  const log = new Logger({
    json: opts.json,
    noColor: opts.noColor,
    humanStream: "stdout",
  });
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
    log.result({
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

  switch (phase) {
    case "fresh":
      console.log(FRESH_WELCOME.join("\n"));
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

/**
 * The fresh-install welcome, authored as lines and printed in one go — so the text is
 * WYSIWYG and easy to edit (the indentation here IS the output; no escaping). A short
 * orientation block for the human, then the agent's funnel into `verify`. Deliberately
 * compact — the full agent preflight is `verify`'s job, not the welcome's.
 */
const FRESH_WELCOME: readonly string[] = [
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
  "",
  "  FOR CODING AGENTS",
  RULE,
  "  Did your human just ask you to set discern up? You drive it — discern only",
  "  guides you, and NOTHING is written until you explicitly run `begin`. Start by",
  "  previewing what setup will do and confirming a few things with your human:",
  "",
  "      discern setup verify        (read-only; add --json for machine output)",
  "",
  "  It will tell you what to confirm, then point you at the next step.",
];

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
