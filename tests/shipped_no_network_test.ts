/**
 * The compiled discern graph has neither network APIs nor network permission.
 *
 * Guards: claim:no-model-inside
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { BINARY_PERMISSIONS } from "../scripts/build.ts";
import { NETWORK_TOKEN } from "./network_boundary.ts";
import { shippedModuleGraph } from "./module_graph.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

Deno.test("the complete shipped module graph reaches no first-party network API", async () => {
  const graph = await shippedModuleGraph(REPO_ROOT, "src/main.ts");
  const files = await structuralGuardScope({
    guard: "tests/shipped_no_network_test.ts#shipped-network-surface",
    universe: {
      kind: "specialized",
      name: "shipped-network-source",
      extensions: [".ts", ".js", ".json"],
      reason:
        "Deno's shipped graph includes executable JavaScript and imported JSON outside the authored-TypeScript universe.",
    },
    narrow: {
      reason:
        "Only repository-local modules resolved from src/main.ts can enter the compiled binary's network surface.",
      include: (path) => graph.modules.has(path),
    },
  });
  assert(
    files.length > 20,
    `suspiciously small shipped graph: ${files.length}`,
  );
  const offenders: string[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    const match = source.match(NETWORK_TOKEN);
    if (match !== null) offenders.push(`${path} contains ${match[0]}`);
  }
  assertEquals(
    offenders,
    [],
    "the shipped graph gained a network API; remove it from the product graph",
  );
});

Deno.test("the compiled binary carries no network permission", () => {
  assertEquals(
    BINARY_PERMISSIONS.filter((permission) =>
      permission === "--allow-net" || permission.startsWith("--allow-net=")
    ),
    [],
  );
});

Deno.test("the shipped-network detector catches a planted API", () => {
  assertMatch('await fetch("https://example.invalid")', NETWORK_TOKEN);
});
