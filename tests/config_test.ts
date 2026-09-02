/**
 * Config helpers: slug validation/derivation, agent and glob parsing, and the
 * TOML-array fragment renderer that feeds `{{agents_array}}` etc. These shape
 * every wizard answer into the exact strings the templates expect.
 */

import { assert, assertEquals } from "@std/assert";
import {
  defaultDocumentationScopePaths,
  defaultDocumentationScopes,
  defaultInstructionScopePaths,
  defaultInstructionScopes,
  isValidSlug,
  parseAgents,
  parseSourceGlobs,
  slugify,
  tokensFromConfig,
} from "../src/lib/config.ts";
import { renderTomlStringList } from "../src/lib/toml_render.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { isNeutralPath } from "../src/engine/scopes/scopes.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import { sourcePathReference } from "../src/shared/source_path_references.ts";

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
    mapDir: "docs/discern/",
  });
  assertEquals(map.project_name, "Demo App");
  assertEquals(map.project_slug, "demo-app");
  assertEquals(map.branch_prefix, "agent/");
  assertEquals(map.agents_array, '"claude_code", "codex"');
  assertEquals(map.map_dir, "docs/discern/");
  // The neutral and gotchas defaults are fixed. Pure documentation and
  // agent-instruction surfaces render through separate seed-scope tokens.
  assertEquals(
    map.scopes_neutral,
    defaultDocumentationScopes().join(", "),
  );
  assertEquals(
    map.scopes_instructions,
    defaultInstructionScopes().join(", "),
  );
  assertEquals(defaultDocumentationScopes(), [
    '"${map.dir}"',
    '"${project.todo}"',
  ]);
  assertEquals(defaultInstructionScopes(), [
    '"discern/instructions.md"',
    '"${skills.dir}/"',
    '"discern/brief.md"',
    '".claude/skills/"',
    '".agents/skills/"',
  ]);
});

Deno.test("every gate-neutral authored path belongs to exactly one seed scope", () => {
  const docs = defaultDocumentationScopePaths();
  const instructions = defaultInstructionScopePaths();
  for (const name of SOURCE_PATH_NAMES) {
    const entry = SOURCE_PATHS[name];
    if (!entry.gateNeutral) continue;
    const source = sourcePathReference(name) ?? entry.defaultPath;
    const path = entry.pathKind === "directory" &&
        !entry.defaultPath.endsWith("/")
      ? `${source}/`
      : source;
    assertEquals(
      Number(docs.includes(path)) + Number(instructions.includes(path)),
      1,
      `${name}: every gate-neutral authored path must belong to exactly one seed scope`,
    );
  }
});

Deno.test("the fresh neutral scopes separate pure docs from owner-reviewed instructions", () => {
  const config = parseConfigOrThrow(
    [
      "[scopes.map]",
      `paths = [${defaultDocumentationScopes().join(", ")}]`,
      "neutral = true",
      "",
      "[scopes.instructions]",
      `paths = [${defaultInstructionScopes().join(", ")}]`,
      "neutral = true",
      "",
    ].join("\n"),
  );

  for (const path of ["discern/map/README.md", "discern/TODO.md"]) {
    assert(isNeutralPath(config, path), `${path} should be neutral`);
  }

  for (
    const path of [
      "discern/instructions.md",
      "discern/skills/review/SKILL.md",
      "discern/brief.md",
      ".claude/skills/review/SKILL.md",
      ".agents/skills/review/SKILL.md",
    ]
  ) {
    assert(isNeutralPath(config, path), `${path} should be neutral`);
  }

  for (const path of defaultDocumentationScopePaths()) {
    assert(
      !defaultInstructionScopePaths().includes(path),
      `${path} must not share the owner-reviewed instructions scope`,
    );
  }

  for (
    const path of [
      "discern/scripts/release.ts",
      ".claude/commands/review.md",
      ".claude/settings.json",
      ".agents/hooks/preflight.ts",
    ]
  ) {
    assert(!isNeutralPath(config, path), `${path} should run the gate`);
  }
});
