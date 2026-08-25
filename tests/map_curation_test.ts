/**
 * Architectural guard for what `discern docs` ships. Every numbered manual
 * section must be classified in the total registry, and every public projection
 * must agree with its public subset. These tests also pin the actual build seam
 * to the document model's page-level predicate, so a new section or page cannot
 * ship or be withheld by accident.
 */

import { assert, assertEquals } from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { dirname, join, SEPARATOR } from "@std/path";
import {
  BUNDLED_PUBLIC_DOC_DIRS,
  DOCS_ADR_DOC_DIR,
  isBundledDocEntry,
  MANUAL_SECTION_REGISTRY,
  type ManualSectionRegistration,
} from "../src/lib/paths.ts";
import {
  discoverDocs,
  type DocEntry,
  isPublicDoc,
  structuredLinkDestinations,
} from "../src/lib/docs.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { stageBundledDocs } from "../scripts/build.ts";
import { loadDocsSite } from "../site/docs.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const MAP_DIR = REPO_AUTHORED_PATHS.map;
const MAP_MARKDOWN_FILES = await structuralGuardScope({
  guard: "tests/map_curation_test.ts#configured-map-sections",
  universe: "tracked-markdown",
  narrow: {
    reason:
      "Section classification and projection are contracts of this repository's configured map tree.",
    include: (rel) => rel.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/`),
  },
});

/** This repo's top-level configured-map entry names. */
function topLevelDocEntries(): string[] {
  const prefix = `${REPO_AUTHORED_PATHS.mapRel}/`;
  return [
    ...new Set(
      MAP_MARKDOWN_FILES.map((rel) => rel.slice(prefix.length).split("/")[0])
        .filter((name): name is string => name !== undefined),
    ),
  ].sort();
}

/** Every numbered map directory, independent of its current registry name. */
function numberedSectionDirs(): string[] {
  const prefix = `${REPO_AUTHORED_PATHS.mapRel}/`;
  return [
    ...new Set(MAP_MARKDOWN_FILES.flatMap((rel) => {
      const within = rel.slice(prefix.length);
      const name = within.split("/")[0];
      return within.includes("/") && name !== undefined && /^\d\d-/.test(name)
        ? [name]
        : [];
    })),
  ].sort();
}

/** The public section rows authored under the manual's `The sections` H2. */
async function manualIndexSectionDirs(): Promise<string[]> {
  const markdown = await Deno.readTextFile(join(MAP_DIR, "README.md"));
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## The sections");
  assert(start >= 0, "the manual index has a `The sections` heading");
  const nextHeading = lines.findIndex((line, index) =>
    index > start && /^##\s+/.test(line)
  );
  const section = lines.slice(
    start + 1,
    nextHeading < 0 ? undefined : nextHeading,
  )
    .join("\n");
  return structuredLinkDestinations(section)
    .map((destination) => destination.replace(/#.*$/, ""))
    .filter((destination) => /^\d\d-[^/]+\/$/.test(destination))
    .map((destination) => destination.slice(0, -1));
}

interface SectionProjectionSnapshot {
  registrations: readonly ManualSectionRegistration[];
  numberedDirs: readonly string[];
  manualDirs: readonly string[];
  bundledDirs: readonly string[];
  docsDirs: readonly string[];
  siteDirs: readonly string[];
}

/** Report every edge that disagrees with the registry's public subset. */
function sectionProjectionIssues(
  snapshot: SectionProjectionSnapshot,
): string[] {
  const registered = snapshot.registrations.map((section) => section.dir);
  const publicDirs = snapshot.registrations
    .filter((section) => section.audience === "public")
    .map((section) => section.dir);
  const comparisons: Array<
    [label: string, actual: readonly string[], expected: readonly string[]]
  > = [
    ["numbered map sections", snapshot.numberedDirs, registered],
    ["bundled public sections", snapshot.bundledDirs, publicDirs],
    ["manual index sections", snapshot.manualDirs, publicDirs],
    ["docs projection sections", snapshot.docsDirs, publicDirs],
    ["site model sections", snapshot.siteDirs, publicDirs],
  ];
  return comparisons.flatMap(([label, actual, expected]) =>
    JSON.stringify(actual) === JSON.stringify(expected) ? [] : [
      `${label}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    ]
  );
}

/** Resolve the README's structured direct-sibling links in authored order. */
async function curatedSiblingPaths(
  readme: DocEntry,
  sectionEntries: readonly DocEntry[],
): Promise<string[]> {
  const markdown = await Deno.readTextFile(readme.absPath);
  const byRel = new Map(
    sectionEntries.map((entry) => [entry.relToDocs, entry]),
  );
  const dir = dirname(readme.relToDocs);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const authoredDest of structuredLinkDestinations(markdown)) {
    const dest = authoredDest.replace(/#.*$/, "");
    if (!dest.toLowerCase().endsWith(".md")) continue;
    const targetRel = join(dir, dest).replaceAll(SEPARATOR, "/");
    const target = byRel.get(targetRel);
    if (
      target === undefined ||
      target.slug.toLowerCase() === "readme" ||
      dirname(target.relToDocs) !== dir ||
      seen.has(target.relToDocs)
    ) {
      continue;
    }
    seen.add(target.relToDocs);
    paths.push(target.relToDocs);
  }
  return paths;
}

Deno.test("isBundledDocEntry follows the total section registry", () => {
  assert(isBundledDocEntry("README.md"));
  assertEquals(isBundledDocEntry(DOCS_ADR_DOC_DIR), false);
  assertEquals(isBundledDocEntry("_internal"), false);
  assertEquals(isBundledDocEntry("_private"), false);
  assertEquals(isBundledDocEntry("_anything-new"), false);
  for (const section of MANUAL_SECTION_REGISTRY) {
    assertEquals(
      isBundledDocEntry(section.dir),
      section.audience === "public",
      `${section.dir} follows its registered audience`,
    );
  }
});

Deno.test("every numbered section and public projection agrees", async () => {
  const names = topLevelDocEntries();
  const embedded = names.filter(isBundledDocEntry);
  const internalEmbedded = embedded.filter((n) => n.startsWith("_"));
  const numbered = numberedSectionDirs();
  const docsDirs = numbered.filter(isBundledDocEntry);
  const site = await loadDocsSite();

  assertEquals(internalEmbedded, []);
  assert(
    !embedded.includes(DOCS_ADR_DOC_DIR),
    "decision records must not ship",
  );
  assert(!embedded.includes("_private"), "_private must never be embedded");
  assert(!embedded.includes("_internal"), "_internal must never be embedded");
  assertEquals(
    sectionProjectionIssues({
      registrations: MANUAL_SECTION_REGISTRY,
      numberedDirs: numbered,
      manualDirs: await manualIndexSectionDirs(),
      bundledDirs: BUNDLED_PUBLIC_DOC_DIRS,
      docsDirs,
      siteDirs: site.sections.map((section) => section.dir),
    }),
    [],
    "classify every numbered section and keep every public projection in registry order",
  );

  for (const name of names) {
    const isDir = (await Deno.stat(join(MAP_DIR, name))).isDirectory;
    if (!isDir) continue;
    assert(
      name.startsWith("_") || /^\d\d-/.test(name),
      `${REPO_AUTHORED_PATHS.mapRel}/${name}/ is neither numbered (public) nor _-prefixed (private) — ` +
        `number it to ship it, or prefix it with _ to keep it private`,
    );
  }
});

Deno.test("the section projection guard catches fresh-named omissions", () => {
  const base: readonly ManualSectionRegistration[] = [
    { dir: "11-foundations", audience: "public" },
    { dir: "90-maintainers", audience: "contributor" },
  ];
  const unclassified = sectionProjectionIssues({
    registrations: base,
    numberedDirs: ["11-foundations", "55-observability", "90-maintainers"],
    manualDirs: ["11-foundations"],
    bundledDirs: ["11-foundations"],
    docsDirs: ["11-foundations"],
    siteDirs: ["11-foundations"],
  });
  assert(
    unclassified.some((issue) => issue.startsWith("numbered map sections:")),
    unclassified.join("\n"),
  );

  const registered: readonly ManualSectionRegistration[] = [
    ...base.slice(0, 1),
    { dir: "55-observability", audience: "public" },
    ...base.slice(1),
  ];
  const missingIndex = sectionProjectionIssues({
    registrations: registered,
    numberedDirs: ["11-foundations", "55-observability", "90-maintainers"],
    manualDirs: ["11-foundations"],
    bundledDirs: ["11-foundations", "55-observability"],
    docsDirs: ["11-foundations", "55-observability"],
    siteDirs: ["11-foundations", "55-observability"],
  });
  assertEquals(missingIndex.length, 1);
  assert(missingIndex[0]?.startsWith("manual index sections:"));
});

Deno.test("public section metadata, curation, and model order agree", async () => {
  const tree = await discoverDocs({ cwd: REPO_ROOT, dir: MAP_DIR });
  assert(tree, "the configured map exists");
  const issues: string[] = [];
  for (const dir of BUNDLED_PUBLIC_DOC_DIRS) {
    const sectionEntries = tree.entries.filter((entry) =>
      entry.section === dir
    );
    const publicEntries = sectionEntries.filter(isPublicDoc);
    const indexes = publicEntries.filter((entry) =>
      entry.slug.toLowerCase() === "readme"
    );
    if (indexes.length !== 1) {
      issues.push(`${dir}: expected one public README, got ${indexes.length}`);
      continue;
    }
    const readme = indexes[0];
    assert(readme !== undefined);
    const leaves = publicEntries.filter((entry) => entry !== readme);
    let previousOrder = 0;
    for (const entry of publicEntries) {
      const { meta } = parseFrontmatter(await Deno.readTextFile(entry.absPath));
      if (meta.description === undefined) {
        issues.push(`${entry.relToDocs}: missing explicit description`);
      }
      if (meta.aliases === undefined || meta.aliases.length === 0) {
        issues.push(`${entry.relToDocs}: missing explicit aliases`);
      }
      if (entry !== readme) {
        if (meta.order === undefined) {
          issues.push(`${entry.relToDocs}: missing explicit order`);
        } else if (meta.order % 10 !== 0) {
          issues.push(
            `${entry.relToDocs}: order ${meta.order}; expected a multiple of 10`,
          );
        } else if (meta.order <= previousOrder) {
          issues.push(
            `${entry.relToDocs}: order ${meta.order}; expected greater than ${previousOrder}`,
          );
        } else {
          previousOrder = meta.order;
        }
      }
    }
    const curated = await curatedSiblingPaths(readme, sectionEntries);
    const ordered = leaves.map((entry) => entry.relToDocs);
    if (JSON.stringify(curated) !== JSON.stringify(ordered)) {
      issues.push(
        `${dir}: README links ${JSON.stringify(curated)}; model order ${
          JSON.stringify(ordered)
        }`,
      );
    }
  }
  assertEquals(
    issues,
    [],
    "public READMEs, explicit metadata, leaf order, and model order must agree",
  );
});

Deno.test("the staged file set equals the public projection", async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, "map");
    const files: Record<string, string> = {
      "README.md": "# Public front door\n",
      "00-orientation/README.md": "# Orientation\n",
      "00-orientation/public.md": "# Public page\n",
      "00-orientation/withheld.md":
        "---\npublish: false\n---\n# Withheld page\n",
      "50-engine-internals/implementation.md": "# Implementation\n",
      "_adr/0001-private-history.md": "# Decision history\n",
      "_private/notes.md": "# Private notes\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      const path = join(source, rel);
      await Deno.mkdir(join(path, ".."), { recursive: true });
      await Deno.writeTextFile(path, content);
    }

    const sourceTree = await discoverDocs({
      cwd: dir,
      dir: source,
      includeInternal: false,
    });
    assert(sourceTree);
    const expected = sourceTree.entries
      .filter((entry) => {
        const topLevel = entry.relToDocs.split("/")[0] ?? entry.relToDocs;
        return isBundledDocEntry(topLevel) && isPublicDoc(entry);
      })
      .map((entry) => entry.relToDocs);

    const stagedDir = join(dir, "staged", "docs");
    const copied = await stageBundledDocs(source, stagedDir);
    const stagedTree = await discoverDocs({
      cwd: dir,
      dir: stagedDir,
      includeInternal: true,
    });
    assert(stagedTree);
    const actual = stagedTree.entries.map((entry) => entry.relToDocs);

    assertEquals(copied, expected);
    assertEquals(actual, expected);
    assert(!actual.includes("00-orientation/withheld.md"));
    assertEquals(await targetExists(join(stagedDir, DOCS_ADR_DOC_DIR)), false);
    assertEquals(await targetExists(join(stagedDir, "_private")), false);
  });
});

Deno.test("the default docs view excludes every internal subtree; --adr reveals only the ADRs", async () => {
  // Default view: not one indexed doc sits under a `_`-prefixed segment.
  const publicTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: MAP_DIR,
    includeInternal: false,
  });
  assert(publicTree);
  for (const e of publicTree.entries) {
    const buried = e.relToDocs.split("/").slice(0, -1).some((s) =>
      s.startsWith("_")
    );
    assert(!buried, `the default docs view leaked an internal doc: ${e.path}`);
  }

  // The --adr view reveals exactly the allowlist — the ADRs, never _internal/_private.
  const adrTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: MAP_DIR,
    includeInternal: [DOCS_ADR_DOC_DIR],
  });
  assert(adrTree);
  assert(
    adrTree.entries.some((e) => e.path.includes("/_adr/")),
    "--adr must surface the ADR tree",
  );
  for (const e of adrTree.entries) {
    assert(
      !e.path.includes("/_internal/") && !e.path.includes("/_private/"),
      `--adr leaked a non-allowlisted internal doc: ${e.path}`,
    );
  }
});
