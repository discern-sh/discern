/**
 * Architectural guard (ADR 0102): a registry path default written as a literal
 * anywhere in authored runtime TypeScript outside the paths registry is a
 * latent bug — it holds only in a project that never repointed the key,
 * precisely the configuration this repo itself does not run. The scan derives
 * from the authored-TypeScript universe, so a new runtime tree auto-enrols. The
 * banned list derives from the registry (`SOURCE_PATHS`), so a new source path
 * auto-enrols too (ADR 0051; modelled on `engine_subprocess_ssot_test.ts`).
 *
 * Allowed homes: the registry module itself, and the migrations file — its
 * paths describe old on-disk schemas and are historically correct, not
 * defaults to resolve.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

/** The files permitted to carry a registry default verbatim. */
const ALLOWED = new Set([
  join("src", "shared", "paths_registry.ts"), // the single source itself
  join("src", "lib", "migrations.ts"), // historical schemas, not defaults
]);

/** Match `default` as a path of its own: not preceded by a word char, `.`, or
 * `/` (so the legacy dotted `.discern/skills` never false-positives), and — for
 * a default without a trailing slash — not merely a prefix of a longer
 * path/word. */
function banned(defaultPath: string): RegExp {
  const escaped = defaultPath.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const tail = defaultPath.endsWith("/") ? "" : "(?![\\w-])";
  return new RegExp(`(?<![\\w./])${escaped}${tail}`);
}

Deno.test("no registry path default appears as a literal outside the registry", async () => {
  const bans = SOURCE_PATH_NAMES.map((name) => ({
    name,
    re: banned(SOURCE_PATHS[name].defaultPath),
    def: SOURCE_PATHS[name].defaultPath,
  }));
  const offenders: string[] = [];
  for (const rel of AUTHORED_TS_FILES) {
    // Tests deliberately carry literals as independent expectations, fixtures,
    // and migration history. Runtime code has no such reason.
    if (rel.startsWith("tests/") || ALLOWED.has(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const ban of bans) {
      if (ban.re.test(text)) {
        offenders.push(`${rel} hard-codes "${ban.def}" (${ban.name})`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `a registry path default is hard-coded outside src/shared/paths_registry.ts — read it through the registry (SOURCE_PATHS / the resolvers in src/lib/paths.ts) instead:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
