/**
 * Vocabulary-drift guard — retired wording is DATA on the term registry, and
 * this one parameterized scan polices all of it.
 *
 * A glossary entry declares the synonyms the canon retired in its favour
 * (`retired` on `scripts/glossary_registry.ts`); this guard bans every such
 * phrase from the live prose surfaces — the binary's user-facing string
 * literals, the shipped templates and their fixtures, the skills, the project
 * scripts, the public map, the mockups, and the root prose files. Retiring a
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
import { walk } from "@std/fs";
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

const SRC = join(REPO_ROOT, "src");

/** The prose trees a user or their agent reads, walked in full. */
const PROSE_TREES = [
  join(REPO_ROOT, "templates"),
  join(REPO_ROOT, "tests", "fixtures", "templates"),
  REPO_AUTHORED_PATHS.skills,
  REPO_AUTHORED_PATHS.scripts,
  REPO_AUTHORED_PATHS.map,
  join(REPO_ROOT, "mockups"),
];

/** The root prose files held to the canon alongside the trees. */
const ROOT_PROSE = [
  join(REPO_ROOT, "README.md"),
  join(REPO_ROOT, "CONTRIBUTING.md"),
  join(REPO_ROOT, "discern.toml"),
  ...REPO_AUTHORED_PATHS.guidance,
];

/** The generated glossary page — the declaration surface, where a retired
 * phrase legitimately appears (as a search alias pointing at the canon). */
const GLOSSARY_PAGE = join(
  REPO_AUTHORED_PATHS.mapRel,
  "00-orientation",
  "glossary.md",
);

function structurallyExempt(rel: string): boolean {
  return rel === GLOSSARY_PAGE ||
    isRepoMapPath(rel, "_adr") ||
    isRepoMapPath(rel, "_private");
}

function allowedFor(synonym: RetiredSynonym, rel: string): boolean {
  return (synonym.allowed ?? []).some((a) =>
    rel === a.path || rel.startsWith(a.path)
  );
}

/** Every scanned prose file, as `[repo-relative path, visible text]`. */
async function proseFiles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const root of PROSE_TREES) {
    for await (const entry of walk(root, { includeDirs: false })) {
      const rel = relative(REPO_ROOT, entry.path);
      if (structurallyExempt(rel)) continue;
      let text: string;
      try {
        text = await Deno.readTextFile(entry.path);
      } catch {
        continue; // non-text / unreadable → nothing to drift
      }
      out.push([rel, visibleMarkdown(text)]);
    }
  }
  for (const path of ROOT_PROSE) {
    out.push([
      relative(REPO_ROOT, path),
      visibleMarkdown(await Deno.readTextFile(path)),
    ]);
  }
  return out;
}

Deno.test("no live surface uses vocabulary the term registry retired", async () => {
  const prose = await proseFiles();
  const src: Array<[string, ReturnType<typeof stringLiterals>]> = [];
  for await (const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })) {
    src.push([
      relative(REPO_ROOT, entry.path),
      stringLiterals(await Deno.readTextFile(entry.path)),
    ]);
  }

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
  for (const { term, synonym } of retiredSynonyms()) {
    for (const { path } of synonym.allowed ?? []) {
      const dir = join(REPO_ROOT, dirname(path));
      const prefix = basename(path);
      let found = false;
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.name === prefix || entry.name.startsWith(prefix)) {
            found = true;
            break;
          }
        }
      } catch {
        // missing directory → the exception is stale
      }
      assert(
        found,
        `"${term}" carries a retired-phrase exception for "${path}", but no ` +
          "such path exists — remove the stale exception from the registry",
      );
    }
  }
});

Deno.test('README keeps exactly one searchable category use, reading "quality harness"', async () => {
  const family = retiredSynonyms().find(({ synonym }) =>
    synonym.phrase === "harness"
  );
  assert(
    family !== undefined,
    "the registry no longer retires the harness category — drop this " +
      "companion test with the README exception, or restore the synonym",
  );
  const readme = visibleMarkdown(
    await Deno.readTextFile(join(REPO_ROOT, "README.md")),
  );
  assertEquals(
    readme.match(retiredPattern(family.synonym)) ?? [],
    ["harness"],
    "README.md keeps exactly one searchable category use",
  );
  assert(
    /\bquality harness\b/i.test(readme),
    'README.md\'s sole category use must read "quality harness"',
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
