/**
 * Published prose cites decisions in ONE normalized, strippable form:
 * `([ADR NNNN](…/_adr/NNNN-slug.md))` at clause end. Bare `(ADR NNNN)` text
 * and citations woven into sentences as grammatical subjects fail here — the
 * invariant the form buys is that prose reads correctly with the citation
 * deleted, which is what lets human-rendered surfaces strip citations without
 * editorial review. Documentation may cite decisions this liberally BECAUSE
 * the form is mechanical; unpublished tiers and `_private` carry no render
 * contract and are exempt.
 *
 * The check iterates the published tiers off the live allowlist, so a new
 * page — or a newly published tier — auto-enrols.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { assertEquals } from "@std/assert";
import { findMalformedAdrReferences } from "../src/lib/adr_citations.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("published-tier ADR references all take the normalized strippable form", async () => {
  const failures: string[] = [];

  // The published surface: every allowlisted tier, plus the root-level docs
  // (the front door ships in the binary and serves as the site landing).
  const roots = BUNDLED_PUBLIC_DOC_DIRS.map((dir) =>
    join(REPO_AUTHORED_PATHS.map, dir)
  );
  const files: string[] = [];
  for (const root of roots) {
    for await (
      const entry of walk(root, { exts: [".md"], includeDirs: false })
    ) {
      files.push(entry.path);
    }
  }
  for await (const entry of Deno.readDir(REPO_AUTHORED_PATHS.map)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(join(REPO_AUTHORED_PATHS.map, entry.name));
    }
  }

  for (const path of files.sort()) {
    const issues = findMalformedAdrReferences(await Deno.readTextFile(path));
    const rel = relative(REPO_ROOT, path);
    failures.push(
      ...issues.map((i) => `${rel}:${i.line} ${i.text} — ${i.reason}`),
    );
  }
  assertEquals(
    failures,
    [],
    "cite decisions as `([ADR NNNN](…/_adr/NNNN-slug.md))` at clause end — " +
      "prose must read correctly with the citation deleted",
  );
});
