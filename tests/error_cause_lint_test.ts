/** Behavioral controls for the caught-error causal-chain lint rule. */

import { assertEquals } from "@std/assert";
import errorCausePlugin from "../scripts/error_cause_lint.ts";

const RULE_ID = "discern-error-cause/require-wrapped-error-cause";

/** Run the causal-chain plugin against an in-memory TypeScript module. */
function diagnostics(source: string): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(errorCausePlugin, "synthetic.ts", source);
}

Deno.test("wrapped caught errors require an explicit cause", () => {
  const found = diagnostics(`
try {
  await work();
} catch (error) {
  throw new Error(\`work failed: \${String(error)}\`);
}
try {
  await work();
} catch (failure) {
  throw new TypeError(messageFor(failure));
}
`);

  assertEquals(found.map((diagnostic) => diagnostic.id), [RULE_ID, RULE_ID]);
  assertEquals(found.map((diagnostic) => diagnostic.message), [
    "An error built from caught 'error' must preserve it with { cause: error }.",
    "An error built from caught 'failure' must preserve it with { cause: failure }.",
  ]);
});

Deno.test("wrapped caught errors retain their cause", () => {
  assertEquals(
    diagnostics(`
try {
  await work();
} catch (error) {
  throw new Error(\`work failed: \${String(error)}\`, { cause: error });
}
`),
    [],
  );
});

Deno.test("unrelated errors and property names do not imply wrapping", () => {
  assertEquals(
    diagnostics(`
try {
  await work();
} catch (error) {
  report(error);
  throw new Error("the word error is inert", { error: "label" });
}
`),
    [],
  );
});
