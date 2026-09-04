/**
 * Engine-verb PARITY guard — the forcing function that keeps every satellite of the
 * CLI verb vocabulary in step with its single source of truth.
 *
 * `KNOWN_ENGINE_VERBS` (dispatch.ts) is the SSOT for the top-level verbs the engine
 * owns; `KNOWN_VERBS` (main.ts) is the wider universe (installer + engine verbs). A
 * handful of satellites RE-LIST members of those sets by hand, each needing its own
 * hand-wired handler so it can't be a derived list: the Cliffy `.command()`
 * registrations (verb → handler), the MCP `TOOLS` table (verb → tool), the
 * setup gate, and the typo-suggester's command names.
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
 *
 * Guards: claim:agent-as-operator
 */

import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import {
  attachEngineCommands,
  KNOWN_ENGINE_VERBS,
} from "../src/engine/dispatch.ts";
import { buildCli, KNOWN_VERBS } from "../src/main.ts";
import {
  MCP_SHELL_ONLY_VERBS,
  TOOLS,
  verbOf,
} from "../src/engine/mcp/server.ts";
import { SETUP_GATED_VERBS } from "../src/shared/setup_state.ts";
import { WORKTREE_FIELDS } from "../src/engine/worktree/identity.ts";
import {
  BEGIN_RECORDED_CLI_VERBS,
  RECORDED_CLI_VERBS,
} from "../src/engine/logbook/cli.ts";
import { LOGBOOK_EFFECTFUL_VERBS } from "../src/shared/verbs.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** Pre-Cliffy exec boundaries that call `recordedRun` directly. */
const LOGBOOK_DIRECT_CLI_VERBS: ReadonlySet<string> = new Set(["queue"]);

const FROZEN_V1_SHELL_ONLY_VERBS = [
  "worktree",
  "identity",
  "skills",
  "mcp",
  "scripts",
  "queue",
  "tidy",
  "desk",
  "enter",
  "setup",
  "upgrade",
  "uninstall",
  "config",
  "help",
  "licenses",
  "triangle",
] as const;

Deno.test("MCP shell-only v1 membership is exact and every reason is durable", () => {
  assertEquals(
    [...MCP_SHELL_ONLY_VERBS.keys()],
    [...FROZEN_V1_SHELL_ONLY_VERBS],
  );
  for (const [verb, reason] of MCP_SHELL_ONLY_VERBS) {
    assert(reason.trim().length >= 20, `${verb} needs a substantive reason`);
    assert(
      !/\b(?:for now|currently|temporary|not yet)\b/i.test(reason),
      `${verb} has a temporary reason: ${reason}`,
    );
  }
});

Deno.test("Cliffy registrations cover EXACTLY the engine-verb SSOT (verb → handler)", () => {
  // Attach the engine commands to a fresh root (every verb is unconditional, ADR
  // 0101), then read back the registered command names. They must be
  // exactly KNOWN_ENGINE_VERBS — a verb added to the SSOT with no `.command()` (or a
  // registration with no SSOT entry) red-lights here.
  const root = new Command();
  attachEngineCommands(root as unknown as Command, TEST_CLI_MODEL);
  const registered = root.getCommands().map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(KNOWN_ENGINE_VERBS),
    "the Cliffy engine-command registrations have drifted from KNOWN_ENGINE_VERBS — " +
      "add/remove a `.command()` in attachEngineCommands (or update the SSOT)",
  );
});

Deno.test("KNOWN_VERBS covers EXACTLY the registered top-level CLI commands", () => {
  // The dispatcher consults KNOWN_VERBS before unknown-command handling. If buildCli grows a
  // top-level command but KNOWN_VERBS does not, that registered command dispatches in
  // Cliffy yet `main` treats it as an unknown command. Tie the installer+engine
  // universe back to the actual Cliffy registrations — hidden ones included, since a
  // command hidden from help (provider hooks, for example) still dispatches.
  const root = buildCli(false) as unknown as Command;
  const registered = root.getCommands(true).map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(KNOWN_VERBS),
    "KNOWN_VERBS has drifted from buildCli's registered top-level commands — " +
      "update KNOWN_VERBS when adding/removing a command, or make a named exception",
  );
});

/** The small structural CLI surface the recursive help-text guard reads. */
interface DescribedCommand {
  getCommands(includeHidden?: boolean): DescribedCommand[];
  getName(): string;
  getDescription(): string;
}

/** Every registered descendant command paired with its full command path. */
function commandTree(
  parent: DescribedCommand,
  prefix: readonly string[] = [],
): Array<{ path: string; command: DescribedCommand }> {
  const entries: Array<{ path: string; command: DescribedCommand }> = [];
  for (const command of parent.getCommands(true)) {
    const parts = [...prefix, command.getName()];
    entries.push({ path: parts.join(" "), command });
    entries.push(...commandTree(command, parts));
  }
  return entries;
}

Deno.test("every registered CLI command has a non-empty description", () => {
  const missing = commandTree(buildCli(false))
    .filter(({ command }) => command.getDescription().trim() === "")
    .map(({ path }) => path);
  assertEquals(
    missing,
    [],
    "every reachable command, including hidden provider hooks, needs help text",
  );
});

Deno.test("every MCP tool maps to a real verb, with explicit non-engine additions and tool-less engine verbs", () => {
  const toolCommandPaths = TOOLS.map((tool) => verbOf(tool.name));
  const toolVerbs = toolCommandPaths.map((path) =>
    path.split(" ", 1)[0] ?? path
  );
  const distinctToolVerbs = new Set(toolVerbs);

  // No dead slug: every tool's top-level verb is one the CLI actually knows.
  for (const v of distinctToolVerbs) {
    assert(
      KNOWN_VERBS.has(v),
      `MCP tool verb "${v}" is not a known CLI verb — its tool slug is dead`,
    );
  }
  // No duplicate tool for one exact command path. A command group may expose
  // both its parent and a real child command as distinct tools.
  assertEquals(
    toolCommandPaths.length,
    new Set(toolCommandPaths).size,
    "two MCP tools map to the same command path",
  );

  // The MCP surface is an intentional subset+ of the verbs: it ADDS three
  // non-engine verbs (core/installer verbs an agent reaches for) and omits
  // verbs that have no tool. The tool-less half is DECLARED in the source
  // beside TOOLS (MCP_SHELL_ONLY_VERBS) — with a reason per member, read by
  // the command-reference rendering contract — and reconciled here.
  const NON_ENGINE_TOOL_VERBS = new Set(["doctor", "map", "docs"]);

  // The exception sets must themselves stay honest (no stale member).
  for (const v of NON_ENGINE_TOOL_VERBS) {
    assert(
      distinctToolVerbs.has(v) && !KNOWN_ENGINE_VERBS.has(v),
      `NON_ENGINE_TOOL_VERBS lists "${v}", but it is not a non-engine MCP tool verb anymore`,
    );
  }
  for (const v of MCP_SHELL_ONLY_VERBS.keys()) {
    assert(
      KNOWN_VERBS.has(v) && !distinctToolVerbs.has(v),
      `MCP_SHELL_ONLY_VERBS declares "${v}", but it is not a tool-less known verb anymore`,
    );
  }

  // The FULL reconciliation: every known verb either has a tool or is
  // declared shell-only — a new verb must decide its MCP story the day it is
  // born, and the two halves can never overlap or leave a gap.
  assertEquals(
    sorted([...distinctToolVerbs, ...MCP_SHELL_ONLY_VERBS.keys()]),
    sorted(KNOWN_VERBS),
    "the verb vocabulary and the MCP surface have drifted — register a tool for the " +
      "new verb, or declare it (with its reason) in MCP_SHELL_ONLY_VERBS beside TOOLS",
  );
  // And the engine/non-engine split stays explicit.
  const expected = [...KNOWN_ENGINE_VERBS]
    .filter((v) => !MCP_SHELL_ONLY_VERBS.has(v))
    .concat([...NON_ENGINE_TOOL_VERBS]);
  assertEquals(
    sorted(distinctToolVerbs),
    sorted(expected),
    "the MCP TOOLS table has drifted from the verb SSOT — register a tool for the new " +
      "verb, or record it in MCP_SHELL_ONLY_VERBS / NON_ENGINE_TOOL_VERBS",
  );
});

Deno.test("every CLI verb routes through an action or direct logbook recording boundary", () => {
  // The logbook's CLI interceptor (`recordedExit`) registers each verb it wraps
  // at CLI-build time. Building the full CLI must therefore register EXACTLY the
  // verb SSOT: a new verb whose action skips the wrapper never records to the
  // logbook — that is the drift this tie catches. The fix is to wrap the new
  // action in `recordedExit("<verb>", …)`, never to weaken this assertion.
  buildCli(false);
  const missing = [...KNOWN_VERBS].filter((v) => !RECORDED_CLI_VERBS.has(v));
  assertEquals(
    sorted(missing),
    sorted(LOGBOOK_DIRECT_CLI_VERBS),
    "CLI verbs whose actions bypass the logbook recording wrapper — wrap each " +
      "action in recordedExit(<verb>, …), or record a reviewed direct boundary",
  );
  const stray = [...RECORDED_CLI_VERBS].filter((v) => !KNOWN_VERBS.has(v));
  assertEquals(
    stray,
    [],
    "the logbook wrapper registered a verb the CLI SSOT does not know — fix the " +
      "verb string passed to recordedExit (its first word must be the top-level verb)",
  );
});

Deno.test("every effectful CLI verb auto-enrols in begin recording", () => {
  buildCli(false);
  assertEquals(
    sorted([...BEGIN_RECORDED_CLI_VERBS, ...LOGBOOK_DIRECT_CLI_VERBS]),
    sorted(LOGBOOK_EFFECTFUL_VERBS),
    "effectful CLI verbs have drifted from logbook begin recording — register " +
      "the action through recordedExit, record its direct boundary, or classify " +
      "a pure-observation verb in shared/verbs.ts",
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
  attachEngineCommands(root as unknown as Command, TEST_CLI_MODEL);
  const identity = root.getCommands().find((c) => c.getName() === "identity");
  assert(identity !== undefined, "the identity command is not registered");
  const optionNames = identity.getOptions().map((o) => o.name);

  for (const f of WORKTREE_FIELDS) {
    assert(
      optionNames.includes(f),
      `identity has no --${f} flag for the WORKTREE_FIELDS member "${f}"`,
    );
  }
  // The only local NON-field options are the resource queries. Result format
  // flags are inherited from the root command rather than re-declared here.
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
