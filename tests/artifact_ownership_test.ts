/**
 * File ownership forcing function. The canonical project artifact enumeration
 * derives from the source-path and provider registries, and every entry must
 * carry one bucket or an explained provider-local outside category.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  isDiscernWriteTarget,
  projectArtifactPaths,
  renderArtifactInventory,
  replaceArtifactInventory,
} from "../src/lib/artifact_ownership.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  declaredFileOwnership,
  PROVIDER_LOCAL,
} from "../src/shared/file_ownership.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

Deno.test("every canonical project artifact declares one File ownership answer", () => {
  const entries = projectArtifactPaths(parseConfigOrThrow(""));
  assert(entries.length > 0, "the project artifact registry must not be empty");
  const seen = new Set<string>();
  for (const entry of entries) {
    const kind = declaredFileOwnership(entry);
    assert(
      !seen.has(entry.path),
      `${entry.path} appears more than once in the normalized enumeration`,
    );
    seen.add(entry.path);
    if (kind === PROVIDER_LOCAL) {
      assertEquals(isDiscernWriteTarget(entry), false);
      assert(
        (entry.ownership[PROVIDER_LOCAL] ?? "").trim().length > 0,
        `${entry.path} must explain why it is provider-local`,
      );
    } else {
      assertEquals(isDiscernWriteTarget(entry), true);
    }
  }
});

// Positive controls: prove the guard rejects both ways an ownership answer can
// be absent or ambiguous, so a green test cannot mean it inspected no markers.

Deno.test("ownership guard: an unbucketed synthetic entry fails", () => {
  assertThrows(
    () => declaredFileOwnership({ id: "synthetic:none", ownership: {} }),
    Error,
    "found 0",
  );
});

Deno.test("ownership guard: a double-bucketed synthetic entry fails", () => {
  assertThrows(
    () =>
      declaredFileOwnership({
        id: "synthetic:two",
        ownership: { "project-owned": true, shared: true },
      }),
    Error,
    "found 2",
  );
});

Deno.test("ownership guard: provider-local needs a reason", () => {
  assertThrows(
    () =>
      declaredFileOwnership({
        id: "synthetic:local",
        ownership: { "provider-local": "" },
      }),
    Error,
    "must explain",
  );
});

Deno.test("the ownership references match the canonical enumeration", async () => {
  const inventory = renderArtifactInventory(
    projectArtifactPaths(parseConfigOrThrow("")),
  );
  for (
    const rel of [
      "70-reference/artifact-ownership.md",
      "80-development/install-surface.md",
    ]
  ) {
    const path = `${REPO_AUTHORED_PATHS.map}/${rel}`;
    const committed = await Deno.readTextFile(path);
    assertEquals(
      committed,
      await canonicalGeneratedMarkdown(
        path,
        replaceArtifactInventory(committed, inventory),
      ),
      `${REPO_AUTHORED_PATHS.mapRel}/${rel} is stale — run \`deno task codegen\``,
    );
  }
});
