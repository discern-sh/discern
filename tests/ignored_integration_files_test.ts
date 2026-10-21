/**
 * Integration files a project's own ignore rules exclude. discern expects Git
 * to track every Shared integration file a provider declares; these cases
 * hold the probe to the whole provider registry, then drive the probe, setup's
 * machinery staging, doctor's check, and refresh's `.gitignore` block against
 * real Git repositories, so "ignored" always means what Git says.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import {
  projectArtifactPaths,
  trackedSharedProviderPaths,
} from "../src/lib/artifact_ownership.ts";
import { declaredFileOwnership } from "../src/shared/file_ownership.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  existingIntegrationFiles,
  ignoredIntegrationFiles,
} from "../src/lib/ignored_integration_files.ts";
import { describeIgnoredFiles } from "../src/shared/ignored_integration.ts";
import {
  integrationStaging,
  stageMachineryPaths,
} from "../src/commands/setup_ignored_files.ts";
import { ensureDiscernGitignoreBlock } from "../src/lib/agent_gitignore.ts";
import { planTrackedRefresh } from "../src/engine/tracked_refresh.ts";
import { compileInstructions } from "../src/engine/instructions.ts";
import { Logger } from "../src/lib/log.ts";
import { integrationFileChecks } from "../src/engine/doctor/integration_checks.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut, scaffoldEngine } from "./engine_helpers.ts";

/** One ownership-bearing declaration found anywhere inside a provider entry. */
interface OwnedDeclaration {
  readonly field: string;
  readonly path: string;
  readonly shared: boolean;
}

/**
 * Walk a provider entry for every object declaring `ownership`, independent
 * of the registry's own flattening, so a new integration field enrolls here
 * the moment it declares ownership. Each declaring object must carry exactly
 * one string: its path.
 */
function ownedDeclarations(value: unknown, field = ""): OwnedDeclaration[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      ownedDeclarations(item, `${field}[${index}]`)
    );
  }
  const record = value as Record<string, unknown>;
  const found: OwnedDeclaration[] = [];
  if (typeof record.ownership === "object" && record.ownership !== null) {
    const strings = Object.entries(record).filter(([, v]) =>
      typeof v === "string"
    );
    if (strings.length !== 1) {
      throw new Error(
        `${field} declares ownership but carries ${strings.length} string fields; name its path unambiguously`,
      );
    }
    const [[, path = ""] = []] = strings;
    found.push({
      field,
      path: String(path),
      shared: (record.ownership as Record<string, unknown>).shared === true,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "ownership") {
      found.push(...ownedDeclarations(child, field ? `${field}.${key}` : key));
    }
  }
  return found;
}

/** A repository whose ignore rules come only from its own files. */
async function ignoringRepo(
  dir: string,
  rules: readonly string[],
): Promise<void> {
  await Deno.writeTextFile(join(dir, ".gitignore"), `${rules.join("\n")}\n`);
  await gitInit(dir);
  await git(dir, "config", "core.excludesFile", "/dev/null");
}

/** A rule that excludes `path` the way a tool-folder template would: its
 * top-level folder, or the file itself at the root. */
function excludingRule(path: string): string {
  const [top = path] = path.split("/");
  return path.includes("/") ? `${top}/` : path;
}

/** A logger that prints nothing, for in-process refreshes. */
function quietLogger(): Logger {
  return new Logger({ json: true, noColor: true });
}

Deno.test("every Shared file a provider declares enrolls in the ignored-file probe", () => {
  const registry = new Map(
    projectArtifactPaths(parseConfigOrThrow("")).map((entry) => [
      entry.path,
      entry,
    ]),
  );
  for (const agent of AGENT_NAMES) {
    const shared = ownedDeclarations(PROVIDERS[agent]).filter((d) => d.shared);
    assert(shared.length > 0, `${agent} declares no Shared path`);
    const files: string[] = [];
    for (const declaration of shared) {
      const entry = registry.get(declaration.path);
      assert(
        entry !== undefined,
        `${agent}.${declaration.field} (${declaration.path}) is missing from the project artifact registry`,
      );
      if (entry.pathKind === "file") files.push(declaration.path);
    }
    const probed = trackedSharedProviderPaths([agent]);
    assertEquals(
      [...probed].sort(),
      [...new Set(files)].sort(),
      `${agent}: the probe must cover exactly its Shared files`,
    );
    for (const path of probed) {
      const entry = registry.get(path);
      assert(entry !== undefined && declaredFileOwnership(entry) === "shared");
    }
  }
});

Deno.test("a project rule excluding any tracked Shared provider path is reported for its agent", async () => {
  for (const agent of AGENT_NAMES) {
    const paths = trackedSharedProviderPaths([agent]);
    await withTempDir(async (dir) => {
      await ignoringRepo(dir, [...new Set(paths.map(excludingRule))]);
      const found = await ignoredIntegrationFiles(dir, [agent]);
      assert(found !== undefined, `${agent}: Git could not answer`);
      assertEquals(
        found.map((file) => file.path),
        paths,
        `${agent}: every excluded integration file is reported`,
      );
      for (const file of found) {
        assertEquals(file.tracked, false, file.path);
        assertStringIncludes(file.rule, `.gitignore:`);
        assertStringIncludes(file.rule, excludingRule(file.path));
      }
    });
  }
});

Deno.test("the probe reports nothing without a matching rule, a tracked match as tracked, and nothing outside Git", async () => {
  const [first = "", ...rest] = trackedSharedProviderPaths(["codex"]);
  assert(first.includes("/"), "the codex fixture needs a folder-scoped file");
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    assertEquals(await ignoredIntegrationFiles(dir, ["codex"]), []);
  });
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, [excludingRule(first)]);
    await Deno.mkdir(join(dir, first, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, first), "tracked = true\n");
    await git(dir, "add", "--force", "--", first);
    await git(dir, "commit", "-q", "-m", "track one");
    const found = await ignoredIntegrationFiles(dir, ["codex"]);
    assertEquals(
      found?.map((file) => [file.path, file.tracked]),
      [[first, true], ...rest.map((path) => [path, false])],
    );
  });
  await withTempDir(async (dir) => {
    assertEquals(await ignoredIntegrationFiles(dir, ["codex"]), undefined);
  });
});

Deno.test("files sharing a rule are listed once under it", () => {
  assertEquals(
    describeIgnoredFiles([
      { path: ".tool/a.json", rule: ".gitignore:1: .tool/" },
      { path: "b.json", rule: ".gitignore:2: b.json" },
      { path: ".tool/c.json", rule: ".gitignore:1: .tool/" },
    ]),
    "`.tool/a.json`, `.tool/c.json` (.gitignore:1: .tool/); `b.json` (.gitignore:2: b.json)",
  );
});

Deno.test("machinery staging forces only what an ignore rule still matches and leaves out files with other content", async () => {
  const paths = trackedSharedProviderPaths(["codex"]);
  const config = parseConfigOrThrow('[project]\nagents = ["codex"]\n');
  /** Write every codex integration file into a repository. */
  const writeIntegrationFiles = async (dir: string): Promise<void> => {
    for (const path of paths) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), "wired = true\n");
    }
  };
  const staged = async (dir: string): Promise<string[]> =>
    (await gitOut(dir, "diff", "--cached", "--name-only", "-z"))
      .split("\0").filter((path) => path !== "").sort();

  // The project's own rule: discern's block re-includes the files, so a plain
  // add stages them and nothing needs forcing.
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, [...new Set(paths.map(excludingRule))]);
    await ensureDiscernGitignoreBlock(dir, config);
    await writeIntegrationFiles(dir);
    const staging = await integrationStaging(dir, ["codex"], []);
    assertEquals([...staging.force], []);
    const result = await stageMachineryPaths(dir, paths, staging);
    assert("staged" in result, JSON.stringify(result));
    assertEquals(await staged(dir), [...paths].sort());
  });

  // A clone-local rule the block cannot override: the files are forced, since
  // the project's rules allow them.
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    await Deno.writeTextFile(
      join(dir, ".git", "info", "exclude"),
      `${[...new Set(paths.map(excludingRule))].join("\n")}\n`,
    );
    await writeIntegrationFiles(dir);
    const staging = await integrationStaging(dir, ["codex"], []);
    assertEquals([...staging.force].sort(), [...paths].sort());
    const result = await stageMachineryPaths(dir, paths, staging);
    assert("staged" in result, JSON.stringify(result));
    assertEquals(await staged(dir), [...paths].sort());
  });

  // A file that already held other content stays out of the commit.
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    const [held = "", ...rest] = paths;
    await Deno.mkdir(join(dir, held, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, held), "[personal]\ntoken = 1\n");
    assertEquals(await existingIntegrationFiles(dir, ["codex"]), [held]);
    await writeIntegrationFiles(dir);
    const result = await stageMachineryPaths(
      dir,
      paths,
      await integrationStaging(dir, ["codex"], [held]),
    );
    assert("staged" in result, JSON.stringify(result));
    assertEquals(await staged(dir), [...rest].sort());
  });
});

Deno.test("existing integration files count only when untracked and holding content", async () => {
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    const [json = "", other = ""] = trackedSharedProviderPaths(["claude_code"]);
    assert(json.endsWith(".json") && other.endsWith(".json"));
    await Deno.mkdir(join(dir, other, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, json), "{}\n");
    await Deno.writeTextFile(join(dir, other), '{"permissions":{}}\n');
    assertEquals(await existingIntegrationFiles(dir, ["claude_code"]), [
      other,
    ]);
    await git(dir, "add", "--", other);
    await git(dir, "commit", "-q", "-m", "shared settings");
    assertEquals(await existingIntegrationFiles(dir, ["claude_code"]), []);
    await Deno.writeTextFile(join(dir, json), "{ not json\n");
    assertEquals(await existingIntegrationFiles(dir, ["claude_code"]), [json]);
  });
});

Deno.test("doctor names what still hides an integration file, and the fix for each cause", async () => {
  const paths = trackedSharedProviderPaths(["codex"]);
  const config = parseConfigOrThrow('[project]\nagents = ["codex"]\n');
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, [...new Set(paths.map(excludingRule))]);
    const [stale] = await integrationFileChecks(dir, config);
    assertEquals(stale?.warn, true);
    for (const path of paths) assertStringIncludes(stale?.detail ?? "", path);
    assertStringIncludes(stale?.fix ?? "", "discern refresh");

    await ensureDiscernGitignoreBlock(dir, config);
    const [current] = await integrationFileChecks(dir, config);
    assertEquals(current?.warn, undefined);
    assertStringIncludes(current?.detail ?? "", "Git can track all");
  });
  // A clone-local rule, where the project's own rules admit the file: the
  // root `.gitignore` outranks it, but discern's block has nothing to answer.
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    await Deno.writeTextFile(
      join(dir, ".git", "info", "exclude"),
      `${paths[0] ?? ""}\n`,
    );
    const [local] = await integrationFileChecks(dir, config);
    assertEquals(local?.warn, true);
    assertStringIncludes(local?.fix ?? "", "git add --force --");
  });
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    const noAgents = parseConfigOrThrow("[project]\nagents = []\n");
    assertEquals(await integrationFileChecks(dir, noAgents), []);
  });
  await withTempDir(async (dir) => {
    assertEquals(await integrationFileChecks(dir, config), []);
  });
});

Deno.test("refresh keeps discern's block current as agents and project rules change", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["codex"] });
    const ignore = join(dir, ".gitignore");
    await Deno.writeTextFile(
      ignore,
      `.codex/\n${await Deno.readTextFile(ignore)}.cursor/\n`,
    );
    await gitInit(dir);
    const pending = await planTrackedRefresh(dir);
    assert("changes" in pending, JSON.stringify(pending));
    assert(pending.changes.some((change) => change.path === ".gitignore"));

    await compileInstructions(dir, quietLogger());
    const block = await Deno.readTextFile(ignore);
    assertStringIncludes(block, "!/.codex/\n/.codex/*\n");
    assert(!block.includes("!/.cursor/"), "an unconfigured agent gets nothing");
    const current = await planTrackedRefresh(dir);
    assert("changes" in current);
    assertEquals(
      current.changes.filter((change) => change.path === ".gitignore"),
      [],
    );

    // A project rule after the block excludes a newly configured agent's
    // files, so refresh moves the block below it.
    const toml = join(dir, "discern.toml");
    await Deno.writeTextFile(
      toml,
      (await Deno.readTextFile(toml)).replace(
        'agents = ["codex"]',
        'agents = ["codex", "cursor"]',
      ),
    );
    await compileInstructions(dir, quietLogger());
    const moved = await Deno.readTextFile(ignore);
    assert(
      moved.indexOf(".cursor/\n") < moved.indexOf("!/.cursor/"),
      "the block follows the rule it answers",
    );
    assertEquals(await ignoredIntegrationFiles(dir, ["codex", "cursor"]), []);
  });
});
