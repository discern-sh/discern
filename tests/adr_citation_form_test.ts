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

import { join } from "@std/path";
import { assertEquals } from "@std/assert";
import { findMalformedAdrReferences } from "../src/lib/adr_citations.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

Deno.test("published-tier ADR references all take the normalized strippable form", async () => {
  const failures: string[] = [];

  const mapPrefix = `${REPO_AUTHORED_PATHS.mapRel}/`;
  const files = await structuralGuardScope({
    guard: "tests/adr_citation_form_test.ts#published-adr-citations",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "The normalized citation form is a publishing contract for root manual pages and registry-declared public tiers only.",
      include: (rel) => {
        if (!rel.startsWith(mapPrefix)) return false;
        const withinMap = rel.slice(mapPrefix.length);
        return !withinMap.includes("/") || BUNDLED_PUBLIC_DOC_DIRS.some(
          (dir) => withinMap.startsWith(`${dir}/`),
        );
      },
    },
  });

  for (const rel of files) {
    const issues = findMalformedAdrReferences(
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    );
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
