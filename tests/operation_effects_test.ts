/** Class guard for command effects and their CLI/MCP enrollment boundaries. */

import { assertEquals } from "@std/assert";
import { buildCli } from "../src/main.ts";
import {
  cliCommandModel,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import {
  OPERATION_EFFECT_CLASSES,
  OPERATION_EFFECTS,
  type OperationEffectPolicy,
} from "../src/shared/operation_effects.ts";
import { TOOLS, verbOf } from "../src/engine/mcp/server.ts";
import { RECORDED_CLI_COMMAND_PATHS } from "../src/engine/logbook/cli.ts";

/** Every registered command path below the root, including hidden commands. */
function liveCommandPaths(): string[] {
  const model = cliCommandModel(buildCli(false));
  return [...walkCliCommands(model)]
    .map((command) => command.path.join(" "))
    .filter((path) => path !== "")
    .sort();
}

/** Paths missing from or stale in one candidate policy registry. */
export function operationEffectParity(
  live: readonly string[],
  policies: Readonly<Record<string, OperationEffectPolicy>>,
): { missing: string[]; stale: string[] } {
  const registered = Object.keys(policies);
  return {
    missing: live.filter((path) => !registered.includes(path)).sort(),
    stale: registered.filter((path) => !live.includes(path)).sort(),
  };
}

Deno.test("every live CLI command path has exactly one operation-effect policy", () => {
  assertEquals(
    operationEffectParity(liveCommandPaths(), OPERATION_EFFECTS),
    { missing: [], stale: [] },
  );
});

Deno.test("every live CLI command path enters the shared execution interceptor", () => {
  const live = liveCommandPaths();
  assertEquals(
    operationEffectParity(
      live,
      Object.fromEntries(
        [...RECORDED_CLI_COMMAND_PATHS].map((path) => [
          path,
          OPERATION_EFFECTS[path as keyof typeof OPERATION_EFFECTS],
        ]),
      ),
    ),
    { missing: [], stale: [] },
  );
});

Deno.test("an unrelated future command path auto-enrolls in effect policy", () => {
  assertEquals(
    operationEffectParity(
      [...liveCommandPaths(), "future-container unrelated-action"],
      OPERATION_EFFECTS,
    ).missing,
    ["future-container unrelated-action"],
  );
});

Deno.test("every declared effect class has a live classified operation", () => {
  const used = new Set(
    Object.values(OPERATION_EFFECTS).flatMap((policy) => policy.effects),
  );
  assertEquals(
    OPERATION_EFFECT_CLASSES.filter((effect) => !used.has(effect)),
    [],
  );
});

Deno.test("every MCP tool resolves to the same command-path policy", () => {
  assertEquals(
    TOOLS.map((tool) => verbOf(tool.name))
      .filter((path) => !Object.hasOwn(OPERATION_EFFECTS, path))
      .sort(),
    [],
  );
});
