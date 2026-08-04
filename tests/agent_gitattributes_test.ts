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
  discernMarkdownAttributePaths,
  reconcileDiscernGitattributes,
  translateScopeGlobToGitattributes,
} from "../src/lib/agent_gitattributes.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { ResolvedGeneratedGroup } from "../src/shared/generated_artifacts.ts";

/** Build resolved generated groups for concise test cases. */
function groups(
  ...entries: Array<
    [name: string, paths: string[], linguistGenerated?: boolean]
  >
): ResolvedGeneratedGroup[] {
  return entries.map(([name, paths, linguistGenerated = false]) => ({
    name,
    paths,
    run: ":",
    linguistGenerated,
  }));
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

Deno.test("one block composes generated, Linguist, and scoped Markdown attributes", () => {
  const declared = groups(
    ["reference", ["reference/**", "README.generated.md"], true],
    ["schemas", ["schema/**"]],
  );
  const result = reconcileDiscernGitattributes("", declared, [
    "AGENTS.md",
    "CLAUDE.md",
  ], [
    { surface: "map", path: "discern/map/**/*.md" },
    { surface: "todo", path: "discern/TODO.md" },
  ]);

  assertEquals(result.operations, [
    { kind: "create-block", path: ".gitattributes" },
  ]);
  assertStringIncludes(result.text, DISCERN_GITATTRIBUTES_BEGIN);
  assertStringIncludes(
    result.text,
    "reference/** merge=discern-generated linguist-generated",
  );
  assertStringIncludes(
    result.text,
    "/README.generated.md merge=discern-generated linguist-generated",
  );
  assertStringIncludes(result.text, "schema/** merge=discern-generated\n");
  assertStringIncludes(
    result.text,
    "/AGENTS.md merge=discern-generated diff=markdown",
  );
  assertStringIncludes(
    result.text,
    "/CLAUDE.md merge=discern-generated diff=markdown",
  );
  assertStringIncludes(result.text, "discern/map/**/*.md diff=markdown");
  assertStringIncludes(result.text, "discern/TODO.md diff=markdown");
  assertEquals(result.text.includes("\n*.md diff=markdown"), false);
  assertEquals(result.patterns.includes("discern/map/**/*.md"), false);
  assertStringIncludes(result.text, DISCERN_GITATTRIBUTES_END);
  assertEquals(result.refused, []);
});

Deno.test("Markdown attributes derive from configured discern surfaces only", () => {
  const config = parseConfigOrThrow(`
[project]
todo = "notes/discern-work.md"

[map]
dir = "knowledge/"

[skills]
dir = "agent-playbooks"

[scripts]
dir = "tools/discern"
`);
  assertEquals(discernMarkdownAttributePaths(config), [
    { surface: "guidance", path: "discern/guidance.md" },
    { surface: "map", path: "knowledge/**/*.md" },
    { surface: "skills", path: "agent-playbooks/**/*.md" },
    { surface: "scripts", path: "tools/discern/**/*.md" },
    { surface: "todo", path: "notes/discern-work.md" },
    { surface: "brief", path: "discern/brief.md" },
  ]);
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
