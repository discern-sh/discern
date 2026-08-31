/**
 * Vocabulary-drift guard — retired wording is DATA on the term registry, and
 * this one parameterized scan polices all of it.
 *
 * A glossary entry declares the synonyms the canon retired in its favour
 * (`retired` on `scripts/glossary_registry.ts`); this guard bans every such
 * phrase from the live prose surfaces — the binary's user-facing string
 * literals, the shipped templates and their fixtures, the skills, the project
 * scripts, the public map, and the root prose files. Retiring a
 * phrase is now a registry edit, not a new hand-rolled regex and scan: the
 * class-not-instance move applied to language itself.
 *
 * Exemptions are data too: a synonym's `allowed` paths name where the phrase
 * stays legal and why. Structurally exempt, for every phrase: the generated
 * glossary page (the declaration surface — retired phrases appear there as
 * search aliases) and the map's dated records (`_adr/`, `_private/`), which
 * keep the vocabulary they were written with.
 */

import { assert, assertEquals } from "@std/assert";
import { basename, dirname, join, relative } from "@std/path";
import {
  retiredPattern,
  type RetiredSynonym,
  retiredSynonyms,
} from "../scripts/glossary_registry.ts";
import {
  bannedPhraseLines,
  stringLiterals,
  visibleMarkdown,
} from "./vocab_scan.ts";
import {
  isRepoMapPath,
  REPO_AUTHORED_PATHS,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { DESIGN_SYSTEM_BUNDLES } from "../site/design_system.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Generated vendor output under site/ (materialized design-system bundles) —
 * not authored here, so not this repo's vocabulary to police. */
const SITE_GENERATED_PREFIXES = Object.values(DESIGN_SYSTEM_BUNDLES).map((b) =>
  join("site", b.output)
);

/** Site extensions that never carry prose (binary assets). */
const BINARY_EXTS = [
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".webp",
  ".woff",
  ".woff2",
];

/** Whether `rel` is inside one repo-relative tree. */
function under(rel: string, tree: string): boolean {
  return rel === tree || rel.startsWith(`${tree}/`);
}

const PROSE_TREE_RELS = [
  "templates",
  "tests/fixtures/templates",
  relative(REPO_ROOT, REPO_AUTHORED_PATHS.skills),
  relative(REPO_ROOT, REPO_AUTHORED_PATHS.scripts),
  REPO_AUTHORED_PATHS.mapRel,
];

/** The root prose files held to the canon alongside the trees. */
const ROOT_PROSE_RELS = [
  "README.md",
  "CONTRIBUTING.md",
  "discern.toml",
  ...REPO_AUTHORED_PATHS.instructions.map((path) => relative(REPO_ROOT, path)),
];

/** Every live vocabulary surface, including the inert shipped-template fixtures. */
const VOCABULARY_FILES = await structuralGuardScope({
  guard: "tests/vocab_drift_test.ts#live-vocabulary-surfaces",
  universe: {
    kind: "specialized",
    name: "live prose text including shipped-template fixtures",
    text: true,
    reason:
      "The vocabulary contract includes inert shipped-template fixtures omitted by authored-text.",
  },
  narrow: {
    reason:
      "The vocabulary canon governs binary strings and user-visible prose surfaces.",
    include: (rel) =>
      (under(rel, "src") && rel.endsWith(".ts")) ||
      (under(rel, "site") &&
        !SITE_GENERATED_PREFIXES.some((prefix) => under(rel, prefix)) &&
        !BINARY_EXTS.some((ext) => rel.endsWith(ext))) ||
      PROSE_TREE_RELS.some((tree) => under(rel, tree)) ||
      ROOT_PROSE_RELS.includes(rel),
  },
});

/**
 * Every scanned site file: TypeScript modules contribute their string
 * literals (code identifiers are not prose), everything else its raw text.
 */
async function siteFiles(files: readonly string[]): Promise<{
  literals: Array<[string, ReturnType<typeof stringLiterals>]>;
  prose: Array<[string, string]>;
}> {
  const literals: Array<[string, ReturnType<typeof stringLiterals>]> = [];
  const prose: Array<[string, string]> = [];
  for (const rel of files.filter((path) => under(path, "site"))) {
    const path = join(REPO_ROOT, rel);
    if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
      literals.push([rel, stringLiterals(await Deno.readTextFile(path))]);
    } else {
      prose.push([rel, await Deno.readTextFile(path)]);
    }
  }
  return { literals, prose };
}

/** The generated glossary page — the declaration surface, where a retired
 * phrase legitimately appears (as a search alias pointing at the canon). */
const GLOSSARY_PAGE = join(
  REPO_AUTHORED_PATHS.mapRel,
  "00-orientation",
  "glossary.md",
);

/** Exclude the glossary and historical or private map records from current-vocabulary enforcement. */
function structurallyExempt(rel: string): boolean {
  return rel === GLOSSARY_PAGE ||
    isRepoMapPath(rel, "_adr") ||
    isRepoMapPath(rel, "_private");
}

/** Match a retired synonym's explicit file or subtree allowance. */
function allowedFor(synonym: RetiredSynonym, rel: string): boolean {
  return (synonym.allowed ?? []).some((a) =>
    rel === a.path || rel.startsWith(a.path)
  );
}

/** Every scanned prose file, as `[repo-relative path, visible text]`. */
async function proseFiles(
  files: readonly string[],
): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const rel of files) {
    if (under(rel, "src") || under(rel, "site") || structurallyExempt(rel)) {
      continue;
    }
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    out.push([rel, visibleMarkdown(text)]);
  }
  return out;
}

Deno.test("no live surface uses vocabulary the term registry retired", async () => {
  const site = await siteFiles(VOCABULARY_FILES);
  const prose = [...(await proseFiles(VOCABULARY_FILES)), ...site.prose];
  const src: Array<[string, ReturnType<typeof stringLiterals>]> = [
    ...site.literals,
    ...await Promise.all(
      VOCABULARY_FILES.filter((rel) => under(rel, "src")).map(async (rel) =>
        [
          rel,
          stringLiterals(await Deno.readTextFile(join(REPO_ROOT, rel))),
        ] as [string, ReturnType<typeof stringLiterals>]
      ),
    ),
  ];

  const offenders: string[] = [];
  for (const { term, synonym } of retiredSynonyms()) {
    const pattern = retiredPattern(synonym);
    const canon = `— retired in favour of "${term}"`;
    for (const [rel, literals] of src) {
      if (allowedFor(synonym, rel)) continue;
      for (const { text, line } of literals) {
        for (const hit of text.match(pattern) ?? []) {
          offenders.push(
            `${rel}:${line} string contains "${
              hit.replace(/\s+/g, " ")
            }" ${canon}`,
          );
        }
      }
    }
    for (const [rel, text] of prose) {
      if (allowedFor(synonym, rel)) continue;
      offenders.push(
        ...bannedPhraseLines(rel, text, pattern).map((f) => `${f} ${canon}`),
      );
    }
  }

  assertEquals(
    offenders,
    [],
    "retired vocabulary returned on a live surface — each phrase's canonical " +
      `term is declared in scripts/glossary_registry.ts:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("every retired-phrase exception still names a real path", async () => {
  const files = await structuralGuardScope({
    guard: "tests/vocab_drift_test.ts#retired-exception-targets",
    universe: {
      kind: "specialized",
      name: "authored text including shipped-template fixtures",
      text: true,
      reason:
        "Retired-phrase allowances may name inert template fixtures omitted by authored-text.",
    },
  });
  for (const { term, synonym } of retiredSynonyms()) {
    for (const { path } of synonym.allowed ?? []) {
      const dir = dirname(path);
      const prefix = basename(path);
      const found = files.some((rel) =>
        dirname(rel) === dir &&
        (basename(rel) === prefix || basename(rel).startsWith(prefix))
      );
      assert(
        found,
        `"${term}" carries a retired-phrase exception for "${path}", but no ` +
          "such path exists — remove the stale exception from the registry",
      );
    }
  }
});

// Positive control on the widened universe: the Git projection really reaches
// the surfaces the scan is meant to police (an empty set would pass vacuously).
Deno.test("the vocabulary scan universe reaches the site tree", async () => {
  const site = await siteFiles(VOCABULARY_FILES);
  assert(
    site.prose.some(([rel]) => rel === "site/pages/assets/og-card.svg"),
    "site prose files should include the social card",
  );
  assert(
    site.literals.some(([rel]) => rel.startsWith("site/")),
    "site TypeScript modules should contribute their string literals",
  );
});

// Positive controls: prove the detector detects, so the guard can't rot into
// a test that passes because it sees nothing.

Deno.test("drift guard: a phrase wrapped across a line break still matches, case-insensitively", () => {
  const pattern = retiredPattern({ phrase: "integration branch" });
  assertEquals(
    bannedPhraseLines(
      "x.md",
      "one\ntwo forked from the Integration\nbranch yesterday",
      pattern,
    ),
    ['x.md:2 contains "Integration branch"'],
  );
});

Deno.test("drift guard: an explicit pattern covers its inflection family, word-bounded", () => {
  const pattern = retiredPattern({
    phrase: "harness",
    pattern: String.raw`\bharness(?:es|ing)?\b`,
  });
  assertEquals("harnessing the harnesses".match(pattern), [
    "harnessing",
    "harnesses",
  ]);
  assertEquals("unharnessed".match(pattern), null);
});

Deno.test("drift guard: every declared matcher recognises its own phrase", () => {
  for (const { term, synonym } of retiredSynonyms()) {
    assert(
      retiredPattern(synonym).test(synonym.phrase),
      `the matcher for "${synonym.phrase}" (under "${term}") does not match ` +
        "its own display phrase — its pattern is wrong",
    );
  }
});
