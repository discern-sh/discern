/**
 * Class guard: every `discern-<verb>-<object>` skill citation on a LIVE surface
 * must name a skill that ships (bundled) or exists in this repo's authored set.
 *
 * The class this cures: advisory strings recommend skills by name — the logbook
 * detectors, the improve rules, hint templates, the instruction sources, the map's
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
import { SKILL_CITATION_BARE } from "../src/lib/docs_integrity.ts";
import { BUNDLED_SKILL_NAMES } from "../src/lib/skills.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { withoutRegistryAtlasMembers } from "./registry_atlas_scan.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

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
    "discern-best-effort",
    "the exact error-discard boundary marker, not a callable skill citation",
  ],
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
  [
    "discern-proof-note",
    "the landing proof note's published schema artifact basename",
  ],
  [
    "discern-mcp-tools",
    "the frozen MCP tools manifest's published artifact basename",
  ],
  [
    "discern-checkpoint-input",
    "the registered OS-temp filename prefix for one checkpoint command input",
  ],
  [
    "discern-operation-lock",
    "the versioned record prefix stored in an operation lock file",
  ],
  [
    "discern-operation-locks",
    "the OS-temp directory for operation locks used before Git exists",
  ],
  [
    "discern-worktree-setup-step",
    "the versioned identity-domain prefix for a worktree setup step",
  ],
  [
    "discern-checkout-mutation",
    "the operation-effect registry class for a checkout-scoped mutation",
  ],
  [
    "discern-common-mutation",
    "the operation-effect registry class for a common-repository mutation",
  ],
  [
    "discern-git-mutation",
    "the operation-effect registry class for a discern-owned Git mutation",
  ],
]);

const EXEMPT_SEGMENTS = ["/_adr/", "/_private/"] as const;

const AUTHORED_SKILLS_REL = relative(REPO_ROOT, REPO_AUTHORED_PATHS.skills)
  .replaceAll("\\", "/");
const AUTHORED_SKILLS_PREFIX = `${AUTHORED_SKILLS_REL}/`;
const INSTRUCTION_RELS = new Set(
  REPO_AUTHORED_PATHS.instructions.map((path) =>
    relative(REPO_ROOT, path).replaceAll("\\", "/")
  ),
);

Deno.test("bundled skill registry exactly matches the shipped directories", async () => {
  const prefix = "templates/skills/";
  const directories = new Set<string>();
  for (
    const rel of await structuralGuardScope({
      guard: "tests/skill_name_parity_test.ts#bundled-skill-registry",
      universe: "authored-text",
      narrow: {
        reason:
          "Bundled skill membership is defined by the first directory below the shipped templates skill root.",
        include: (path) => path.startsWith(prefix),
      },
    })
  ) {
    const name = rel.slice(prefix.length).split("/")[0];
    if (name !== undefined && name !== "") directories.add(name);
  }
  assertEquals([...directories].sort(), [...BUNDLED_SKILL_NAMES]);
});

Deno.test("skill-name parity: every live discern-* citation ships", async () => {
  const known = new Set<string>();
  const bundledPrefix = "templates/skills/";
  for (
    const rel of await structuralGuardScope({
      guard: "tests/skill_name_parity_test.ts#known-skill-directories",
      universe: "authored-text",
      narrow: {
        reason:
          "Known skill membership is directory-driven by the bundled and configured authored skill source trees.",
        include: (path) =>
          path.startsWith(bundledPrefix) ||
          path.startsWith(AUTHORED_SKILLS_PREFIX),
      },
    })
  ) {
    const prefix = rel.startsWith(bundledPrefix)
      ? bundledPrefix
      : AUTHORED_SKILLS_PREFIX;
    const name = rel.slice(prefix.length).split("/")[0];
    if (name !== undefined) known.add(name);
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
  const mapPrefix = `${REPO_AUTHORED_PATHS.mapRel}/`;
  for (
    const rel of await structuralGuardScope({
      guard: "tests/skill_name_parity_test.ts#live-skill-citations",
      universe: "authored-text",
      narrow: {
        reason:
          "Live skill citations appear in product source, shipped templates, configured instructions, authored skills, and current map prose; tests and executable scripts use fixture namespaces.",
        include: (path) =>
          (path.startsWith("src/") || path.startsWith("templates/") ||
            INSTRUCTION_RELS.has(path) ||
            path.startsWith(AUTHORED_SKILLS_PREFIX) ||
            path.startsWith(mapPrefix)) &&
          !EXEMPT_SEGMENTS.some((segment) => `/${path}`.includes(segment)),
      },
    })
  ) {
    scan(
      rel,
      withoutRegistryAtlasMembers(
        rel,
        await Deno.readTextFile(join(REPO_ROOT, rel)),
      ),
    );
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
