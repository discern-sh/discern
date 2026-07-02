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
 * point.
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

/** The two repo facts a consent message is grounded in — the exact sibling worktree
 * path that will be created (ADR 0052) and whether a `docs/` tree already exists (so
 * the message asks where discern's own docs should live). */
export interface ConsentContext {
  worktreePath: string;
  docsExists: boolean;
}

/**
 * Derive a project's {@link ConsentContext} from its setup directory — the single home
 * for this computation, shared by `verify` (which previews it) and `begin` (which
 * re-serves it in the `awaiting_consent` refusal), so the two can never drift. The
 * worktree location is the default sibling discern computes on a fresh install:
 * `<repo>.worktrees` beside the checkout (no config exists yet to relocate it).
 */
export async function deriveConsentContext(
  destDir: string,
): Promise<ConsentContext> {
  const docsExists = await pathExists(join(destDir, "docs"));
  const worktreePath = join(dirname(destDir), `${basename(destDir)}.worktrees`);
  return { worktreePath, docsExists };
}

/** The recommended home for discern's agent-doc tree when the project already has a
 * hand-authored `docs/` (kept in step with `verify`'s findings note). */
const SUGGESTED_DOCS_DIR = "docs/discern/";

/**
 * The exact `begin` command a fresh, non-declarative setup runs AFTER the consent
 * conversation — always carrying `--confirmed` (the attestation) and, when a docs tree
 * already exists, the `--docs` placeholder. The single source for this string, shared by
 * {@link consentMessage}, `verify`'s `next_action`, and `begin`'s `awaiting_consent`
 * refusal, so the three never drift.
 */
export function confirmedBeginCommand(docsExists: boolean): string {
  return docsExists
    ? 'discern setup begin --model "<your-model-id>" --docs "<chosen-docs-dir>" --confirmed'
    : 'discern setup begin --model "<your-model-id>" --confirmed';
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
 * (b) the message itself — first-person agent voice, ≤ ~200 words — the three-pillar
 * explainer, the roadmap with an honest time-and-tokens expectation and the safety
 * frame, then the numbered confirmations (the model question verbatim, the docs home
 * when `docsExists`, the exact worktree location, ready-to-begin); (c) the exact next
 * command including `--confirmed`. The command rides OUTSIDE the fenced message — it is
 * the agent's to run, not the human's to read.
 */
export function consentMessage(ctx: ConsentContext): string {
  const { worktreePath, docsExists } = ctx;

  const confirmations: string[] = [
    "1. Am I your most capable model? Everything I configure here is inherited by every future session.",
  ];
  let n = 2;
  if (docsExists) {
    confirmations.push(
      `${n}. You already have a docs/ folder. discern's docs describe what's inferable from the code — separate from anything you've hand-written — so they belong somewhere of their own. Shall I put them under ${SUGGESTED_DOCS_DIR}?`,
    );
    n += 1;
  }
  confirmations.push(
    `${n}. Isolated working copies will live beside this project at ${worktreePath} — keep that location?`,
  );
  n += 1;
  confirmations.push(`${n}. Ready for me to begin?`);

  const command = confirmedBeginCommand(docsExists);

  return [
    "Relay the message below to your human as your next chat message — adapt the wording to your own voice if you like, but keep every point. Then wait for their answers.",
    "",
    fence("message to your human"),
    "",
    "I'd like to set up discern on this project — a one-time step that gives us three things:",
    "",
    "  • quality checks — your formatter, linter, and tests, run together on every change so mistakes are caught before they ship;",
    "  • isolated working copies (git worktrees) — each task gets its own copy of the project, so parallel work never collides;",
    "  • shared project instructions — one place that tells every future coding session how this project works.",
    "",
    "Here's the plan: I'll study the repo, come back with one short batch of questions, then author the project's docs, principles, and guidance, wire up the quality checks, and prove the whole thing green. Expect roughly 20–40 minutes and a meaningful number of tokens.",
    "",
    "It's safe and reversible: I work on a dedicated `discern-setup` branch — nothing touches your main branch until you choose to merge, you can undo everything by deleting that branch, and there's no API key or outside service.",
    "",
    "A few things to confirm before I begin:",
    "",
    ...confirmations,
    "",
    fence("end of message"),
    "",
    "Once they've answered, run this — substitute your own model id, or drop `--model` if you don't know it (it is recorded only for support triage):",
    "",
    `    ${command}`,
  ].join("\n");
}

/** The minimal landing shape {@link completionMessage} reads — structurally satisfied
 * by `setup_land.ts`'s `LandingSummary`, declared here so this bottom-layer module never
 * imports up into `commands`. */
export interface CompletionLanding {
  inRepo: boolean;
  branch: string;
  target: string;
  onTarget: boolean;
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
      const notRunning = a.capabilities
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
 * finished work actually lives (mirrors the cases `setup_land.ts` distinguishes). */
function landingLine(l: CompletionLanding): string {
  if (!l.inRepo) {
    return "This project isn't a git repository, so there's nothing to land — your setup is in place as it is.";
  }
  if (l.onTarget) {
    return `Your setup already lives on \`${l.target}\`, so there's nothing to land.`;
  }
  if (l.branch === "") {
    return `Your setup is on the \`discern-setup\` branch. Check that branch out, then land it onto \`${l.target}\` with \`discern setup land\`.`;
  }
  return `Your setup is on the \`${l.branch}\` branch, not yet on \`${l.target}\`. I'd recommend landing it now with \`discern setup land\` — or leave the branch as it is to review first; nothing is lost either way.`;
}

/**
 * The closing relay block `setup done` serves — ONE prose string mirroring
 * {@link consentMessage}'s shape: a framing line with the relay licence, then the
 * first-person message covering what the project now has (honest coverage), the
 * reactivation step (a fresh session, so discern's tools and hooks load), and the
 * landing recommendation. Composed from the already-computed {@link CompletionContext}
 * pieces — never recomputed.
 */
export function completionMessage(ctx: CompletionContext): string {
  const { assurance, reactivation, landing } = ctx;
  // The reactivation bullet is genuinely derived: an agent that wired nothing loading
  // at session start has an empty `per_agent`, so there is nothing to switch on and we
  // never tell the human to restart for nothing.
  const reactivationBullet = reactivation.per_agent.length > 0
    ? [
      "  • One more step to switch it on: discern's tools and automations load when a coding session starts, so this session can't use them yet. Start a fresh session to pick them up.",
    ]
    : [];
  return [
    "Relay the message below to your human — adapt the wording to your own voice if you like, but keep every point.",
    "",
    fence("message to your human"),
    "",
    "discern is set up — your project is configured and the quality gate is green.",
    "",
    `  • ${coverageLine(assurance)}`,
    ...reactivationBullet,
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
