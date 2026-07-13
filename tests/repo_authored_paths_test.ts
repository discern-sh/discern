/**
 * Architectural guard for discern's self-hosted authored surface.
 *
 * The canonical source-path registry defines the enrolment set. Every entry
 * with an ongoing config key must resolve beneath project/ and exist; the
 * setup-time brief is excluded because its registry entry deliberately has no
 * ongoing key. Adding a configurable authored source therefore enrols here
 * automatically instead of creating a new path that can silently scatter.
 */

import { assert } from "@std/assert";
import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

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
