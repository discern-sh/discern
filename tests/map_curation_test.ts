/**
 * Architectural guard for what `discern help` ships. The curation rule —
 * "public docs + the explicit `BUNDLED_INTERNAL_DOC_DIRS` allowlist ship; every
 * other `_`-prefixed tree (`_internal`, `_private`, …) stays out of the binary
 * AND the default view" — is the property that lets a new private doc tree be
 * safe the moment it is created, with no list to remember. These tests pin it
 * against THIS repo's configured map and the one predicate the build filters
 * on ({@link isBundledDocEntry}), so a regression (a private tree leaking into
 * the embed, or the build and the view disagreeing) fails the gate rather than a
 * customer binary.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  BUNDLED_INTERNAL_DOC_DIRS,
  BUNDLED_PUBLIC_DOC_DIRS,
  isBundledDocEntry,
} from "../src/lib/paths.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

const MAP_DIR = REPO_AUTHORED_PATHS.map;

/** This repo's top-level configured-map entry names. */
async function topLevelDocEntries(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MAP_DIR)) names.push(entry.name);
  return names.sort();
}

Deno.test("isBundledDocEntry ships public + the ADR allowlist, and nothing else internal", () => {
  // Allowlisted public entries and the root README ship; the never-ship private
  // trees do not.
  assert(isBundledDocEntry("00-orientation"));
  assert(isBundledDocEntry("README.md"));
  assertEquals(isBundledDocEntry("_internal"), false);
  assertEquals(isBundledDocEntry("_private"), false);
  // A brand-new `_`-prefixed tree is private by default — no list to update.
  assertEquals(isBundledDocEntry("_anything-new"), false);
  // The contributor/engine-internals trees are for people working ON discern,
  // not using it — they never ship in a customer binary.
  assertEquals(isBundledDocEntry("50-engine-internals"), false);
  assertEquals(isBundledDocEntry("80-development"), false);
  // Exactly the allowlists ship — the ADR internal tree, and every user-relevant
  // public tree.
  for (const allowed of BUNDLED_INTERNAL_DOC_DIRS) {
    assert(isBundledDocEntry(allowed), `${allowed} should be bundled`);
  }
  for (const allowed of BUNDLED_PUBLIC_DOC_DIRS) {
    assert(isBundledDocEntry(allowed), `${allowed} should be bundled`);
  }
});

Deno.test("the real configured map embeds only public docs + the allowlist", async () => {
  const names = await topLevelDocEntries();
  const embedded = names.filter(isBundledDocEntry);
  const internalEmbedded = embedded.filter((n) => n.startsWith("_"));

  // The only `_`-prefixed trees that ship are exactly the allowlist — so the
  // maintainer/internal material under `_private/` and `_internal/` never does.
  assertEquals(internalEmbedded.sort(), [...BUNDLED_INTERNAL_DOC_DIRS].sort());
  assert(!embedded.includes("_private"), "_private must never be embedded");
  assert(!embedded.includes("_internal"), "_internal must never be embedded");

  // Every allowlisted public tree ships; the contributor/engine-internals trees
  // never do (a user's binary is for operating the harness, not building it).
  for (const dir of BUNDLED_PUBLIC_DOC_DIRS) {
    assert(embedded.includes(dir), `${dir} should be embedded`);
  }
  assert(
    !embedded.includes("50-engine-internals"),
    "engine-internals must not ship in a user binary",
  );
  assert(
    !embedded.includes("80-development"),
    "the development tree must not ship in a user binary",
  );

  // Every top-level dir is either a numbered public subtree or `_`-prefixed —
  // nothing can be private-by-intent yet ship because someone forgot the prefix.
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
    includeInternal: BUNDLED_INTERNAL_DOC_DIRS,
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
