/**
 * `discern setup verify` — the read-only PREFLIGHT phase of the staged handshake
 * (ADR 0075). It writes nothing; it inspects the repo and turns the result into the
 * consent conversation the agent walks its human through before `begin`.
 *
 * Grounded, not generic: it reports THIS repo's git state, whether the project has a
 * `docs/` folder of its own (the map lives at its own default home and never touches
 * it — the consent message reassures rather than offers to adopt it; ADR 0100, ADR
 * 0131), each pre-existing agent-instruction file, which `begin` folds into the
 * instruction source unless the coding agent judges another tool maintains it,
 * the agents detected as installed (ADR 0069), any of their
 * integration files the project's own ignore rules exclude or that already hold
 * someone else's content, and the exact sibling
 * path the worktrees will use (ADR 0052) — then serves the agent a ready-to-relay `instructions`
 * block (the pre-composed "message to your human": what discern adds, what it will do
 * and cost, the model question, the worktree location) it relays and
 * then runs `begin`. The
 * message is the script, not stage directions (ADR 0086): a terse courier agent that
 * only relays discern's words still delivers a complete first conversation. It is kept
 * out of structured fields on purpose — agents summarize and weaken the same content
 * when it arrives as JSON data — so the prose is the load-bearing lane and the human
 * render and `--json` carry it identically (ADR 0078, the two-lane rule). The
 * read-only→destructive boundary is exactly `verify | begin`: every finding here is an
 * observation, never a refusal — `begin` is where the dirty-tree check and the branch
 * checkout happen.
 */

import { join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { worktreeState } from "../lib/git.ts";
import { consentAgentSet } from "../lib/detect_agents.ts";
import { allInstructionFilePaths } from "../lib/providers.ts";
import { existingIntegrationFiles } from "../lib/ignored_integration_files.ts";
import { reincludedIntegrationFiles } from "../lib/agent_gitignore.ts";
import { describePaths } from "../shared/ignored_integration.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import { pathExists } from "../shared/fs_presence.ts";
import type {
  SetupVerifyConflict,
  SetupVerifyData,
} from "../shared/result_schemas.ts";
import {
  confirmedBeginCommand,
  consentMessage,
  deriveConsentContext,
  humanOffRampLines,
} from "../shared/setup_messages.ts";
import { resolveSetupRoot } from "./setup.ts";
import { SOURCE_PATHS } from "../shared/paths_registry.ts";
import { runGit } from "../shared/subprocess.ts";
import {
  type HumanOutputGroup,
  renderHumanOutputGroups,
} from "../shared/result.ts";
import {
  SETUP_BRANCH,
  setupBranchExists,
  setupPhaseOf,
} from "../shared/setup_state.ts";

/** Options for the read-only preflight (just the global flags — it takes no input). */
export interface VerifyOptions {
  json: boolean;
  noColor: boolean;
}

/**
 * Run the preflight for the cwd's project. Read-only and always exits 0. For a project
 * that is already set up (or mid-setup) the preflight is moot — `begin` has run or is
 * unnecessary — so it gives a short redirect instead.
 */
export async function runSetupVerify(opts: VerifyOptions): Promise<number> {
  const log = new Logger({
    json: opts.json,
    noColor: opts.noColor,
    humanStream: "stdout",
  });
  const root = await findRoot();
  // The SAME root resolution `begin` uses — a preflight run from a repo
  // subdirectory must preview the tree setup will actually operate on (the
  // repository top-level and ITS sibling worktree path), not the subdirectory's.
  const destDir = await resolveSetupRoot(Deno.cwd());
  let config: DiscernConfig | undefined;
  let bootstrapped = false;
  if (root !== undefined) {
    try {
      config = await loadConfig(root);
      bootstrapped = config.meta.bootstrapped;
    } catch {
      // discern-best-effort: setup-verify-config-fallback
      // Unparseable config — treat as mid-setup; the strict verbs report the error.
    }
  }
  const phase = setupPhaseOf({ hasConfig: root !== undefined, bootstrapped });

  // Preflight is a FRESH-install step. Once begin has run, redirect instead.
  if (phase !== "fresh") {
    const unproven = config?.meta.setup_completion === "unproven";
    const message = unproven
      ? "Setup completion is unproven and cannot be accepted. Resolve the incomplete or red setup, commit the correction, then run `discern setup done` to converge to proven."
      : phase === "done"
      ? "This project is already set up — preflight isn't needed. Run `discern status` to orient."
      : "Setup has already begun here. Run `discern setup begin` to reprint the brief, then continue it and run `discern setup done` to finish.";
    const redirect: SetupVerifyData = {
      phase,
      next_action: unproven
        ? "discern setup done"
        : phase === "done"
        ? "discern status"
        : "discern setup begin",
    };
    if (opts.json) {
      log.result({ ok: true, verb: "setup verify", data: redirect });
    } else {
      log.line(message);
    }
    return 0;
  }

  // No config HERE, but a `discern-setup` branch exists carrying setup's work: an
  // abandoned half-finished setup, not a fresh install. Redirect to the resume —
  // funneling toward `begin` from this branch would re-scaffold over it.
  if (await setupBranchExists(destDir)) {
    const message =
      `Setup has already begun on the \`${SETUP_BRANCH}\` branch, and you are not on it. ` +
      "Resume through `discern setup begin --confirmed`; discern checks out the dedicated branch and reprints the current brief without replaying completed scaffold writes.";
    const redirect: SetupVerifyData = {
      phase: "in_progress",
      next_action: "discern setup begin --confirmed",
    };
    if (opts.json) {
      log.result({ ok: true, verb: "setup verify", data: redirect });
    } else {
      log.line(message);
    }
    return 0;
  }

  // --- Gather the grounded findings (all read-only) ---
  const git = await worktreeState(destDir);
  const identity = await gitIdentityPresent(destDir);
  const agents = await consentAgentSet();
  const detected = agents.detected;
  const effectiveAgents = agents.set.wired.map((a) => a.name);
  // Integration files of that set the project's own rules exclude, which
  // discern's `.gitignore` block will re-include, and those that already hold
  // someone else's content, which setup leaves for the agent to resolve.
  const ignored = await reincludedIntegrationFiles(destDir, effectiveAgents);
  const existing = git.kind === "not-a-repo"
    ? []
    : await existingIntegrationFiles(destDir, effectiveAgents) ?? [];
  // The grounded facts the consent message is built from — the exact sibling
  // worktree path, whether a docs/ folder already exists, whether git is here at
  // all, and the agent set `begin` will wire — derived once in the shared module
  // so `begin`'s `awaiting_consent` refusal re-serves the identical message.
  const {
    worktreePath,
    worktreeEnvFiles,
    inheritedEnvNames,
    docsExists,
    gitRepo,
    projectName,
  } = await deriveConsentContext(
    destDir,
    agents.set,
    ignored,
  );
  const existingInstructions = await findExistingInstructions(destDir);

  const conflicts = buildConflicts(
    git,
    identity,
    existingInstructions,
    existing,
  );
  // The consent conversation as ONE ready-to-relay prose block, built once and rendered
  // identically in every result representation — never split into fields, which agents
  // summarize and weaken (ADR 0078). discern ships the script, not stage directions
  // (ADR 0086). Terminal and Markdown presentations lead with it; the structured
  // result carries it verbatim under `instructions`; a flag-less fresh `begin`
  // re-serves the same string.
  const instructions = consentMessage({
    worktreePath,
    worktreeEnvFiles,
    inheritedEnvNames,
    docsExists,
    gitRepo,
    agents: agents.set,
    projectName,
    ignoredIntegrationFiles: ignored,
  });
  // Without git the funnel's next action is to CREATE the repository setup's
  // isolation needs (then re-run the preflight) — never straight to `begin`,
  // which could only proceed in place, with no branch and nothing to land.
  const nextAction = gitRepo
    ? confirmedBeginCommand(projectName.proposed)
    : "git init";

  if (opts.json) {
    const data: SetupVerifyData = {
      phase: "fresh",
      ready: git.kind === "clean",
      findings: {
        git: {
          repo: git.kind !== "not-a-repo",
          clean: git.kind === "clean",
          uncommitted: git.kind === "dirty" ? git.changes.length : 0,
          identity,
        },
        docs: {
          exists: docsExists,
        },
        existing_instructions: existingInstructions,
        ignored_integration_files: ignored,
        existing_integration_files: existing,
        agents_detected: detected,
        agents_effective: effectiveAgents,
        worktree_path: worktreePath,
        project_identity: {
          proposed_name: projectName.proposed,
          evidence: projectName.evidence.map((item) => ({
            source: item.source,
            location: item.location,
            value: item.value,
          })),
          fallback_only: projectName.fallbackOnly,
          requires_confirmation: true,
        },
      },
      conflicts,
      // The consent conversation rides the prose field the agent relays verbatim,
      // identical in every presentation.
      instructions,
      // Carry the explicit --model choice in the funnel. The agent substitutes its
      // exact self-declared id when known or keeps `unreported`; both are advisory.
      next_action: nextAction,
    };
    log.result({ ok: true, verb: "setup verify", data });
    return 0;
  }

  printPreflight({
    git,
    docsExists,
    existingInstructions,
    detected,
    effectiveAgents,
    worktreePath,
    projectName: projectName.proposed,
    conflicts,
    instructions,
  });
  return 0;
}

/** The agent-instruction files (CLAUDE.md / AGENTS.md / GEMINI.md) present on disk.
 * On a fresh install (no discern.toml) each is the owner's, which `begin` folds into
 * `instructions.md` (ADR 0065), or another tool's, which the agent names with
 * `--tool-maintained` — so naming them lets the agent judge each and reassure the
 * human nothing is lost. Drawn from {@link allInstructionFilePaths} — the SAME registry aggregator
 * `begin`'s migration walks — so the set this preflight promises to preserve can
 * never name a file the migration would skip. */
async function findExistingInstructions(destDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const p of allInstructionFilePaths()) {
    if (await pathExists(join(destDir, p))) {
      found.push(p);
    }
  }
  found.sort();
  return found;
}

/** Build the conflict list from the findings — pre-existing things `begin` works
 * around, each a heads-up for the human, never a blocker. An existing `docs/` tree
 * is NOT one of them: the map's namespace default collides with nothing (ADR 0100),
 * so the docs choice rides the consent message as an opt-in, not a warning. */
function buildConflicts(
  git: Awaited<ReturnType<typeof worktreeState>>,
  identity: boolean,
  existingInstructions: string[],
  existingIntegration: readonly string[],
): SetupVerifyConflict[] {
  const conflicts: SetupVerifyConflict[] = [];
  if (git.kind === "not-a-repo") {
    conflicts.push({
      kind: "not_a_repo",
      detail:
        "Not a git repository — setup starts with `git init` here: the isolated discern-setup branch, the undo story, and the working copies all need it. Run `git init`, then re-run `discern setup verify`.",
    });
  } else if (git.kind === "dirty") {
    conflicts.push({
      kind: "dirty_worktree",
      detail:
        "Uncommitted changes to tracked files — begin will ask you to commit or stash first. (Advanced: --allow-dirty sets up on the current branch as-is, skipping the isolated discern-setup branch — for CI or automated setups.)",
    });
  }
  if (git.kind !== "not-a-repo" && !identity) {
    conflicts.push({
      kind: "missing_git_identity",
      detail:
        "No git identity is configured, so the commits setup makes here will fail or record a guessed author. Set it first: " +
        '`git config user.name "Your Name"` and `git config user.email "you@example.com"` ' +
        "(add --global to set it machine-wide).",
    });
  }
  if (existingInstructions.length > 0) {
    conflicts.push({
      kind: "existing_instructions",
      detail: `Found existing agent instructions (${
        existingInstructions.join(", ")
      }). Read each and judge whether the owner wrote it or another tool maintains it; ask the owner only when the file doesn't settle it. begin folds what the owner wrote into ${SOURCE_PATHS.instructions.defaultPath} — nothing is lost, and you reconcile any overlap with discern's instructions at the end of setup. Pass \`--tool-maintained <file>\` to begin for each file a tool maintains: begin leaves that content out, because importing it would freeze a copy the tool keeps rewriting, and names how to route the tool through an instruction source.`,
    });
  }
  if (existingIntegration.length > 0) {
    conflicts.push({
      kind: "existing_integration_files",
      detail:
        `These integration files already hold entries discern didn't write, which can include personal settings or credentials: ${
          describePaths(existingIntegration)
        }. begin adds discern's entries but leaves them out of its commit. Read each: commit it if the other entries are safe to share, or move the personal ones to the tool's user-level settings first.`,
    });
  }
  return conflicts;
}

const RULE = "─".repeat(72);

/** Render the human preflight as lines, printed in one go (the layout is then easy to
 * edit): the grounded findings, the consent checklist, then the funnel into `begin`. */
function printPreflight(p: {
  git: Awaited<ReturnType<typeof worktreeState>>;
  docsExists: boolean;
  existingInstructions: string[];
  detected: string[];
  effectiveAgents: string[];
  worktreePath: string;
  projectName: string;
  conflicts: SetupVerifyConflict[];
  instructions: string;
}): void {
  const docs = p.docsExists
    ? `you have your own docs/ folder — begin leaves it untouched; discern's map lands separately at ${SOURCE_PATHS.map.defaultPath}`
    : `none of your own — discern's map (its agent-maintained tree) will be scaffolded at ${SOURCE_PATHS.map.defaultPath}`;
  const instructions = p.existingInstructions.length > 0
    ? `found ${
      p.existingInstructions.join(", ")
    } — begin folds what the owner wrote into ${SOURCE_PATHS.instructions.defaultPath}; a file another tool maintains is left out with --tool-maintained`
    : `none yet — begin seeds ${SOURCE_PATHS.instructions.defaultPath}`;
  const agents = p.detected.length > 0
    ? `detected on this machine: ${p.detected.join(", ")}`
    : `none detected on this machine — begin will default to ${
      p.effectiveAgents.join(", ")
    }`;

  const groups: HumanOutputGroup<string>[] = [
    {
      id: "preflight-heading",
      items: [
        "discern setup — preflight (read-only; nothing is written until `begin`)",
      ],
    },
    { id: "audience-off-ramp", items: humanOffRampLines() },
    {
      id: "project-findings",
      items: [
        "What's in this project right now:",
        `  • Git ........... ${gitSummary(p.git)}`,
        `  • Docs .......... ${docs}`,
        `  • Instructions .. ${instructions}`,
        `  • Agents ........ ${agents}`,
        `  • Project name .. proposed as “${p.projectName}” — confirm it in the conversation below`,
        "  • Worktrees ..... will live beside this repo at:",
        `                    ${p.worktreePath}`,
      ],
    },
    {
      id: "conflicts",
      items: p.conflicts.map((conflict) => `  ⚠ ${conflict.detail}`),
    },
  ];

  // The consent block carries its own framing, the fenced message to relay, and the
  // exact next command (including `--confirmed`) — so nothing more is appended here.
  groups.push(
    { id: "consent-divider", items: [RULE] },
    { id: "consent-instructions", items: [p.instructions] },
  );

  new Logger({ json: false, noColor: false }).line(
    renderHumanOutputGroups(groups),
  );
}

/** A one-line git-state summary for the human findings list. */
function gitSummary(git: Awaited<ReturnType<typeof worktreeState>>): string {
  switch (git.kind) {
    case "clean":
      return "clean git repository ✓";
    case "dirty":
      return `git repository with ${git.changes.length} uncommitted change(s) — see below`;
    case "not-a-repo":
      return "not a git repository — see below";
  }
}

/**
 * Whether a git commit identity (user.name AND user.email) resolves here, across
 * every config scope git itself would consult. Without one, every commit setup
 * makes — the machinery commit, the agent's per-stage commits, the completion
 * marker — fails mid-flow; naming it in the preflight (with the exact commands)
 * costs one probe instead of a burned session.
 */
async function gitIdentityPresent(destDir: string): Promise<boolean> {
  const name = (await runGit(["config", "user.name"], { cwd: destDir })).stdout
    .trim();
  const email = (await runGit(["config", "user.email"], { cwd: destDir }))
    .stdout.trim();
  return name !== "" && email !== "";
}
