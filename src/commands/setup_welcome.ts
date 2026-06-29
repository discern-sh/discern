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
        ...(progress !== undefined ? { progress } : {}),
      },
    });
    return 0;
  }

  switch (phase) {
    case "fresh":
      printFreshWelcome();
      break;
    case "in_progress":
      printInProgressWelcome(progress);
      break;
    case "done":
      console.log(
        "discern is already set up here. Run `discern status` to orient.",
      );
      break;
  }
  return 0;
}

const RULE = "─".repeat(72);

/** The fresh-install welcome: a short orientation block for the human, then the
 * agent's funnel into `verify`. Deliberately compact — the full agent preflight is
 * `verify`'s job, not the welcome's. */
function printFreshWelcome(): void {
  console.log(
    "discern — a stack-neutral quality harness for coding agents and the humans who run them.",
  );
  console.log("");
  console.log("This project isn't set up yet.");
  console.log("");
  console.log("  FOR HUMANS");
  console.log("  " + RULE);
  console.log(
    "  Welcome! discern adds a quality gate, isolated git worktrees, and shared",
  );
  console.log(
    "  agent instructions to this repo — tailored to YOUR codebase by your own",
  );
  console.log("  coding agent. To get started, tell your coding agent:");
  console.log("");
  console.log('      "Run discern setup"');
  console.log("");
  console.log(
    "  It's safe. Setup only touches this folder, never anything outside it. Your",
  );
  console.log(
    "  agent works on a dedicated `discern-setup` branch in small, clearly-explained",
  );
  console.log(
    "  commits, so you can follow along — and undo everything with one command if",
  );
  console.log("  you change your mind. No API key, no lock-in.");
  console.log("");
  console.log(
    "  Point your MOST CAPABLE model at it: setup is a one-time, high-leverage step,",
  );
  console.log(
    "  and discern is only as good as the model that configured it.",
  );
  console.log("");
  console.log("  FOR CODING AGENTS");
  console.log("  " + RULE);
  console.log(
    "  Did your human just ask you to set discern up? You drive it — discern only",
  );
  console.log(
    "  guides you, and NOTHING is written until you explicitly run `begin`. Start by",
  );
  console.log(
    "  previewing what setup will do and confirming a few things with your human:",
  );
  console.log("");
  console.log(
    "      discern setup verify        (read-only; add --json for machine output)",
  );
  console.log("");
  console.log(
    "  It will tell you what to confirm, then point you at `discern setup begin`.",
  );
}

/** The in-progress welcome: the resume view. Lead with DERIVED progress (what's left,
 * unfakeable), then the agent's path to finish and the human's reassurance. */
function printInProgressWelcome(progress: SetupProgress | undefined): void {
  console.log("discern setup is IN PROGRESS here — not yet finished.");
  console.log("");
  if (progress !== undefined) {
    for (const line of renderProgressLines(progress)) {
      console.log(line);
    }
    console.log("");
  }
  console.log(
    "Agents: this is YOUR job to finish, not a status to report back. Continue the",
  );
  console.log(
    "setup brief, then run `discern setup done` to validate and record completion.",
  );
  console.log(
    "Reprint the full brief any time with `discern setup begin` (idempotent — it",
  );
  console.log(
    "won't touch your work). Don't tell the user setup is done until `done` passes.",
  );
  console.log("");
  console.log(
    "Humans: your coding agent is mid-setup on the `discern-setup` branch. Follow",
  );
  console.log("along — you can roll it all back by deleting that branch.");
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
