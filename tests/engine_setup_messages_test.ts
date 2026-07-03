/**
 * Unit coverage for the ready-to-relay setup messages (`src/shared/setup_messages.ts`,
 * ADR 0086). The CLI parity tests (engine_setup_welcome_test.ts) prove the human render
 * and `--json` carry the identical string; these prove the builders themselves — every
 * branch of the consent and completion blocks, deterministically, from constructed
 * inputs — so a wording or structure regression in any branch fails here, not just in
 * the branch a fixture happens to hit.
 */

import { assert, assertStringIncludes } from "@std/assert";
import {
  completionMessage,
  confirmedBeginCommand,
  consentMessage,
} from "../src/shared/setup_messages.ts";
import type { SetupAssurance } from "../src/shared/setup_assurance.ts";

const WT = "/repo.worktrees";

// ── consentMessage ───────────────────────────────────────────────────────────

Deno.test("consentMessage carries the relay licence, the verbatim model question, the three pillars, the cost, and the worktree path", () => {
  const msg = consentMessage({ worktreePath: WT, docsExists: false });
  // The adaptive relay licence — the whole point of the script-not-stage-directions
  // genre (ADR 0086): reword allowed, dropping a point not.
  assertStringIncludes(
    msg,
    "adapt the wording to your own voice if you like, but keep every point",
  );
  // The verbatim carve-out: quoted text is exempt from the adapt licence. A cold run
  // showed the bare licence licenses trimming the question's second sentence.
  assertStringIncludes(
    msg,
    "relay anything in quotation marks word for word",
  );
  // The model question, verbatim, inside quotation marks with the word-for-word cue.
  assertStringIncludes(
    msg,
    'Ask them this, word for word: "Am I your most capable model? Everything I configure here is inherited by every future session."',
  );
  // The three plain-word pillars, jargon glossed once.
  assertStringIncludes(
    msg,
    "quality checks — your formatter, linter, and tests",
  );
  assertStringIncludes(msg, "isolated working copies (git worktrees)");
  assertStringIncludes(msg, "shared project instructions");
  // The honest time+token expectation and the safety frame.
  assertStringIncludes(msg, "20–40 minutes");
  assertStringIncludes(msg, "discern-setup");
  assertStringIncludes(msg, "no API key");
  // The exact worktree path, and the confirmed command with no --docs.
  assertStringIncludes(msg, WT);
  assertStringIncludes(msg, "--confirmed");
  assert(!msg.includes("--docs"), "no docs tree → no --docs in the command");
});

Deno.test("consentMessage adds the docs-home ask and --docs only when a docs tree exists", () => {
  const withDocs = consentMessage({ worktreePath: WT, docsExists: true });
  assertStringIncludes(withDocs, "You already have a docs/ folder");
  assertStringIncludes(withDocs, "docs/discern/");
  assertStringIncludes(withDocs, "--docs");

  const noDocs = consentMessage({ worktreePath: WT, docsExists: false });
  assert(!noDocs.includes("You already have a docs/ folder"));
});

Deno.test("consentMessage keeps the message body concise (≤ ~200 words of prose)", () => {
  // The message the human reads sits between the two fences; the framing line and the
  // command ride outside it. Keep it short enough to survive a single read — the base
  // case at the ~200-word target, the docs case adding only its one extra confirmation.
  const wordsOf = (docsExists: boolean): number => {
    const body = consentMessage({ worktreePath: WT, docsExists })
      .split("message to your human")[1]?.split("end of message")[0] ?? "";
    return body.trim().split(/\s+/).filter(Boolean).length;
  };
  const base = wordsOf(false);
  assert(base > 0 && base <= 210, `base message body was ${base} words`);
  assert(wordsOf(true) <= 240, `docs message body was ${wordsOf(true)} words`);
});

// ── confirmedBeginCommand ────────────────────────────────────────────────────

Deno.test("confirmedBeginCommand always carries --confirmed, and --docs only with a docs tree", () => {
  assertStringIncludes(confirmedBeginCommand(false), "--confirmed");
  assert(!confirmedBeginCommand(false).includes("--docs"));
  assertStringIncludes(confirmedBeginCommand(true), "--confirmed");
  assertStringIncludes(confirmedBeginCommand(true), "--docs");
});

// ── completionMessage ────────────────────────────────────────────────────────

/** Build a {@link SetupAssurance} at a chosen verdict for the coverage-line branches. */
function assurance(verdict: SetupAssurance["verdict"]): SetupAssurance {
  const caps = [
    "format",
    "lint",
    "typecheck",
    "test",
    "build",
    "smoke",
  ] as const;
  const enforcedCount = verdict === "full" ? 6 : verdict === "partial" ? 2 : 0;
  return {
    capabilities: caps.map((name, i) => ({
      name,
      state: i < enforcedCount ? "enforced" : "absent",
    })),
    enforced: enforcedCount,
    total: 6,
    verdict,
  };
}

const READY_REACTIVATION = {
  summary: "…",
  per_agent: [{ label: "Claude Code", step: "start a new session" }],
};

Deno.test("completionMessage renders honest coverage for each verdict", () => {
  const landing = {
    inRepo: false,
    branch: "",
    target: "main",
    onTarget: false,
  };
  const full = completionMessage({
    assurance: assurance("full"),
    landing,
    reactivation: READY_REACTIVATION,
  });
  assertStringIncludes(full, "all run on every change");

  const partial = completionMessage({
    assurance: assurance("partial"),
    landing,
    reactivation: READY_REACTIVATION,
  });
  assertStringIncludes(partial, "2 of 6 are wired");
  assertStringIncludes(
    partial,
    "Not running yet: typecheck, test, build, smoke",
  );

  const minimal = completionMessage({
    assurance: assurance("minimal"),
    landing,
    reactivation: READY_REACTIVATION,
  });
  assertStringIncludes(minimal, "No quality checks are wired yet");
});

Deno.test("completionMessage adapts the landing recommendation to where the work lives", () => {
  const ctx = (
    landing: {
      inRepo: boolean;
      branch: string;
      target: string;
      onTarget: boolean;
    },
  ) =>
    completionMessage({
      assurance: assurance("minimal"),
      landing,
      reactivation: READY_REACTIVATION,
    });

  assertStringIncludes(
    ctx({ inRepo: false, branch: "", target: "main", onTarget: false }),
    "isn't a git repository",
  );
  assertStringIncludes(
    ctx({ inRepo: true, branch: "main", target: "main", onTarget: true }),
    "already lives on `main`",
  );
  assertStringIncludes(
    ctx({ inRepo: true, branch: "feature", target: "main", onTarget: false }),
    "discern setup land",
  );
  // Detached HEAD (no current branch) still names how to land it.
  assertStringIncludes(
    ctx({ inRepo: true, branch: "", target: "main", onTarget: false }),
    "Check that branch out",
  );
});

Deno.test("completionMessage omits the reactivation step when nothing wired at session start", () => {
  const landing = {
    inRepo: false,
    branch: "",
    target: "main",
    onTarget: false,
  };
  const withAgents = completionMessage({
    assurance: assurance("full"),
    landing,
    reactivation: READY_REACTIVATION,
  });
  assertStringIncludes(withAgents, "start a fresh session");
  // Reactivation rides the headline, BEFORE the bullets: cold runs show a courier
  // agent keeps the opening sentence and prunes middle bullets, and the fresh-session
  // step is the one instruction a novice cannot recover on their own.
  assert(
    withAgents.indexOf("start a fresh session") <
      withAgents.indexOf("all run on every change"),
    "the reactivation step must precede the coverage bullet",
  );

  const noAgents = completionMessage({
    assurance: assurance("full"),
    landing,
    reactivation: { summary: "", per_agent: [] },
  });
  assert(
    !noAgents.includes("start a fresh session"),
    "an agent that wired nothing at session start is never told to restart",
  );
});
