/**
 * Public-surface PARITY guard — the forcing function that keeps every
 * published manual projection on the strict corpus-policy wrapper.
 *
 * `PUBLIC_DOC_SURFACES` (src/lib/docs.ts) is the SSOT: the projection matrix
 * in code. Two reconciliations give it teeth, modelled on
 * `tests/engine_verb_parity_test.ts`:
 *
 *  1. every enrolled surface's source must consume `buildManualProjection`;
 *  2. no other module under src/, site/, or scripts/ may touch the page-level
 *     `.publish` axis at all — a new renderer that re-derives publication by
 *     hand red-lights here, with the fix being "filter through the predicate
 *     and enrol".
 *
 * When this fails for a new surface, the fix is NOT to weaken the assertion —
 * it is to consume the predicate and add the registry entry.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import {
  PUBLIC_DOC_SURFACES,
  PUBLIC_DOC_SURFACES_PENDING,
} from "../src/lib/docs.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** The model itself — the one definition site of the predicate. */
const MODEL = "src/lib/docs.ts";

/** Files allowed to read `.publish` WITHOUT being a published surface, each
 * with the reason. Anything else that touches the axis must enrol. */
const PUBLISH_ACCESS_EXCEPTIONS = new Map<string, string>([
  [MODEL, "defines isPublicDoc over the field"],
  [
    "src/lib/frontmatter.ts",
    "parses the frontmatter key the flag comes from (the metadata layer, " +
    "below the predicate)",
  ],
  [
    "src/commands/docs.ts",
    "toRecord passes the flag through as a structured field (metadata " +
    "surfacing, not a filter — the filtering goes through publicDocs)",
  ],
  [
    "src/lib/manual.ts",
    "is the strict manual corpus-policy wrapper over the neutral predicate",
  ],
  [
    "scripts/manual_doc_checkpoint.ts",
    "reads one changed page's raw frontmatter from a Git tree to decide " +
    "whether a checkpoint covers it; the corpus projection cannot answer for " +
    "a deleted page, and a page missing the key must fire the checkpoint " +
    "closed rather than resolve to unpublished",
  ],
]);

const consumesPredicate = (text: string): boolean =>
  /\bbuildManualProjection\b/.test(text);

Deno.test("every enrolled surface consumes the predicate; every pending one does not yet", async () => {
  for (const surface of PUBLIC_DOC_SURFACES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, surface.source));
    assert(
      consumesPredicate(text),
      `enrolled surface "${surface.name}" (${surface.source}) no longer ` +
        "references buildManualProjection — re-wire it through the canonical " +
        "manual model (or remove the entry if the surface is gone)",
    );
  }
  for (const surface of PUBLIC_DOC_SURFACES_PENDING) {
    const text = await Deno.readTextFile(join(REPO_ROOT, surface.source));
    assert(
      !consumesPredicate(text),
      `pending surface "${surface.name}" (${surface.source}) now consumes ` +
        "the predicate — move its entry from PUBLIC_DOC_SURFACES_PENDING to " +
        "PUBLIC_DOC_SURFACES",
    );
  }
});

Deno.test("no module outside the registry touches the page-level publish axis", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/public_doc_parity_test.ts#publication-axis-readers",
      universe: "authored-ts",
      narrow: {
        reason:
          "The publication model governs production, site, and repository-tool modules; tests consume its outputs as controls.",
        include: (path) =>
          path.startsWith("src/") || path.startsWith("site/") ||
          path.startsWith("scripts/"),
      },
    })
  ) {
    if (PUBLISH_ACCESS_EXCEPTIONS.has(rel)) continue;
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\.publish\b/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "these modules read .publish by hand — consume isPublicDoc/publicDocs " +
      "from src/lib/docs.ts or the strict wrapper in src/lib/manual.ts",
  );
});

Deno.test("the exception list and registry stay honest", async () => {
  // Every exception file still exists and still touches the axis (a stale
  // exception is a loophole waiting for a new file of the same name).
  for (const [rel, reason] of PUBLISH_ACCESS_EXCEPTIONS) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    assert(
      /\.publish\b/.test(text),
      `${rel} is excepted (${reason}) but no longer reads .publish — drop ` +
        "the exception",
    );
  }
  // Registry entries are unique per (name); sources exist.
  const names = [...PUBLIC_DOC_SURFACES, ...PUBLIC_DOC_SURFACES_PENDING]
    .map((s) => s.name);
  assertEquals(names.length, new Set(names).size, "duplicate surface names");
});
