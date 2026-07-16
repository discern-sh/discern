/**
 * Architectural guard for what `discern help` ships. The curation rule —
 * "the binary stages exactly the published leaves in its public subtree
 * allowlist" — is the property that keeps unpublished pages and every internal
 * tree out of customer binaries. These tests pin the actual build seam to the
 * document model's one page-level predicate, so a new page cannot ship or be
 * withheld by accident.
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import {
  BUNDLED_PUBLIC_DOC_DIRS,
  HELP_ADR_DOC_DIR,
  isBundledDocEntry,
} from "../src/lib/paths.ts";
import { discoverDocs, isPublicDoc } from "../src/lib/docs.ts";
import { stageBundledDocs } from "../scripts/build.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

const MAP_DIR = REPO_AUTHORED_PATHS.map;

/** This repo's top-level configured-map entry names. */
async function topLevelDocEntries(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MAP_DIR)) names.push(entry.name);
  return names.sort();
}

Deno.test("isBundledDocEntry admits public help tiers and no internal tree", () => {
  assert(isBundledDocEntry("00-orientation"));
  assert(isBundledDocEntry("README.md"));
  assertEquals(isBundledDocEntry(HELP_ADR_DOC_DIR), false);
  assertEquals(isBundledDocEntry("_internal"), false);
  assertEquals(isBundledDocEntry("_private"), false);
  assertEquals(isBundledDocEntry("_anything-new"), false);
  assertEquals(isBundledDocEntry("50-engine-internals"), false);
  assertEquals(isBundledDocEntry("80-development"), false);
  for (const allowed of BUNDLED_PUBLIC_DOC_DIRS) {
    assert(isBundledDocEntry(allowed), `${allowed} should be bundled`);
  }
});

Deno.test("the real configured map admits only public help tiers", async () => {
  const names = await topLevelDocEntries();
  const embedded = names.filter(isBundledDocEntry);
  const internalEmbedded = embedded.filter((n) => n.startsWith("_"));

  assertEquals(internalEmbedded, []);
  assert(
    !embedded.includes(HELP_ADR_DOC_DIR),
    "decision records must not ship",
  );
  assert(!embedded.includes("_private"), "_private must never be embedded");
  assert(!embedded.includes("_internal"), "_internal must never be embedded");

  // Every allowlisted public tree ships; the contributor/engine-internals trees
  // never do (a user's binary is for operating the harness, not building it).
  for (const dir of BUNDLED_PUBLIC_DOC_DIRS) {
    assert(embedded.includes(dir), `${dir} should be embedded`);
  }
  assert(
    !embedded.includes("50-engine-internals"),
    "engine-internals must not ship in a customer binary",
  );
  assert(
    !embedded.includes("80-development"),
    "the development tree must not ship in a user binary",
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
    assertEquals(await exists(join(stagedDir, HELP_ADR_DOC_DIR)), false);
    assertEquals(await exists(join(stagedDir, "_private")), false);
  });
});

Deno.test("the default help view excludes every internal subtree; --adr reveals only the ADRs", async () => {
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
    assert(!buried, `the default help view leaked an internal doc: ${e.path}`);
  }

  // The --adr view reveals exactly the allowlist — the ADRs, never _internal/_private.
  const adrTree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: MAP_DIR,
    includeInternal: [HELP_ADR_DOC_DIR],
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
