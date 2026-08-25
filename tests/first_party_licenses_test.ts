/**
 * First-party legal-package forcing function: authored files, metadata, and
 * the generated binary payload all derive from one registry.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
  FIRST_PARTY_LICENSE_ARTIFACT_PATHS,
  firstPartyLicenseBundlePayload,
  generateFirstPartyLicenseBundle,
  readFirstPartyLicenseBundle,
  renderFirstPartyLicenseBundleModule,
  sameFirstPartyLicenseBundlePayload,
} from "../src/shared/first_party_license_codegen.ts";
import {
  DISCERN_PROJECT_PAYLOAD_LICENSE,
  DISCERN_SOFTWARE_LICENSE,
  FIRST_PARTY_LEGAL_DOCUMENTS,
  type FirstPartyLegalDocumentDeclaration,
} from "../src/shared/license_registry.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { firstPartyLicenseBundleSchema } from "../src/shared/license_bundle_schemas.ts";
import { decodeJson } from "../src/shared/runtime_decode.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const DENO_LICENSE_SCHEMA = z.object({
  license: z.string().optional(),
}).passthrough();

const repoRoot = REPO_ROOT;

Deno.test("embedded first-party documents validate before license use", () => {
  const error = assertThrows(
    () =>
      decodeJson(
        firstPartyLicenseBundleSchema,
        JSON.stringify({
          documents: [{
            key: "fixture",
            kind: "notice",
            identifier: "FIXTURE",
            title: "fixture",
            path: "NOTICE.fixture",
            smokeMarker: "fixture",
            text: false,
          }],
        }),
        "embedded first-party license fixture",
      ),
    Error,
  );
  assertStringIncludes(error.message, "embedded first-party license fixture");
  assertStringIncludes(error.message, "documents.0.text");
});

Deno.test("every authored first-party legal document is registered exactly once", async () => {
  const declaredPaths = FIRST_PARTY_LEGAL_DOCUMENTS.map((document) =>
    document.path
  );
  const keys = FIRST_PARTY_LEGAL_DOCUMENTS.map((document) => document.key);
  assertEquals(new Set(declaredPaths).size, declaredPaths.length);
  assertEquals(new Set(keys).size, keys.length);
  assertEquals(declaredPaths.filter((path) => path === "LICENSE"), ["LICENSE"]);
  assertEquals(declaredPaths.filter((path) => path === "NOTICE"), ["NOTICE"]);

  const authoredPaths = await structuralGuardScope({
    guard: "tests/first_party_licenses_test.ts#legal-document-registry",
    universe: "authored-text",
    narrow: {
      reason:
        "The first-party legal registry governs root notices and the LICENSES tree.",
      include: (rel) =>
        rel === "LICENSE" || rel === "NOTICE" || rel.startsWith("LICENSES/"),
    },
  });
  assertEquals(
    [...declaredPaths].sort(),
    authoredPaths.sort(),
    "add every first-party file under LICENSES/ to FIRST_PARTY_LEGAL_DOCUMENTS",
  );
});

Deno.test("the first-party bundle embeds every registered source byte-for-byte", async () => {
  const generated = await generateFirstPartyLicenseBundle({ repoRoot });
  assertEquals(
    generated.documents.map((document) => document.key),
    FIRST_PARTY_LEGAL_DOCUMENTS.map((document) => document.key),
  );
  for (const document of generated.documents) {
    assertEquals(
      document.text,
      await Deno.readTextFile(join(repoRoot, document.path)),
      `${document.path} differs from the text prepared for the binary`,
    );
    assertStringIncludes(document.text, document.smokeMarker);
  }

  const committedText = await Deno.readTextFile(
    join(repoRoot, FIRST_PARTY_LICENSE_ARTIFACT_PATHS.bundle),
  );
  const freshText = renderFirstPartyLicenseBundleModule(generated);
  assertEquals(
    firstPartyLicenseBundlePayload(committedText),
    firstPartyLicenseBundlePayload(freshText),
    `${FIRST_PARTY_LICENSE_ARTIFACT_PATHS.bundle} is stale — run \`deno task codegen\``,
  );
  assertEquals(readFirstPartyLicenseBundle(committedText), generated);
  assert(sameFirstPartyLicenseBundlePayload(committedText, freshText));
  assert(
    !sameFirstPartyLicenseBundlePayload(
      committedText,
      `${freshText}throw new Error("hand edit");\n`,
    ),
    "source appended outside the generated export must trigger regeneration",
  );
});

Deno.test("software metadata and the payload notice match the legal registry", async () => {
  const denoJson = decodeWith(
    DENO_LICENSE_SCHEMA,
    await Deno.readTextFile(join(repoRoot, "deno.json")),
  );
  assertEquals(denoJson.license, DISCERN_SOFTWARE_LICENSE.identifier);

  const notice = await Deno.readTextFile(join(repoRoot, "NOTICE"));
  assertStringIncludes(notice, DISCERN_PROJECT_PAYLOAD_LICENSE.identifier);
  assertStringIncludes(notice, DISCERN_PROJECT_PAYLOAD_LICENSE.path);
  assertStringIncludes(notice, "Project-authored");
  assertStringIncludes(notice, "third-party portions");
});

Deno.test("a future legal document auto-enrols in the generated bundle", async () => {
  await withTempDir(async (dir) => {
    const future: FirstPartyLegalDocumentDeclaration = {
      key: "future-unrelated-document",
      kind: "notice",
      identifier: "FUTURE",
      title: "future unrelated document",
      path: "legal/future.txt",
      smokeMarker: "future-member-proof",
    };
    const declarations = [...FIRST_PARTY_LEGAL_DOCUMENTS, future];
    for (const declaration of declarations) {
      const path = join(dir, declaration.path);
      await ensureDir(dirname(path));
      await Deno.writeTextFile(path, `${declaration.smokeMarker}\n`);
    }

    const generated = await generateFirstPartyLicenseBundle({
      repoRoot: dir,
      documents: declarations,
    });
    assertEquals(
      generated.documents.map((document) => document.key),
      declarations.map((document) => document.key),
    );
    assert(
      generated.documents.some((document) => document.key === future.key),
      "the synthetic future member did not join the bundle",
    );
  });
});
