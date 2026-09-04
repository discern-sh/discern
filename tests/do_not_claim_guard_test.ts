/**
 * The absolute do-not-claim list is enforced, not advisory: none of its
 * sentences may appear on a public surface. The scan reads every authored
 * text file except the module that defines the list, the ledger page that
 * renders it, and the private overlay, and matches each sentence exactly —
 * case-insensitively, whitespace collapsed — so a negated or reworded
 * statement passes and the forbidden sentence itself never does.
 *
 * The list is read from the ledger, never restated here, so a sentence
 * added to `DO_NOT_CLAIM` is refused everywhere from the same commit.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DO_NOT_CLAIM } from "../scripts/brand/claims.ts";
import { isRepoMapPath, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const LEDGER_MODULE = "scripts/brand/claims.ts";
const LEDGER_PAGE = "project/map/_internal/brand/claims-and-evidence.md";

const PUBLIC_SURFACES = await structuralGuardScope({
  guard: "tests/do_not_claim_guard_test.ts#public-surfaces",
  universe: "authored-text",
  narrow: {
    reason:
      "The ledger defines and renders the list, and the private overlay is not a public surface.",
    include: (rel) =>
      rel !== LEDGER_MODULE && rel !== LEDGER_PAGE &&
      !isRepoMapPath(rel, "_private"),
  },
});

/** Lowercase with runs of whitespace collapsed, for exact-sentence matching. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/** The forbidden sentences `text` carries. */
export function forbiddenSentences(text: string): string[] {
  const haystack = normalize(text);
  return DO_NOT_CLAIM.filter((sentence) =>
    haystack.includes(normalize(sentence))
  );
}

Deno.test("no public surface carries a do-not-claim sentence", async () => {
  assert(PUBLIC_SURFACES.length > 100, "suspiciously small public surface");
  const offenders: string[] = [];
  for (const rel of PUBLIC_SURFACES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const sentence of forbiddenSentences(text)) {
      offenders.push(`${rel}: “${sentence}”`);
    }
  }
  assertEquals(
    offenders,
    [],
    `a public surface states a sentence the ledger forbids — reword or negate it:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("control: the sentence match fires on the exact claim and stays quiet on its negation", () => {
  const first = DO_NOT_CLAIM[0] ?? "";
  assert(first.length > 0);
  assertEquals(forbiddenSentences(`Some copy.  ${first.toUpperCase()} More.`), [
    first,
  ]);
  assertEquals(
    forbiddenSentences(first.replace(/\s+/g, "\n  ")),
    [first],
    "whitespace differences do not hide the sentence",
  );
  assertEquals(
    forbiddenSentences("discern does not guarantee correct software."),
    [],
  );
  assertEquals(forbiddenSentences("discern is not a sandbox."), []);
});
