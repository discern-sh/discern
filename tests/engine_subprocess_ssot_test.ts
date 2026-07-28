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
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  declaredInterruptSurfaces,
  homesThatMaySpawn,
  SPAWN_HOMES,
} from "./spawn_surfaces.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/** Every `.ts` file under `root`, as `[display-relative path, contents]`. */
async function tsFiles(
  root: string,
  displayRoot = root,
): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const entry of walk(root, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) continue;
    out.push([
      relative(displayRoot, entry.path).replaceAll("\\", "/"),
      await Deno.readTextFile(entry.path),
    ]);
  }
  return out;
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
  displayRoot = root,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const [rel, text] of await tsFiles(root, displayRoot)) {
    const found = text.match(SPAWN_SITE)?.length ?? 0;
    if (found > 0) counts.set(rel, found);
  }
  return counts;
}

Deno.test("every subprocess constructor site lives in a registered spawn home", async () => {
  const found = await spawnSites(SRC, REPO_ROOT);
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
    assertEquals(
      Object.fromEntries(await spawnSites(dir)),
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
  for (const [rel, text] of await tsFiles(SRC, REPO_ROOT)) {
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
  for (const [rel, text] of await tsFiles(SRC, REPO_ROOT)) {
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
