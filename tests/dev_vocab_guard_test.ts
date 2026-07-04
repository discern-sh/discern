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

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");

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

const DOCS = join(REPO_ROOT, "docs");
const TESTS = join(REPO_ROOT, "tests");
const RECIPES = join(REPO_ROOT, "recipes");

const ROOT_TEXT_FILES = [
  "README.md",
  "TODO.md",
  "guidance.md",
  "discern.toml",
];

const RETIRED_COMMAND_ALLOWLIST = new Set([
  "tests/dev_vocab_guard_test.ts",
  "docs/_adr/0095-prelaunch-cli-vocabulary.md",
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
  for (const root of [SRC, TESTS, DOCS, TEMPLATES, RECIPES]) {
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
