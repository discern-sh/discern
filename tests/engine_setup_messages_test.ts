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
  type CompletionContext,
  completionMessage,
  confirmedBeginCommand,
  consentMessage,
} from "../src/shared/setup_messages.ts";
import { renderFreshWelcome } from "../src/commands/setup_welcome.ts";
import { SETUP_REVERSIBILITY } from "../src/shared/setup_experience.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import type { SetupAssurance } from "../src/shared/setup_assurance.ts";

const WT = "/repo.worktrees";

/** A detected two-agent set for the consent-context constructions. */
const AGENTS = {
  wired: [
    { label: "Claude Code", name: "claude_code" },
    { label: "Cursor", name: "cursor" },
  ],
  detected: true,
};

// ── consentMessage ───────────────────────────────────────────────────────────

Deno.test("consentMessage carries the verbatim-protected confirmations, three pillars, cost, reversibility, and worktree path", () => {
  const msg = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: AGENTS,
  });
  // The adaptive relay licence — the whole point of the script-not-stage-directions
  // genre (ADR 0086): reword allowed, dropping a point not.
  assertStringIncludes(
    msg,
    "as one natural conversation",
  );
  // The verbatim carve-out: quoted text is exempt from the adapt licence. A cold run
  // showed the bare licence licenses trimming the question's second sentence.
  assertStringIncludes(
    msg,
    "form the consent record",
  );
  // The recommendation explains the inherited outcome, gives the concrete switch
  // route, and keeps provenance separate from capability.
  assertStringIncludes(
    msg,
    "Everything I set up here is inherited by future sessions",
  );
  assertStringIncludes(msg, "strongest suitable reasoning model");
  assertStringIncludes(msg, "switch models first");
  assertStringIncludes(msg, "Provenance is advisory");
  assertStringIncludes(msg, "Current provider/model (self-declared)");
  assertStringIncludes(msg, "never copy the placeholder");
  // The three plain-word pillars, jargon glossed once.
  assertStringIncludes(
    msg,
    "Lasting outcome: future sessions inherit",
  );
  assertStringIncludes(msg, "separate task workspaces");
  assertStringIncludes(msg, "maintained project guide");
  // Placement stays consent: the tracked-by-default posture is disclosed — the
  // agent files land committed so out-of-tool sessions can read them.
  assertStringIncludes(msg, "reviewable integration files");
  // The footprint story in namespace terms (ADR 0099): one root file, one visible
  // folder (the map glossed for a novice) — scoped to what discern itself OWNS, with
  // the provider config files acknowledged as the user's own tools' integrations.
  // The old blanket containment claim ("nothing else in your repo is touched") was
  // an overclaim — `begin` also writes .mcp.json, agent settings, a gitignore block
  // — and must never return.
  assertStringIncludes(msg, "one root `discern.toml`");
  assertStringIncludes(msg, "one visible `discern/` folder");
  assertStringIncludes(
    msg,
    "preserve its workflows",
  );
  assertStringIncludes(
    msg,
    "write the maintained project guide and agent instructions",
  );
  assertStringIncludes(
    msg,
    "selected coding tools' reviewable integration files",
  );
  assert(
    !msg.includes("author the project's docs and instructions"),
    "the setup plan must name the map rather than teach docs as its synonym",
  );
  assert(!msg.includes("Nothing else in your repo is touched"));
  // The undo is NAMED, not alluded to: the branch mid-setup, `discern uninstall` after.
  assertStringIncludes(msg, "discern uninstall");
  // The honest time+token expectation and the safety frame.
  assertStringIncludes(msg, "20–40 minutes");
  assertStringIncludes(msg, "setup branch");
  assertStringIncludes(msg, "No API key");
  // The exact worktree path, and the confirmed command with no --map.
  assertStringIncludes(msg, WT);
  assertStringIncludes(msg, "--confirmed");
  assert(!msg.includes("--map"), "the consent surface never mentions --map");
});

Deno.test("consentMessage reassures about existing docs and never offers to adopt them (ADR 0131)", () => {
  const withDocs = consentMessage({
    worktreePath: WT,
    docsExists: true,
    gitRepo: true,
    agents: AGENTS,
  });
  // The reassurance: the human's docs stay theirs; the map is a separate tree
  // with its own named home.
  assertStringIncludes(withDocs, "already has `docs/`");
  assertStringIncludes(withDocs, "does not adopt or overwrite it");
  assertStringIncludes(withDocs, SOURCE_PATHS.map.defaultPath);
  // The retired adoption offer must never return: no question, no --map coda —
  // pointing the map at human-curated docs is not something setup suggests.
  assert(
    !withDocs.includes("--map"),
    "the existing-docs adoption offer must not return",
  );
  assert(!withDocs.includes("point discern at your existing docs"));

  const noDocs = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: AGENTS,
  });
  assert(!noDocs.includes("already has `docs/`"));
  assert(!noDocs.includes("--map"));
});

Deno.test("consentMessage makes the agent set a consent point, with --agents as the mechanism", () => {
  const detected = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: AGENTS,
  });
  // The set is named to the human as a confirmation, not wired silently.
  assertStringIncludes(
    detected,
    "I found Claude Code, Cursor on this machine",
  );
  assertStringIncludes(
    detected,
    "I recommend wiring that detected set",
  );
  assertStringIncludes(detected, "Keep it, or name a different set");
  // The mechanics ride OUTSIDE the fence, agent-facing, with the REAL effective
  // set as the example — copied verbatim it wires exactly what would have been
  // wired anyway, so the example can't mislead.
  assertStringIncludes(detected, "--agents claude_code,cursor");
  const fenced = detected.split("end of message")[0] ?? "";
  assert(
    !fenced.includes("--agents"),
    "the --agents mechanics are agent-facing — never inside the relayed message",
  );

  // Nothing detected → the defaults are still a consent point, phrased honestly.
  const defaulted = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: {
      wired: [{ label: "Claude Code", name: "claude_code" }],
      detected: false,
    },
  });
  assertStringIncludes(defaulted, "proposed default set is Claude Code");
  assertStringIncludes(defaulted, "Keep it, or name the tools you use");
});

Deno.test("consentMessage conditions every isolation promise on git being present", () => {
  const nonGit = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: false,
    agents: AGENTS,
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
  assertStringIncludes(nonGit, "May I run `git init` here");
  assertStringIncludes(
    nonGit,
    "After Git exists, before landing, the main shared version is unchanged",
  );
  // The agent's next step is to initialize git and re-run the preflight — the
  // begin command comes after the repo actually exists.
  assertStringIncludes(
    nonGit,
    "initialize git, re-run `discern setup verify`",
  );

  const withGit = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: AGENTS,
  });
  assert(!withGit.includes("git init"), "a git repo needs no git-init step");
  assertStringIncludes(
    withGit,
    "Before landing, the main shared version is unchanged",
  );
});

Deno.test("consentMessage keeps the itemized message body within its bounded relay budget", () => {
  // The message the human reads sits between the two fences; the framing line and the
  // command ride outside it. Keep it short enough to survive a single read — the base
  // case at the ~430-word target (the three pillars, the honest footprint story with
  // the provider files acknowledged, the named undo, and the agent-set consent
  // point), the docs case adding only its one extra reassurance bullet.
  const wordsOf = (docsExists: boolean): number => {
    const body = consentMessage({
      worktreePath: WT,
      docsExists,
      gitRepo: true,
      agents: AGENTS,
    })
      .split("message to your human")[1]?.split("end of message")[0] ?? "";
    return body.trim().split(/\s+/).filter(Boolean).length;
  };
  const base = wordsOf(false);
  assert(base > 0 && base <= 440, `base message body was ${base} words`);
  assert(wordsOf(true) <= 490, `docs message body was ${wordsOf(true)} words`);
});

// ── confirmedBeginCommand ────────────────────────────────────────────────────

Deno.test("confirmedBeginCommand carries --confirmed and never a --map placeholder", () => {
  assertStringIncludes(confirmedBeginCommand(), "--confirmed");
  assertStringIncludes(
    confirmedBeginCommand("Atlas Core"),
    "--name 'Atlas Core'",
  );
  // The map's home is a default; a placeholder in the default command would
  // push every agent to pass one (ADR 0131).
  assert(!confirmedBeginCommand().includes("--map"));
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
    known_jobs: caps.map((name, i) => ({
      name,
      state: i < enforcedCount ? "enforced" : "absent",
    })),
    enforced: enforcedCount,
    total: 6,
    known_total: 6,
    not_applicable: 0,
    verdict,
  };
}

const READY_REACTIVATION = {
  summary: "…",
  per_agent: [{
    label: "Claude Code",
    step:
      "start a fresh session, inspect its registered tool inventory, then invoke `mcp__discern__discern_status`; if missing, reload the project integration and run `discern doctor`.",
    check: "mcp__discern__discern_status",
    recovery: "reload the project integration and retry.",
    cli_fallback: "discern status --json",
  }],
};

const INVENTORY = {
  project_context: {
    primary_subsystem: {
      region: "10-runtime",
      page: "discern/map/10-runtime/README.md",
      title: "Runtime",
      start_here: "Begin at `src/runtime.ts`.",
      boundary: "The runtime owns command execution.",
      non_obvious_invariant: "Every command preserves the child exit status.",
    },
    principles: { count: 2, items: ["Preserve status", "Plan effects"] },
    instruction_sources: ["discern/instructions.md"],
  },
  map_regions: { count: 2, items: ["00-orientation", "10-runtime"] },
  ledger_items: { count: 1, items: ["Resolve retry ownership"] },
  jobs: {
    enforced: ["test"],
    deferred: ["format"],
    absent: ["lint"],
    not_applicable: ["build"],
  },
};

/** Build a complete closing relay context around one landing state. */
function completionContext(
  landing: {
    inRepo: boolean;
    branch: string;
    target: string;
    onTarget: boolean;
    onSetupBranch: boolean;
  },
  verdict: SetupAssurance["verdict"] = "full",
): CompletionContext {
  return {
    assurance: assurance(verdict),
    inventory: INVENTORY,
    landing,
    reactivation: READY_REACTIVATION,
    proofLine: "Proof abc123 — gate green",
    forced: false,
  };
}

Deno.test("welcome, consent, and completion derive one reversibility authority", () => {
  const welcome = renderFreshWelcome({ tty: false }).join("\n");
  const consent = consentMessage({
    worktreePath: WT,
    docsExists: false,
    gitRepo: true,
    agents: AGENTS,
  });
  const completion = completionMessage(completionContext({
    inRepo: false,
    branch: "",
    target: "main",
    onTarget: false,
    onSetupBranch: false,
  }));
  assertStringIncludes(welcome, SETUP_REVERSIBILITY.welcome);
  assertStringIncludes(welcome, SETUP_REVERSIBILITY.uninstall);
  assertStringIncludes(consent, SETUP_REVERSIBILITY.beforeLanding);
  assertStringIncludes(consent, SETUP_REVERSIBILITY.uninstall);
  assertStringIncludes(completion, SETUP_REVERSIBILITY.uninstall);
});

Deno.test("completionMessage renders honest coverage for each verdict", () => {
  const landing = {
    inRepo: false,
    branch: "",
    target: "main",
    onTarget: false,
    onSetupBranch: false,
  };
  const full = completionMessage(completionContext(landing));
  assertStringIncludes(full, "6 of 6 applicable protections");
  assertStringIncludes(full, "Later agents start in Runtime");
  assertStringIncludes(full, "Begin at `src/runtime.ts`");
  assertStringIncludes(full, "The runtime owns command execution");
  assertStringIncludes(full, "Every command preserves the child exit status");
  assertStringIncludes(full, "Decision rules future work inherits (2)");
  assertStringIncludes(
    full,
    "Future sessions load their project instructions from",
  );
  // The close restates the contained footprint the consent message promised —
  // and names `discern uninstall` as the undo, since the branch-delete story
  // retires once the setup accepts.
  assertStringIncludes(full, "The installed footprint is");
  assertStringIncludes(full, "`discern/` folder");
  assertStringIncludes(full, "discern uninstall");

  const partial = completionMessage(completionContext(landing, "partial"));
  assertStringIncludes(partial, "2 of 6 applicable protections");
  assertStringIncludes(
    partial,
    "Not running yet: typecheck, test, build, smoke",
  );

  const minimal = completionMessage(completionContext(landing, "minimal"));
  assertStringIncludes(minimal, "No quality checks are wired yet");
});

Deno.test("completionMessage adapts the landing recommendation to where the work lives", () => {
  const ctx = (
    landing: {
      inRepo: boolean;
      branch: string;
      target: string;
      onTarget: boolean;
      onSetupBranch: boolean;
    },
  ) => completionMessage(completionContext(landing, "minimal"));

  assertStringIncludes(
    ctx({
      inRepo: false,
      branch: "",
      target: "main",
      onTarget: false,
      onSetupBranch: false,
    }),
    "isn't a git repository",
  );
  assertStringIncludes(
    ctx({
      inRepo: true,
      branch: "main",
      target: "main",
      onTarget: true,
      onSetupBranch: false,
    }),
    "already lives on `main`",
  );
  const setupBranch = ctx({
    inRepo: true,
    branch: "discern-setup",
    target: "main",
    onTarget: false,
    onSetupBranch: true,
  });
  assertStringIncludes(setupBranch, "discern setup accept");
  assertStringIncludes(setupBranch, "not permission to merge");
  assertStringIncludes(setupBranch, "decline");
  assertStringIncludes(setupBranch, "I will wait");
  // The user's OWN branch (an --allow-dirty in-place setup): `setup accept` would
  // sweep that branch's own commits onto the trunk, so the recommendation is a
  // manual merge, never the land command.
  const ownBranch = ctx({
    inRepo: true,
    branch: "feature",
    target: "main",
    onTarget: false,
    onSetupBranch: false,
  });
  assertStringIncludes(ownBranch, "usual Git workflow");
  assertStringIncludes(ownBranch, "leave the branch for review");
  assertStringIncludes(ownBranch, "decline it");
  assertStringIncludes(ownBranch, "I will wait");
  assert(
    !ownBranch.includes("discern setup accept"),
    `a non-setup branch must never be steered to setup accept:\n${ownBranch}`,
  );
  // Detached HEAD (no current branch) still names how to land it.
  assertStringIncludes(
    ctx({
      inRepo: true,
      branch: "",
      target: "main",
      onTarget: false,
      onSetupBranch: false,
    }),
    "Check out `discern-setup`",
  );
});

Deno.test("completionMessage withholds restart and improvement until landing, then gives exact activation checks", () => {
  const landing = {
    inRepo: false,
    branch: "",
    target: "main",
    onTarget: false,
    onSetupBranch: false,
  };
  const withAgents = completionMessage(completionContext(landing));
  assertStringIncludes(withAgents, "For Claude Code");
  assertStringIncludes(withAgents, "registered tool inventory");
  assertStringIncludes(withAgents, "`mcp__discern__discern_status`");
  assertStringIncludes(withAgents, "`discern doctor`");
  assertStringIncludes(
    withAgents,
    "Only after every applicable activation check succeeds",
  );
  assertStringIncludes(withAgents, "project-guide areas (2 total)");
  assertStringIncludes(withAgents, "Still open (1)");

  const noAgents = completionMessage({
    assurance: assurance("full"),
    inventory: INVENTORY,
    landing,
    reactivation: { summary: "", per_agent: [] },
    proofLine: "Proof abc123 — gate green",
    forced: false,
  });
  assert(
    !noAgents.includes("start a fresh session"),
    "an agent that wired nothing at session start is never told to restart",
  );

  const unlanded = completionMessage(completionContext({
    inRepo: true,
    branch: "discern-setup",
    target: "main",
    onTarget: false,
    onSetupBranch: true,
  }));
  assertStringIncludes(unlanded, "`main` does not contain it yet");
  assert(!unlanded.includes("start a fresh"));
  assert(!unlanded.includes("discern improvement"));
});
