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

import { assertEquals } from "@std/assert";
import { findMalformedAdrReferences } from "../src/lib/adr_citations.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("published-tier ADR references all take the normalized strippable form", async () => {
  const failures: string[] = [];

  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
  });
  if (tree === undefined) throw new Error("the repository manual is missing");
  const manual = await buildManualProjection(tree.entries);

  for (const page of manual.pages) {
    const issues = findMalformedAdrReferences(
      await Deno.readTextFile(page.entry.absPath),
    );
    failures.push(
      ...issues.map((i) =>
        `${page.entry.path}:${i.line} ${i.text} — ${i.reason}`
      ),
    );
  }
  assertEquals(
    failures,
    [],
    "cite decisions as `([ADR NNNN](…/_adr/NNNN-slug.md))` at clause end — " +
      "prose must read correctly with the citation deleted",
  );
});
