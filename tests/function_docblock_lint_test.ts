/**
 * Behavioral controls for the function-docblock lint rule, including a
 * fresh-name nested declaration that proves new containers auto-enrol.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import functionDocblockPlugin from "../scripts/function_docblock_lint.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const RULE_ID = "discern/require-function-docblock";

/** Run the function-docblock plugin against an in-memory TypeScript module. */
function diagnostics(
  source: string,
  filename = "synthetic.ts",
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(functionDocblockPlugin, filename, source);
}

/** Convert a lint diagnostic's byte offset into a one-based source line. */
function diagnosticLine(
  source: string,
  diagnostic: Deno.lint.Diagnostic,
): number {
  return source.slice(0, diagnostic.range[0]).split("\n").length;
}

Deno.test("function docblocks accept documented declaration forms", () => {
  const source = `
/** Describe a local value. */
function localValue(): number { return 1; }

/** Resolve a public value. */
export async function publicValue(): Promise<number> { return 2; }

/** Produce the default value. */
export default function (): number { return 3; }

/** Parse a deliberately loose fixture. */
// deno-lint-ignore no-explicit-any
function suppressedFixture(): any { return {}; }
`;

  assertEquals(diagnostics(source), []);
});

Deno.test("function docblocks reject an unrelated nested future sibling", () => {
  const source = `
/** Build an orbital report. */
function buildOrbitalReport(): string {
  function calibrateQuasar(): string { return "ready"; }
  return calibrateQuasar();
}
`;

  const found = diagnostics(source);
  assertEquals(found.length, 1);
  assertEquals(found[0]?.id, RULE_ID);
  assertEquals(
    found[0]?.message,
    "Function 'calibrateQuasar' must have a JSDoc block immediately above its declaration.",
  );
});

Deno.test("function docblocks reject anonymous default exports", () => {
  const found = diagnostics("export default function (): void {}\n");

  assertEquals(found.length, 1);
  assertEquals(
    found[0]?.message,
    "Function 'default export' must have a JSDoc block immediately above its declaration.",
  );
});

Deno.test("function docblocks reject non-JSDoc and stale comments", () => {
  const source = `
/* This block is not JSDoc. */
function ordinaryBlock(): void {}

/** This documents the marker, not the later function. */
const marker = true;
function staleBlock(): boolean { return marker; }
`;

  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.message),
    [
      "Function 'ordinaryBlock' must have a JSDoc block immediately above its declaration.",
      "Function 'staleBlock' must have a JSDoc block immediately above its declaration.",
    ],
  );
});

Deno.test("every authored TypeScript function declaration has JSDoc", async () => {
  const missing: string[] = [];
  for (const rel of AUTHORED_TS_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const diagnostic of diagnostics(source, rel)) {
      missing.push(
        `${rel}:${diagnosticLine(source, diagnostic)} ${diagnostic.message}`,
      );
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} authored TypeScript function declarations need an immediately preceding JSDoc block:\n${
        missing.join("\n")
      }`,
    );
  }
});
