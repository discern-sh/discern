/**
 * The pure root-`.gitignore` matcher behind discern's block exceptions, held to
 * Git itself. Every case writes a project `.gitignore`, then compares the
 * matcher's verdict with `git check-ignore` for every integration path the
 * provider registry declares plus neighbours in the same folders. The rules
 * `reincludingRules` appends must make Git admit every integration path while
 * every neighbour keeps Git's original verdict.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { trackedSharedProviderPaths } from "../src/lib/artifact_ownership.ts";
import {
  ignoreVerdict,
  parseIgnorePatterns,
  reincludingRules,
} from "../src/lib/gitignore_patterns.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";

/** Every integration path discern expects Git to track, across all agents. */
const INTEGRATION_PATHS = trackedSharedProviderPaths(AGENT_NAMES);

/** Files beside them that the project's rules must keep deciding. */
const NEIGHBOURS = [
  ".codex/other.json",
  ".codex/environments/other.toml",
  ".codex/rules/other.rules",
  ".cursor/other.json",
  ".claude/other.json",
  ".gemini/other.json",
  ".github/other.json",
  ".github/hooks/other.json",
  "other.json",
  "README.md",
];

/** Root `.gitignore` files in the shapes tool and editor templates take. */
const CASES: readonly (readonly string[])[] = [
  [".codex/"],
  ["/.codex"],
  [".codex"],
  [".codex/*"],
  [".*"],
  [".*", "!.gitignore"],
  ["*"],
  ["/*", "!/README.md"],
  ["**/.codex/**"],
  ["*.json"],
  [".c*/"],
  ["[.]codex/", "[!x]cursor/"],
  [".codex/**/*.toml"],
  [".mcp.json"],
  ["/.mcp.json"],
  ["**/settings.json"],
  [".claude/**"],
  [".claude/*", "!.claude/settings.json"],
  [".cursor/", "!.cursor/mcp.json"],
  ["environments/"],
  ["**/rules/"],
  ["?codex/"],
  [".codex/rules/*.rules"],
  ["*.toml", "!config.toml"],
  [".github/"],
  [".gemini", ".github/hooks/"],
  ["# a comment", "", "  ", "\\#literal", ".codex/   "],
  ["a/**/b", "**/hooks.json"],
  ["hooks.json/", ".mcp.json/", "/.codex/config.toml/"],
];

/** The paths Git ignores among `paths`, from the root `.gitignore` alone. */
async function gitIgnored(
  root: string,
  paths: readonly string[],
): Promise<Set<string>> {
  const run = new Deno.Command("git", {
    args: ["check-ignore", "--stdin", "-z", "--no-index"],
    cwd: root,
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = run.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(paths.map((path) => `${path}\0`).join("")),
  );
  await writer.close();
  const { code, stdout } = await run.output();
  assert(code === 0 || code === 1, `git check-ignore exited ${code}`);
  return new Set(
    new TextDecoder().decode(stdout).split("\0").filter((path) => path !== ""),
  );
}

/** The paths the matcher says `lines` exclude. */
function matcherIgnored(
  lines: readonly string[],
  paths: readonly string[],
): Set<string> {
  const patterns = parseIgnorePatterns(lines);
  return new Set(
    paths.filter((path) => ignoreVerdict(patterns, path) !== undefined),
  );
}

Deno.test("the matcher agrees with git check-ignore, and the re-include rules admit only integration files", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "README.md"), "fixture\n");
    await gitInit(root);
    await git(root, "config", "core.excludesFile", "/dev/null");
    await git(root, "config", "core.ignoreCase", "false");
    const queried = [...INTEGRATION_PATHS, ...NEIGHBOURS];
    for (const lines of CASES) {
      const label = JSON.stringify(lines);
      await Deno.writeTextFile(
        join(root, ".gitignore"),
        `${lines.join("\n")}\n`,
      );
      const original = await gitIgnored(root, queried);
      assertEquals(
        [...matcherIgnored(lines, queried)].sort(),
        [...original].sort(),
        `${label}: the matcher must agree with Git`,
      );

      const combined = [
        ...lines,
        ...reincludingRules(lines, INTEGRATION_PATHS),
      ];
      await Deno.writeTextFile(
        join(root, ".gitignore"),
        `${combined.join("\n")}\n`,
      );
      const after = await gitIgnored(root, queried);
      assertEquals(
        INTEGRATION_PATHS.filter((path) => after.has(path)),
        [],
        `${label}: every integration path is re-included`,
      );
      assertEquals(
        NEIGHBOURS.filter((path) => after.has(path) !== original.has(path)),
        [],
        `${label}: neighbours keep the project's verdict`,
      );
      assertEquals(
        [...matcherIgnored(combined, queried)].sort(),
        [...after].sort(),
        `${label}: the matcher agrees with Git after the exceptions`,
      );
    }
  });
});

Deno.test("a verdict names the deciding rule and any excluded folder", () => {
  const patterns = parseIgnorePatterns(["node_modules/", ".tool/", "*.log"]);
  const nested = ignoreVerdict(patterns, ".tool/config.json");
  assertEquals(nested?.pattern.line, 2);
  assertEquals(nested?.pattern.text, ".tool/");
  assertEquals(nested?.excludedDirectory, ".tool");
  const direct = ignoreVerdict(patterns, "build.log");
  assertEquals(direct?.pattern.line, 3);
  assertEquals(direct?.excludedDirectory, undefined);
  assertEquals(ignoreVerdict(patterns, "src/main.ts"), undefined);
  assertEquals(reincludingRules(["node_modules/"], [".tool/config.json"]), []);
});
