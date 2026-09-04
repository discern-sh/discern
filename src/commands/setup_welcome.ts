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
import { notApplicableCountLabel } from "../shared/setup_assurance.ts";
import {
  assertSetupHumanSurfaceConsumption,
  SETUP_REVERSIBILITY,
  type SetupHumanMoment,
  setupHumanMomentsForSurface,
} from "../shared/setup_experience.ts";

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
function welcomeMoment(id: string): SetupHumanMoment {
  const moment = setupHumanMomentsForSurface("welcome").find((candidate) =>
    candidate.id === id
  );
  if (moment === undefined) {
    throw new Error(`Missing setup welcome moment: ${id}`);
  }
  return moment;
}

const FIRST_USE_VALUE = welcomeMoment("first-use-value");
const MODEL_SELECTION = welcomeMoment("model-selection");
assertSetupHumanSurfaceConsumption("welcome", [
  FIRST_USE_VALUE.id,
  MODEL_SELECTION.id,
]);

const FRESH_AGENT_INSTRUCTIONS =
  "You are discern's configuration engine for this project. Run read-only `discern setup verify` now, relay its owner conversation naturally, and carry setup through each stated next action. Nothing is written until `begin`; wait only for applicable decisions, preserve explicit consent and Proof, and never infer landing authority.";

const FRESH_OWNER_WELCOME = [
  "Welcome. This one-time setup gives future coding sessions a dependable way to understand, change, and check this project.",
  "The selected agent will study the repository, preserve its workflows, set up the final quality check (the Gate) and separate working copies for tasks, then write the maintained project guide and shared agent instructions. discern keeps that working practice in place.",
  "Expect roughly 20–40 minutes and a meaningful number of tokens, prepared as small commits on a separate reviewable branch. You decide cost, access, durable data, new dependencies, exceptions, and landing.",
  `${SETUP_REVERSIBILITY.welcome} ${SETUP_REVERSIBILITY.uninstall}`,
  "The footprint includes the root `discern.toml` and one visible `discern/` folder for authored sources, plus managed blocks in `.gitignore` and `.gitattributes`, Agent files compiled from the authored instructions, and the selected coding tools' local integration files. Generated provider skill directories stay Git-ignored. No API key or outside service is required by discern itself.",
  "Because future sessions inherit this work, I recommend your strongest suitable reasoning model. Switch with the coding tool's model selector and start a fresh project session. To stop, say so before `begin`; this welcome and the next preflight are read-only.",
] as const;

const FRESH_HUMAN_FRAMING = FRESH_OWNER_WELCOME.join(" ");

/** The leading note a non-git first contact carries on both surfaces: the very
 * first step is `git init` — the isolation and undo story every other welcome
 * sentence relies on doesn't exist until it runs. */
const FRESH_NON_GIT_NOTE =
  "This folder isn't a git repository yet — setup's first step is `git init` (git is what makes setup isolated, reversible, and easy to undo); `discern setup verify` walks you through it.";

/** Tell the agent how to resume setup on the observed branch state. */
function inProgressAgentInstructions(branch: string): string {
  const location = branch === "" ? "a detached HEAD" : `branch \`${branch}\``;
  return `Finishing setup on ${location} is YOUR job, not a status to report back. Run \`discern setup begin\` to reprint the brief, continue it, then run \`discern setup done\` to validate and record completion — and don't tell the user setup is done until it passes.`;
}

const ABANDONED_AGENT_INSTRUCTIONS =
  `Setup is already in progress on the \`${SETUP_BRANCH}\` branch. Resume it with \`discern setup begin --confirmed\`; discern checks out that branch and reprints the current brief without replaying completed scaffold writes. Continue it, then run \`discern setup done\` to finish.`;

const UNPROVEN_AGENT_INSTRUCTIONS =
  "Setup was recorded as unproven, so it cannot be accepted or activated yet. Resolve the incomplete or red setup, commit the correction, then run `discern setup done` to replace the persisted state with proven Gate evidence.";

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
      // discern-best-effort: setup-welcome-config-fallback
      // Unparseable config — keep the welcome alive; the strict verbs report the error.
    }
  }
  const phase = setupPhaseOf({ hasConfig, bootstrapped });
  const setupCompletion = config?.meta.setup_completion;
  const unproven = setupCompletion === "unproven";

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
          next_action: "discern setup begin --confirmed",
          agent_instructions: ABANDONED_AGENT_INSTRUCTIONS,
        },
      });
      return 0;
    }
    new Logger({ json: false, noColor: false }).line(
      renderHumanOutputGroups(abandonedSetupWelcomeGroups()),
    );
    return 0;
  }

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
  const currentBranch = phase === "in_progress" && root !== undefined
    ? (await runGit(["branch", "--show-current"], { cwd: root })).stdout.trim()
    : "";
  const next = phase === "fresh" && !gitRepo
    ? "git init"
    : unproven
    ? "discern setup done"
    : setupNextAction(phase);

  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup",
      data: {
        phase,
        complete: phase === "done" && !unproven,
        ...(setupCompletion === undefined
          ? {}
          : { setup_completion: setupCompletion }),
        next_action: next,
        // The same instructional substance every presentation carries. The named
        // agent and human fields preserve their real audiences independently of
        // whether the caller chooses terminal, JSON, or Markdown delivery.
        ...(phase === "fresh"
          ? {
            agent_instructions: FRESH_AGENT_INSTRUCTIONS,
            human_framing: gitRepo
              ? FRESH_HUMAN_FRAMING
              : `${FRESH_NON_GIT_NOTE} ${FRESH_HUMAN_FRAMING}`,
          }
          : {}),
        ...(phase === "in_progress"
          ? { agent_instructions: inProgressAgentInstructions(currentBranch) }
          : {}),
        ...(unproven
          ? { agent_instructions: UNPROVEN_AGENT_INSTRUCTIONS }
          : {}),
        // Same snake_case shape as status's `setup_unfinished`, so the two derived-
        // progress surfaces read identically.
        ...(progress !== undefined
          ? {
            progress: {
              pending_markers: progress.pendingMarkers,
              known_jobs: progress.knownJobs,
              assurance: progress.assurance,
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
      log.line(
        renderHumanOutputGroups(
          inProgressWelcomeGroups(progress, currentBranch),
        ),
      );
      break;
    case "done":
      log.line(
        unproven
          ? "discern setup is unproven and cannot be accepted or activated. Resolve the incomplete or red setup, commit the correction, then run `discern setup done` to converge to proven."
          : "discern is already set up here. Run `discern status` to orient.",
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
  `${DISCERN_WORDMARK} — a project-owned working practice for coding agents and the people responsible for what lands.`,
  "",
  "This project isn't set up yet.",
  "",
  "  FOR HUMANS",
  RULE,
  ...FRESH_OWNER_WELCOME.map((line) => `  ${line}`),
  "",
  "  To get started, tell your coding agent:",
  '      "Run `discern setup` in this project."',
  "",
  "  FOR CODING AGENTS",
  RULE,
  `  ${FRESH_AGENT_INSTRUCTIONS}`,
  "",
  "  Your next action, now — preview the plan and open the consent conversation:",
  "",
  "      discern setup verify        (read-only; --json/--markdown emit one result)",
  "",
  "  Run it yourself: it hands you the complete owner facts and decisions, then",
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
      body: FRESH_OWNER_WELCOME.join("\n\n"),
      treatment: "rule",
      spacing: "sm",
      width: innerWidth,
    }),
    "To get started, tell your coding agent:",
    action,
  ], { spacing: 1 });
  const agents = joinVertical([
    terminal.presenter.present(renderSectionCli, {
      title: "FOR CODING AGENTS",
      body: FRESH_AGENT_INSTRUCTIONS,
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
      "Run it yourself: it hands you the complete owner facts and decisions, then points you at the next step. Don't hand this back as a report — carry it through.",
      "muted",
    ),
  ], { spacing: 1 });
  const header = joinVertical([
    terminal.tone(mark, "accent", "strong"),
    terminal.role(
      "project-owned working practice\nfor coding agents and the people responsible for what lands.",
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
 * work, but the current branch has no config. `setup begin` owns the bounded
 * checkout-and-reprint continuation and recognizes the existing scaffold. */
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
        "Agents: resume through discern's bounded continuation; it preserves the",
        "dedicated branch and does not replay completed scaffold writes:",
      ],
    },
    {
      id: "resume-commands",
      items: [
        "    discern setup begin --confirmed",
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
  branch: string,
): HumanOutputGroup<string>[] {
  const branchLabel = branch === "" ? "a detached HEAD" : `\`${branch}\``;
  const recovery = branch === SETUP_BRANCH
    ? [
      `Humans: your coding agent is mid-setup on ${branchLabel}. Follow along —`,
      "roll it all back by deleting that branch, then run `discern uninstall` to",
      "sweep out any generated files.",
    ]
    : [
      `Humans: your coding agent is mid-setup on ${branchLabel}. This setup was`,
      "started in place, so there is no separate setup branch to delete. To roll it",
      "back, revert its scaffold commit on this branch, then run `discern uninstall`.",
    ];
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
        ...recovery,
      ],
    },
  ];
}

/**
 * Render derived setup progress as human lines — what doc/instructions authoring is left
 * (files still carrying a marker) and which known jobs are wired or do not apply.
 * Shared shape with `status`, which reads the same {@link SetupProgress}.
 */
export function renderProgressLines(progress: SetupProgress): string[] {
  const lines: string[] = ["Progress so far:"];

  if (progress.pendingMarkers.length === 0) {
    lines.push("  • Map & instructions: all skeletons filled ✓");
  } else {
    lines.push(
      `  • Map & instructions: ${progress.pendingMarkers.length} file(s) still need filling —`,
    );
    for (const f of progress.pendingMarkers) {
      lines.push(`      ${f}`);
    }
  }

  const wired = progress.knownJobs.filter((job) => job.wired).map((job) =>
    job.name
  );
  const notApplicable = progress.knownJobs.filter((job) =>
    job.not_applicable === true
  ).map((job) => job.name);
  const unset = progress.knownJobs.filter((job) =>
    !job.wired && job.not_applicable !== true
  ).map((job) => job.name);
  const wiredPart = wired.length > 0 ? wired.join(", ") : "none yet";
  const notApplicablePart = notApplicable.length > 0
    ? ` · does not apply: ${notApplicable.join(", ")}`
    : "";
  const unsetPart = unset.length > 0 ? ` · unset: ${unset.join(", ")}` : "";
  lines.push(
    `  • known jobs wired: ${wiredPart}${notApplicablePart}${unsetPart}`,
  );
  lines.push(
    `  • applicable protections: ${progress.assurance.enforced} of ${progress.assurance.total} enforced · ${
      notApplicableCountLabel(progress.assurance.not_applicable)
    }`,
  );

  return lines;
}
