/**
 * `discern setup verify` — the read-only PREFLIGHT phase of the staged handshake
 * (ADR 0075). It writes nothing; it inspects the repo and turns the result into the
 * consent conversation the agent walks its human through before `begin`.
 *
 * Grounded, not generic: it reports THIS repo's git state, whether the project has a
 * `docs/` tree of its own (the map defaults to its own namespace home and never touches
 * it; pointing `[docs].dir` at existing docs is a deliberate opt-in the consent message
 * offers — ADR 0100), a pre-existing agent-instructions file `begin` will fold into the
 * guidance source, the agents detected on PATH (ADR 0069), and the exact sibling path
 * the worktrees will use (ADR 0052) — then serves the agent a ready-to-relay `guidance`
 * block (the pre-composed "message to your human": what discern adds, what it will do
 * and cost, the model question, the docs opt-in, the worktree location) it relays and
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
import { allGuidanceFilePaths } from "../lib/providers.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import type {
  SetupVerifyConflict,
  SetupVerifyData,
} from "../shared/result_schemas.ts";
import {
  confirmedBeginCommand,
  consentMessage,
  deriveConsentContext,
} from "../shared/setup_messages.ts";
import { resolveSetupRoot } from "./setup.ts";
import { SOURCE_PATHS } from "../shared/paths_registry.ts";
import { runGit } from "../shared/subprocess.ts";
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
      // Unparseable config — treat as mid-setup; the strict verbs report the error.
    }
  }
  const phase = setupPhaseOf({ hasConfig: root !== undefined, bootstrapped });

  // Preflight is a FRESH-install step. Once begin has run, redirect instead.
  if (phase !== "fresh") {
    const message = phase === "done"
      ? "This project is already set up — preflight isn't needed. Run `discern status` to orient."
      : "Setup has already begun here. Continue the brief and run `discern setup done` to finish (or `discern setup begin` to reprint the brief).";
    const redirect: SetupVerifyData = {
      phase,
      next_action: phase === "done" ? "discern status" : "discern setup done",
    };
    if (opts.json) {
      log.result({ ok: true, verb: "setup verify", data: redirect });
    } else {
      console.log(message);
    }
    return 0;
  }

  // No config HERE, but a `discern-setup` branch exists carrying setup's work: an
  // abandoned half-finished setup, not a fresh install. Redirect to the resume —
  // funneling toward `begin` from this branch would re-scaffold over it.
  if (await setupBranchExists(destDir)) {
    const message =
      `Setup has already begun on the \`${SETUP_BRANCH}\` branch, and you are not on it. ` +
      `Check it out (\`git checkout ${SETUP_BRANCH}\`) and continue from there — don't start setup again from this branch.`;
    const redirect: SetupVerifyData = {
      phase: "in_progress",
      next_action: `git checkout ${SETUP_BRANCH}`,
    };
    if (opts.json) {
      log.result({ ok: true, verb: "setup verify", data: redirect });
    } else {
      console.log(message);
    }
    return 0;
  }

  // --- Gather the grounded findings (all read-only) ---
  const git = await worktreeState(destDir);
  const identity = await gitIdentityPresent(destDir);
  const agents = await consentAgentSet();
  const detected = agents.detected;
  const effectiveAgents = agents.set.wired.map((a) => a.name);
  // The grounded facts the consent message is built from — the exact sibling
  // worktree path, whether a docs/ tree already exists, whether git is here at
  // all, and the agent set `begin` will wire — derived once in the shared module
  // so `begin`'s `awaiting_consent` refusal re-serves the identical message.
  const { worktreePath, docsExists, gitRepo } = await deriveConsentContext(
    destDir,
    agents.set,
  );
  const existingInstructions = await findExistingInstructions(destDir);

  const conflicts = buildConflicts(git, identity, existingInstructions);
  // The consent conversation as ONE ready-to-relay prose block, built once and rendered
  // identically on both surfaces — never split into structured fields, which agents
  // summarize and weaken (ADR 0078). discern ships the script, not stage directions
  // (ADR 0086). The human render leads with it; `--json` carries it verbatim under
  // `guidance`; a flag-less fresh `begin` re-serves the same string.
  const guidance = consentMessage({
    worktreePath,
    docsExists,
    gitRepo,
    agents: agents.set,
  });
  // Without git the funnel's next action is to CREATE the repository setup's
  // isolation needs (then re-run the preflight) — never straight to `begin`,
  // which could only proceed in place, with no branch and nothing to land.
  const nextAction = gitRepo
    ? confirmedBeginCommand()
    : "git init && discern setup verify";

  if (opts.json) {
    const data: SetupVerifyData = {
      phase: "fresh",
      ready: git.kind !== "dirty",
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
        agents_detected: detected,
        agents_effective: effectiveAgents,
        worktree_path: worktreePath,
      },
      conflicts,
      // The consent conversation rides the prose lane the agent relays verbatim,
      // identical to the human render — the parity the JSON surface broke before.
      guidance,
      // Carry the --model flag in the funnel so the model that runs setup is recorded
      // as provenance — substitute your own id, or omit it if you don't know it (the
      // engine ignores the placeholder, so a verbatim copy records nothing).
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
    conflicts,
    guidance,
  });
  return 0;
}

/** The agent-instruction files (CLAUDE.md / AGENTS.md / GEMINI.md) present on disk.
 * On a fresh install (no discern.toml) these are the USER's — `begin` folds them into
 * `guidance.md` (ADR 0065) — so naming them lets the agent reassure the human nothing
 * is lost. Drawn from {@link allGuidanceFilePaths} — the SAME registry aggregator
 * `begin`'s migration walks — so the set this preflight promises to preserve can
 * never name a file the migration would skip. */
async function findExistingInstructions(destDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const p of allGuidanceFilePaths()) {
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
      kind: "dirty_tree",
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
      }). begin preserves them by folding their content into ${SOURCE_PATHS.guidance.defaultPath} — nothing is lost, and you reconcile any overlap with discern's guidance at the end of setup.`,
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
  conflicts: SetupVerifyConflict[];
  guidance: string;
}): void {
  const docs = p.docsExists
    ? `you have your own docs/ tree — begin leaves it untouched; discern's map lands at ${SOURCE_PATHS.docs.defaultPath} unless you point [docs].dir at yours (offered below)`
    : `none of your own — discern's map (its agent-maintained docs tree) will be scaffolded at ${SOURCE_PATHS.docs.defaultPath}`;
  const instructions = p.existingInstructions.length > 0
    ? `found ${
      p.existingInstructions.join(", ")
    } — begin preserves it (folded into ${SOURCE_PATHS.guidance.defaultPath})`
    : `none yet — begin seeds ${SOURCE_PATHS.guidance.defaultPath}`;
  const agents = p.detected.length > 0
    ? `detected on PATH: ${p.detected.join(", ")}`
    : `none detected on PATH — begin will default to ${
      p.effectiveAgents.join(", ")
    }`;

  const lines: string[] = [
    "discern setup — preflight (read-only; nothing is written until `begin`)",
    "",
    '(Reading this as a human? Paste "Run `discern setup`" into your coding agent —',
    "it takes it from here. Everything below is addressed to that agent.)",
    "",
    "What's in this project right now:",
    `  • Git ........... ${gitSummary(p.git)}`,
    `  • Docs .......... ${docs}`,
    `  • Instructions .. ${instructions}`,
    `  • Agents ........ ${agents}`,
    "  • Worktrees ..... will live beside this repo at:",
    `                    ${p.worktreePath}`,
  ];

  if (p.conflicts.length > 0) {
    lines.push("");
    for (const c of p.conflicts) {
      lines.push(`  ⚠ ${c.detail}`);
    }
  }

  // The consent block carries its own framing, the fenced message to relay, and the
  // exact next command (including `--confirmed`) — so nothing more is appended here.
  lines.push(
    "",
    RULE,
    "",
    p.guidance,
  );

  console.log(lines.join("\n"));
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

/** True when a path exists (any type, symlinks not followed). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}
