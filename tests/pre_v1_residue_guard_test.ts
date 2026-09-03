/** Structural absence guards for private-era runtime compatibility residue. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RETIRED_SOURCE_IDENTIFIERS = [
  "LegacyStandardLimitProposalSchema",
  "canonicalStandardLimitProposal",
  "canonicalStandardLimitProposals",
  "canonicalProofInput",
  "canonicalProofNotePayloadInput",
  "canonicalProposalRecord",
  "legacyFetchMapping",
  "legacyMappingError",
  "decodeLegacyResumeToken",
  "LegacyAwaitResumePayload",
  "LegacyValidationJobObservation",
  "LegacyValidationRepeatGroup",
  "legacyValidationJobObservations",
  "legacyValidationObservation",
  "legacyTestSteps",
  "resultsToJson",
  "branchesToDelete",
  "legacy_events",
  "legacy_eligibility_readings",
] as const;

/** Return every retired identifier still present in production TypeScript. */
function retiredResidue(
  sources: Readonly<Record<string, string>>,
): string[] {
  const findings: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    for (const identifier of RETIRED_SOURCE_IDENTIFIERS) {
      if (source.includes(identifier)) findings.push(`${path}: ${identifier}`);
    }
    for (
      const match of source.matchAll(
        /^\s*export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(Legacy[A-Za-z0-9_]*)/gmu,
      )
    ) {
      findings.push(`${path}: exported ${match[1] ?? "Legacy symbol"}`);
    }
  }
  return findings.sort();
}

Deno.test("private-era runtime identifiers cannot re-enter production", async () => {
  const files = await structuralGuardScope({
    guard: "tests/pre_v1_residue_guard_test.ts#retired-runtime-identifiers",
    universe: "authored-ts",
    narrow: {
      reason:
        "The retired compatibility paths were runtime implementation details under src/.",
      include: (path) => path.startsWith("src/"),
    },
  });
  const sources = Object.fromEntries(
    await Promise.all(files.map(async (path) => [
      path,
      await Deno.readTextFile(join(REPO_ROOT, path)),
    ])),
  );
  assertEquals(retiredResidue(sources), []);
});

Deno.test("private-era residue guard detects identifiers and Legacy exports", () => {
  assertEquals(
    retiredResidue({
      "src/example.ts":
        "export interface LegacyThing {}\nfunction resultsToJson() {}\n",
    }),
    [
      "src/example.ts: exported LegacyThing",
      "src/example.ts: resultsToJson",
    ],
  );
});
