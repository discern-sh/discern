/**
 * Class guard: every `discern-<verb>-<object>` skill citation on a LIVE surface
 * must name a skill that ships (bundled) or exists in this repo's authored set.
 *
 * The class this cures: advisory strings recommend skills by name — the logbook
 * detectors, the improve rules, hint templates, the guidance sources, the map's
 * product pages, the skills' own cross-references — and nothing tied those
 * citations to the bundled directory set. A trim or rename then leaves live
 * surfaces recommending skills that no longer exist (the seven-skill trim found
 * three such strings in the logbook detectors alone). The known set derives
 * from the SAME sources the materializer reads, so a future rename fails here
 * until every live citation follows, and a new skill auto-enrols.
 *
 * Dated records are exempt: `_adr/` (with `_superseded/`) and `_private/`
 * preserve history, and history legitimately names retired skills.
 */

import { assert, assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { walk } from "@std/fs";
import { bundledSkillNames } from "../src/lib/skills.ts";
import { SKILL_CITATION_BARE } from "../src/lib/docs_integrity.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { withoutRegistryAtlasMembers } from "./registry_atlas_scan.ts";

/** The citation grammar, from its single source (docs_integrity.ts): two-plus
 * segments after the prefix, reached at a word boundary. This repo-local sweep
 * is deliberately WIDER than the shipped preflight's backticked-span check —
 * bare tokens in source strings and templates count here — so it keeps its own
 * reasoned exception map below. */
const CITATION = SKILL_CITATION_BARE;

/** Grammar-matching tokens that are NOT skill citations. Each names its
 * reason, and the test asserts every entry stays a non-skill so this set can
 * never silently absorb a real name. */
const NON_SKILL_TOKENS = new Map<string, string>([
  [
    "discern-allow-retrospective",
    "the comment-currency escape marker, quoted wherever the guard is explained",
  ],
  [
    "discern-design-system",
    "the design-system import-map alias, quoted in the site docs' example",
  ],
  [
    "discern-setup-config",
    "the setup config document's published schema artifact basename",
  ],
]);

const EXEMPT_SEGMENTS = ["/_adr/", "/_private/"] as const;

/** The live surfaces: engine + installer source, shipped templates, and this
 * repo's configured authored prose. Tests and project scripts are deliberately
 * NOT swept — tests fabricate discern-* identifiers freely and verify their
 * real citations by execution; scripts are executable namespaces. */
const SWEEP_ROOTS: readonly string[] = [
  join(REPO_ROOT, "src"),
  join(REPO_ROOT, "templates"),
  ...REPO_AUTHORED_PATHS.guidance,
  REPO_AUTHORED_PATHS.skills,
  REPO_AUTHORED_PATHS.map,
];

Deno.test("skill-name parity: every live discern-* citation ships", async () => {
  const known = new Set(await bundledSkillNames());
  try {
    for await (const e of Deno.readDir(REPO_AUTHORED_PATHS.skills)) {
      if (e.isDirectory) {
        known.add(e.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  assert(known.size > 0, "expected at least one known skill");
  for (const [token, reason] of NON_SKILL_TOKENS) {
    assert(
      !known.has(token),
      `exception '${token}' (${reason}) names a real skill — drop the exception`,
    );
  }

  const offenders: string[] = [];
  const scan = (rel: string, text: string): void => {
    for (const match of text.matchAll(CITATION)) {
      const name = match[0];
      if (!known.has(name) && !NON_SKILL_TOKENS.has(name)) {
        offenders.push(`${rel}: ${name}`);
      }
    }
  };
  for (const root of SWEEP_ROOTS) {
    const info = await Deno.stat(root).catch(() => undefined);
    if (info === undefined) {
      continue;
    }
    if (info.isFile) {
      const rel = relative(REPO_ROOT, root).replaceAll("\\", "/");
      scan(
        rel,
        withoutRegistryAtlasMembers(
          rel,
          await Deno.readTextFile(root),
        ),
      );
      continue;
    }
    for await (const entry of walk(root, { includeDirs: false })) {
      const rel = relative(REPO_ROOT, entry.path).replaceAll("\\", "/");
      if (EXEMPT_SEGMENTS.some((seg) => `/${rel}`.includes(seg))) {
        continue;
      }
      scan(
        rel,
        withoutRegistryAtlasMembers(
          rel,
          await Deno.readTextFile(entry.path),
        ),
      );
    }
  }
  assertEquals(
    [...new Set(offenders)].sort(),
    [],
    "every discern-* skill citation on a live surface must name a bundled " +
      "or authored skill. A rename or trim must update every citation; add a " +
      "reasoned NON_SKILL_TOKENS entry only for a token that is not a skill " +
      "citation at all.",
  );
});
