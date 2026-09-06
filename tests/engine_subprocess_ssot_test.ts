/**
 * Architectural guard for the complete production-and-tooling subprocess
 * constructor population.
 *
 * The exact boundary registry carries every path, enclosing function,
 * operation, and reason. Its engine subset also carries one interrupt contract
 * per spawn home. Unknown constructors, stale entries, raw Git/shell spawns,
 * and unaccounted engine interrupt homes all fail independently.
 */

import { assertEquals } from "@std/assert";
import {
  directSpawnSitesInFiles,
  directSpawnSitesInSource,
  productionAndToolingSpawnFiles,
  spawnBoundaryParityFindings,
} from "../scripts/subprocess_spawn_boundaries.ts";
import {
  declaredInterruptSurfaces,
  homesThatMaySpawn,
  SPAWN_INTERRUPT_CONTRACTS,
  SUBPROCESS_SPAWN_BOUNDARIES,
} from "./spawn_surfaces.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** One immutable checkout census shared by independent registry assertions. */
let liveSites: ReturnType<typeof directSpawnSitesInFiles> | undefined;

/** Lazily parse the live source set once; fixture scans remain independent. */
function liveSpawnSites(): ReturnType<typeof directSpawnSitesInFiles> {
  return liveSites ??= productionAndToolingSpawnFiles().then((files) =>
    directSpawnSitesInFiles(REPO_ROOT, files)
  );
}

Deno.test("every production-and-tooling subprocess constructor has one exact boundary", async () => {
  const actual = await liveSpawnSites();
  assertEquals(
    spawnBoundaryParityFindings(actual, SUBPROCESS_SPAWN_BOUNDARIES),
    [],
  );
});

Deno.test("the spawn guard enrolls an unrelated future source root", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(`${root}/another/container`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/another/container/relay.ts`,
      [
        "export function launch(): void {",
        '  new Deno.Command("unrelated-tool", {}).spawn();',
        "}",
      ].join("\n"),
    );
    await gitInit(root);
    const actual = await directSpawnSitesInFiles(
      root,
      await productionAndToolingSpawnFiles(root),
    );
    assertEquals(
      spawnBoundaryParityFindings(actual, []),
      [
        "unregistered subprocess constructor at another/container/relay.ts:2:3 inside launch",
      ],
    );
  });
});

Deno.test("a stale exact spawn registry entry fails with its operation", () => {
  const registered = [{
    path: "future/tool.ts",
    enclosingFunction: "launch",
    operation: "launch a retired helper",
    reason: "the helper once required a specialized protocol",
    may: ["other"],
    role: "registered-boundary",
  }] as const;
  assertEquals(spawnBoundaryParityFindings([], registered), [
    "stale subprocess boundary future/tool.ts#launch (launch a retired helper)",
  ]);
});

Deno.test("constructor syntax reports stable enclosing functions and binary expressions", () => {
  assertEquals(
    directSpawnSitesInSource(
      [
        "const top = new Deno.Command(Deno.execPath(), {});",
        "const launch = (): void => {",
        '  new Deno.Command("tool", {}).spawn();',
        "};",
      ].join("\n"),
    ).map((site) => [site.enclosingFunction, site.binary]),
    [["<module>", "Deno.execPath()"], ["launch", '"tool"']],
  );
});

Deno.test("every engine spawn home declares one live interrupt contract", () => {
  const engineHomes = [
    ...new Set(
      SUBPROCESS_SPAWN_BOUNDARIES.filter((entry) =>
        entry.path.startsWith("src/")
      ).map((entry) => entry.path),
    ),
  ].sort();
  assertEquals(Object.keys(SPAWN_INTERRUPT_CONTRACTS).sort(), engineHomes);
});

Deno.test("every declared interrupt surface id is unique across homes", () => {
  const declared = declaredInterruptSurfaces();
  assertEquals(
    declared,
    [...new Set(declared)],
    "two spawn homes declare the same interrupt surface; give each scenario its own id",
  );
});

Deno.test("every literal Git constructor belongs to a declared Git boundary", async () => {
  const permitted = homesThatMaySpawn("git");
  const actual = await liveSpawnSites();
  assertEquals(
    actual.filter((site) =>
      site.binary === '"git"' || site.binary === "'git'" ||
      site.binary === "gitBin()"
    ).filter((site) => !permitted.has(site.path))
      .map((site) => `${site.path}:${site.line}`),
    [],
    "route ordinary Git commands through runGit or register the exact specialized boundary",
  );
});

Deno.test("every literal shell constructor belongs to a declared shell boundary", async () => {
  const permitted = homesThatMaySpawn("sh");
  const actual = await liveSpawnSites();
  assertEquals(
    actual.filter((site) => site.binary === '"sh"' || site.binary === "'sh'")
      .filter((site) => !permitted.has(site.path))
      .map((site) => `${site.path}:${site.line}`),
    [],
    "route buffered shell commands through runShell or register the exact specialized boundary",
  );
});

Deno.test("subprocess binding analysis preserves chains, shadowing and cycles", () => {
  const source = [
    'const First = (Deno["Command"]);',
    "const Launch = (First);",
    'new Launch("outer", {});',
    'function nested(Launch: unknown) { new Launch("unrelated", {}); }',
    "const CycleA = CycleB; const CycleB = CycleA;",
    'new CycleA("cycle", {});',
    'new Error("ordinary constructor");',
  ].join("\n");
  assertEquals(
    directSpawnSitesInSource(source).map((site) => site.binary),
    ['"outer"'],
  );
});
