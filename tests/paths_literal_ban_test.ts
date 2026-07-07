/**
 * Architectural guard (ADR 0102): a registry path default written as a literal
 * anywhere in `src/**` outside the paths registry is a latent bug — it holds
 * only in a project that never repointed the key, precisely the configuration
 * this repo itself does not run. The banned list derives from the registry
 * (`SOURCE_PATHS`), never a hand-copied list, so a new source path auto-enrols
 * (ADR 0051; modelled on `engine_subprocess_ssot_test.ts`).
 *
 * Allowed homes: the registry module itself, and the migrations file — its
 * paths describe old on-disk schemas and are historically correct, not
 * defaults to resolve.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

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
  for await (const entry of walk(SRC, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) {
      continue;
    }
    const rel = relative(REPO_ROOT, entry.path);
    if (ALLOWED.has(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(entry.path);
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
