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
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import type { SetupAssurance } from "../src/shared/setup_assurance.ts";

const WT = "/repo.worktrees";

// ── consentMessage ───────────────────────────────────────────────────────────

Deno.test("consentMessage carries the relay licence, the verbatim model question, the three pillars, the cost, and the worktree path", () => {
  const msg = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
  });
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
  // The footprint story in namespace terms (ADR 0099): one root file, one visible
  // folder (the map glossed for a novice) — scoped to what discern itself OWNS, with
  // the provider config files acknowledged as the user's own tools' integrations.
  // The old blanket containment claim ("nothing else in your repo is touched") was
  // an overclaim — `begin` also writes .mcp.json, agent settings, a gitignore block
  // — and must never return.
  assertStringIncludes(msg, "one root file (`discern.toml`)");
  assertStringIncludes(msg, "one visible `discern/` folder");
  assertStringIncludes(msg, "map of your codebase");
  assertStringIncludes(msg, "the files your coding tools require");
  assert(!msg.includes("Nothing else in your repo is touched"));
  // The undo is NAMED, not alluded to: the branch mid-setup, `discern uninstall` after.
  assertStringIncludes(msg, "discern uninstall");
  // The honest time+token expectation and the safety frame.
  assertStringIncludes(msg, "20–40 minutes");
  assertStringIncludes(msg, "discern-setup");
  assertStringIncludes(msg, "no API key");
  // The exact worktree path, and the confirmed command with no --docs.
  assertStringIncludes(msg, WT);
  assertStringIncludes(msg, "--confirmed");
  assert(!msg.includes("--docs"), "no docs tree → no --docs in the command");
});

Deno.test("consentMessage offers the existing-docs opt-in exactly when a docs tree exists (ADR 0100)", () => {
  const withDocs = consentMessage({
    worktreePath: WT,
    docsExists: true,
    gitRepo: true,
  });
  // The promise, then the default, then the opt-in — a choice, not a workaround.
  assertStringIncludes(withDocs, "discern won't touch it");
  assertStringIncludes(withDocs, SOURCE_PATHS.docs.defaultPath);
  assertStringIncludes(withDocs, "keep them separate (the default)");
  // The --docs flag is the agent's post-conversation instruction, outside the
  // fence — carrying the REAL detected path, never a placeholder to substitute.
  assertStringIncludes(withDocs, "--docs docs/");
  assert(!withDocs.includes("<their-docs-path>"));
  const fenced = withDocs.split("end of message")[0] ?? "";
  assert(
    !fenced.includes("--docs"),
    "the --docs mechanics are agent-facing — never inside the relayed message",
  );

  const noDocs = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
  });
  assert(!noDocs.includes("You already have a docs/ folder"));
  assert(!noDocs.includes("--docs"));
});

Deno.test("consentMessage conditions every isolation promise on git being present", () => {
  const nonGit = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: false,
  });
  // The unconditional branch promise must not survive into a directory where
  // there is no git to deliver it — the plan leads with `git init` instead.
  assert(
    !nonGit.includes(
      "I work on a dedicated `discern-setup` branch, so nothing touches your main branch",
    ),
    "a non-git consent must not promise the isolated branch unconditionally",
  );
  assertStringIncludes(nonGit, "git init");
  assertStringIncludes(nonGit, "OK to initialize git here?");
  assertStringIncludes(
    nonGit,
    "once git is initialized I work on a dedicated `discern-setup` branch",
  );
  // The agent's next step is to initialize git and re-run the preflight — the
  // begin command comes after the repo actually exists.
  assertStringIncludes(
    nonGit,
    "initialize git (`git init`), re-run `discern setup verify`",
  );

  const withGit = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
  });
  assert(!withGit.includes("git init"), "a git repo needs no git-init step");
  assertStringIncludes(
    withGit,
    "I work on a dedicated `discern-setup` branch, so nothing touches your main branch",
  );
});

Deno.test("consentMessage keeps the message body concise (≤ ~265 words of prose)", () => {
  // The message the human reads sits between the two fences; the framing line and the
  // command ride outside it. Keep it short enough to survive a single read — the base
  // case at the ~265-word target (the three pillars, the honest footprint story with
  // the provider files acknowledged, and the named undo), the docs case adding only
  // its one extra confirmation.
  const wordsOf = (docsExists: boolean): number => {
    const body = consentMessage({ worktreePath: WT, docsExists, gitRepo: true })
      .split("message to your human")[1]?.split("end of message")[0] ?? "";
    return body.trim().split(/\s+/).filter(Boolean).length;
  };
  const base = wordsOf(false);
  assert(base > 0 && base <= 270, `base message body was ${base} words`);
  assert(wordsOf(true) <= 330, `docs message body was ${wordsOf(true)} words`);
});

// ── confirmedBeginCommand ────────────────────────────────────────────────────

Deno.test("confirmedBeginCommand carries --confirmed and never a --docs placeholder", () => {
  assertStringIncludes(confirmedBeginCommand(), "--confirmed");
  // The docs opt-in is an addition the consent framing describes; a placeholder in
  // the default command would push every agent to pass one (ADR 0100).
  assert(!confirmedBeginCommand().includes("--docs"));
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
  // The close restates the contained footprint the consent message promised —
  // and names `discern uninstall` as the undo, since the branch-delete story
  // retires once the setup lands.
  assertStringIncludes(full, "Everything discern added is contained");
  assertStringIncludes(full, "`discern/` folder");
  assertStringIncludes(full, "discern uninstall");

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
