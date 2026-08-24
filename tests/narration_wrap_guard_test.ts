/**
 * Multi-word phrase assertions on rendered output must be wrap-independent.
 *
 * Narration soft-wraps prose at the bound terminal width, and the wrap
 * position shifts with content earlier in the sentence — an absolute temp
 * path's length differs per platform, so a phrase that survives one
 * machine's wrap splits across a line break on another (macOS-authored
 * assertions failed on Linux CI exactly this way). A bare
 * `assertStringIncludes` on captured `output`/`stdout`/`stderr` with a
 * spaced phrase asserts the wrap lottery, not the message. Use
 * `assertTerminalTextIncludes` (tests/helpers.ts), which compares content
 * with whitespace collapsed on both sides. Single-token expectations can't
 * straddle a wrap break and stay exempt; assertions through variables are
 * opaque to this scan and stay on the author's honour.
 */

import { join } from "@std/path";
import { assertEquals } from "@std/assert";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const CALL = "assertStringIncludes(";
const SELF = "tests/narration_wrap_guard_test.ts";

/** Slice one balanced-paren call span starting at the call's open paren. */
function callSpan(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return source.slice(open + 1);
}

/** The first top-level argument expression of a call span. */
function firstArgument(span: string): string {
  let depth = 0;
  for (let i = 0; i < span.length; i += 1) {
    const ch = span[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      return span.slice(0, i);
    }
  }
  return span;
}

/** The raw static content of the first string literal after the first comma. */
function expectedLiteral(span: string): string | undefined {
  const first = firstArgument(span);
  const rest = span.slice(first.length + 1).trimStart();
  const quote = rest[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return undefined;
  }
  for (let i = 1; i < rest.length; i += 1) {
    if (rest[i] === "\\") {
      i += 1;
      continue;
    }
    if (rest[i] === quote) {
      return rest.slice(1, i);
    }
  }
  return undefined;
}

/** File:line offenders — spaced expected phrases asserted on raw output. */
export function wrapSensitiveAssertions(
  file: string,
  source: string,
): string[] {
  const offenders: string[] = [];
  let at = source.indexOf(CALL);
  while (at !== -1) {
    const span = callSpan(source, at + CALL.length - 1);
    const target = firstArgument(span);
    const literal = expectedLiteral(span);
    if (
      /\.(output|stdout|stderr)\b/.test(target) &&
      literal !== undefined &&
      /[ \n]|\\n/.test(literal)
    ) {
      const line = source.slice(0, at).split("\n").length;
      offenders.push(`${file}:${line}`);
    }
    at = source.indexOf(CALL, at + CALL.length);
  }
  return offenders;
}

Deno.test("spaced phrases on rendered output assert content, not the wrap", async () => {
  const offenders: string[] = [];
  for (
    const file of await structuralGuardScope({
      guard: "tests/narration_wrap_guard_test.ts#wrap-independent-assertions",
      universe: "authored-ts",
      narrow: {
        reason:
          "The invariant governs test assertions over captured output; runtime code does not make those assertions.",
        include: (rel) => rel.startsWith("tests/") && rel !== SELF,
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, file));
    offenders.push(...wrapSensitiveAssertions(file, source));
  }
  assertEquals(
    offenders,
    [],
    "these assert a multi-word phrase against rendered output with " +
      "assertStringIncludes; narration wraps at the terminal width, so the " +
      "phrase splits when path lengths shift (macOS vs Linux CI) — use " +
      "assertTerminalTextIncludes from tests/helpers.ts instead",
  );
});
