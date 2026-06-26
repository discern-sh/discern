/**
 * Engine-verb PARITY guard — the forcing function that keeps every satellite of the
 * CLI verb vocabulary in step with its single source of truth.
 *
 * `KNOWN_ENGINE_VERBS` (dispatch.ts) is the SSOT for the top-level verbs the engine
 * owns; `KNOWN_VERBS` (main.ts) is the wider universe (installer + engine verbs). A
 * handful of satellites RE-LIST members of those sets by hand, each needing its own
 * hand-wired handler so it can't be a derived list: the Cliffy `.command()`
 * registrations (verb → handler), the MCP `TOOLS` table (verb → tool), the
 * bootstrap gate, the per-verb feature gate, and the typo-suggester's recipe names.
 * Without a tie, adding or renaming a verb silently leaves one stale — a dead MCP
 * slug, an orphaned feature mapping, a verb the gate forgets to guard.
 *
 * This test is that tie. Each satellite is reconciled against the SSOT, and where a
 * satellite LEGITIMATELY differs (an intentional subset/superset) the difference is
 * asserted via EXPLICIT, NAMED exception sets — so a new member forces a conscious
 * choice (extend the satellite, or record why it is excepted) and can never drift in
 * silently. Modelled on `tests/agent_parity_test.ts` (the agent-registry keystone).
 *
 * When this fails for a new verb, the fix is NOT to weaken the assertion — it is to
 * teach the named satellite about the verb (the message says which one and how).
 */

import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import {
  attachEngineCommands,
  ENGINE_RECIPE_NAMES,
  KNOWN_ENGINE_VERBS,
} from "../src/engine/dispatch.ts";
import { KNOWN_VERBS } from "../src/main.ts";
import { TOOLS, verbOf } from "../src/engine/mcp/server.ts";
import { FEATURES, isFeature, VERB_FEATURE } from "../src/shared/features.ts";
import { BOOTSTRAP_GATED_VERBS } from "../src/shared/setup_state.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("Cliffy registrations cover EXACTLY the engine-verb SSOT (verb → handler)", () => {
  // Attach the engine commands to a fresh root with every feature ON (so every
  // gated verb is wired), then read back the registered command names. They must be
  // exactly KNOWN_ENGINE_VERBS — a verb added to the SSOT with no `.command()` (or a
  // registration with no SSOT entry) red-lights here.
  const root = new Command();
  attachEngineCommands(root as unknown as Command, new Set(FEATURES));
  const registered = root.getCommands().map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(KNOWN_ENGINE_VERBS),
    "the Cliffy engine-command registrations have drifted from KNOWN_ENGINE_VERBS — " +
      "add/remove a `.command()` in attachEngineCommands (or update the SSOT)",
  );
});

Deno.test("every MCP tool maps to a real verb, with explicit non-engine additions and tool-less engine verbs", () => {
  const toolVerbs = TOOLS.map((t) => verbOf(t.name));

  // No dead slug: every tool's verb is one the CLI actually knows.
  for (const v of toolVerbs) {
    assert(
      KNOWN_VERBS.has(v),
      `MCP tool verb "${v}" is not a known CLI verb — its tool slug is dead`,
    );
  }
  // No duplicate tool for one verb.
  assertEquals(
    toolVerbs.length,
    new Set(toolVerbs).size,
    "two MCP tools map to the same verb",
  );

  // The MCP surface is an intentional subset+ of the verbs: it ADDS three
  // non-engine verbs (core/installer verbs an agent reaches for) and OMITS five
  // engine verbs that have no tool (command groups / plumbing). Both differences
  // are pinned here, so a new verb forces a choice rather than drifting.
  const NON_ENGINE_TOOL_VERBS = new Set(["doctor", "docs", "help"]);
  const ENGINE_VERBS_WITHOUT_TOOL = new Set([
    "refresh", // re-materializes artifacts; not surfaced as an agent tool
    "worktree", // a command group (worktree:* subverbs), not a single tool
    "worktree-name", // identity-resolution plumbing
    "skills", // a command group (skills list/eject)
    "mcp", // the server itself — it cannot expose itself as one of its tools
  ]);

  // The exception sets must themselves stay honest (no stale member).
  for (const v of NON_ENGINE_TOOL_VERBS) {
    assert(
      toolVerbs.includes(v) && !KNOWN_ENGINE_VERBS.has(v),
      `NON_ENGINE_TOOL_VERBS lists "${v}", but it is not a non-engine MCP tool verb anymore`,
    );
  }
  for (const v of ENGINE_VERBS_WITHOUT_TOOL) {
    assert(
      KNOWN_ENGINE_VERBS.has(v) && !toolVerbs.includes(v),
      `ENGINE_VERBS_WITHOUT_TOOL lists "${v}", but it is not a tool-less engine verb anymore`,
    );
  }

  // The reconciliation: tool verbs == (engine verbs that DO have a tool) + the
  // non-engine additions.
  const expected = [...KNOWN_ENGINE_VERBS]
    .filter((v) => !ENGINE_VERBS_WITHOUT_TOOL.has(v))
    .concat([...NON_ENGINE_TOOL_VERBS]);
  assertEquals(
    sorted(toolVerbs),
    sorted(expected),
    "the MCP TOOLS table has drifted from the verb SSOT — register a tool for the new " +
      "verb, or record it in ENGINE_VERBS_WITHOUT_TOOL / NON_ENGINE_TOOL_VERBS",
  );
});

Deno.test("every bootstrap-gated verb is a real known verb", () => {
  // BOOTSTRAP_GATED_VERBS is an intentional SUBSET of the verbs (the ones that
  // mislead before setup). It must never name a verb that doesn't exist — a typo'd
  // entry would silently gate nothing.
  for (const v of BOOTSTRAP_GATED_VERBS) {
    assert(
      KNOWN_VERBS.has(v),
      `BOOTSTRAP_GATED_VERBS names "${v}", which is not a known CLI verb`,
    );
  }
});

Deno.test("VERB_FEATURE keys are real verbs and values are real features", () => {
  // Every feature-gated verb must be a known verb (else the gate guards nothing),
  // and every value a known feature. The value is already compile-checked to
  // `Feature` by VERB_FEATURE's type; this also covers it at runtime, and ties the
  // keys — which have no union type — back to the verb SSOT.
  for (const [verb, feature] of Object.entries(VERB_FEATURE)) {
    assert(
      KNOWN_VERBS.has(verb),
      `VERB_FEATURE maps "${verb}", which is not a known CLI verb`,
    );
    assert(
      isFeature(feature),
      `VERB_FEATURE maps "${verb}" to "${feature}", which is not a known feature`,
    );
  }
});

Deno.test("ENGINE_RECIPE_NAMES is the engine verbs minus the command groups, plus the worktree sub-recipes", () => {
  // The typo-suggester's recipe-name list intentionally DIFFERS from the verbs: it
  // drops the command-group verbs that have no recipe form, and adds the worktree
  // sub-recipes (real recipe files / hook entry points that are not top-level
  // verbs). Both differences are explicit, so a new engine verb forces a decision.
  const RECIPE_DROPS_ENGINE_VERB = new Set([
    "skills", // a command group, not a suggestable recipe
    "mcp", // the server entry point, not a suggestable recipe
  ]);
  const RECIPE_ADDS_SUBRECIPES = [
    "worktree-create",
    "worktree-remove",
    "worktree-ensure",
    "worktree-teardown",
    "worktree-prune",
  ];

  // The drop set must stay honest (each is a real engine verb the recipes omit).
  for (const v of RECIPE_DROPS_ENGINE_VERB) {
    assert(
      KNOWN_ENGINE_VERBS.has(v) && !ENGINE_RECIPE_NAMES.includes(v),
      `RECIPE_DROPS_ENGINE_VERB lists "${v}", but it is no longer a dropped engine verb`,
    );
  }
  // The added sub-recipes must not collide with the top-level verb names.
  for (const v of RECIPE_ADDS_SUBRECIPES) {
    assert(
      ENGINE_RECIPE_NAMES.includes(v) && !KNOWN_ENGINE_VERBS.has(v),
      `RECIPE_ADDS_SUBRECIPES lists "${v}", but it is not an extra (non-verb) recipe name`,
    );
  }

  const expected = [...KNOWN_ENGINE_VERBS]
    .filter((v) => !RECIPE_DROPS_ENGINE_VERB.has(v))
    .concat(RECIPE_ADDS_SUBRECIPES);
  assertEquals(
    sorted(ENGINE_RECIPE_NAMES),
    sorted(expected),
    "ENGINE_RECIPE_NAMES has drifted from the verb SSOT — extend it for the new verb, " +
      "or record the difference in RECIPE_DROPS_ENGINE_VERB / RECIPE_ADDS_SUBRECIPES",
  );
});
