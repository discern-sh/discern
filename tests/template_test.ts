/**
 * Token substitution and path resolution — the substitution contract.
 *
 * These pin the rules the scaffolder depends on: known tokens substitute,
 * unknown tokens are left verbatim and reported, the `{{db}}` runtime token is
 * preserved, the single path token resolves in a file name, and `.tmpl` is
 * stripped. A regression in any of these silently corrupts every scaffold.
 */

import { assertEquals } from "@std/assert";
import {
  isContractExecutable,
  isGitignoreFragment,
  isSettingsTemplate,
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
    gotchas_doc: "docs/80-development/finish-gate-gotchas.md",
    scopes_neutral: '"docs/", ".ai/", ".claude/"',
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

Deno.test("substituteTokens preserves the {{db}} runtime token without reporting drift", () => {
  const { text, unknown } = substituteTokens("clone=createdb {{db}}", tokens());
  // {{db}} is owned by the worktree engine: pass through, and it is NOT drift.
  assertEquals(text, "clone=createdb {{db}}");
  assertEquals(unknown, []);
});

Deno.test("substituteTokens dedups repeated unknown tokens", () => {
  const { unknown } = substituteTokens("{{x}} {{x}} {{y}}", tokens());
  assertEquals(unknown.sort(), ["x", "y"]);
});

Deno.test("resolveTargetPath substitutes the slug path token and strips .tmpl", () => {
  assertEquals(
    resolveTargetPath(".ai/guidelines/{{project_slug}}.md.tmpl", "demo-app"),
    ".ai/guidelines/demo-app.md",
  );
});

Deno.test("resolveTargetPath strips .tmpl from a token-free path", () => {
  assertEquals(
    resolveTargetPath("icculus.toml.tmpl", "demo-app"),
    "icculus.toml",
  );
});

Deno.test("resolveTargetPath leaves a non-template path unchanged", () => {
  assertEquals(resolveTargetPath("bin/agent", "demo-app"), "bin/agent");
});

Deno.test("file-kind predicates classify the special paths", () => {
  assertEquals(isTemplateFile("icculus.toml.tmpl"), true);
  assertEquals(isTemplateFile("bin/agent"), false);
  assertEquals(isGitignoreFragment(".gitignore.fragment"), true);
  assertEquals(isGitignoreFragment(".gitignore"), false);
  assertEquals(isSettingsTemplate(".claude/settings.json.tmpl"), true);
  assertEquals(isSettingsTemplate(".claude/settings.json"), false);
});

Deno.test("isContractExecutable marks the dispatcher and top-level recipes only", () => {
  assertEquals(isContractExecutable("bin/agent"), true);
  assertEquals(isContractExecutable(".icculus/engine/finish"), true);
  assertEquals(isContractExecutable(".icculus/engine/worktree-exit"), true);
  // lib sources and awk data are NOT executable.
  assertEquals(isContractExecutable(".icculus/engine/lib/jobs.sh"), false);
  assertEquals(isContractExecutable(".icculus/engine/lib/toml.awk"), false);
  // Unrelated files are not executable.
  assertEquals(isContractExecutable("icculus.toml"), false);
  assertEquals(isContractExecutable("docs/README.md"), false);
});
