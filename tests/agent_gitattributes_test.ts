/**
 * `.gitattributes` convergence for declared generated artifacts. Scope globs
 * translate only when Git's attributes dialect can preserve their meaning; the
 * reconciler owns one delimited block and leaves every outside byte alone.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  canonicalDiscernGitattributesBlock,
  DISCERN_GITATTRIBUTES_BEGIN,
  DISCERN_GITATTRIBUTES_END,
  reconcileDiscernGitattributes,
  translateScopeGlobToGitattributes,
} from "../src/lib/agent_gitattributes.ts";
import type { ResolvedGeneratedGroup } from "../src/shared/generated_artifacts.ts";

function groups(
  ...entries: Array<[name: string, paths: string[]]>
): ResolvedGeneratedGroup[] {
  return entries.map(([name, paths]) => ({ name, paths, run: ":" }));
}

Deno.test("scope globs translate to equivalent root .gitattributes patterns", () => {
  const cases = [
    ["src/**", "src/**"],
    ["/**", "**"],
    ["/ui/", "**/ui/**"],
    ["/vendor/generated/", "**/vendor/generated/**"],
    ["src/", "src/**"],
    ["*.view", "*.view"],
    ["src/**/*.ts", "src/**/*.ts"],
    ["?at.ts", "/?at.ts"],
    ["README.generated.md", "/README.generated.md"],
    ["schema/output.json", "schema/output.json"],
  ] as const;

  for (const [scope, expected] of cases) {
    assertEquals(translateScopeGlobToGitattributes(scope), {
      ok: true,
      source: scope,
      pattern: expected,
    });
  }
});

Deno.test("scope globs with no faithful attributes spelling are refused", () => {
  for (
    const scope of [
      "{schema,reference}/**",
      "generated output/**",
      "!private/**",
      "./dist/**",
      "generated/../dist/**",
      "generated//dist/**",
      "src\\**",
      "src/?(draft).ts",
    ]
  ) {
    const translated = translateScopeGlobToGitattributes(scope);
    assertEquals(translated.ok, false, scope);
    if (!translated.ok) {
      assert(translated.reason.length > 0, scope);
    }
  }
});

Deno.test("a fresh file gets declared paths and built-in Agent files in one block", () => {
  const declared = groups([
    "reference",
    ["reference/**", "README.generated.md"],
  ]);
  const result = reconcileDiscernGitattributes("", declared, [
    "AGENTS.md",
    "CLAUDE.md",
  ]);

  assertEquals(result.operations, [
    { kind: "create-block", path: ".gitattributes" },
  ]);
  assertStringIncludes(result.text, DISCERN_GITATTRIBUTES_BEGIN);
  assertStringIncludes(result.text, "reference/** merge=discern-generated");
  assertStringIncludes(
    result.text,
    "/README.generated.md merge=discern-generated",
  );
  assertStringIncludes(result.text, "/AGENTS.md merge=discern-generated");
  assertStringIncludes(result.text, "/CLAUDE.md merge=discern-generated");
  assertStringIncludes(result.text, DISCERN_GITATTRIBUTES_END);
  assertEquals(result.refused, []);
});

Deno.test("reconcile replaces only the marked bytes and is idempotent", () => {
  const before = "*.jpg binary\r\n\r\n";
  const after = "\r\n*.md text eol=lf\r\n";
  const stale = [
    DISCERN_GITATTRIBUTES_BEGIN,
    "old/** merge=discern-generated",
    DISCERN_GITATTRIBUTES_END,
    "",
  ].join("\r\n");
  const existing = `${before}${stale}${after}`;
  const declared = groups(["schemas", ["schema/**"]]);

  const first = reconcileDiscernGitattributes(existing, declared);
  assertEquals(first.operations, [
    { kind: "replace-block", path: ".gitattributes" },
  ]);
  assert(first.text.startsWith(before));
  assert(first.text.endsWith(after));
  assertStringIncludes(first.text, "schema/** merge=discern-generated");
  assert(!first.text.includes("old/**"), first.text);

  const second = reconcileDiscernGitattributes(first.text, declared);
  assertEquals(second.operations, []);
  assertEquals(second.text, first.text);
});

Deno.test("empty config removes the managed block and preserves outside bytes", () => {
  const block = canonicalDiscernGitattributesBlock(
    groups(["schemas", ["schema/**"]]),
  ).text.replaceAll("\n", "\r\n");
  const before = "*.jpg binary\r\n\r\n";
  const after = "*.md text\r\n";
  const existing = `${before}${block}${after}`;

  const result = reconcileDiscernGitattributes(existing, []);
  assertEquals(result.operations, [
    { kind: "remove-block", path: ".gitattributes" },
  ]);
  assertEquals(result.text, `${before}${after}`);
});

Deno.test("adding then removing a block round-trips project-owned lines", () => {
  const project = "*.jpg binary\r\n";
  const added = reconcileDiscernGitattributes(
    project,
    groups(["schemas", ["schema/**"]]),
  );
  const removed = reconcileDiscernGitattributes(added.text, []);
  assertEquals(removed.text, project);
});

Deno.test("unused attributes management is a zero-byte no-op", () => {
  assertEquals(reconcileDiscernGitattributes("", [], []), {
    text: "",
    operations: [],
    patterns: [],
    refused: [],
  });
});
