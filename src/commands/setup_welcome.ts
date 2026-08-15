/**
 * `discern setup` (and bare `discern`, pre-setup) — the read-only WELCOME, the
 * first contact for both readers (ADR 0075). It writes NOTHING; the destructive
 * scaffold lives behind `discern setup begin`.
 *
 * Three lifecycle states ({@link SetupPhase}):
 *   - `fresh`       — no `discern.toml` yet. A dual-addressed welcome: reassurance for
 *                     the human, and the `verify` funnel for the agent.
 *   - `in_progress` — `begin` scaffolded but `[meta].bootstrapped` is unset. Show the
 *                     DERIVED progress (markers + known jobs) and point at `done`.
 *   - `done`        — bootstrapped. The router shows normal help instead; reached here
 *                     only by an explicit call, which we point at `status`.
 *
 * Human output is dual-addressed and shown for BOTH a TTY and a pipe — robust where
 * detecting the reader is not (ADR 0075). `--json` carries `phase` + `next_action` so
 * a JSON-consuming agent is funneled the same way.
 */

import { emitResult } from "../shared/emit.ts";
import { Logger } from "../lib/log.ts";
import { DISCERN_WORDMARK } from "../shared/brand.ts";
import { renderDiscernArt } from "../../art/terminal/brand.ts";
import {
  joinVertical,
  renderCommandCli,
  renderSectionCli,
} from "discern-design-system/cli";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalPresentationContext,
} from "../lib/terminal.ts";
import {
  type HumanOutputGroup,
  renderHumanOutputGroups,
} from "../shared/result.ts";
import { runGit } from "../shared/subprocess.ts";
import {
  SETUP_BRANCH,
  setupBranchExists,
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
  /** Explicit package presentation facts for the styled branch. */
  terminal?: TerminalContext;
}

/** The repo facts the fresh welcome grounds itself in — today just whether the
 * directory is a git work tree, so a no-git first contact leads with the
 * `git init` step instead of promising the isolated branch it can't deliver. */
export interface WelcomeContext {
  gitRepo: boolean;
}

/** Inputs at the command edge that decide whether to use the styled render. */
export interface WelcomeStyleInputs {
  stdoutTty: boolean;
  /** Already resolved from `--no-color` and `NO_COLOR` by the CLI plumbing. */
  noColor: boolean;
  /** The process context already resolved by the CLI entry point. */
  terminal?: TerminalContext;
}

/** Resolve the welcome's presentation mode from the existing no-colour plumbing. */
export function resolveWelcomeStyle(
  inputs: WelcomeStyleInputs,
): WelcomeStyleMode {
  return {
    tty: inputs.stdoutTty && !inputs.noColor,
    ...(inputs.terminal === undefined ? {} : { terminal: inputs.terminal }),
  };
}

/**
 * The instructional substance the welcome carries to a JSON-consuming agent, so it
 * is not handed a colder, thinner welcome than one reading the dual-addressed human
 * text (ADR 0075). The human blocks below say the same things in prose; these are
 * the structured mirror, kept in step with them by the welcome JSON tests.
 */
const FRESH_AGENT_GUIDANCE =
  "You are discern's configuration engine for this project — the capable agent already in the loop, here to set discern up for your human. This is a short workflow you DRIVE end to end (verify → begin → author → done), not a status to relay back and stop on; discern only guides you, and nothing is written until you run `discern setup begin`. Your next action now: run `discern setup verify` yourself to preview the plan and open the consent conversation — don't hand the welcome back as a report. It hands you the exact message to relay to your human (what discern is, what it will do and cost, and the points to confirm) — relay that, wait for their answers, then run `begin`.";

const FRESH_HUMAN_FRAMING =
  "discern adds a quality gate, isolated git worktrees, and shared agent instructions to this repo, tailored to your codebase by your own coding agent — isolated, reversible, and with no API key. Everything discern itself owns lands in one root file (discern.toml) and one visible discern/ folder, plus the config files your coding tools require — your own tools' integrations, wired for you; `discern uninstall` backs it all out if you change your mind. Expect roughly 20–40 minutes and a meaningful number of tokens. Point your most capable model at it: setup is one-time and high-leverage.";

/** The leading note a non-git first contact carries on both surfaces: the very
 * first step is `git init` — the isolation and undo story every other welcome
 * sentence relies on doesn't exist until it runs. */
const FRESH_NON_GIT_NOTE =
  "This folder isn't a git repository yet — setup's first step is `git init` (git is what makes setup isolated, reversible, and easy to undo); `discern setup verify` walks you through it.";

const IN_PROGRESS_AGENT_GUIDANCE =
  "Finishing setup is YOUR job, not a status to report back. Continue the setup brief, then run `discern setup done` to validate and record completion — and don't tell the user setup is done until it passes. Reprint the brief any time with `discern setup begin` (idempotent; it won't touch your work).";

const ABANDONED_AGENT_GUIDANCE =
  `Setup is already in progress on the \`${SETUP_BRANCH}\` branch — resume it there; do NOT start setup again from this branch (that would re-scaffold over the half-finished install). Check the branch out (\`git checkout ${SETUP_BRANCH}\`), reprint the brief with \`discern setup begin\`, continue it, then run \`discern setup done\` to finish.`;

/**
 * Render the welcome for the cwd's project, resolving its lifecycle phase from config
 * presence + the setup completion marker. Read-only and non-fatal: an unparseable config is
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

  // A half-finished setup abandoned from another branch: no config HERE, but a
  // `discern-setup` branch exists carrying setup's work. Route to the resume
  // surface — the fresh funnel would walk the agent into re-scaffolding over it.
  if (phase === "fresh" && await setupBranchExists(Deno.cwd())) {
    if (opts.json) {
      emitResult({
        ok: true,
        verb: "setup",
        data: {
          phase: "in_progress",
          complete: false,
          next_action: `git checkout ${SETUP_BRANCH}`,
          agent_guidance: ABANDONED_AGENT_GUIDANCE,
        },
      });
      return 0;
    }
    new Logger({ json: false, noColor: false }).line(
      renderHumanOutputGroups(abandonedSetupWelcomeGroups()),
    );
    return 0;
  }

  const next = setupNextAction(phase);
  const progress = phase === "in_progress" && root !== undefined &&
      config !== undefined
    ? await setupProgress(root, config)
    : undefined;
  // The fresh welcome grounds itself in the git state, so a no-git first contact
  // leads with the `git init` step (the audience most likely to lack git is
  // exactly the one this curated first contact exists for).
  const gitRepo = phase !== "fresh" ||
    (await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: Deno.cwd() }))
      .success;

  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup",
      data: {
        phase,
        complete: phase === "done",
        next_action: next,
        // The same instructional substance every presentation carries. The named
        // agent and human fields preserve their real audiences independently of
        // whether the caller chooses terminal, JSON, or Markdown delivery.
        ...(phase === "fresh"
          ? {
            agent_guidance: FRESH_AGENT_GUIDANCE,
            human_framing: gitRepo
              ? FRESH_HUMAN_FRAMING
              : `${FRESH_NON_GIT_NOTE} ${FRESH_HUMAN_FRAMING}`,
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
              known_jobs: progress.knownJobs,
            },
          }
          : {}),
      },
    });
    return 0;
  }

  const terminal = terminalContext();
  const style = resolveWelcomeStyle({
    stdoutTty: opts.stdoutIsTerminal ?? terminal.stdoutIsTerminal,
    noColor: opts.noColor,
    terminal,
  });

  const log = new Logger({ json: false, noColor: false });
  switch (phase) {
    case "fresh":
      log.line(
        renderHumanOutputGroups(freshWelcomeGroups(style, { gitRepo })),
      );
      break;
    case "in_progress":
      log.line(renderHumanOutputGroups(inProgressWelcomeGroups(progress)));
      break;
    case "done":
      log.line(
        "discern is already set up here. Run `discern status` to orient.",
      );
      break;
  }
  return 0;
}

const RULE = `  ${"─".repeat(72)}`;
const TTY_MAX_BOX_WIDTH = 78;
const TTY_MIN_BOX_WIDTH = 24;

/**
 * The fresh-install welcome, authored as lines and printed in one go — so the text is
 * WYSIWYG and easy to edit (the indentation here IS the output; no escaping). A short
 * orientation block for the human, then the agent's funnel into `verify`. Deliberately
 * compact — the full agent preflight is `verify`'s job, not the welcome's.
 */
const PLAIN_FRESH_WELCOME: readonly string[] = [
  `${DISCERN_WORDMARK} — quality gates and safe worktrees for coding agents and the humans who run them.`,
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
  "  Setup is isolated and reversible. Everything discern itself owns lands in",
  "  one root file (`discern.toml`) and one visible `discern/` folder, plus the",
  "  config files your coding tools require — your own tools' integrations,",
  "  wired for you and committed in the open. Your agent works on a dedicated",
  "  `discern-setup` branch in small step-by-step commits, so you can follow",
  "  along — and if you change your mind, `discern uninstall` backs it all",
  "  out. There's no lock-in, no API key, and no surprises.",
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
  "      discern setup verify        (read-only; --json/--markdown emit one result)",
  "",
  "  Run it yourself: it hands you the exact message to relay to your human, then",
  "  points you at the next step. Don't hand this back as a report — carry it through.",
];

/** The plain-render lines of the non-git leading note ({@link FRESH_NON_GIT_NOTE}
 * wrapped to the welcome's layout), inserted right under the headline. */
const PLAIN_NON_GIT_NOTE: readonly string[] = [
  "",
  "  ⚠ This folder isn't a git repository yet. Setup's first step is `git init` —",
  "    git is what makes setup isolated, reversible, and easy to undo.",
];

const PLAIN_FRESH_GROUP_IDS = [
  "orientation",
  "setup-state",
  "human-overview",
  "human-action",
  "reversibility",
  "model-guidance",
  "agent-overview",
  "agent-next-action",
  "agent-command",
  "agent-handoff",
] as const;

/** Give every authored plain-welcome block a stable semantic identity. The
 * source stays WYSIWYG, but a new blank-delimited block cannot ship unnamed. */
function namedWelcomeGroups(
  lines: readonly string[],
  ids: readonly string[],
): HumanOutputGroup<string>[] {
  const blocks: string[][] = [];
  let items: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (items.length > 0) blocks.push(items);
      items = [];
    } else {
      items.push(line);
    }
  }
  if (items.length > 0) blocks.push(items);
  if (blocks.length !== ids.length) {
    throw new Error(
      `fresh welcome has ${blocks.length} blocks but ${ids.length} semantic group ids`,
    );
  }
  return blocks.map((block, index) => ({
    id: ids[index] ?? "",
    items: block,
  }));
}

/** Model the fresh welcome's semantic regions. The decorated TTY box is one
 * self-structured frame; the plain view names each textual region directly. */
function freshWelcomeGroups(
  style: WelcomeStyleMode,
  ctx: WelcomeContext = { gitRepo: true },
): HumanOutputGroup<string>[] {
  const terminal = style.terminal ?? terminalPresentationContext(style.tty);
  if (style.tty && terminal.capabilities.columns >= TTY_MIN_BOX_WIDTH) {
    return [{
      id: "welcome-frame",
      items: [styledFreshWelcome(ctx, terminal).join("\n")],
    }];
  }
  const lines = [...PLAIN_FRESH_WELCOME];
  const ids: string[] = [...PLAIN_FRESH_GROUP_IDS];
  if (!ctx.gitRepo) {
    const at = lines.indexOf("This project isn't set up yet.") + 1;
    lines.splice(at, 0, ...PLAIN_NON_GIT_NOTE);
    ids.splice(2, 0, "git-prerequisite");
  }
  return namedWelcomeGroups(lines, ids);
}

/** Render the fresh-install welcome in either plain or TTY-decorated form. */
export function renderFreshWelcome(
  style: WelcomeStyleMode,
  ctx: WelcomeContext = { gitRepo: true },
): string[] {
  return renderHumanOutputGroups(freshWelcomeGroups(style, ctx)).split("\n");
}

/** Compose the package-backed TTY welcome, including the Git prerequisite. */
function styledFreshWelcome(
  ctx: WelcomeContext,
  terminal: TerminalContext,
): string[] {
  const capabilities = terminal.capabilities;
  const width = Math.min(TTY_MAX_BOX_WIDTH, capabilities.columns);
  const innerWidth = width - 4;
  const mark = renderDiscernArt(capabilities.unicode ? "split" : "stamp");
  const action = terminal.tone(
    '"Run `discern setup` in this project."',
    "success",
    "strong",
  );
  const humans = joinVertical([
    terminal.presenter.present(renderSectionCli, {
      title: "FOR HUMANS",
      body:
        "Welcome! discern adds a quality gate, isolated git worktrees, and shared agent instructions to this repo — tailored to YOUR codebase by your own coding agent.",
      treatment: "rule",
      spacing: "sm",
      width: innerWidth,
    }),
    "quality gate   isolated git worktrees   shared agent instructions",
    "To get started, tell your coding agent:",
    action,
    "Setup is isolated and reversible. Everything discern itself owns lands in one root file (`discern.toml`) and one visible `discern/` folder, plus the config files your coding tools require — your own tools' integrations, wired for you and committed in the open. Your agent works on a dedicated `discern-setup` branch in small step-by-step commits, so you can follow along — and if you change your mind, `discern uninstall` backs it all out. There's no lock-in, no API key, and no surprises.",
    "Point your MOST CAPABLE model at it: setup is a one-time, high-leverage step, and discern is only as good as the model that configured it. Expect roughly 20–40 minutes and a meaningful number of tokens.",
  ], { spacing: 1 });
  const agents = joinVertical([
    terminal.presenter.present(renderSectionCli, {
      title: "FOR CODING AGENTS",
      body:
        "You are discern's configuration engine here: the capable agent already in the loop, set to configure discern for your human. This is a short workflow you DRIVE end to end (verify → begin → author → done) — not a status to relay back and stop on. discern guides each step; NOTHING is written until you explicitly run `begin`.",
      treatment: "rule",
      spacing: "sm",
      width: innerWidth,
    }),
    "Your next action, now — preview the plan and open the consent conversation:",
    terminal.presenter.present(renderCommandCli, {
      command: "discern setup verify",
      explanation: "(read-only; --json/--markdown emit one result)",
      maxWidth: innerWidth,
    }),
    terminal.role(
      "Run it yourself: it hands you the exact message to relay to your human, then points you at the next step. Don't hand this back as a report — carry it through.",
      "muted",
    ),
  ], { spacing: 1 });
  const header = joinVertical([
    terminal.tone(mark, "accent", "strong"),
    terminal.role(
      "quality gates and safe worktrees\nfor coding agents and the humans who run them.",
      "muted",
    ),
  ]).split("\n");
  const body = joinVertical([
    terminal.role("This project isn't set up yet.", "strong"),
    ...(ctx.gitRepo ? [] : [terminal.tone(
      "⚠ This folder isn't a git repository yet. Setup's first step is `git init` — git is what makes setup isolated, reversible, and easy to undo.",
      "warning",
    )]),
    humans,
    agents,
  ], { spacing: 1 });
  const frame = terminal.presenter.box({
    body,
    width,
    padding: 1,
    borderStyle: {
      ...terminal.theme.typography.muted,
      color: terminal.themeColor("--discern-color-accent-700"),
    },
  }).split("\n");
  // The package box intentionally normalizes indentation while wrapping. Keep
  // Discern's product-owned art outside it so those accepted rows remain exact.
  return [...header, "", ...frame];
}

/** The abandoned-mid-setup welcome: a `discern-setup` branch exists with setup's
 * work, but the current branch has no config — the resume is to check the branch
 * out, never to re-enter the fresh funnel (whose re-scaffold would pollute the
 * half-finished install). */
function abandonedSetupWelcomeGroups(): HumanOutputGroup<string>[] {
  return [
    {
      id: "setup-state",
      items: ["discern setup is IN PROGRESS here — not yet finished."],
    },
    {
      id: "branch-location",
      items: [
        `A \`${SETUP_BRANCH}\` branch exists carrying setup's work so far, but you are`,
        "not on it.",
      ],
    },
    {
      id: "agent-resume",
      items: [
        "Agents: resume the setup there — do NOT start setup again from this branch",
        "(that would re-scaffold over the half-finished install). Your next actions:",
      ],
    },
    {
      id: "resume-commands",
      items: [
        `    git checkout ${SETUP_BRANCH}`,
        "    discern setup begin        (reprints the brief; idempotent)",
      ],
    },
    {
      id: "completion-action",
      items: [
        "Then continue the brief and run `discern setup done` to finish.",
      ],
    },
    {
      id: "human-recovery",
      items: [
        `Humans: your coding agent left setup half-done on the \`${SETUP_BRANCH}\``,
        "branch. It can pick up right where it left off — or roll everything back:",
        "delete that branch, then `discern uninstall` sweeps out the generated files.",
      ],
    },
  ];
}

/** The in-progress welcome, as lines: the resume view. Lead with DERIVED progress
 * (what's left, unfakeable), then the agent's path to finish and the human's
 * reassurance. */
function inProgressWelcomeGroups(
  progress: SetupProgress | undefined,
): HumanOutputGroup<string>[] {
  return [
    {
      id: "setup-state",
      items: ["discern setup is IN PROGRESS here — not yet finished."],
    },
    {
      id: "setup-progress",
      items: progress === undefined ? [] : renderProgressLines(progress),
    },
    {
      id: "agent-resume",
      items: [
        "Agents: this is YOUR job to finish, not a status to report back. Continue the",
        "setup brief, then run `discern setup done` to validate and record completion.",
        "Reprint the full brief any time with `discern setup begin` (idempotent — it",
        "won't touch your work). Don't tell the user setup is done until `done` passes.",
      ],
    },
    {
      id: "human-recovery",
      items: [
        "Humans: your coding agent is mid-setup on the `discern-setup` branch. Follow",
        "along — roll it all back by deleting that branch, then `discern uninstall`",
        "to sweep out any generated files.",
      ],
    },
  ];
}

/**
 * Render derived setup progress as human lines — what doc/guidance authoring is left
 * (files still carrying a marker) and which known jobs are wired. Shared shape with
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

  const wired = progress.knownJobs.filter((job) => job.wired).map((job) =>
    job.name
  );
  const unset = progress.knownJobs.filter((job) => !job.wired).map((job) =>
    job.name
  );
  const wiredPart = wired.length > 0 ? wired.join(", ") : "none yet";
  const unsetPart = unset.length > 0 ? ` · unset: ${unset.join(", ")}` : "";
  lines.push(`  • known jobs wired: ${wiredPart}${unsetPart}`);

  return lines;
}
