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
import { dirname, fromFileUrl, join, relative } from "@std/path";
import {
  RETIRED_COMMAND_REDIRECTS,
  RETIRED_CONFIG_KEY_REDIRECTS,
} from "../src/shared/vocabulary.ts";
import { configSectionNames } from "../src/shared/config_codegen.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");
const MOCKUPS = join(REPO_ROOT, "mockups");
const SCRIPTS = join(REPO_ROOT, "scripts");
const SKILLS = join(REPO_ROOT, "skills");
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

const MAP = join(REPO_ROOT, "map");
const TESTS = join(REPO_ROOT, "tests");
const RECIPES = join(REPO_ROOT, "recipes");

const ROOT_TEXT_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "TODO.md",
  "deno.json",
  "guidance.md",
  "discern.toml",
];

const RETIRED_COMMAND_ALLOWLIST = new Set([
  "tests/dev_vocab_guard_test.ts",
  "map/_adr/0095-prelaunch-cli-vocabulary.md",
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

async function maybeTextFile(
  rel: string,
): Promise<[string, string] | undefined> {
  try {
    return [rel, await Deno.readTextFile(join(REPO_ROOT, rel))];
  } catch {
    return undefined;
  }
}

async function commandSurfaceFiles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (
    const root of [
      SRC,
      TESTS,
      MAP,
      TEMPLATES,
      RECIPES,
      MOCKUPS,
      SCRIPTS,
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
  return out.filter(([rel]) => !RETIRED_COMMAND_ALLOWLIST.has(rel));
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

/** Escape one canonical token for interpolation into a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compatibility records are the only non-ADR files allowed to spell a retired
 * launch name in a callable/config position. Historical fixtures preserve what
 * an old install really contained; the active brief/TODO keep the owner-approved
 * migration searchable until bookkeeping removes the completed entries.
 */
function isLaunchVocabularyRecord(rel: string): boolean {
  return rel.startsWith("map/_adr/") ||
    rel.startsWith("tests/fixtures/historical-installs/") ||
    rel.endsWith("/3a-vocabulary-and-rename-sweep.md") ||
    new Set([
      "src/shared/vocabulary.ts",
      "src/lib/migrations.ts",
      "src/lib/version.ts",
      "tests/migrations_test.ts",
      "tests/dev_vocab_guard_test.ts",
    ]).has(rel);
}

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
          `(?:^\\s*${spelling}|[\"']${key})\\s*\\.\\s*${dottedTail}\\b`,
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
