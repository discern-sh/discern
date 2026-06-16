/**
 * Config helpers: slug validation/derivation, agent and glob parsing, and the
 * TOML-array fragment renderer that feeds `{{agents_array}}` etc. These shape
 * every wizard answer into the exact strings the templates expect.
 */

import { assertEquals } from "@std/assert";
import {
  isValidSlug,
  parseAgents,
  parseSourceGlobs,
  slugify,
  tokensFromConfig,
} from "../src/lib/config.ts";
import { renderTomlStringList } from "../src/lib/toml_render.ts";

Deno.test("isValidSlug accepts the documented shape and rejects the rest", () => {
  for (const ok of ["a", "my-app", "app2", "x-1-y"]) {
    assertEquals(isValidSlug(ok), true, `expected "${ok}" valid`);
  }
  for (const bad of ["-leading", "Upper", "has space", "under_score", ""]) {
    assertEquals(isValidSlug(bad), false, `expected "${bad}" invalid`);
  }
});

Deno.test("slugify kebab-cases a free-text name", () => {
  assertEquals(slugify("Demo App"), "demo-app");
  assertEquals(slugify("  My  Cool_Project!! "), "my-cool-project");
  assertEquals(slugify("Already-Kebab"), "already-kebab");
});

Deno.test("parseAgents keeps known agents and reports unknown ones", () => {
  const { agents, unknown } = parseAgents("claude_code, codex, bogus");
  assertEquals(agents, ["claude_code", "codex"]);
  assertEquals(unknown, ["bogus"]);
});

Deno.test("parseAgents dedups and ignores empty entries", () => {
  const { agents } = parseAgents("codex,,codex");
  assertEquals(agents, ["codex"]);
});

Deno.test("parseSourceGlobs splits, trims, and drops empties", () => {
  assertEquals(parseSourceGlobs("src/** , app/** ,"), ["src/**", "app/**"]);
});

Deno.test("renderTomlStringList quotes and comma-joins", () => {
  assertEquals(
    renderTomlStringList(["claude_code", "codex"]),
    '"claude_code", "codex"',
  );
  assertEquals(renderTomlStringList(["src/**"]), '"src/**"');
  assertEquals(renderTomlStringList([]), "");
});

Deno.test("tokensFromConfig produces the full token contract", () => {
  const map = tokensFromConfig({
    projectName: "Demo App",
    slug: "demo-app",
    branchPrefix: "agent/",
    sourceGlobs: ["src/**", "lib/**"],
    brief: "anything",
    agents: ["claude_code", "codex"],
  });
  assertEquals(map.project_name, "Demo App");
  assertEquals(map.project_slug, "demo-app");
  assertEquals(map.branch_prefix, "agent/");
  assertEquals(map.agents_array, '"claude_code", "codex"');
  assertEquals(map.scopes_web, '"src/**", "lib/**"');
  // The neutral/previewable/gotchas defaults are fixed.
  assertEquals(map.scopes_neutral, '"docs/", ".ai/", ".claude/"');
  assertEquals(map.scopes_previewable, '"public/**"');
});
