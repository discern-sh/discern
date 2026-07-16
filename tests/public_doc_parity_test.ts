/**
 * Public-surface PARITY guard — the forcing function that keeps every
 * published projection of a doc tree on the model's ONE page-level predicate.
 *
 * `PUBLIC_DOC_SURFACES` (src/lib/docs.ts) is the SSOT: the projection matrix
 * in code. Two reconciliations give it teeth, modelled on
 * `tests/engine_verb_parity_test.ts`:
 *
 *  1. every enrolled surface's source must actually consume `isPublicDoc` /
 *     `publicDocs`, and every pending surface must NOT yet (the day its
 *     wiring lands, it must move to the enrolled list or this fails);
 *  2. no other module under src/, site/, or scripts/ may touch the page-level
 *     `.publish` axis at all — a new renderer that re-derives publication by
 *     hand red-lights here, with the fix being "filter through the predicate
 *     and enrol".
 *
 * When this fails for a new surface, the fix is NOT to weaken the assertion —
 * it is to consume the predicate and add the registry entry.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import {
  PUBLIC_DOC_SURFACES,
  PUBLIC_DOC_SURFACES_PENDING,
} from "../src/lib/docs.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

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
]);

const consumesPredicate = (text: string): boolean =>
  /\b(isPublicDoc|publicDocs)\b/.test(text);

Deno.test("every enrolled surface consumes the predicate; every pending one does not yet", async () => {
  for (const surface of PUBLIC_DOC_SURFACES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, surface.source));
    assert(
      consumesPredicate(text),
      `enrolled surface "${surface.name}" (${surface.source}) no longer ` +
        "references isPublicDoc/publicDocs — re-wire it through the model's " +
        "predicate (or remove the registry entry if the surface is gone)",
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
  for (const root of ["src", "site", "scripts"]) {
    for await (
      const entry of walk(join(REPO_ROOT, root), {
        exts: [".ts"],
        includeDirs: false,
        skip: [/node_modules/],
      })
    ) {
      const rel = relative(REPO_ROOT, entry.path);
      if (PUBLISH_ACCESS_EXCEPTIONS.has(rel)) continue;
      const text = await Deno.readTextFile(entry.path);
      if (/\.publish\b/.test(text)) {
        offenders.push(rel);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "these modules read .publish by hand — consume isPublicDoc/publicDocs " +
      "from src/lib/docs.ts and enrol in PUBLIC_DOC_SURFACES instead",
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
