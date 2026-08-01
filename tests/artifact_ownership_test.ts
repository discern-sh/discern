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
  writtenArtifactClass,
} from "../src/lib/artifact_ownership.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  declaredFileOwnership,
  declaredWrittenArtifactClass,
  discernProjectPayloadLicense,
  PROVIDER_LOCAL,
} from "../src/shared/file_ownership.ts";
import {
  DISCERN_PROJECT_PAYLOAD_LICENSE,
  FIRST_PARTY_LEGAL_DOCUMENTS,
} from "../src/shared/license_registry.ts";
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

Deno.test("every discern-written project artifact declares one provenance class", () => {
  const entries = projectArtifactPaths(parseConfigOrThrow(""));
  let classified = 0;
  for (const entry of entries) {
    const ownership = declaredFileOwnership(entry);
    const artifactClass = writtenArtifactClass(entry);
    if (ownership === "shared" || ownership === "generated") {
      assert(
        artifactClass !== undefined,
        `${entry.path} is ${ownership} but has no written-artifact class`,
      );
      classified++;
      if (artifactClass === "comment-incapable") {
        assert(
          entry.path.endsWith(".json"),
          `${entry.path} is comment-incapable, but JSON is the only permanent exemption`,
        );
      }
      continue;
    }
    assertEquals(
      artifactClass,
      undefined,
      `${entry.path} is ${ownership} and is not continuing discern output`,
    );
  }
  assert(classified > 0, "expected at least one discern-written artifact");
});

Deno.test("every registered discern-authored project payload is Apache-2.0", () => {
  const entries = projectArtifactPaths(parseConfigOrThrow(""));
  for (const entry of entries) {
    const expected = declaredFileOwnership(entry) === PROVIDER_LOCAL
      ? undefined
      : DISCERN_PROJECT_PAYLOAD_LICENSE.identifier;
    assertEquals(
      discernProjectPayloadLicense(entry),
      expected,
      `${entry.path} has the wrong discern-authored payload license`,
    );
  }

  assertEquals(
    discernProjectPayloadLicense({
      id: "synthetic:future-artifact",
      ownership: { generated: true },
    }),
    DISCERN_PROJECT_PAYLOAD_LICENSE.identifier,
    "a future registered artifact must inherit the payload license without a second list",
  );
});

Deno.test("configured worktree env files enter the project-artifact registry", () => {
  const config = parseConfigOrThrow(`
[worktree]
env_files = ["config/secrets", ".env.override"]
`);
  const envPaths = projectArtifactPaths(config)
    .filter((entry) => entry.id.startsWith("fixed:environment:"))
    .map((entry) => entry.path);
  assertEquals(envPaths, ["config/secrets", ".env.override"]);
});

Deno.test("first-party legal documents never enter the project footprint", () => {
  const projectPaths = new Set(
    projectArtifactPaths(parseConfigOrThrow("")).map((entry) => entry.path),
  );
  for (const document of FIRST_PARTY_LEGAL_DOCUMENTS) {
    assert(
      !projectPaths.has(document.path),
      `${document.path} must stay in discern's distribution, outside user projects`,
    );
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

Deno.test("provenance guard: an unclassified synthetic artifact fails", () => {
  assertThrows(
    () =>
      declaredWrittenArtifactClass({
        id: "synthetic:none",
        writtenArtifact: {},
      }),
    Error,
    "found 0",
  );
});

Deno.test("provenance guard: a double-classified synthetic artifact fails", () => {
  assertThrows(
    () =>
      declaredWrittenArtifactClass({
        id: "synthetic:two",
        writtenArtifact: {
          "context-loaded": true,
          "comment-incapable": true,
        },
      }),
    Error,
    "found 2",
  );
});

Deno.test("provenance guard: a comment-capable artifact names its source", () => {
  assertThrows(
    () =>
      declaredWrittenArtifactClass({
        id: "synthetic:source",
        writtenArtifact: { "comment-capable-non-context": "" },
      }),
    Error,
    "must name the source",
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
