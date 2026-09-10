/** Importing a test module registers it again in the importing native worker. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { testRegistrationImports } from "./import_specifiers.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("runtime imports cannot register another test module", async () => {
  const findings: string[] = [];
  for (
    const file of await structuralGuardScope({
      guard: "tests/test_registration_guard_test.ts#runtime-test-imports",
      universe: "authored-deno",
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, file));
    for (const imported of testRegistrationImports(source)) {
      findings.push(
        `${file}: ${imported}; move shared helpers to a module without test registrations`,
      );
    }
  }
  assertEquals(findings, []);
});

Deno.test("registration imports include aliases and dynamic literals while type-only uses remain inert", () => {
  const target = "./future_test.ts";
  for (
    const source of [
      `import { helper as local } from "${target}";`,
      `import "${target}";`,
      `import {} from "${target}";`,
      `import main, { type Only } from "${target}";`,
      `export { helper } from "${target}";`,
      `export {} from "${target}";`,
      `export * from "${target}";`,
      `await import("${target}");`,
      `await import(\`${target}\`);`,
      'import "./future_\\u0074est.ts";',
    ]
  ) assertEquals(testRegistrationImports(source), [target], source);
  for (
    const source of [
      `import type { Only } from "${target}";`,
      `import { type Only, type Also } from "${target}";`,
      `export type { Only } from "${target}";`,
      `export { type Only } from "${target}";`,
      `export type * from "${target}";`,
      `type Only = import("${target}").Only;`,
      `// import "${target}";`,
      `const text = 'import "${target}"';`,
      'import { helper } from "./future_fixture.ts";',
    ]
  ) assertEquals(testRegistrationImports(source), [], source);
});
