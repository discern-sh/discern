/**
 * Token substitution and path resolution — the substitution contract.
 *
 * These pin the rules the scaffolder depends on: known tokens substitute,
 * unknown tokens are left verbatim and reported, the worktree engine's `@…@`
 * runtime tokens use a different delimiter (so the installer never touches them),
 * the single path token resolves in a file name, and `.tmpl` is stripped. A
 * regression in any of these silently corrupts every scaffold.
 */

import { assertEquals } from "@std/assert";
import {
  isGitignoreFragment,
  isTemplateFile,
  resolveTargetPath,
  substituteTokens,
  type TokenMap,
} from "../src/lib/template.ts";

/** A complete token map for tests, with recognisable values. */
function tokens(): TokenMap {
  return {
    project_name: "Demo App",
    project_slug: "demo-app",
    branch_prefix: "agent/",
    agents_array: '"claude_code", "codex"',
    docs_dir: "docs/",
    gotchas_doc: "docs/80-development/done-gate-gotchas.md",
    scopes_neutral: '"${docs.dir}", ".discern/", ".claude/"',
    scopes_web: '"src/**", "app/**"',
    scopes_previewable: '"public/**"',
    kit_version: "0.1.0",
  };
}

Deno.test("substituteTokens replaces every known content token", () => {
  const input = "name={{project_name}} slug={{project_slug}} v={{kit_version}}";
  const { text, unknown } = substituteTokens(input, tokens());
  assertEquals(text, "name=Demo App slug=demo-app v=0.1.0");
  assertEquals(unknown, []);
});

Deno.test("substituteTokens leaves an unknown token verbatim and reports it", () => {
  const { text, unknown } = substituteTokens(
    "a={{nope}} b={{project_slug}}",
    tokens(),
  );
  // The unknown token is untouched; the known one still substitutes.
  assertEquals(text, "a={{nope}} b=demo-app");
  assertEquals(unknown, ["nope"]);
});

Deno.test("substituteTokens ignores the engine's @runtime@ tokens (different delimiter)", () => {
  const { text, unknown } = substituteTokens(
    "clone=createdb -T @project_slug@_template @db@",
    tokens(),
  );
  // Runtime tokens use @…@, not {{…}}, so the installer never sees them — they
  // pass through untouched and are NOT drift.
  assertEquals(text, "clone=createdb -T @project_slug@_template @db@");
  assertEquals(unknown, []);
});

Deno.test("substituteTokens no longer special-cases {{db}} — it is ordinary drift now", () => {
  const { text, unknown } = substituteTokens("x={{db}}", tokens());
  // With runtime tokens moved to @…@, a stray {{db}} is just an unknown token:
  // left verbatim and reported, like any other drift.
  assertEquals(text, "x={{db}}");
  assertEquals(unknown, ["db"]);
});

Deno.test("substituteTokens dedups repeated unknown tokens", () => {
  const { unknown } = substituteTokens("{{x}} {{x}} {{y}}", tokens());
  assertEquals(unknown.sort(), ["x", "y"]);
});

Deno.test("resolveTargetPath substitutes the slug path token and strips .tmpl", () => {
  assertEquals(
    resolveTargetPath(
      "docs/{{project_slug}}-guide.md.tmpl",
      "demo-app",
    ),
    "docs/demo-app-guide.md",
  );
});

Deno.test("resolveTargetPath strips .tmpl from a token-free path", () => {
  assertEquals(
    resolveTargetPath("discern.toml.tmpl", "demo-app"),
    "discern.toml",
  );
});

Deno.test("resolveTargetPath leaves a non-template path unchanged", () => {
  assertEquals(resolveTargetPath("brief.md", "demo-app"), "brief.md");
});

Deno.test("file-kind predicates classify the special paths", () => {
  assertEquals(isTemplateFile("discern.toml.tmpl"), true);
  assertEquals(isTemplateFile("brief.md"), false);
  assertEquals(isGitignoreFragment(".gitignore.fragment"), true);
  assertEquals(isGitignoreFragment(".gitignore"), false);
  // Settings-template routing is no longer a hardcoded predicate here — it is
  // registry-driven in fs_plan (a template whose TARGET is a hooks provider's
  // settings file). See fs_plan_test.ts / the synthetic hooks-provider test.
});
