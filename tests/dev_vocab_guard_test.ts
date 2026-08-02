/**
 * Distribution-vocabulary guards — the net that keeps engine-developer commands
 * out of anything an end user sees.
 *
 * `discern` is both a product and a self-hosting repo, so two command
 * vocabularies coexist: the user's (`discern …`) and the kit's own Deno-task
 * aliases (`deno task <task>`). The latter must never reach a user — not in
 * shipped `templates/` (every project receives it verbatim), and not in any
 * user-facing output the binary prints. These tests fail the gate if the
 * vocabulary leaks, so a future command can't quietly reintroduce the regression.
 *
 * Since the managed-file machinery (and its `selfsync`/`selfcheck` aliases) was
 * removed, those alias names should no longer appear anywhere under `src/`.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import {
  RETIRED_COMMAND_REDIRECTS,
  RETIRED_CONFIG_KEY_REDIRECTS,
} from "../src/shared/vocabulary.ts";
import { configSectionNames } from "../src/shared/config_codegen.ts";
import {
  isRepoMapPath,
  REPO_AUTHORED_PATHS,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { withoutRegistryAtlasMembers } from "./registry_atlas_scan.ts";

const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");
const SCRIPTS = join(REPO_ROOT, "scripts");
const SKILLS = REPO_AUTHORED_PATHS.skills;
const GITHUB = join(REPO_ROOT, ".github");

/** The retired Deno-task alias names that should no longer exist anywhere. */
const RETIRED_TOKENS = ["selfsync", "selfcheck"];

/** Every file under `root`, as `[repo-relative path, contents]`. */
async function textFiles(root: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const entry of walk(root, { includeDirs: false })) {
    let text: string;
    try {
      text = await Deno.readTextFile(entry.path);
    } catch {
      continue; // non-text / unreadable → nothing to leak
    }
    out.push([relative(REPO_ROOT, entry.path), text]);
  }
  return out;
}

Deno.test("the retired self-host aliases appear nowhere under src/", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(SRC)) {
    for (const token of RETIRED_TOKENS) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `retired self-host vocabulary still present under src/:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("shipped templates/ never name engine-developer commands", async () => {
  const banned = ["deno task", ...RETIRED_TOKENS];
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(TEMPLATES)) {
    for (const token of banned) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `engine-developer vocabulary leaked into the shipped surface:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

const MAP = REPO_AUTHORED_PATHS.map;
const TESTS = join(REPO_ROOT, "tests");
const PROJECT_SCRIPTS = REPO_AUTHORED_PATHS.scripts;

/**
 * discern's one update channel is the install script (`src/lib/version.ts`
 * defines the sentence every surface cites). Naming any other channel — a
 * package manager, a self-update — promises distribution the product doesn't
 * have. The scan covers everything a user or their agent reads: the binary's
 * source, the shipped templates, and the public map (`discern docs` serves it).
 * Excluded: `_`-prefixed internal map trees and the configured map's
 * `80-development` subtree (contributor docs, where the repo's own dev Brewfile
 * is legitimately named).
 */
Deno.test("no shipped surface invents an update channel", async () => {
  const banned = [/\bbrew\b/i, /\bself-update\b/i];
  const offenders: string[] = [];
  const files = [
    ...await textFiles(SRC),
    ...await textFiles(TEMPLATES),
    ...(await textFiles(MAP)).filter(([rel]) =>
      !rel.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/_`) &&
      !isRepoMapPath(rel, "80-development")
    ),
  ];
  for (const [rel, text] of files) {
    for (const pattern of banned) {
      const hit = text.match(pattern);
      if (hit !== null) {
        offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "a shipped surface names an update channel discern doesn't have — cite " +
      `UPDATE_CHANNEL (src/lib/version.ts) instead:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

const ROOT_TEXT_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "deno.json",
  "discern.toml",
];

const RETIRED_COMMAND_ALLOWLIST = new Set([
  "tests/dev_vocab_guard_test.ts",
  join(
    REPO_AUTHORED_PATHS.mapRel,
    "_adr",
    "0095-prelaunch-cli-vocabulary.md",
  ),
]);

const RETIRED_COMMAND_TOKENS = [
  "changed-scopes",
  "worktree-name",
  "add-preset",
  "discern migrate",
  "discern init",
  "discern bootstrap",
  "migrate --check",
  "`migrate`",
  "`init`",
  "`bootstrap`",
  "src/commands/migrate.ts",
  "src/commands/init.ts",
  "src/commands/bootstrap.ts",
  "tests/migrate_test.ts",
  "tests/engine_changed_scopes_test.ts",
  "tests/init_config_test.ts",
  "tests/init_edge_test.ts",
  "src/engine/scopes/changed.ts",
  "`discern worktree`",
  "discern worktree subcommands",
  "worktree:setup",
  "worktree:ensure",
  "worktree:create",
  "worktree:remove",
  "worktree:teardown",
  "worktree:prune",
  "`worktree:*`",
];

/** Return the maybe text file. */
async function maybeTextFile(
  rel: string,
): Promise<[string, string] | undefined> {
  try {
    return [rel, await Deno.readTextFile(join(REPO_ROOT, rel))];
  } catch {
    return undefined;
  }
}

/** Return the maybe configured text file. */
async function maybeConfiguredTextFile(
  path: string,
): Promise<[string, string] | undefined> {
  try {
    return [relative(REPO_ROOT, path), await Deno.readTextFile(path)];
  } catch {
    return undefined;
  }
}

/** Return the command surface files. */
async function commandSurfaceFiles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (
    const root of [
      SRC,
      TESTS,
      MAP,
      TEMPLATES,
      SCRIPTS,
      PROJECT_SCRIPTS,
      SKILLS,
      GITHUB,
    ]
  ) {
    out.push(...await textFiles(root));
  }
  for (const rel of ROOT_TEXT_FILES) {
    const file = await maybeTextFile(rel);
    if (file !== undefined) out.push(file);
  }
  for (
    const path of [
      ...REPO_AUTHORED_PATHS.guidance,
      REPO_AUTHORED_PATHS.todo,
    ]
  ) {
    const file = await maybeConfiguredTextFile(path);
    if (file !== undefined) out.push(file);
  }
  return out.filter(([rel]) => !RETIRED_COMMAND_ALLOWLIST.has(rel)).map(
    ([rel, text]): [string, string] => [
      rel,
      withoutRegistryAtlasMembers(rel, text),
    ],
  );
}

Deno.test("retired prelaunch command vocabulary does not reappear", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await commandSurfaceFiles()) {
    for (const token of RETIRED_COMMAND_TOKENS) {
      if (text.includes(token)) {
        offenders.push(`${rel} contains ${JSON.stringify(token)}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired command vocabulary is still present:\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * ADR 0120 renamed the tree discern maintains to THE MAP, and ADR 0131 retired
 * the old concept phrase outright: "docs tree" on an authored surface either
 * misnames the map or conflates it with a project's own documentation (a
 * literal `docs/` directory stays describable — the slash keeps it out of this
 * pattern). Frozen ADRs and archived planning briefs keep their wording.
 */
Deno.test("the retired 'docs tree' concept phrase does not reappear", async () => {
  const pattern = /\bdocs[ -]tree/i;
  const frozen = (rel: string): boolean =>
    isRepoMapPath(rel, "_adr") ||
    rel.includes("/_done/");
  const offenders: string[] = [];
  for (const [rel, text] of await commandSurfaceFiles()) {
    if (frozen(rel)) continue;
    const hit = text.match(pattern);
    if (hit !== null) {
      offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `the retired "docs tree" phrase returned — the tree is the map:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

/** Escape one canonical token for interpolation into a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Private planning is the only non-ADR surface allowed to spell a retired
 * launch name in a callable or config position.
 */
function isLaunchVocabularyRecord(rel: string): boolean {
  return isRepoMapPath(rel, "_adr") ||
    isRepoMapPath(rel, "_private") ||
    rel.endsWith("/3a-vocabulary-and-rename-sweep.md") ||
    new Set(["src/shared/vocabulary.ts", "tests/dev_vocab_guard_test.ts"]).has(
      rel,
    );
}

/** Compatibility records allowed to retain the retired Project Recipe contract. */
function isProjectScriptMigrationRecord(rel: string): boolean {
  return isLaunchVocabularyRecord(rel) ||
    rel.includes("/_done/") ||
    new Set([
      "src/shared/paths_registry.ts",
      "tests/paths_registry_test.ts",
    ]).has(rel);
}

/**
 * Structural remnants of the retired Project Recipe surface. Ordinary English
 * such as a "CI recipe" remains legal; old config positions are covered by the
 * table-driven launch-vocabulary guard below.
 */
const RETIRED_PROJECT_SCRIPT_SURFACE = [
  /\bDISCERN_RECIPES(?:_DIR)?\b/u,
  /\{\{recipes_dir\}\}/u,
  /\bproject recipes?\b/iu,
  /\bENGINE_RECIPE_NAMES\b/u,
  /\bresolveRecipesDir\b/u,
  /\brecipeEnvVars\b/u,
  /\bRecipeEnv\b/u,
  /\bdiscern\/recipes\b/u,
];

Deno.test("the retired Project Recipe surface stays out of live surfaces", async () => {
  const offenders: string[] = [];
  for (const [rel, source] of await commandSurfaceFiles()) {
    if (isProjectScriptMigrationRecord(rel)) continue;
    for (const pattern of RETIRED_PROJECT_SCRIPT_SURFACE) {
      const hit = source.match(pattern);
      if (hit !== null) {
        offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired Project Recipe contract returned outside frozen records:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

interface ForbiddenPosition {
  retired: string;
  kind: string;
  pattern: RegExp;
}

/**
 * Structural patterns only: invocations, MCP identifiers, command registrations,
 * result verbs, and config keys. Ordinary English remains outside this guard —
 * words such as “finishing” and “docs” are legitimate prose.
 */
function retiredLaunchPositions(): ForbiddenPosition[] {
  const positions: ForbiddenPosition[] = [];
  for (const retired of Object.keys(RETIRED_COMMAND_REDIRECTS)) {
    const words = retired.split(" ");
    const cli = words.map(escapeRegExp).join("\\s+");
    const mcp = words.map(escapeRegExp).join("_");
    const leaf = escapeRegExp(words.at(-1) ?? retired);
    positions.push(
      {
        retired,
        kind: "CLI invocation",
        pattern: new RegExp(`\\bdiscern\\s+${cli}(?=[\\s\x60'\".,):]|$)`, "mu"),
      },
      {
        retired,
        kind: "MCP tool name",
        pattern: new RegExp(`\\bdiscern_${mcp}\\b`, "u"),
      },
      {
        retired,
        kind: "source dev invocation",
        pattern: new RegExp(
          `\\bdeno\\s+task\\s+dev\\s+${cli}(?=[\\s\x60'\".,):]|$)`,
          "mu",
        ),
      },
      {
        retired,
        kind: "command registration",
        pattern: new RegExp(`\\.command\\(\\s*[\"']${leaf}[\"']`, "u"),
      },
      {
        retired,
        kind: "CLI argv",
        pattern: new RegExp(
          `\\b(?:(?:runCli|resolveInvocation)\\s*\\(\\s*\\[|runAgent\\s*\\(\\s*[^,\\n]+,\\s*\\[)\\s*[\"']${leaf}[\"']`,
          "u",
        ),
      },
    );
    if (words.length === 1) {
      positions.push({
        retired,
        kind: "result verb",
        pattern: new RegExp(`\\bverb\\s*:\\s*[\"']${leaf}[\"']`, "u"),
      });
    }
  }

  for (const retired of Object.keys(RETIRED_CONFIG_KEY_REDIRECTS)) {
    const key = escapeRegExp(retired);
    const spelling = `(?:${key}|\"${key}\"|'${key}')`;
    const dottedTail = retired === "docs" ? "dir" : "[A-Za-z0-9_-]+";
    positions.push(
      {
        retired,
        kind: "config table",
        pattern: new RegExp(`\\[\\s*${key}(?=\\s*(?:\\.|\\]))`, "mu"),
      },
      {
        retired,
        kind: "dotted config key",
        pattern: new RegExp(
          `(?:^\\s*${spelling}|[\"']${key})\\s*\\.\\s*${dottedTail}\\b(?=[\\s=\\x60'\"\\],)]|$)`,
          "mu",
        ),
      },
      {
        retired,
        kind: "config interpolation",
        pattern: new RegExp(`\\$\\{${key}\\.`, "u"),
      },
    );
  }
  return positions;
}

Deno.test("retired launch vocabulary stays out of callable and config positions", async () => {
  const offenders: string[] = [];
  const liveConfigSections = new Set(configSectionNames());
  for (const retired of Object.keys(RETIRED_CONFIG_KEY_REDIRECTS)) {
    if (liveConfigSections.has(retired)) {
      offenders.push(
        `config schema: retired ${
          JSON.stringify(retired)
        } remains a root section`,
      );
    }
  }
  const patterns = retiredLaunchPositions();
  for (const [rel, text] of await commandSurfaceFiles()) {
    if (isLaunchVocabularyRecord(rel)) continue;
    for (const { retired, kind, pattern } of patterns) {
      if (pattern.test(text)) {
        offenders.push(`${rel}: retired ${JSON.stringify(retired)} in ${kind}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired launch vocabulary returned in a public contract position:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
