/**
 * Token substitution and path resolution — the substitution contract.
 *
 * These pin the rules the scaffolder depends on: known tokens substitute,
 * unknown tokens are left verbatim and reported, the worktree engine's `@…@`
 * runtime tokens use a different delimiter (so the installer never touches them),
 * the single path token resolves in a file name, and `.tmpl` is stripped. A
 * regression in any of these silently corrupts every scaffold.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  CONTENT_TOKEN_NAMES,
  isGitignoreFragment,
  isTemplateFile,
  resolveTargetPath,
  substituteTokens,
  type TokenMap,
} from "../src/lib/template.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** A complete token map for tests, with recognisable values. */
function tokens(): TokenMap {
  return {
    project_name: "Demo App",
    project_slug: "demo-app",
    branch_prefix: "agent/",
    agents_array: '"claude_code", "codex"',
    map_dir: "docs/",
    gotchas_doc: "docs/80-development/done-gate-gotchas.md",
    scopes_neutral: '"${map.dir}", ".discern/", ".claude/"',
    scopes_instructions: '"discern/instructions.md", "${skills.dir}"',
    artifact_provenance_marker: "discern provenance marker",
    discern_version: "0.1.0",
  };
}

Deno.test("substituteTokens replaces every known content token", () => {
  const input =
    "name={{project_name}} slug={{project_slug}} v={{discern_version}}";
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

Deno.test("every scaffold content token and seed-template placeholder enroll each other", async () => {
  const files = await structuralGuardScope({
    guard: "tests/template_test.ts#scaffold-token-parity",
    universe: "authored-text",
    narrow: {
      reason:
        "The scaffold token contract applies only to seed templates; bundled skills, instructions, and setup pages have separate renderers.",
      include: (rel) =>
        rel.startsWith("templates/") &&
        ![
          "templates/skills/",
          "templates/instructions/",
          "templates/setup/",
        ].some((prefix) => rel.startsWith(prefix)),
    },
  });
  const seen = new Set<string>();
  const unknown: string[] = [];
  const declared = new Set<string>(CONTENT_TOKEN_NAMES);
  for (const rel of files) {
    const text = `${rel}\n${await Deno.readTextFile(join(REPO_ROOT, rel))}`;
    for (const match of text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)) {
      const name = match[1];
      assert(name !== undefined);
      seen.add(name);
      if (!declared.has(name)) unknown.push(`${rel}: ${name}`);
    }
  }
  assert(files.length >= 5, "the seed-template scan must stay broad");
  assertEquals(unknown, []);
  assertEquals(
    CONTENT_TOKEN_NAMES.filter((name) => !seen.has(name)),
    [],
    "every declared content token must occur in a seed template",
  );
});
