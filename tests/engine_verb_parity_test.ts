/**
 * Engine-verb PARITY guard — the forcing function that keeps every satellite of the
 * CLI verb vocabulary in step with its single source of truth.
 *
 * `KNOWN_ENGINE_VERBS` (dispatch.ts) is the SSOT for the top-level verbs the engine
 * owns; `KNOWN_VERBS` (main.ts) is the wider universe (installer + engine verbs). A
 * handful of satellites RE-LIST members of those sets by hand, each needing its own
 * hand-wired handler so it can't be a derived list: the Cliffy `.command()`
 * registrations (verb → handler), the MCP `TOOLS` table (verb → tool), the
 * setup gate, and the typo-suggester's recipe names.
 * Without a tie, adding or renaming a verb silently leaves one stale — a dead MCP
 * slug, or a verb the gate forgets to guard.
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
import { buildCli, KNOWN_VERBS } from "../src/main.ts";
import { TOOLS, verbOf } from "../src/engine/mcp/server.ts";
import { SETUP_GATED_VERBS } from "../src/shared/setup_state.ts";
import { WORKTREE_FIELDS } from "../src/engine/worktree/identity.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("Cliffy registrations cover EXACTLY the engine-verb SSOT (verb → handler)", () => {
  // Attach the engine commands to a fresh root (every verb is unconditional, ADR
  // 0101), then read back the registered command names. They must be
  // exactly KNOWN_ENGINE_VERBS — a verb added to the SSOT with no `.command()` (or a
  // registration with no SSOT entry) red-lights here.
  const root = new Command();
  attachEngineCommands(root as unknown as Command);
  const registered = root.getCommands().map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(KNOWN_ENGINE_VERBS),
    "the Cliffy engine-command registrations have drifted from KNOWN_ENGINE_VERBS — " +
      "add/remove a `.command()` in attachEngineCommands (or update the SSOT)",
  );
});

Deno.test("KNOWN_VERBS covers EXACTLY the registered top-level CLI commands", () => {
  // The dispatcher consults KNOWN_VERBS before recipe fallthrough. If buildCli grows a
  // top-level command but KNOWN_VERBS does not, that registered command appears in
  // --help yet `main` treats it as an unknown recipe. Tie the installer+engine universe
  // back to the actual Cliffy registrations.
  const root = buildCli(false) as unknown as Command;
  const registered = root.getCommands().map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(KNOWN_VERBS),
    "KNOWN_VERBS has drifted from buildCli's registered top-level commands — " +
      "update KNOWN_VERBS when adding/removing a command, or make a named exception",
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
  // non-engine verbs (core/installer verbs an agent reaches for) and OMITS four
  // engine verbs that have no tool (command groups / plumbing). Both differences
  // are pinned here, so a new verb forces a choice rather than drifting.
  const NON_ENGINE_TOOL_VERBS = new Set(["doctor", "docs", "help"]);
  const ENGINE_VERBS_WITHOUT_TOOL = new Set([
    "worktree", // a command group (worktree command group), not a single tool
    "identity", // identity-resolution plumbing
    "skills", // a command group (skills list/eject)
    "mcp", // the server itself — it cannot expose itself as one of its tools
    // The interactive human surface: it wields supervisory actions over OTHER
    // efforts' worktrees, which the fleet-ownership rule forbids an agent —
    // deliberately CLI-only for `worktree drop`'s reason (ADR 0119).
    "desk",
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

Deno.test("every setup-gated verb is a real known verb", () => {
  // SETUP_GATED_VERBS is an intentional SUBSET of the verbs (the ones that
  // mislead before setup). It must never name a verb that doesn't exist — a typo'd
  // entry would silently gate nothing.
  for (const v of SETUP_GATED_VERBS) {
    assert(
      KNOWN_VERBS.has(v),
      `SETUP_GATED_VERBS names "${v}", which is not a known CLI verb`,
    );
  }
});

Deno.test("the identity CLI exposes a flag for EXACTLY the identity-field SSOT", () => {
  // The --<field> flags re-list WORKTREE_FIELDS by hand (each carries its own help
  // text, so they can't be a derived list) — tie them by test. The resolver's switch
  // and the action's field selection already derive from the SSOT; this catches a
  // flag that drifts from it (a renamed/removed field, or a new one with no flag).
  const root = new Command();
  attachEngineCommands(root as unknown as Command);
  const identity = root.getCommands().find((c) => c.getName() === "identity");
  assert(identity !== undefined, "the identity command is not registered");
  const optionNames = identity.getOptions().map((o) => o.name);

  for (const f of WORKTREE_FIELDS) {
    assert(
      optionNames.includes(f),
      `identity has no --${f} flag for the WORKTREE_FIELDS member "${f}"`,
    );
  }
  // The only NON-field options are the resource queries (explicit, named exceptions).
  const NON_FIELD_OPTIONS = new Set(["resource", "resources"]);
  for (const n of NON_FIELD_OPTIONS) {
    assert(
      optionNames.includes(n) &&
        !(WORKTREE_FIELDS as readonly string[]).includes(n),
      `NON_FIELD_OPTIONS lists "${n}", but it is not a non-field identity option`,
    );
  }
  const fieldOptions = optionNames.filter((n) => !NON_FIELD_OPTIONS.has(n));
  assertEquals(
    sorted(fieldOptions),
    sorted(WORKTREE_FIELDS),
    "identity's identity flags have drifted from WORKTREE_FIELDS — add the flag " +
      "for the new field, or record a new non-field option in NON_FIELD_OPTIONS",
  );
});

Deno.test("ENGINE_RECIPE_NAMES is the engine verbs minus the command groups, plus the worktree sub-recipes", () => {
  // The typo-suggester's recipe-name list intentionally DIFFERS from the verbs: it
  // drops the command-group verbs that have no recipe form, and adds the worktree
  // sub-recipes (real recipe files / hook entry points that are not top-level
  // verbs). Both differences are explicit, so a new engine verb forces a decision.
  const RECIPE_DROPS_ENGINE_VERB = new Set([
    "worktree",
    "skills", // a command group, not a suggestable recipe
    "mcp", // the server entry point, not a suggestable recipe
    "desk", // interactive-only — no recipe or hook form to suggest (ADR 0119)
  ]);
  const RECIPE_ADDS_SUBRECIPES = [
    "worktree-setup",
    "worktree-create",
    "worktree-remove",
    "worktree-ensure",
    "worktree-teardown",
    "worktree-drop",
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
