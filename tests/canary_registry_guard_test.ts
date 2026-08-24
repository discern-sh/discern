/**
 * Canary registry guard — every judgment in `scripts/canary_registry.ts`
 * stays tied to a real test module, and the derived membership stays
 * deterministic.
 *
 * The registry records judgment calls (extras promoted on failure evidence,
 * hot files refused for cost), so this guard holds the record to the same
 * bar as the code it schedules: entries must name modules that exist, carry
 * a specific one-line reason, stay sorted and duplicate-free, and never
 * contradict each other. Membership itself is re-derived here from the
 * Git-derived module universe, so a deleted or renamed member fails the gate
 * until the registry follows.
 */

import { assert, assertEquals } from "@std/assert";
import {
  CANARY_CONVENTION_PATTERN,
  CANARY_EXCLUDED_TEST_FILES,
  CANARY_EXTRA_TEST_FILES,
  type CanaryRegistryEntry,
  canaryTestFiles,
} from "../scripts/canary_registry.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const TEST_MODULES = await structuralGuardScope({
  guard: "tests/canary_registry_guard_test.ts#canary-registry",
  universe: "authored-ts",
  narrow: {
    reason:
      "Canary membership governs the repository's test modules; production sources cannot be members.",
    include: (rel) => rel.startsWith("tests/") && rel.endsWith("_test.ts"),
  },
});

const MODULE_SET = new Set(TEST_MODULES);

/** Assert one registry list is sorted, duplicate-free, and fully grounded. */
function assertWellFormed(
  label: string,
  entries: readonly CanaryRegistryEntry[],
): void {
  const files = entries.map((e) => e.file);
  assertEquals(
    files,
    [...new Set(files)].sort(),
    `${label} must be sorted by file and duplicate-free`,
  );
  for (const entry of entries) {
    assert(
      MODULE_SET.has(entry.file),
      `${label} names '${entry.file}', which is not a tracked test module`,
    );
    assert(
      entry.reason.trim().length >= 12 && !/[\r\n]/.test(entry.reason),
      `${label} entry '${entry.file}' needs a specific one-line reason`,
    );
  }
}

Deno.test("canary extras are real, reasoned, and outside the convention", () => {
  assertWellFormed("CANARY_EXTRA_TEST_FILES", CANARY_EXTRA_TEST_FILES);
  for (const extra of CANARY_EXTRA_TEST_FILES) {
    assert(
      !CANARY_CONVENTION_PATTERN.test(extra.file),
      `'${extra.file}' already enrols via the naming convention; drop the redundant extra`,
    );
  }
});

Deno.test("canary exclusions are real, reasoned, and never also extras", () => {
  assertWellFormed("CANARY_EXCLUDED_TEST_FILES", CANARY_EXCLUDED_TEST_FILES);
  const extras = new Set(CANARY_EXTRA_TEST_FILES.map((e) => e.file));
  for (const excluded of CANARY_EXCLUDED_TEST_FILES) {
    assert(
      !extras.has(excluded.file),
      `'${excluded.file}' is both an extra and an exclusion; keep one judgment`,
    );
  }
});

Deno.test("derived canary membership is deterministic and complete", () => {
  const members = canaryTestFiles(TEST_MODULES);
  assertEquals(
    members,
    [...new Set(members)].sort(),
    "membership must be sorted and duplicate-free",
  );
  assert(members.length > 0, "the canary must never derive to an empty run");
  const memberSet = new Set(members);
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  for (const module of TEST_MODULES) {
    if (!CANARY_CONVENTION_PATTERN.test(module)) continue;
    assertEquals(
      memberSet.has(module),
      !excluded.has(module),
      `convention module '${module}' must be a member exactly when not excluded`,
    );
  }
  for (const extra of CANARY_EXTRA_TEST_FILES) {
    assert(
      memberSet.has(extra.file),
      `registered extra '${extra.file}' must be a member`,
    );
  }
  for (const member of members) {
    assert(
      MODULE_SET.has(member),
      `derived member '${member}' must be a tracked test module`,
    );
  }
});
