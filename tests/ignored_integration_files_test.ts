/**
 * Integration files a project's own ignore rules exclude. discern expects Git
 * to track every Shared integration file a provider declares; these cases
 * hold the probe to the whole provider registry, then drive the probe, the
 * machinery staging, and doctor's check against real Git repositories, so
 * "ignored" always means what Git says.
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
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { ignoredIntegrationFiles } from "../src/lib/ignored_integration_files.ts";
import { describeIgnoredFiles } from "../src/shared/ignored_integration.ts";
import {
  planIgnoredFiles,
  stageMachineryPaths,
} from "../src/commands/setup_ignored_files.ts";
import { integrationFileChecks } from "../src/engine/doctor/integration_checks.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";

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

Deno.test("machinery staging applies each owner choice without a failed add", async () => {
  const paths = trackedSharedProviderPaths(["codex"]);
  const rules = [...new Set(paths.map(excludingRule))];
  /** Write every codex integration file into an ignoring repository. */
  const fixture = async (dir: string): Promise<void> => {
    await ignoringRepo(dir, rules);
    for (const path of paths) {
      await Deno.mkdir(join(dir, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, path), "wired\n");
    }
  };
  const staged = async (dir: string): Promise<string[]> =>
    (await gitOut(dir, "diff", "--cached", "--name-only", "-z"))
      .split("\0").filter((path) => path !== "").sort();

  await withTempDir(async (dir) => {
    await fixture(dir);
    const planned = await planIgnoredFiles(dir, ["codex"], undefined);
    assert("awaiting" in planned, "no choice must wait for the owner");
    assertEquals(planned.awaiting.map((file) => file.path), paths);
  });

  await withTempDir(async (dir) => {
    await fixture(dir);
    const planned = await planIgnoredFiles(dir, ["codex"], "track-anyway");
    assert("plan" in planned);
    const result = await stageMachineryPaths(dir, paths, planned.plan);
    assert("staged" in result, JSON.stringify(result));
    assertEquals(await staged(dir), [...paths].sort());
  });

  await withTempDir(async (dir) => {
    await fixture(dir);
    const planned = await planIgnoredFiles(dir, ["codex"], "keep-local");
    assert("plan" in planned);
    assertEquals(planned.plan.keepLocal, paths);
    const result = await stageMachineryPaths(
      dir,
      [...paths, ".gitignore"],
      planned.plan,
    );
    assert("staged" in result, JSON.stringify(result));
    assertEquals(result.staged, [".gitignore"]);
    assertEquals(await staged(dir), []);
  });

  // An integration file already tracked beneath an ignored folder needs no
  // choice, and is staged without Git exiting 1 on the folder's rule.
  await withTempDir(async (dir) => {
    await fixture(dir);
    await git(dir, "add", "--force", "--", ...paths);
    await git(dir, "commit", "-q", "-m", "tracked earlier");
    for (const path of paths) {
      await Deno.writeTextFile(join(dir, path), "rewired\n");
    }
    const planned = await planIgnoredFiles(dir, ["codex"], undefined);
    assert("plan" in planned, "tracked files need no owner choice");
    assertEquals(planned.plan.choice, undefined);
    const result = await stageMachineryPaths(dir, paths, planned.plan);
    assert("staged" in result, JSON.stringify(result));
    assertEquals(await staged(dir), [...paths].sort());
  });
});

Deno.test("doctor separates undecided, kept-local, and stale integration files", async () => {
  const paths = trackedSharedProviderPaths(["codex"]);
  const [kept = "", ...undecided] = paths;
  const config = (listed: readonly string[]): DiscernConfig =>
    parseConfigOrThrow(
      `[project]\nagents = ["codex"]\nlocal_integration_files = ${
        JSON.stringify(listed)
      }\n`,
    );
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, [...new Set(paths.map(excludingRule))]);

    const [mixed] = await integrationFileChecks(
      dir,
      config([kept, "not-an-integration.json"]),
    );
    assertEquals(mixed?.warn, true);
    for (const path of undecided) {
      assertStringIncludes(mixed?.detail ?? "", path);
    }
    assert(
      !(mixed?.detail ?? "").includes(kept),
      "a kept-local file is decided",
    );
    assertStringIncludes(mixed?.detail ?? "", "not-an-integration.json");
    assertStringIncludes(mixed?.fix ?? "", "git add --force --");
    assertStringIncludes(mixed?.fix ?? "", "[project].local_integration_files");

    const [decided] = await integrationFileChecks(dir, config(paths));
    assertEquals(decided?.warn, undefined);
    assertEquals(decided?.ok, true);
    assertStringIncludes(decided?.detail ?? "", "kept out of Git");
  });
  await withTempDir(async (dir) => {
    await ignoringRepo(dir, ["/build-output/"]);
    const [clean] = await integrationFileChecks(dir, config([]));
    assertEquals(clean?.warn, undefined);
    assertStringIncludes(clean?.detail ?? "", "Git can track all");
  });
  await withTempDir(async (dir) => {
    assertEquals(await integrationFileChecks(dir, config([])), []);
  });
});
