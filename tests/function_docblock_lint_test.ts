/**
 * Behavioral controls for the function-docblock lint rule, including a
 * fresh-name nested declaration that proves new containers auto-enrol.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import functionDocblockPlugin from "../scripts/function_docblock_lint.ts";
import { AUTHORED_DENO_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

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
/** Supply the scalar used by the local-declaration fixture. */
function localValue(): number { return 1; }

/** Resolve the fixture's public promise to a stable scalar. */
export async function publicValue(): Promise<number> { return 2; }

/** Export a stable scalar through an anonymous default declaration. */
export default function (): number { return 3; }

/** Preserve an untyped return so the lint-directive attachment is exercised. */
// deno-lint-ignore no-explicit-any
function suppressedFixture(): any { return {}; }
`;

  assertEquals(diagnostics(source), []);
});

Deno.test("function docblocks reject identifier paraphrases under fresh names", () => {
  const source = `
/** Return the calibrate quasar. */
function calibrateQuasar(): string { return "ready"; }

/** Does process nebula values. */
function processNebulaValue(): string { return "ready"; }
`;

  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.message),
    [
      "Function 'calibrateQuasar' has JSDoc that only paraphrases its name. Describe its behavior, contract, or reason for existing.",
      "Function 'processNebulaValue' has JSDoc that only paraphrases its name. Describe its behavior, contract, or reason for existing.",
    ],
  );
});

Deno.test("function docblocks reject the backfill's known filler shapes", () => {
  const source = `
/** Walk into. */
function walkInto(): void {}

/** Return the land. */
function land(): void {}

/** Return the named by. */
function namedBy(): void {}

/** Return the at. */
function at(): void {}
`;

  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.message),
    ["walkInto", "land", "namedBy", "at"].map((name) =>
      `Function '${name}' has JSDoc that only paraphrases its name. Describe its behavior, contract, or reason for existing.`
    ),
  );
});

Deno.test("function docblocks require prose before JSDoc tags", () => {
  const source = `
/**
 * @returns the value
 */
function taggedOnly(): string { return "ready"; }
`;

  assertEquals(
    diagnostics(source).map((diagnostic) => diagnostic.message),
    [
      "Function 'taggedOnly' has JSDoc that only paraphrases its name. Describe its behavior, contract, or reason for existing.",
    ],
  );
});

Deno.test("function docblocks accept concise behavioral information", () => {
  const source = `
/** Escape regex metacharacters so the value is matched literally. */
function escapeRegExp(value: string): string { return value; }

/** Treat lookup failures as an absent file. */
function isFile(path: string): boolean { return path.length > 0; }
`;

  assertEquals(diagnostics(source), []);
});

Deno.test("function docblocks reject an unrelated nested future sibling", () => {
  const source = `
/** Assemble telemetry into the orbital-report fixture. */
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

Deno.test("every authored Deno function declaration has informative JSDoc", async () => {
  const missing: string[] = [];
  for (const rel of AUTHORED_DENO_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const diagnostic of diagnostics(source, rel)) {
      missing.push(
        `${rel}:${diagnosticLine(source, diagnostic)} ${diagnostic.message}`,
      );
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} authored Deno function declarations have missing or low-information JSDoc:\n${
        missing.join("\n")
      }`,
    );
  }
});
