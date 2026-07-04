/**
 * `discern setup verify` — the read-only PREFLIGHT phase of the staged handshake
 * (ADR 0075). It writes nothing; it inspects the repo and turns the result into the
 * consent conversation the agent walks its human through before `begin`.
 *
 * Grounded, not generic: it reports THIS repo's git state, an existing `docs/` tree, a
 * pre-existing agent-instructions file `begin` will fold into `guidance.md`, the agents
 * detected on PATH (ADR 0069), and the exact sibling path the worktrees will use
 * (ADR 0052) — then serves the agent a ready-to-relay `guidance` block (the pre-composed
 * "message to your human": what discern adds, what it will do and cost, the model
 * question, the docs home, the worktree location) it relays and then runs `begin`. The
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
import {
  detectAgentsOnPath,
  resolveDefaultAgents,
} from "../lib/detect_agents.ts";
import { providerFor } from "../lib/providers.ts";
import {
  AGENT_NAMES,
  type DiscernConfig,
  loadConfig,
} from "../shared/config_schema.ts";
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
import { setupPhaseOf } from "../shared/setup_state.ts";

/** Options for the read-only preflight (just the global flags — it takes no input). */
export interface VerifyOptions {
  json: boolean;
  noColor: boolean;
}

const SUGGESTED_DOCS_DIR = "docs/discern/";
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
  const destDir = Deno.cwd();
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

  // --- Gather the grounded findings (all read-only) ---
  const git = await worktreeState(destDir);
  const detected = await detectAgentsOnPath();
  const effectiveAgents = detected.length > 0
    ? detected
    : await resolveDefaultAgents();
  // The two grounded facts the consent message is built from — the exact sibling
  // worktree path and whether a docs/ tree already exists — derived once in the shared
  // module so `begin`'s `awaiting_consent` refusal re-serves the identical message.
  const { worktreePath, docsExists } = await deriveConsentContext(destDir);
  const existingInstructions = await findExistingInstructions(destDir);

  const conflicts = buildConflicts(git, docsExists, existingInstructions);
  // The consent conversation as ONE ready-to-relay prose block, built once and rendered
  // identically on both surfaces — never split into structured fields, which agents
  // summarize and weaken (ADR 0078). discern ships the script, not stage directions
  // (ADR 0086). The human render leads with it; `--json` carries it verbatim under
  // `guidance`; a flag-less fresh `begin` re-serves the same string.
  const guidance = consentMessage({ worktreePath, docsExists });
  const nextAction = confirmedBeginCommand(docsExists);

  if (opts.json) {
    const data: SetupVerifyData = {
      phase: "fresh",
      ready: git.kind !== "dirty",
      findings: {
        git: {
          repo: git.kind !== "not-a-repo",
          clean: git.kind === "clean",
          uncommitted: git.kind === "dirty" ? git.changes.length : 0,
        },
        docs: {
          exists: docsExists,
          suggested_discern_dir: docsExists ? SUGGESTED_DOCS_DIR : null,
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
 * is lost. Drawn from the provider registry, deduped (several agents share AGENTS.md). */
async function findExistingInstructions(destDir: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const name of AGENT_NAMES) {
    const p = providerFor(name)?.guidanceFile.path;
    if (p !== undefined) {
      paths.add(p);
    }
  }
  const found: string[] = [];
  for (const p of paths) {
    if (await pathExists(join(destDir, p))) {
      found.push(p);
    }
  }
  found.sort();
  return found;
}

/** Build the conflict list from the findings — pre-existing things `begin` works
 * around, each a heads-up for the human, never a blocker. */
function buildConflicts(
  git: Awaited<ReturnType<typeof worktreeState>>,
  docsExists: boolean,
  existingInstructions: string[],
): SetupVerifyConflict[] {
  const conflicts: SetupVerifyConflict[] = [];
  if (git.kind === "not-a-repo") {
    conflicts.push({
      kind: "not_a_repo",
      detail:
        "Not a git repository — begin will set up in place, without the isolated discern-setup branch. Consider `git init` first so setup is easy to roll back.",
    });
  } else if (git.kind === "dirty") {
    conflicts.push({
      kind: "dirty_tree",
      detail:
        "Uncommitted changes to tracked files — begin will ask you to commit or stash first. (Advanced: --allow-dirty sets up on the current branch as-is, skipping the isolated discern-setup branch — for CI or automated setups.)",
    });
  }
  if (docsExists) {
    conflicts.push({
      kind: "existing_docs",
      detail:
        `You already have a docs/ tree. discern's docs describe what's inferable from the code — conceptually distinct from docs you've hand-curated. Choose a separate home such as ${SUGGESTED_DOCS_DIR}, then pass it to begin with --docs so the choice is persisted as [docs].dir.`,
    });
  }
  if (existingInstructions.length > 0) {
    conflicts.push({
      kind: "existing_instructions",
      detail: `Found existing agent instructions (${
        existingInstructions.join(", ")
      }). begin preserves them by folding their content into guidance.md — nothing is lost, and you reconcile any overlap with discern's guidance at the end of setup.`,
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
    ? "existing docs/ tree — begin leaves it untouched (see below)"
    : "no docs/ tree yet — begin will scaffold one";
  const instructions = p.existingInstructions.length > 0
    ? `found ${
      p.existingInstructions.join(", ")
    } — begin preserves it (folded into guidance.md)`
    : "none yet — begin seeds guidance.md";
  const agents = p.detected.length > 0
    ? `detected on PATH: ${p.detected.join(", ")}`
    : `none detected on PATH — begin will default to ${
      p.effectiveAgents.join(", ")
    }`;

  const lines: string[] = [
    "discern setup — preflight (read-only; nothing is written until `begin`)",
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

/** True when a path exists (any type, symlinks not followed). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}
