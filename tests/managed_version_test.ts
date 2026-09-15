/** Adoption precedence, strict configuration, and the public baseline. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { configSchema, parseConfig } from "../src/shared/config_schema.ts";
import {
  compareManagedVersion,
  managedVersionRegression,
  planManagedVersionAdoption,
} from "../src/shared/managed_version.ts";
import { DISCERN_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import { MIGRATIONS } from "../src/lib/migrations.ts";
import { TEMPLATE_OMITTED_META_KEYS } from "../src/shared/config_metadata.ts";

Deno.test("managed adoption uses SemVer precedence and preserves equal build metadata", () => {
  for (
    const [running, previous, state, adopted] of [
      ["1.2.7", undefined, "unknown", "1.2.7"],
      ["1.2.7", "1.2.7", "equal", "1.2.7"],
      ["1.2.7+new", "1.2.7+old", "equal", "1.2.7+old"],
      ["1.2.7", "1.2.7-rc.1", "running-newer", "1.2.7"],
      ["1.2.7-rc.10", "1.2.7-rc.2", "running-newer", "1.2.7-rc.10"],
      ["1.2.3", "1.2.7", "project-managed-by-newer", "1.2.7"],
      ["1.2.7-rc.1", "1.2.7", "project-managed-by-newer", "1.2.7"],
    ] as const
  ) {
    assertEquals(compareManagedVersion(running, previous).state, state);
    assertEquals(planManagedVersionAdoption(running, previous), {
      previous: previous ?? null,
      adopted,
    });
  }
});

Deno.test("the schema-1 baseline recognizes optional managed adoption and rejects machine inventory", () => {
  assertEquals(SCHEMA_VERSION, 1);
  assertEquals(MIGRATIONS, []);
  assert(TEMPLATE_OMITTED_META_KEYS.includes("managed_version"));
  assertEquals(configSchema.parse({}).meta.managed_version, undefined);
  for (const value of [DISCERN_VERSION, "1.2.7-rc.2+build.9"]) {
    assertEquals(
      parseConfig(`[meta]\nmanaged_version = "${value}"\n`).issues,
      [],
    );
  }
  for (const value of ["", "v1.2.7", "1.2", "01.2.7", "1.2.7 — Name"]) {
    assert(
      parseConfig(`[meta]\nmanaged_version = "${value}"\n`).issues.length > 0,
    );
  }
  for (const key of ["installed_version", "minimum_version"]) {
    assert(parseConfig(`[meta]\n${key} = "1.2.7"\n`).issues.length > 0);
  }
});

Deno.test("trunk adoption survives deletion, lowering, and build-only changes", () => {
  for (const proposed of [undefined, "1.2.6", "1.2.7-rc.1"]) {
    const message = managedVersionRegression("1.2.7", proposed);
    assert(message !== undefined);
    assertStringIncludes(message, "Restore the trunk value");
  }
  for (const proposed of ["1.2.7+other", "1.2.8", "2.0.0-rc.1"]) {
    assertEquals(managedVersionRegression("1.2.7", proposed), undefined);
  }
  assertEquals(managedVersionRegression(undefined, undefined), undefined);
});
