/** Behavioral and repository-wide controls for deliberate error discards. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  BEST_EFFORT_BOUNDARIES,
  type BestEffortBoundary,
} from "../src/shared/best_effort.ts";
import {
  type BestEffortBoundaryRegistry,
  silentCatchPlugin,
} from "../scripts/silent_catch_lint.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RULE_ID = "discern-silent-catch/no-silent-catch";

/** Run the silent-catch plugin against one in-memory authored module. */
function diagnostics(
  source: string,
  filename = "synthetic.ts",
  registry: BestEffortBoundaryRegistry = {},
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(
    silentCatchPlugin(registry),
    filename,
    source,
  );
}

Deno.test("empty, comment-only, and absence-returning catches are silent", () => {
  const found = diagnostics(`
export function forgetOne(): void {
  try { act(); } catch {}
}
export function forgetTwo(): void {
  try { act(); } catch {
    // The comment does not make the failure observable.
  }
}
export function forgetThree(): undefined {
  try { act(); } catch { return undefined; }
}
export function forgetFour(): false {
  try { act(); } catch { const missing = undefined; return false; }
}
export function forgetFive(): number {
  try { act(); } catch { return 0; }
}
`);
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
  ]);
});

Deno.test("promise, async, aliased, and richer discard handlers are silent", () => {
  const found = diagnostics(`
const forget = () => undefined;
export async function consume(): Promise<void> {
  await first().catch(() => undefined);
  await second().catch(() => {});
  await third().catch(async () => { return undefined; });
  await fourth().catch(() => condition ? undefined : null);
  await fifth().catch(forget);
  await sixth().catch((error) => void error);
  await seventh().catch(() => Promise.resolve(undefined));
  await eighth().then(use, () => undefined);
}
`);
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
    RULE_ID,
  ]);
});

Deno.test("cosmetic statements do not make a swallowed catch observable", () => {
  const found = diagnostics(`
export function consume(): void {
  try { first(); } catch (error) { error; }
  try { second(); } catch (error) { void error; }
  try { third(); } catch (error) { String(error); }
}
`);
  assertEquals(found.map((diagnostic) => diagnostic.id), [
    RULE_ID,
    RULE_ID,
    RULE_ID,
  ]);
});

Deno.test("nested cleanup swallowing is detected independently", () => {
  const found = diagnostics(`
export async function preservePrimary(): Promise<void> {
  try {
    await primary();
  } catch (error) {
    try { await cleanup(); } catch {}
    throw error;
  }
}
`);
  assertEquals(found.map((diagnostic) => diagnostic.id), [RULE_ID]);
});

Deno.test("reported, propagated, and structured failures remain visible", () => {
  assertEquals(
    diagnostics(`
export async function visible(): Promise<void> {
  try { await first(); } catch (error) { log.warn(String(error)); }
  try { await second(); } catch (error) { throw error; }
  try { await copy(); } catch { status.textContent = "Copy unavailable"; }
  await third().catch((error) => report(error));
  await fourth().catch((error) => ({ ok: false, error }));
}
`),
    [],
  );
});

Deno.test("non-function catch combinators are not promise rejection handlers", () => {
  assertEquals(
    diagnostics(`
const schema = z.string().optional().catch(undefined);
`),
    [],
  );
});

/** Build one exact synthetic direct exception. */
function directBoundary(
  overrides: Partial<BestEffortBoundary> = {},
): BestEffortBoundary {
  return {
    path: "synthetic.ts",
    enclosingFunction: "fixture",
    operation: "discard one planted cleanup failure",
    kind: "direct",
    shape: "sync",
    observability: { kind: "unobservable" },
    reason:
      "The planted syntax cannot call the capability and proves exact registry matching.",
    ...overrides,
  };
}

Deno.test("an exact direct exception permits one registered syntax site", () => {
  const source = `export function fixture(): void {
  try { cleanup(); } catch {
    // discern-best-effort: planted-cleanup
  }
}\n`;
  assertEquals(
    diagnostics(source, "synthetic.ts", {
      "planted-cleanup": directBoundary(),
    }),
    [],
  );
});

Deno.test("an awaited direct exception binds its async registry shape", () => {
  const source = `export async function fixture(): Promise<void> {
  try { await cleanup(); } catch {
    // discern-best-effort: planted-cleanup
  }
}\n`;
  assertEquals(
    diagnostics(source, "synthetic.ts", {
      "planted-cleanup": directBoundary({ shape: "async" }),
    }),
    [],
  );
});

Deno.test("a for-await direct exception also binds its async registry shape", () => {
  const source = `export async function fixture(): Promise<void> {
  try { for await (const value of values()) consume(value); } catch {
    // discern-best-effort: planted-cleanup
  }
}\n`;
  assertEquals(
    diagnostics(source, "synthetic.ts", {
      "planted-cleanup": directBoundary({ shape: "async" }),
    }),
    [],
  );
});

Deno.test("unknown and mismatched direct exceptions fail with recovery", () => {
  const source = `export function fixture(): void {
  try { cleanup(); } catch {
    // discern-best-effort: unknown-cleanup
  }
}\n`;
  const unknown = diagnostics(source);
  assertEquals(unknown.map((diagnostic) => diagnostic.id), [RULE_ID]);
  assertEquals(
    unknown[0]?.message,
    "Unknown best-effort boundary 'unknown-cleanup'; add its exact registry entry or remove the marker.",
  );
  const mismatch = diagnostics(source, "synthetic.ts", {
    "unknown-cleanup": directBoundary({ enclosingFunction: "elsewhere" }),
  });
  assertEquals(mismatch.map((diagnostic) => diagnostic.id), [RULE_ID]);
});

/** Convert a diagnostic byte offset into a one-based line. */
function diagnosticLine(
  source: string,
  diagnostic: Deno.lint.Diagnostic,
): number {
  return source.slice(0, diagnostic.range[0]).split("\n").length;
}

Deno.test("authored production code has no unnamed silent catch", async () => {
  const findings: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/silent_catch_lint_test.ts#production-error-discards",
      universe: "authored-deno",
      narrow: {
        reason:
          "Test code deliberately plants rejected forms; the product and repository tooling are the enforced error-discard boundary.",
        include: (path) => !path.startsWith("tests/"),
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (
      const diagnostic of diagnostics(source, rel, BEST_EFFORT_BOUNDARIES)
    ) {
      findings.push(
        `${rel}:${diagnosticLine(source, diagnostic)} ${diagnostic.message}`,
      );
    }
  }
  assertEquals(findings, []);
});
