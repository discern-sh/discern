/**
 * Architectural guard for discern's self-hosted authored surface.
 *
 * The canonical source-path registry defines the enrolment set. Every entry
 * with an ongoing config key must resolve beneath project/ and exist; the
 * setup-time brief is excluded because its registry entry deliberately has no
 * ongoing key. Adding a configurable authored source therefore enrols here
 * automatically instead of creating a new path that can silently scatter.
 *
 * The second half proves the authored-TypeScript universe that repo-wide
 * structural guards scan: every tree holding authored TypeScript today
 * enrols, generated and ignored trees stay out, and a freshly created
 * container joins with nothing to remember — the property that keeps a guard
 * scanning `src/` alone from silently missing a sibling in `scripts/` or in a
 * tree that doesn't exist yet.
 */

import { assert, assertEquals } from "@std/assert";
import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import {
  AUTHORED_TS_FILES,
  AUTHORED_TS_ROOTS,
  authoredTsFiles,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const PROJECT_DIR = join(REPO_ROOT, "project");
const config = await loadConfig(REPO_ROOT);

function valueAt(dotted: string): unknown {
  let value: unknown = config;
  for (const segment of dotted.split(".")) {
    assert(
      typeof value === "object" && value !== null && !Array.isArray(value),
      `${dotted} must resolve through an object`,
    );
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

Deno.test("every ongoing self-hosted authored source resolves beneath project/ and exists", async () => {
  const enrolled: string[] = [];
  for (const name of SOURCE_PATH_NAMES) {
    const key = SOURCE_PATHS[name].key;
    if (key === null) continue;
    enrolled.push(name);
    const configured = valueAt(key);
    const values = Array.isArray(configured) ? configured : [configured];
    assert(values.length > 0, `${key} must name at least one source`);
    for (const value of values) {
      assert(typeof value === "string", `${key} must contain paths`);
      const path = isAbsolute(value) ? value : join(REPO_ROOT, value);
      const rel = relative(PROJECT_DIR, path);
      assert(
        rel !== "" && rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) &&
          !isAbsolute(rel),
        `${key} resolves outside project/: ${value}`,
      );
      await Deno.stat(path);
    }
  }
  assert(enrolled.length > 0, "the authored-source registry must not be empty");
});

Deno.test("the universe spans every tree holding authored TypeScript today", () => {
  for (const root of ["scripts", "site", "src", "tests", "types"]) {
    assert(
      AUTHORED_TS_ROOTS.includes(root),
      `${root}/ holds authored TypeScript and must enrol in the universe ` +
        `(got: ${AUTHORED_TS_ROOTS.join(", ")})`,
    );
  }
});

Deno.test("ignored and data trees stay out of the universe", () => {
  const banned = ["node_modules/", "dist/", ".claude/", "tests/fixtures/"];
  assertEquals(
    AUTHORED_TS_FILES.filter((rel) => banned.some((p) => rel.startsWith(p))),
    [],
  );
});

Deno.test("a fresh authored container enrols; ignored trees never do", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "generated/\n");
    await gitInit(dir);
    for (
      const rel of [
        "unrelated_tools/relay.ts", // a container no guard has ever named
        "generated/out.ts", // ignored: a build product
        "tests/fixtures/sample.ts", // inert test data
      ]
    ) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, rel), "export const x = 1;\n");
    }
    assertEquals(await authoredTsFiles(dir), ["unrelated_tools/relay.ts"]);
  });
});
