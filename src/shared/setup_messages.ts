/**
 * Setup's **ready-to-relay human messages** — the pre-composed, first-person "message
 * to your human" blocks discern serves at each human touchpoint of the staged
 * handshake, so a courier agent that only relays discern's words still delivers a
 * complete, warm, accurate first experience.
 *
 * The genre is deliberate (ADR 0086): discern ships the *script* — the message itself —
 * and asks the agent only to relay it, rather than *stage directions* (instructions
 * ABOUT the message, like "open warmly and explain what discern is"). A terse agent
 * compresses stage directions into a checklist while following every command faithfully;
 * composing warmth from instructions is the transformation that degrades under
 * final-answer compression, so the message is authored here, not delegated. The relay
 * licence is adaptive, not verbatim-or-else: reword into your own voice, but keep every
 * point — with one carve-out, that quoted text is relayed word for word (cold runs
 * show the licence otherwise licenses trimming the model question's second sentence).
 * Structure is load-bearing too: courier agents keep opening sentences and short list
 * items and prune inter-list prose and middle bullets, so every must-survive fact gets
 * its own list item (or the headline), one thought apiece.
 *
 * Each builder returns ONE plain prose string carried verbatim on every surface (the
 * human render, the `--json` `guidance` field, the `awaiting_consent` refusal). It is
 * never decomposed into structured fields — ADR 0078's two-lane finding is that
 * field-ized behavioral instructions get summarized and weakened; only prose is
 * followed. The novice-calibrated vocabulary ("isolated working copies (git
 * worktrees)", "quality checks — your formatter, linter, and tests") lives ONLY inside
 * these relay blocks; agent-facing text keeps discern's precise terms.
 */

import { basename, dirname, join } from "@std/path";
import type { SetupAssurance } from "./setup_assurance.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";
import { runGit } from "./subprocess.ts";

/** The conventional home of a project's own documentation, probed so the consent
 * message can reassure that discern never touches it — the map is a separate,
 * agent-maintained artifact with its own home (ADR 0100, ADR 0131). */
const HUMAN_DOCS_REL = "docs/";

/** The agent set the consent conversation puts to the human: which coding tools
 * `begin` will wire, each as its display label plus the registry name `--agents`
 * accepts, and whether the set was detected as installed or fell back to the
 * defaults. Declared here — the bottom layer — and produced by the feature
 * layer's installation detection (`src/lib/detect_agents.ts`), mirroring how
 * {@link CompletionLanding} keeps this module from importing upward. */
export interface ConsentAgentSet {
  /** The set `begin` will wire, in registry order. */
  wired: ReadonlyArray<{ label: string; name: string }>;
  /** True when installation evidence was found; false for the default set. */
  detected: boolean;
}

/** The repo facts a consent message is grounded in — the exact sibling worktree
 * path that will be created (ADR 0052), whether the project has a `docs/` folder of
 * its own (so the message reassures it stays untouched — the map is discern's own
 * separate tree, never pointed at human docs; ADR 0100, ADR 0131), whether
 * the directory is a git work tree at all (so no surface promises the isolated
 * `discern-setup` branch, the undo story, or worktrees where git can't deliver
 * them — the non-git plan is `git init` first), and the agent set `begin` will
 * wire (a consent point of its own, with `--agents` as the mechanism). */
export interface ConsentContext {
  worktreePath: string;
  docsExists: boolean;
  gitRepo: boolean;
  agents: ConsentAgentSet;
}

/**
 * Derive a project's {@link ConsentContext} from its setup directory — the single home
 * for this computation, shared by `verify` (which previews it) and `begin` (which
 * re-serves it in the `awaiting_consent` refusal), so the two can never drift. The
 * worktree location is the default sibling discern computes on a fresh install:
 * `<repo>.worktrees` beside the checkout (no config exists yet to relocate it).
 * The agent set arrives from the caller (installation detection lives in the
 * feature layer, which this bottom module never imports).
 */
export async function deriveConsentContext(
  destDir: string,
  agents: ConsentAgentSet,
): Promise<ConsentContext> {
  const docsExists = await pathExists(join(destDir, HUMAN_DOCS_REL));
  const worktreePath = join(dirname(destDir), `${basename(destDir)}.worktrees`);
  const gitRepo =
    (await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: destDir }))
      .success;
  return { worktreePath, docsExists, gitRepo, agents };
}

/**
 * The exact `begin` command a fresh, non-declarative setup runs AFTER the consent
 * conversation — always carrying `--confirmed` (the attestation). The single source
 * for this string, shared by {@link consentMessage}, `verify`'s `next_action`, and
 * `begin`'s `awaiting_consent` refusal, so the three never drift. It never carries
 * a `--map` flag: the map's home is a default, and a placeholder here would push
 * agents to pass one.
 */
export function confirmedBeginCommand(): string {
  return 'discern setup begin --model "<your-model-id>" --confirmed';
}

/**
 * The opening phrase of the human OFF-RAMP — the one-line handoff an
 * agent-addressed setup surface prints for a human who ran it by hand. The
 * audience guard (`tests/engine_setup_handoff_test.ts`) matches this phrase on
 * every surface `SETUP_HUMAN_AUDIENCES` classifies, so keep renders on
 * {@link humanOffRampLines} rather than re-wording it locally.
 */
export const OFF_RAMP_PROMPT = "Reading this as a human?";

/**
 * The off-ramp parenthetical, pre-wrapped so every surface prints identical
 * lines (a banner may indent them). `discern setup` is the right paste at any
 * phase: the welcome routes fresh installs to the funnel and abandoned ones to
 * the resume, so the line never goes stale mid-setup.
 */
export function humanOffRampLines(): readonly string[] {
  return [
    `(${OFF_RAMP_PROMPT} Paste "Run \`discern setup\`" into your`,
    "coding agent — it takes it from here. Everything below is addressed",
    "to that agent.)",
  ];
}

/** A labelled rule that fences the relayable message off from the agent-facing framing
 * and command around it, so a courier agent can see exactly what to paste. */
function fence(label: string): string {
  const dashes = "─".repeat(Math.max(4, 68 - label.length));
  return `─── ${label} ${dashes}`;
}

/**
 * The pre-`begin` consent block `verify` serves and a flag-less fresh `begin` re-serves.
 * ONE prose string: (a) a framing line to the agent carrying the adaptive relay licence;
 * (b) the message itself — first-person agent voice, kept short enough to survive a
 * single read — the three-pillar explainer (with a reassurance bullet when the project
 * has its own `docs/`: it stays untouched, the map lives separately — ADR 0131), the
 * roadmap with an honest time-and-tokens expectation and the safety frame, then the
 * numbered confirmations (the model question verbatim, the git-init consent when the
 * directory has no git (`gitRepo` false), the exact worktree location,
 * ready-to-begin); (c) the exact next command including `--confirmed`. The command
 * rides OUTSIDE the fenced message — it is the agent's to run, not the human's to
 * read. Every promise is conditioned on the git state: without git there is no
 * `discern-setup` branch or main-branch story to promise, so the plan leads with
 * `git init` and the next action is to initialize git and re-run the preflight.
 */
export function consentMessage(ctx: ConsentContext): string {
  const { worktreePath, docsExists, gitRepo, agents } = ctx;

  const confirmations: string[] = [
    '1. Ask them this, word for word: "Am I your most capable model? Everything I configure here is inherited by every future session."',
  ];
  let n = 2;
  if (!gitRepo) {
    confirmations.push(
      `${n}. This folder isn't under version control yet, so my first step will be \`git init\` — everything above (the safety net, the working copies) needs it. OK to initialize git here?`,
    );
    n += 1;
  }
  // The agent set is a consent point, not a silent default: the human hears which
  // of their tools get wired and can trim or extend the set before anything is
  // written (`--agents` is the mechanism, named for the agent below the fence).
  const agentLabels = agents.wired.map((a) => a.label).join(", ");
  confirmations.push(
    agents.detected
      ? `${n}. I found ${agentLabels} on this machine — I'll wire discern into ${
        agents.wired.length > 1 ? "each of them" : "it"
      }; say the word to skip or add one.`
      : `${n}. I didn't spot a specific coding tool here, so I'll wire discern's default set: ${agentLabels} — say the word to change it.`,
  );
  n += 1;
  confirmations.push(
    `${n}. Isolated working copies will live beside this project at ${worktreePath} — keep that location?`,
  );
  n += 1;
  confirmations.push(
    `${n}. Ready for me to begin? Expect roughly 20–40 minutes and a meaningful number of tokens.`,
  );

  const command = confirmedBeginCommand();

  const plan = gitRepo
    ? "The plan: I'll study the repo, come back with one short batch of questions, author the project's map and guidance, wire up the quality checks, and prove it green."
    : "The plan: I'll initialize git first (`git init` — the safety net below needs it), then study the project, come back with one short batch of questions, author the project's map and guidance, wire up the quality checks, and prove it green.";
  const safety = gitRepo
    ? "It's safe and reversible: I work on a dedicated `discern-setup` branch, so nothing touches your main branch until you merge, you can undo it all by deleting that branch (or later with `discern uninstall`), and there's no API key or outside service."
    : "It's safe and reversible: once git is initialized I work on a dedicated `discern-setup` branch, you can undo it all by deleting that branch (or later with `discern uninstall`), and there's no API key or outside service.";

  return [
    "Relay the message below to your human as your next chat message — adapt the wording to your own voice if you like, but keep every point, and relay anything in quotation marks word for word. Then wait for their answers.",
    "",
    fence("message to your human"),
    "",
    "I'd like to set up discern on this project — a one-time step that adds three things:",
    "",
    "  • quality checks — your formatter, linter, and tests, run on every change to catch mistakes before they ship;",
    "  • isolated working copies (git worktrees) — each task gets its own copy, so parallel work never collides;",
    "  • shared project instructions — one place that tells every coding session how this project works; the agent files are committed, so cloud sessions read them too.",
    "",
    `  • discern owns one root file (\`discern.toml\`), one visible \`discern/\` folder — a deferred-work ledger and those shared instructions — and a map of your codebase at \`${SOURCE_PATHS.map.defaultPath}\`: an agent-maintained account of how the codebase fits together, kept current for your audit. It updates the files your coding tools require, committed for review.`,
    ...(docsExists
      ? [
        "",
        "  • You already have a docs/ folder — it's yours, and discern won't touch it. The map is discern's own separate tree; your documentation stays where it is.",
      ]
      : []),
    "",
    plan,
    "",
    safety,
    "",
    "A few things to confirm before I begin:",
    "",
    ...confirmations,
    "",
    fence("end of message"),
    "",
    gitRepo
      ? "Once they've answered, run this — substitute your own model id, or drop `--model` if you don't know it (it is recorded only for support triage):"
      : "Once they've answered: initialize git (`git init`), re-run `discern setup verify` to confirm the plan against the new repository, then run this — substitute your own model id, or drop `--model` if you don't know it (it is recorded only for support triage):",
    "",
    `    ${command}`,
    "",
    // The REAL effective set, never a placeholder — copied verbatim it wires
    // exactly what would have been wired anyway, so the example can't mislead.
    `If they asked to skip or add a tool, pass the exact set to wire: \`--agents ${
      agents.wired.map((a) => a.name).join(",")
    }\` (edit that list).`,
  ].join("\n");
}

/** The minimal landing shape {@link completionMessage} reads — structurally satisfied
 * by `setup_accept.ts`'s `LandingSummary`, declared here so this bottom-layer module never
 * imports up into `commands`. */
export interface CompletionLanding {
  inRepo: boolean;
  branch: string;
  target: string;
  onTarget: boolean;
  /** True only on the dedicated `discern-setup` branch — the ONE branch
   * `discern setup accept` lands; any other branch is steered to a manual merge. */
  onSetupBranch: boolean;
}

/** The minimal reactivation shape — structurally satisfied by `reactivationHandoff()`'s
 * return (`src/lib/providers.ts`), declared here for the same layering reason. */
export interface CompletionReactivation {
  summary: string;
  per_agent: ReadonlyArray<{ label: string; step: string }>;
}

/** The pieces `setup done` has already computed, from which the closing relay block is
 * composed — never recomputed here (single source of truth). */
export interface CompletionContext {
  assurance: SetupAssurance;
  landing: CompletionLanding;
  reactivation: CompletionReactivation;
}

/** Plain-word, honest coverage line for the completion message — what is actually
 * running now, calibrated for a novice rather than the agent-facing verdict sentence. */
function coverageLine(a: SetupAssurance): string {
  switch (a.verdict) {
    case "full":
      return "Quality checks — your formatter, linter, and tests — all run on every change now.";
    case "minimal":
      return "No quality checks are wired yet, so nothing is caught automatically. Wiring your tests is the highest-value thing to add next.";
    case "partial": {
      const notRunning = a.known_jobs
        .filter((c) => c.state !== "enforced")
        .map((c) => c.name);
      const tail = notRunning.length > 0
        ? ` Not running yet: ${notRunning.join(", ")}.`
        : "";
      return `Quality checks: ${a.enforced} of ${a.total} are wired and running.${tail}`;
    }
  }
}

/** Plain-word landing recommendation for the completion message, adapted to where the
 * finished work actually lives (mirrors the cases `setup_accept.ts` distinguishes). */
function landingLine(l: CompletionLanding): string {
  if (!l.inRepo) {
    return "This project isn't a git repository, so there's nothing to land — your setup is in place as it is.";
  }
  if (l.onTarget) {
    return `Your setup already lives on \`${l.target}\`, so there's nothing to land.`;
  }
  if (l.branch === "") {
    return `Your setup is on the \`discern-setup\` branch. Check that branch out, then land it onto \`${l.target}\` with \`discern setup accept\`.`;
  }
  if (!l.onSetupBranch) {
    // `setup accept` lands only the dedicated setup branch — recommending it for
    // the user's own branch would sweep that branch's commits onto the trunk.
    return `Your setup is on the \`${l.branch}\` branch, not yet on \`${l.target}\`. Merge it in your usual way when you're ready — nothing is lost meanwhile.`;
  }
  return `Your setup is on the \`${l.branch}\` branch, not yet on \`${l.target}\`. I'd recommend landing it now with \`discern setup accept\` — or leave the branch as it is to review first; nothing is lost either way.`;
}

/**
 * The closing relay block `setup done` serves — ONE prose string mirroring
 * {@link consentMessage}'s shape: a framing line with the relay licence, then the
 * first-person message covering what the project now has (honest coverage), the
 * contained footprint (the root `discern.toml` plus the `discern/` folder — the
 * namespace story the consent message opened with, closed honestly), the
 * reactivation step (a fresh session, so discern's tools and hooks load), and the
 * landing recommendation. Composed from the already-computed {@link CompletionContext}
 * pieces — never recomputed.
 */
export function completionMessage(ctx: CompletionContext): string {
  const { assurance, reactivation, landing } = ctx;
  // Reactivation rides the HEADLINE, not a bullet: cold runs show a courier agent
  // keeps a message's opening sentence and prunes middle bullets, and the
  // fresh-session step is the one instruction a novice cannot recover on their own.
  // It is also genuinely derived: an agent that wired nothing loading at session
  // start has an empty `per_agent`, so there is nothing to switch on and we never
  // tell the human to restart for nothing.
  const headline = reactivation.per_agent.length > 0
    ? "discern is set up — your project is configured and the quality gate is green. One step remains to switch it on: discern's tools and automations load when a coding session starts, so start a fresh session to pick them up."
    : "discern is set up — your project is configured and the quality gate is green.";
  return [
    "Relay the message below to your human — adapt the wording to your own voice if you like, but keep every point.",
    "",
    fence("message to your human"),
    "",
    headline,
    "",
    ...reactivation.per_agent.map((agent) =>
      `  • ${agent.label}: ${agent.step}`
    ),
    `  • ${coverageLine(assurance)}`,
    "  • Everything discern added is contained: `discern.toml` at the root and the `discern/` folder, plus the files your coding tools require — plain files you can read and audit any time. If you ever change your mind, `discern uninstall` takes the wiring back out and leaves your own content in place.",
    `  • ${landingLine(landing)}`,
    "",
    fence("end of message"),
  ].join("\n");
}

/** True when a path exists (any type, symlinks not followed) — the same probe `verify`
 * and `begin` use, kept local so this module has no upward dependency. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}
