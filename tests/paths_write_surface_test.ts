/**
 * The write-surface contract (ADR 0099), enforced — guard #4 of the leakage
 * battery (ADR 0102). discern writes to a user project ONLY: the root
 * `discern.toml`; the configured source paths (the paths registry, through the
 * resolvers); the agent files, materialized skills dirs, and provider
 * integration files (the provider registry); the delimited `.gitignore` block;
 * and the worktree `.env` upsert. Everything else it records lives inside
 * `.git` (the gate receipt, the ready sentinel, the resource ledger, the
 * ignored-file baseline, the logbook), at a user-typed output path, or in a
 * temp file — outside the project tree and outside this contract.
 *
 * Two legs, so a stray write fails no matter where it hides:
 *
 * 1. **Static funnel** (the ADR 0054 house style): every raw filesystem write
 *    primitive under `src/**` must live in a sanctioned write-site module —
 *    one whose writes target a contract bucket. A `Deno.writeTextFile` planted
 *    in any other module fails here, whether or not a test exercises it.
 * 2. **Runtime diff**: scaffold a real project, run the writing verbs
 *    (`setup begin` for every known agent, then `refresh` and `upgrade`), and
 *    diff every file the run created or modified against the contract,
 *    derived from the paths registry and the provider registry — never a
 *    hand-copied list. A stray write inside a sanctioned module fails here.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, runAgent } from "./engine_helpers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  AGENT_NAMES,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  artifactPathMatches,
  isDiscernWriteTarget,
  projectArtifactPaths,
} from "../src/lib/artifact_ownership.ts";

// ── leg 1: the static funnel ─────────────────────────────────────────────────

/** A raw filesystem mutation primitive: the Deno write/link/move/remove/temp
 * calls, plus `ensureDir` (directory creation). Reads are not writes. Temp
 * creation is included because an explicit `dir` can deliberately target Git
 * metadata, as the write-authority probe does. */
const WRITE_PRIMITIVE =
  /\bDeno\.(writeTextFile|writeFile|copyFile|symlink|rename|remove|mkdir|makeTempFile|makeTempDir)\s*\(|\bensureDir\s*\(/;

/** An `@std/fs` tree-mutation helper imported by name (`copy`, `move`) — the
 * one non-`Deno.*` way src code writes files today (skills materialization). */
const STD_FS_MUTATION_IMPORT =
  /import\s*{[^}]*\b(copy|move)\b[^}]*}\s*from\s*"@std\/fs"/;

/**
 * The sanctioned write-site modules, each annotated with the contract bucket
 * its writes target. This is a funnel-home list in the house style (like the
 * subprocess SSOT guard's spawner homes); the PATHS those funnels may write are
 * not trusted from this list — the runtime leg derives them from the
 * registries and checks the actual writes.
 */
const WRITE_SITE_HOMES = new Map<string, string>([
  // discern.toml (the config writer) + the seed scaffold
  [
    "src/lib/fs_plan.ts",
    "the plan applier: the config seed, the .gitignore block, provider settings seeds, the brief",
  ],
  [
    "src/commands/setup.ts",
    "setup: the guidance seed, the docs/TODO skeletons (registry-resolved), config provenance",
  ],
  [
    "src/commands/uninstall.ts",
    "the uninstall executor: removes registry-declared generated files and strips co-owned files (the write-surface inverse)",
  ],
  [
    "src/lib/tidy_format.ts",
    "the canonical discern.toml writer shared by every config mutation path",
  ],
  [
    "src/engine/tidy/tidy.ts",
    "the configured map, guidance, TODO, and root discern.toml formatter",
  ],
  [
    "src/lib/migrations.ts",
    "MigrationContext: registry legacy-to-default moves + config edits",
  ],
  // provider-registry paths
  [
    "src/engine/guidelines.ts",
    "the agent files (provider registry guidance paths)",
  ],
  [
    "src/lib/providers.ts",
    "provider MCP / rules / worktree-app config files (provider registry)",
  ],
  [
    "src/lib/provider_hooks.ts",
    "provider hook settings files (provider registry)",
  ],
  [
    "src/lib/skills.ts",
    "materialized skills + manifest (provider registry skills dirs)",
  ],
  // the delimited .gitignore block
  ["src/lib/agent_gitignore.ts", "the .gitignore block writer"],
  // runtime worktree state
  [
    "src/engine/worktree/env_file.ts",
    "the worktree .env upsert (never created)",
  ],
  [
    "src/engine/worktree/lifecycle.ts",
    "the ready sentinel — .git-internal, outside the project tree",
  ],
  [
    "src/engine/worktree/git.ts",
    "worktree pruning (removes whole checkouts + .git admin dirs) and the .env upsert",
  ],
  [
    "src/engine/worktree/ignored.ts",
    "the ignored-file baseline — .git-internal, outside the project tree",
  ],
  [
    "src/engine/worktree/resources.ts",
    "the resource ledger — .git-internal, outside the project tree",
  ],
  [
    "src/engine/gate/receipt.ts",
    "the gate receipt — .git-internal, outside the project tree",
  ],
  [
    "src/engine/logbook/store.ts",
    "the logbook (events, epoch sidecar, rotation) — .git-internal, outside the project tree",
  ],
  // paths the user typed (explicit consent) or temp files (outside the tree)
  ["src/commands/docs.ts", "the user-typed docs-export --output path"],
  [
    "src/engine/gate/diagnostic_output.ts",
    "full diagnostic output offloaded to a temp file (outside the project tree)",
  ],
  [
    "src/shared/temp_artifacts.ts",
    "the OS-temp artifact registry: creates gate output artifacts and reaps expired ones (outside the project tree; ADR 0117)",
  ],
  [
    "src/shared/write_preflight.ts",
    "ephemeral same-directory authority probes for writes a slow workflow plans to perform later",
  ],
]);

const SRC = join(dirname(fromFileUrl(import.meta.url)), "..", "src");

/** Every `.ts` file under `src/`, as `[repo-relative path, contents]`. */
async function srcFiles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  const src = SRC;
  for await (const entry of walk(src, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) {
      continue;
    }
    out.push([
      join("src", relative(src, entry.path)),
      await Deno.readTextFile(entry.path),
    ]);
  }
  return out;
}

Deno.test("every filesystem write primitive lives in a sanctioned write-site module", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await srcFiles()) {
    if (WRITE_SITE_HOMES.has(rel)) {
      continue;
    }
    if (WRITE_PRIMITIVE.test(text) || STD_FS_MUTATION_IMPORT.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "files write to the filesystem outside the sanctioned write-site modules — " +
      "route the write through a contract surface (a registry-resolved path, " +
      "the provider registry, the .gitignore/config writers, or the worktree " +
      ".env upsert; see ADR 0099) and add the module here with its bucket:\n  " +
      offenders.join("\n  "),
  );
});

Deno.test("the sanctioned write-site list carries no stale entries", async () => {
  const stale: string[] = [];
  const byRel = new Map(await srcFiles());
  for (const rel of WRITE_SITE_HOMES.keys()) {
    const text = byRel.get(rel);
    if (
      text === undefined ||
      (!WRITE_PRIMITIVE.test(text) && !STD_FS_MUTATION_IMPORT.test(text))
    ) {
      stale.push(rel);
    }
  }
  assertEquals(
    stale,
    [],
    `sanctioned write-site modules that no longer write — drop them from the list:\n  ${
      stale.join("\n  ")
    }`,
  );
});

// ── leg 2: the runtime diff ──────────────────────────────────────────────────

/** Fingerprint every file under `root` (skipping `.git/`): rel path → content,
 * with a symlink fingerprinted by its target rather than followed. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for await (
    const entry of walk(root, { includeDirs: false, followSymlinks: false })
  ) {
    const rel = relative(root, entry.path);
    if (rel === ".git" || rel.startsWith(".git/")) {
      continue;
    }
    out.set(
      rel,
      entry.isSymlink
        ? `link:${await Deno.readLink(entry.path)}`
        : await Deno.readTextFile(entry.path),
    );
  }
  return out;
}

/** The rel paths `after` created or modified versus `before`. */
function writtenPaths(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const [rel, print] of after) {
    if (before.get(rel) !== print) {
      out.push(rel);
    }
  }
  return out.sort();
}

/**
 * The write-surface contract as a predicate over project-relative paths,
 * derived from the canonical artifact enumeration against the project's own
 * config. Provider-local paths are declared there so the ignore contract stays
 * exhaustive, but they are not discern write targets.
 */
async function contractPredicate(
  root: string,
): Promise<(rel: string) => boolean> {
  const config = parseConfigOrThrow(
    await Deno.readTextFile(join(root, "discern.toml")),
  );
  const writable = projectArtifactPaths(config).filter(isDiscernWriteTarget);
  return (rel) => writable.some((entry) => artifactPathMatches(entry, rel));
}

Deno.test("setup begin + refresh + upgrade write only inside the contract", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# Write-surface probe\n");
    await gitInit(dir);
    const before = await snapshotTree(dir);

    // The richest writing verb, for every agent the registry knows: seeds,
    // skeletons, guidance seed, provider wiring, skills, agent files.
    let r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(r.code, 0, r.output);

    // Mark the install set up so the work verbs run rather than redirecting to
    // setup, and commit so upgrade's clean-tree guard is satisfied. Both are
    // the test's own writes to already-in-contract paths.
    const configPath = join(dir, "discern.toml");
    const editor = new TomlEditor(await Deno.readTextFile(configPath));
    editor.setBool("meta.bootstrapped", true);
    await Deno.writeTextFile(configPath, editor.toString());
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "post-setup", "--no-gpg-sign");

    r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);
    r = await runAgent(dir, ["upgrade"]);
    assertEquals(r.code, 0, r.output);

    const after = await snapshotTree(dir);
    const written = writtenPaths(before, after);
    assert(written.length > 0, "the run must observe real writes");

    const inContract = await contractPredicate(dir);
    const offenders = written.filter((rel) => !inContract(rel));
    assertEquals(
      offenders,
      [],
      "the run wrote outside the ADR 0099 write-surface contract — every " +
        "project-tree write must target a registry path (through the " +
        "resolvers), a provider-registry path, discern.toml, the .gitignore " +
        "block, or the worktree .env:\n  " + offenders.join("\n  "),
    );
  });
});
