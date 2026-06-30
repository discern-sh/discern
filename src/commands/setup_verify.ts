/**
 * `discern setup verify` — the read-only PREFLIGHT phase of the staged handshake
 * (ADR 0075). It writes nothing; it inspects the repo and turns the result into the
 * consent conversation the agent walks its human through before `begin`.
 *
 * Grounded, not generic: it reports THIS repo's git state, an existing `docs/` tree, a
 * pre-existing agent-instructions file `begin` will fold into `guidance.md`, the agents
 * detected on PATH (ADR 0069), and the exact sibling path the worktrees will use
 * (ADR 0052) — then hands the agent the consent conversation to hold with the human
 * (model + fresh session, worktree location, readiness for the branch checkout) as a
 * `guidance` prose lane it relays VERBATIM, and points at `begin`. The consent prose is
 * kept out of structured fields on purpose: agents summarize and weaken the same
 * instructions when they arrive as JSON data, so the warm prose is the load-bearing
 * lane and the human render and `--json` carry it identically (ADR 0078, the two-lane
 * rule). The read-only→destructive boundary is exactly `verify | begin`: every finding
 * here is an observation, never a refusal — `begin` is where the dirty-tree check and
 * the branch checkout happen.
 */

import { basename, dirname, join } from "@std/path";
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
import { setupPhaseOf } from "../shared/setup_state.ts";

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
      log.result({ ok: true, verb: "setup:verify", data: redirect });
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
  const docsExists = await pathExists(join(destDir, "docs"));
  const existingInstructions = await findExistingInstructions(destDir);
  // No config yet (fresh), so the worktree location is the default sibling discern
  // would compute: `<repo>.worktrees` beside the checkout (ADR 0052).
  const worktreePath = join(
    dirname(destDir),
    `${basename(destDir)}.worktrees`,
  );

  const conflicts = buildConflicts(git, docsExists, existingInstructions);
  // The consent conversation as ONE warm prose lane, built once and rendered
  // identically on both surfaces — never split into structured fields, which agents
  // summarize and weaken (ADR 0078). The human render leads with it; `--json` carries
  // it verbatim under `guidance`.
  const guidance = buildConsentGuidance(worktreePath);

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
        docs: { exists: docsExists },
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
      next_action: 'discern setup begin --model "<your-model-id>"',
    };
    log.result({ ok: true, verb: "setup:verify", data });
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
        "Uncommitted changes to tracked files — begin will ask you to commit or stash first (or pass --allow-dirty to set up on the current branch as-is).",
    });
  }
  if (docsExists) {
    conflicts.push({
      kind: "existing_docs",
      detail:
        "You already have a docs/ tree. discern's docs describe what's inferable from the code — conceptually distinct from docs you've hand-curated. begin won't touch yours; discuss whether to keep both side by side or nest discern's under docs/discern/.",
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

/**
 * The consent conversation as ONE warm prose block the agent relays VERBATIM — the
 * load-bearing prose lane (ADR 0078). It opens with the agent's identity and where it
 * is in the handshake (so a no-context agent drives the conversation rather than
 * relaying it back), then the open-warmly framing, then the three things to settle with
 * the human: the model question (put verbatim, the agent's to escalate not self-assess),
 * the worktree location (KEEP or RELOCATE only — turning worktrees off is not surfaced,
 * ADR 0075), and readiness for the branch checkout. Carried identically by the human
 * render and `--json`, so neither surface is the thinner one — the parity A9 restored.
 */
function buildConsentGuidance(worktreePath: string): string {
  return [
    "You are discern's configuration engine, mid-handshake: `verify` has previewed the plan; your next action is to hold this consent conversation with your human, then run `begin`. Drive it — don't relay this back and stop.",
    "",
    "Open warmly and explain what discern is (they may be meeting it for the first time): a quality gate, isolated git worktrees, and shared agent instructions, tailored to their codebase by you. Then settle these three together — a conversation, not a checklist to summarise back:",
    "",
    "1. Model & session — this is the project's single highest-leverage moment, and its quality is bounded by the model that runs it. Put the question to your human rather than self-assessing, verbatim:",
    '   "Am I your most capable model? Everything I configure here is inherited by every future session."',
    "   If they switch you, return to a FRESH session on the stronger model (discern's tools and session hooks load only at session start). When you run `begin`, pass `--model \"<your-model-id>\"` if you know your model identifier — it records which model configured the project for support triage; if you don't know it, omit `--model` rather than guessing.",
    "",
    `2. Worktree location — discern keeps each task in its own linked git worktree, placed beside this repo at ${worktreePath} (never nested inside it, which would confuse git and tooling). Keep that, or relocate it with \`[worktree].root\`?`,
    "",
    "3. Ready to begin — `discern setup begin` checks out a dedicated `discern-setup` branch and scaffolds the harness, landing everything there in small, revertible commits. Confirm your human is ready, then run it.",
  ].join("\n");
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

  lines.push(
    "",
    RULE,
    "",
    p.guidance,
    "",
    RULE,
    "When your human has confirmed, run:",
    "",
    '    discern setup begin --model "<your-model-id>"',
    "    (substitute your model id if you know it; omit --model otherwise — it is",
    "     recorded for support triage, never required)",
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
