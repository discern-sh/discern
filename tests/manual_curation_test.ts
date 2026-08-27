/** Canonical section, curation, and binary-staging guards for the manual. */

import { dirname, join, SEPARATOR } from "@std/path";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { discoverDocs, structuredLinkDestinations } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { MANUAL_SECTION_REGISTRY } from "../src/shared/manual.ts";
import { stageBundledManual } from "../scripts/build.ts";
import { loadDocsSite } from "../site/docs.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

async function projection() {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
  });
  if (tree === undefined) throw new Error("the repository manual is missing");
  return await buildManualProjection(tree.entries);
}

/** Resolve README links to direct sibling pages in authored order. */
async function curatedSiblingPaths(
  readmePath: string,
  siblingPaths: ReadonlySet<string>,
): Promise<string[]> {
  const markdown = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.manual, readmePath),
  );
  const dir = dirname(readmePath);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const authored of structuredLinkDestinations(markdown)) {
    const destination = authored.replace(/#.*$/u, "");
    if (!destination.toLowerCase().endsWith(".md")) continue;
    const rel = join(dir, destination).replaceAll(SEPARATOR, "/");
    if (!siblingPaths.has(rel) || seen.has(rel)) continue;
    seen.add(rel);
    paths.push(rel);
  }
  return paths;
}

Deno.test("manual sections, source directories, site, and projection share one registry order", async () => {
  const manual = await projection();
  const site = await loadDocsSite();
  const physical: string[] = [];
  for await (const entry of Deno.readDir(REPO_AUTHORED_PATHS.manual)) {
    if (entry.isDirectory) physical.push(entry.name);
  }
  physical.sort();
  const registered = MANUAL_SECTION_REGISTRY.map((section) => section.dir);
  assertEquals(physical, registered);
  assertEquals(manual.sections.map((section) => section.dir), registered);
  assertEquals(site.sections.map((section) => section.dir), registered);
  assertEquals(manual.pages.length, 47);
  assertEquals(
    manual.pages.filter((page) => page.kind === "tutorial").length,
    3,
  );
  assertEquals(manual.pages.filter((page) => page.kind === "guide").length, 15);
  assertEquals(
    manual.pages.filter((page) => page.kind === "explanation").length,
    11,
  );
  assertEquals(
    manual.pages.filter((page) => page.kind === "reference").length,
    12,
  );
  assertEquals(
    manual.pages.filter((page) => page.kind === "troubleshooting").length,
    6,
  );
});

Deno.test("each section front door curates every leaf in canonical model order", async () => {
  const manual = await projection();
  const issues: string[] = [];
  for (const section of manual.sections) {
    const leafPaths = section.pages.filter((page) => !page.isIndex)
      .map((page) => page.entry.relToDocs);
    const curated = await curatedSiblingPaths(
      section.index.entry.relToDocs,
      new Set(leafPaths),
    );
    if (JSON.stringify(curated) !== JSON.stringify(leafPaths)) {
      issues.push(
        `${section.dir}: README links ${JSON.stringify(curated)}; model ${
          JSON.stringify(leafPaths)
        }`,
      );
    }
  }
  assertEquals(issues, []);
});

Deno.test("binary staging is a fresh byte-identical manual projection with no Map tree", async () => {
  await withTempDir(async (dir) => {
    const destination = join(dir, "stage", "docs");
    await Deno.mkdir(join(destination, "_private"), { recursive: true });
    await Deno.writeTextFile(
      join(destination, "_private", "stale-map-byte.md"),
      "protected Map material",
    );

    const manual = await projection();
    const expected = manual.pages.map((page) => page.entry.relToDocs);
    const copied = await stageBundledManual(
      REPO_AUTHORED_PATHS.manual,
      destination,
    );
    assertEquals(copied, expected);
    assertFalse(await targetExists(join(destination, "_private")));
    assertFalse(await targetExists(join(destination, "_adr")));

    const stagedTree = await discoverDocs({
      cwd: dir,
      dir: destination,
      includeInternal: true,
    });
    assert(stagedTree !== undefined);
    assertEquals(
      stagedTree.entries.map((entry) => entry.relToDocs).sort(),
      [...expected].sort(),
    );
    for (const page of manual.pages) {
      assertEquals(
        await Deno.readFile(join(destination, page.entry.relToDocs)),
        await Deno.readFile(page.entry.absPath),
      );
    }
  });
});
