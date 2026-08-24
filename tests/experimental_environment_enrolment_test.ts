/**
 * Closed-set enrollment guard for environment-only experiments.
 *
 * Every `DISCERN_EXPERIMENTAL_*` name in authored TypeScript must come from
 * the registry, and the contributor experimental-behaviors page must account for
 * every registered name. Synthetic controls prove the two-way comparison
 * catches a future source use and a future undocumented registry member.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  EXPERIMENTAL_ENV_ENABLED_VALUE,
  EXPERIMENTAL_ENVIRONMENT_VARIABLES,
  experimentalAwaitCallSeconds,
  experimentalEnvironmentEnabled,
} from "../src/shared/experimental.ts";
import { fakeEnv } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const EXPERIMENTAL_DOC =
  "project/map/50-engine-internals/experimental-behaviors.md";
const EXPERIMENTAL_ENV_PATTERN = /\bDISCERN_EXPERIMENTAL_[A-Z][A-Z0-9_]*\b/g;

/** Sorted unique experimental environment-variable names found in text. */
function experimentalEnvironmentNames(text: string): string[] {
  return [...new Set(text.match(EXPERIMENTAL_ENV_PATTERN) ?? [])].sort();
}

/** Two-way differences between registered and observed environment names. */
function enrollmentFailures(
  registered: readonly string[],
  observed: readonly string[],
): string[] {
  const registeredSet = new Set(registered);
  const observedSet = new Set(observed);
  return [
    ...observed.filter((name) => !registeredSet.has(name)).map((name) =>
      `${name}: used but absent from EXPERIMENTAL_ENVIRONMENT_VARIABLES`
    ),
    ...registered.filter((name) => !observedSet.has(name)).map((name) =>
      `${name}: registered but absent from the enrolled surface`
    ),
  ];
}

Deno.test("experimental flags use exact value 1", () => {
  const variable = EXPERIMENTAL_ENVIRONMENT_VARIABLES.experimentalMcpPreload;
  assertEquals(EXPERIMENTAL_ENV_ENABLED_VALUE, "1");
  assertEquals(
    experimentalEnvironmentEnabled(
      "experimentalMcpPreload",
      fakeEnv({ [variable]: "1" }),
    ),
    true,
  );
  for (const value of ["", "0", "true", "yes"]) {
    assertEquals(
      experimentalEnvironmentEnabled(
        "experimentalMcpPreload",
        fakeEnv({ [variable]: value }),
      ),
      false,
    );
  }
  assertEquals(
    experimentalEnvironmentEnabled("experimentalMcpPreload", fakeEnv()),
    false,
  );
});

Deno.test("the await call cap activates only on a positive whole number", () => {
  const variable = EXPERIMENTAL_ENVIRONMENT_VARIABLES
    .experimentalAwaitCallSeconds;
  assertEquals(experimentalAwaitCallSeconds(fakeEnv({ [variable]: "1" })), 1);
  assertEquals(
    experimentalAwaitCallSeconds(fakeEnv({ [variable]: "1500" })),
    1500,
  );
  for (
    const value of ["", "0", "-300", "1.5", "300s", " 300", "3e2", "yes", "01"]
  ) {
    assertEquals(
      experimentalAwaitCallSeconds(fakeEnv({ [variable]: value })),
      undefined,
      `value ${JSON.stringify(value)} stays off`,
    );
  }
  assertEquals(experimentalAwaitCallSeconds(fakeEnv()), undefined);
});

Deno.test("every experimental environment name comes from the registry", async () => {
  const registered = Object.values(EXPERIMENTAL_ENVIRONMENT_VARIABLES).sort();
  const observed = new Set<string>();
  for (
    const rel of await structuralGuardScope({
      guard:
        "tests/experimental_environment_enrolment_test.ts#experimental-environment-names",
      universe: "authored-ts",
    })
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const name of experimentalEnvironmentNames(text)) observed.add(name);
  }
  assertEquals(enrollmentFailures(registered, [...observed].sort()), []);
});

Deno.test("the contributor experimental-behaviors page documents every flag", async () => {
  const registered = Object.values(EXPERIMENTAL_ENVIRONMENT_VARIABLES).sort();
  const documented = experimentalEnvironmentNames(
    await Deno.readTextFile(join(REPO_ROOT, EXPERIMENTAL_DOC)),
  );
  assertEquals(enrollmentFailures(registered, documented), []);
});

Deno.test("experimental environment enrollment catches future drift", () => {
  const prefix = "DISCERN_EXPERIMENTAL_";
  const current = EXPERIMENTAL_ENVIRONMENT_VARIABLES.experimentalMcpPreload;
  const future = prefix + "FUTURE";
  assertEquals(
    enrollmentFailures([current], [current, future]),
    [
      `${future}: used but absent from EXPERIMENTAL_ENVIRONMENT_VARIABLES`,
    ],
  );
  assertEquals(
    enrollmentFailures([current, future], [current]),
    [`${future}: registered but absent from the enrolled surface`],
  );
});
