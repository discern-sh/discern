/**
 * Shipped-runtime import-cycle guard over Deno's resolved code graph.
 *
 * Static and dynamic runtime imports are edges; erased type-only imports are
 * not. Every non-trivial strongly connected component is a startup-order
 * hazard, so the allowed population is absolute: zero, with no exception
 * registry or numeric ceiling.
 */

import { assert, assertEquals } from "@std/assert";
import type { ModuleGraph } from "./module_graph.ts";
import { shippedModuleGraph } from "./module_graph.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Build deterministic, duplicate-free outgoing edges for every local module. */
function adjacencyOf(graph: ModuleGraph): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const module of graph.modules) adjacency.set(module, new Set());
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.add(edge.to);
  }
  return new Map(
    [...adjacency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, targets]) => [module, [...targets].sort()]),
  );
}

/**
 * Enumerate runtime SCCs with Tarjan's algorithm, retaining singleton
 * components only when the module imports itself.
 */
function importCycles(graph: ModuleGraph): string[][] {
  const adjacency = adjacencyOf(graph);
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  /** Complete one depth-first Tarjan visit and emit a root's component. */
  function visit(module: string): void {
    indexes.set(module, nextIndex);
    lowLinks.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);

    for (const dependency of adjacency.get(module) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          module,
          Math.min(
            lowLinks.get(module) ?? Number.POSITIVE_INFINITY,
            lowLinks.get(dependency) ?? Number.POSITIVE_INFINITY,
          ),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          module,
          Math.min(
            lowLinks.get(module) ?? Number.POSITIVE_INFINITY,
            indexes.get(dependency) ?? Number.POSITIVE_INFINITY,
          ),
        );
      }
    }

    if (lowLinks.get(module) !== indexes.get(module)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
      if (member === module) break;
    }
    components.push(component.sort());
  }

  for (const module of [...graph.modules].sort()) {
    if (!indexes.has(module)) visit(module);
  }
  return components
    .filter((component) =>
      component.length > 1 ||
      (component[0] !== undefined &&
        (adjacency.get(component[0]) ?? []).includes(component[0]))
    )
    .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

/** Find a shortest edge path inside one SCC, including both endpoints. */
function shortestPath(
  from: string,
  to: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  members: ReadonlySet<string>,
): string[] | undefined {
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path?.at(-1);
    if (path === undefined || current === undefined) continue;
    if (current === to) return path;
    for (const next of adjacency.get(current) ?? []) {
      if (!members.has(next) || visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  return undefined;
}

/**
 * Render one edge-valid closed walk that names every member of an SCC. A walk
 * may repeat bridge modules; each adjacent pair is still a real import edge.
 */
function cycleRoute(graph: ModuleGraph, component: readonly string[]): string {
  const adjacency = adjacencyOf(graph);
  const members = new Set(component);
  const start = [...component].sort()[0];
  assert(start !== undefined);
  if (component.length === 1) return `${start} → ${start}`;

  const remaining = new Set(component.filter((member) => member !== start));
  const walk = [start];
  let current = start;
  while (remaining.size > 0) {
    const target = [...remaining].sort()[0];
    assert(target !== undefined);
    const path = shortestPath(current, target, adjacency, members);
    assert(path !== undefined, `SCC has no path from ${current} to ${target}`);
    walk.push(...path.slice(1));
    for (const member of path) remaining.delete(member);
    current = target;
  }
  const home = shortestPath(current, start, adjacency, members);
  assert(home !== undefined, `SCC has no path from ${current} to ${start}`);
  walk.push(...home.slice(1));
  return walk.join(" → ");
}

Deno.test("SCC reporting renders an edge route through every cycle member", () => {
  const graph: ModuleGraph = {
    modules: new Set(["a.ts", "b.ts", "c.ts", "leaf.ts"]),
    edges: [
      { from: "a.ts", to: "b.ts" },
      { from: "b.ts", to: "a.ts" },
      { from: "b.ts", to: "c.ts" },
      { from: "c.ts", to: "b.ts" },
      { from: "c.ts", to: "leaf.ts" },
    ],
  };
  const cycles = importCycles(graph);
  assertEquals(cycles, [["a.ts", "b.ts", "c.ts"]]);
  const route = cycleRoute(graph, cycles[0] ?? []);
  assertEquals(route, "a.ts → b.ts → c.ts → b.ts → a.ts");
});

Deno.test("the shipped runtime module graph is acyclic", async () => {
  const graph = await shippedModuleGraph(REPO_ROOT, "src/main.ts");
  const declaredModules = await structuralGuardScope({
    guard: "tests/import_cycle_test.ts#shipped-module-graph",
    universe: {
      kind: "specialized",
      name: "shipped-module-source",
      extensions: [".ts", ".js", ".json"],
      reason:
        "Deno's shipped graph includes executable JavaScript and imported JSON outside any one canonical authored-code universe.",
    },
    narrow: {
      reason:
        "Only repository-local modules resolved from src/main.ts can participate in the shipped runtime graph.",
      include: (path) => graph.modules.has(path),
    },
  });
  assertEquals(
    [...declaredModules].sort(),
    [...graph.modules].sort(),
    "the declared shipped-module source family must cover every local module Deno resolves",
  );

  const cycles = importCycles(graph);
  assert(
    cycles.length === 0,
    "the shipped runtime import graph must be a DAG; break each code-edge cycle:\n" +
      cycles.map((component) => `  ${cycleRoute(graph, component)}`).join("\n"),
  );
});
