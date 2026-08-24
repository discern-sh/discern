/**
 * Architectural guard (ADR 0054): every subprocess the engine spawns is
 * accounted for.
 *
 * Three layers, all driven off the spawn-surface registry
 * (`tests/spawn_surfaces.ts`):
 *   1. every `new Deno.Command(…)` constructor site under `src/` — whatever
 *      binary it names, literal or variable — lives in a registered home with
 *      an exact site count, so a new spawner (or a new site inside an old
 *      home) fails here until it registers and declares its interrupt
 *      contract;
 *   2. a git spawn (`gitBin()` or a literal) lives in a registered Git home:
 *      ordinary commands use runGit, while the attributed commit boundary owns
 *      the only commit spawn;
 *   3. a literal `sh` spawn funnels through the homes registered for the
 *      shell — route a buffered shell command through runShell().
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import {
  declaredInterruptSurfaces,
  homesThatMaySpawn,
  SPAWN_HOMES,
} from "./spawn_surfaces.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Read declared TypeScript files as `[repo-relative path, contents]`. */
async function tsFiles(
  root: string,
  files: readonly string[],
): Promise<Array<[string, string]>> {
  return await Promise.all(
    files.map(async (rel): Promise<[string, string]> => [
      rel,
      await Deno.readTextFile(join(root, rel)),
    ]),
  );
}

/** Production modules capable of spawning a child process. */
function productionSpawnFiles(): Promise<string[]> {
  return structuralGuardScope({
    guard: "tests/engine_subprocess_ssot_test.ts#production-spawn-sites",
    universe: "authored-ts",
    narrow: {
      reason:
        "The spawn-home registry governs production subprocess constructors implemented beneath src.",
      include: (path) => path.startsWith("src/"),
    },
  });
}

/** Repository-wide injected universe proving a future container auto-enrols. */
function plantedSpawnFiles(root: string): Promise<string[]> {
  return structuralGuardScope({
    guard: "tests/engine_subprocess_ssot_test.ts#future-spawn-site-control",
    universe: "authored-ts",
  }, root);
}

/**
 * A `Deno.Command` constructor site, regardless of the binary it names — the
 * generative mechanism for spawning a child, so a spawner using a variable
 * binary name cannot slip past a literal-name pattern. `node:child_process`
 * counts too: it is the same mechanism through the Node compatibility layer.
 */
const SPAWN_SITE = /new\s+Deno\.Command\s*\(|["']node:child_process["']/g;

/** Count the constructor sites per file under `root`; zero-count files omitted. */
async function spawnSites(
  root: string,
  files: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const [rel, text] of await tsFiles(root, files)) {
    const found = text.match(SPAWN_SITE)?.length ?? 0;
    if (found > 0) counts.set(rel, found);
  }
  return counts;
}

Deno.test("every subprocess constructor site lives in a registered spawn home", async () => {
  const found = await spawnSites(REPO_ROOT, await productionSpawnFiles());
  const actual = Object.fromEntries([...found].sort());
  const expected = Object.fromEntries(
    SPAWN_HOMES.map((entry) => [entry.home, entry.sites] as const).sort(),
  );
  assertEquals(
    actual,
    expected,
    "the spawn sites under src/ diverge from tests/spawn_surfaces.ts — " +
      "register the new home (or update the changed one) and declare its " +
      "interrupt contract: an E2E surface in engine_interrupt_surfaces_test.ts, " +
      "or a written exemption a reviewer can audit",
  );
});

Deno.test("the spawn-site guard enrolls an unrelated future spawner", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/another/container`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/another/container/relay.ts`,
      // A fresh-named binary held in a variable: invisible to a literal
      // "sh"/"git" pattern, caught by the constructor scan.
      `const tool = "unrelated-tool";\nnew Deno.Command(tool, {}).spawn();\n`,
    );
    await gitInit(dir);
    assertEquals(
      Object.fromEntries(await spawnSites(dir, await plantedSpawnFiles(dir))),
      { "another/container/relay.ts": 1 },
    );
  });
});

Deno.test("every declared interrupt surface id is unique across homes", () => {
  const declared = declaredInterruptSurfaces();
  assertEquals(
    declared,
    [...new Set(declared)],
    "two spawn homes declare the same interrupt surface — one scenario would " +
      "silently stand in for both; give each home its own surface id",
  );
});

/** A `new Deno.Command(…)` whose binary is git: the gitBin() resolver or a literal. */
const GIT_SPAWN = /new Deno\.Command\(\s*(?:gitBin\(\)|["']git["'])/;

Deno.test("every git spawn lives in a registered Git home", async () => {
  const gitHomes = homesThatMaySpawn("git");
  const offenders: string[] = [];
  for (
    const [rel, text] of await tsFiles(REPO_ROOT, await productionSpawnFiles())
  ) {
    if (gitHomes.has(rel)) continue;
    if (GIT_SPAWN.test(text)) offenders.push(rel);
  }
  assertEquals(
    offenders,
    [],
    `git is spawned outside ${
      [...gitHomes].join(", ")
    } — route ordinary commands through runGit(), or use the attributed ` +
      `commit boundary:\n  ${offenders.join("\n  ")}`,
  );
});

/** A `new Deno.Command(…)` whose binary is the literal shell. */
const SH_SPAWN = /new Deno\.Command\(\s*["']sh["']/;

Deno.test("every sh -c spawn funnels through a sanctioned runner", async () => {
  const shHomes = homesThatMaySpawn("sh");
  const offenders: string[] = [];
  for (
    const [rel, text] of await tsFiles(REPO_ROOT, await productionSpawnFiles())
  ) {
    if (shHomes.has(rel)) continue;
    if (SH_SPAWN.test(text)) offenders.push(rel);
  }
  assertEquals(
    offenders,
    [],
    `sh is spawned outside the sanctioned runners (${
      [...shHomes].join(", ")
    }) — run buffered shell commands through runShell():\n  ${
      offenders.join("\n  ")
    }`,
  );
});
