/** Class guard for command effects and their CLI/MCP enrollment boundaries. */

import { assertEquals } from "@std/assert";
import { buildCli, dryRunCapableVerbs } from "../src/main.ts";
import {
  cliCommandModel,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import {
  OPERATION_EFFECT_CLASSES,
  OPERATION_EFFECTS,
  type OperationEffectPolicy,
  operationEffectPolicy,
  previewRequiredOperationPaths,
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

/** Registry-required previews missing from or contradicted by the live CLI. */
export function operationPreviewParity(
  live: readonly string[],
  dryRunCapable: readonly string[],
  policies: Readonly<Record<string, OperationEffectPolicy>>,
): { required_without_flag: string[]; flag_without_requirement: string[] } {
  const liveSet = new Set(live);
  const required = previewRequiredOperationPaths(policies).filter((path) =>
    liveSet.has(path)
  );
  const requiredSet = new Set(required);
  const dryRunSet = new Set(dryRunCapable);
  return {
    required_without_flag: required.filter((path) => !dryRunSet.has(path)),
    flag_without_requirement: dryRunCapable.filter((path) =>
      !requiredSet.has(path)
    ).sort(),
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

Deno.test("operation preview policy and the live --dry-run surface agree", () => {
  assertEquals(
    operationPreviewParity(
      liveCommandPaths(),
      dryRunCapableVerbs(),
      OPERATION_EFFECTS,
    ),
    { required_without_flag: [], flag_without_requirement: [] },
  );
});

Deno.test("a classified future writer without --dry-run fails preview parity", () => {
  const path = "future-container unrelated-writer";
  const policy: OperationEffectPolicy = {
    effects: ["discern-checkout-mutation"],
    lock: "checkout",
    preview: "required",
  };
  assertEquals(operationEffectParity([path], { [path]: policy }), {
    missing: [],
    stale: [],
  });
  assertEquals(operationPreviewParity([path], [], { [path]: policy }), {
    required_without_flag: [path],
    flag_without_requirement: [],
  });
});

Deno.test("a dry-run flag without required preview policy fails parity", () => {
  const path = "future observation";
  const policy: OperationEffectPolicy = {
    effects: ["observation"],
    lock: "none",
    preview: "none",
  };
  assertEquals(operationPreviewParity([path], [path], { [path]: policy }), {
    required_without_flag: [],
    flag_without_requirement: [path],
  });
});

Deno.test("preview exemptions stay bounded while mixed Gate work is required", () => {
  for (const policy of Object.values(OPERATION_EFFECTS)) {
    if (policy.preview === "none") {
      assertEquals(policy.effects, ["observation"]);
    }
  }
  assertEquals(OPERATION_EFFECTS.queue.preview, "disclose");
  assertEquals(OPERATION_EFFECTS.test.preview, "disclose");
  assertEquals(OPERATION_EFFECTS.scripts.preview, "disclose");
  assertEquals(OPERATION_EFFECTS.done.preview, "required");
  assertEquals(OPERATION_EFFECTS.done.effects, [
    "discern-checkout-mutation",
    "project-command",
  ]);
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

Deno.test("queue keeps its own concurrency authority while declaring project effects", () => {
  assertEquals(OPERATION_EFFECTS.queue.effects, ["project-command"]);
  assertEquals(operationEffectPolicy("queue")?.lock, "none");
});

Deno.test("every MCP tool resolves to the same command-path policy", () => {
  assertEquals(
    TOOLS.map((tool) => verbOf(tool.name))
      .filter((path) => !Object.hasOwn(OPERATION_EFFECTS, path))
      .sort(),
    [],
  );
});
