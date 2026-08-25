/**
 * `discern uninstall` — the exit-honesty round-trip.
 *
 * The write-surface contract (ADR 0099, `paths_write_surface_test.ts`) proves
 * discern writes ONLY inside its registry-derived footprint. This is the inverse:
 * wire the full harness for every known agent, uninstall, and prove the footprint
 * is gone — the generated files removed, the co-owned files stripped back to
 * exactly the bytes the user had, the user's own content untouched.
 *
 * The "should be gone" set is DERIVED from the provider registry (not a hand
 * list), so a new provider file auto-enrols: teach discern to write it and this
 * test fails until uninstall learns to remove it too (the ADR 0051 discipline).
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { pathExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, runAgent } from "./engine_helpers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  allInstructionFilePaths,
  allSkillsDirs,
  PROVIDERS,
  wiredMcp,
} from "../src/lib/providers.ts";

/** Canonical 2-space JSON with a trailing newline (what discern's merge writes),
 * so a clean strip round-trips byte-for-byte. */
const USER_CLAUDE_SETTINGS =
  `{\n  "permissions": {\n    "deny": [\n      "Read(secret)"\n    ]\n  }\n}\n`;
const USER_MCP_JSON =
  `{\n  "mcpServers": {\n    "other": {\n      "type": "stdio",\n      "command": "foo",\n      "args": []\n    }\n  }\n}\n`;
const USER_GITATTRIBUTES = "*.jpg binary\n";
/** The two co-owned files seeded with user content BEFORE discern wires them —
 * so the round-trip asserts they return to these exact bytes. */
const PRE_SEEDED = new Set([".claude/settings.json", ".mcp.json"]);

/**
 * Every project-relative path discern CREATES from nothing (so uninstall must
 * remove it outright), derived from the provider registry: the compiled agent
 * files, the materialized skills dirs, and each declared integration file — minus
 * the co-owned files we pre-seeded with user content (those are asserted
 * byte-restored instead of removed).
 */
function registryCreatedPaths(): string[] {
  const out = new Set<string>();
  for (const rel of allInstructionFilePaths()) {
    out.add(rel);
  }
  for (const dir of allSkillsDirs()) {
    out.add(dir);
  }
  for (const provider of Object.values(PROVIDERS)) {
    const mcp = wiredMcp(provider);
    if (mcp !== undefined) {
      out.add(mcp.configFile);
    }
    if (provider.hooks !== undefined) {
      out.add(provider.hooks.settingsFile);
    }
    if (provider.worktreeApp !== undefined) {
      out.add(provider.worktreeApp.configFile);
    }
    if (provider.projectRules !== undefined) {
      out.add(provider.projectRules.rulesFile);
    }
  }
  return [...out].filter((rel) => !PRE_SEEDED.has(rel));
}

/** Wire the full harness for every known agent into `dir`: seed pre-existing
 * user content, `setup begin`, mark set up, commit, then `refresh` to wire every
 * provider integration and compile the agent files. */
async function wireFullHarness(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# uninstall probe\n");
  await ensureDir(join(dir, ".claude"));
  await Deno.writeTextFile(
    join(dir, ".claude/settings.json"),
    USER_CLAUDE_SETTINGS,
  );
  await Deno.writeTextFile(join(dir, ".mcp.json"), USER_MCP_JSON);
  await Deno.writeTextFile(join(dir, ".gitignore"), "node_modules/\n");
  await Deno.writeTextFile(join(dir, ".gitattributes"), USER_GITATTRIBUTES);
  await gitInit(dir);

  const begin = await runAgent(dir, [
    "setup",
    "begin",
    "--confirmed",
    "--json",
    "--agents",
    AGENT_NAMES.join(","),
  ]);
  assertEquals(begin.code, 0, begin.output);

  const configPath = join(dir, "discern.toml");
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  editor.setBool("meta.bootstrapped", true);
  await Deno.writeTextFile(configPath, editor.toString());
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "post-setup", "--no-gpg-sign");

  const refresh = await runAgent(dir, ["refresh"]);
  assertEquals(refresh.code, 0, refresh.output);
}

Deno.test("uninstall removes discern's footprint and keeps the user's content", async () => {
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);

    // Discern wired what the registry declares (a precondition for the round-trip
    // to prove anything): the compiled Claude file and its co-owned .mcp.json.
    assert(
      await pathExists(join(dir, "CLAUDE.md")),
      "setup should compile CLAUDE.md",
    );
    assert(
      (await Deno.readTextFile(join(dir, ".mcp.json"))).includes("discern"),
      "setup should wire the discern MCP server",
    );

    // Runtime records exist under .git before the round-trip, so their
    // removal below proves something.
    assert(
      await pathExists(join(dir, ".git", "discern")),
      "setup and refresh should have recorded runtime state under .git/discern",
    );

    const result = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(result.code, 0, result.output);
    const envelope = JSON.parse(result.stdout);
    assert(envelope.ok, result.output);

    // 1. Every registry-declared file discern created is gone.
    for (const rel of registryCreatedPaths()) {
      assertEquals(
        await pathExists(join(dir, rel)),
        false,
        `uninstall left a discern-created path behind: ${rel}`,
      );
    }

    // 2. The co-owned files are restored to the user's exact bytes.
    assertEquals(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
      USER_CLAUDE_SETTINGS,
    );
    assertEquals(
      await Deno.readTextFile(join(dir, ".mcp.json")),
      USER_MCP_JSON,
    );

    // 3. The user's own .gitignore rule survives; discern's block is gone.
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    assert(gitignore.includes("node_modules/"), "user gitignore rule was lost");
    assert(
      !gitignore.includes("# --- discern ---"),
      "discern block was not removed",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      USER_GITATTRIBUTES,
    );

    // 4. The user's content — the config and the whole discern/ namespace — stays.
    assert(
      await pathExists(join(dir, "discern.toml")),
      "discern.toml must be kept",
    );
    assert(
      await pathExists(join(dir, "discern/instructions.md")),
      "the instruction source must be kept",
    );

    // 5. The runtime-state namespace under .git exits with the tool
    //    (exit honesty covers the registered admin entries, shim included).
    assertEquals(
      await pathExists(join(dir, ".git", "discern")),
      false,
      "uninstall must remove the discern/ namespace under .git",
    );
    assert(Array.isArray(envelope.data.removed_runtime_state));
    assert(envelope.data.removed_runtime_state.length > 0);

    // 6. The result names what stayed and how to remove the binary.
    assert(Array.isArray(envelope.data.kept));
    assert(envelope.data.kept.includes("discern.toml"));
    assert(typeof envelope.data.binary_hint === "string");
  });
});

Deno.test("uninstall surfaces incomplete strips when the templates tree can't resolve", async () => {
  // B52: with discern's templates/ unresolvable, a hooks target's
  // template-seeded permission/scalar entries can't be identified and are left
  // in place. That must never be silent — the result reports it (which files,
  // why) so the user can finish by hand. Pointing DISCERN_TEMPLATES_DIR at a
  // non-directory makes resolveTemplatesDir throw, exactly the failure mode.
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);
    const bogus = join(dir, "no-such-templates-dir");

    const result = await runAgent(dir, ["uninstall", "--json"], {
      env: { DISCERN_TEMPLATES_DIR: bogus },
    });
    assertEquals(result.code, 0, result.output);
    const envelope = JSON.parse(result.stdout);
    assert(envelope.ok, result.output);

    // The plan fact is consumed, not dropped: templates were unavailable…
    assertEquals(
      envelope.data.templates_available,
      false,
      "templates_available must surface in the result",
    );
    // …and at least one co-owned hooks target is named as only-partially cleaned.
    const incomplete = envelope.data.incomplete_strips;
    assert(Array.isArray(incomplete));
    assert(
      incomplete.length > 0,
      "an unresolvable templates tree must yield at least one incomplete strip",
    );
    for (const item of incomplete) {
      assert(typeof item.rel === "string" && item.rel.length > 0);
      assert(
        typeof item.reason === "string" && item.reason.length > 0,
        "each incomplete strip must say why",
      );
    }
    // The human view says it too (a warning naming the files).
    const human = await runAgent(dir, ["uninstall", "--dry-run"], {
      env: { DISCERN_TEMPLATES_DIR: bogus },
    });
    assertEquals(human.code, 0, human.output);
    assert(
      /template-seeded settings cannot be removed/.test(human.output),
      `human view must warn about incomplete strips; got:\n${human.output}`,
    );
  });
});

Deno.test("uninstall --dry-run reports the plan and changes nothing", async () => {
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);

    const dry = await runAgent(dir, ["uninstall", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const envelope = JSON.parse(dry.stdout);
    assert(envelope.dry_run === true, dry.output);
    assert(Array.isArray(envelope.data.removed));
    assert(envelope.data.removed.length > 0, "the plan should list removals");

    // Nothing was touched: the generated files and co-owned wiring are intact.
    assert(await pathExists(join(dir, "CLAUDE.md")));
    assert(await pathExists(join(dir, ".claude/skills")));
    assert(
      (await Deno.readTextFile(join(dir, ".mcp.json"))).includes("discern"),
      "the dry run must not strip anything",
    );
  });
});

Deno.test("uninstall refuses while the resource ledger records provisioned resources", async () => {
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);
    // A schema-valid ledger entry: the ownership proof and frozen destroy
    // command for an external resource whose worktree is already gone.
    const ledgerDir = join(dir, ".git", "discern", "resources");
    await ensureDir(ledgerDir);
    const entryPath = join(ledgerDir, "orphan--db.json");
    await Deno.writeTextFile(
      entryPath,
      JSON.stringify({
        schema: 1,
        seq: 0,
        project_slug: "engine-test",
        git_key: "orphan",
        worktree_id: "orphan",
        worktree_path: join(dir, "gone"),
        resource_name: "db",
        resource_identity: "engine_test_orphan",
        destroy_command: "true",
        token_map: {},
        retries: 0,
        gc: true,
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );

    const refused = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const envelope = JSON.parse(refused.stdout);
    assertEquals(envelope.error, "provisioned_resources");
    assertEquals(envelope.data.resources.length, 1);
    assert(
      await pathExists(join(dir, ".git", "discern")),
      "a refused uninstall must leave the runtime state untouched",
    );

    // With the ledger reclaimed, the same uninstall proceeds.
    await Deno.remove(entryPath);
    const applied = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(applied.code, 0, applied.output);
    assertEquals(await pathExists(join(dir, ".git", "discern")), false);
  });
});

Deno.test("uninstall needs confirmation when only runtime state remains", async () => {
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);
    const first = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(first.code, 0, first.output);

    // A later verb recreates runtime records under .git — the only removable
    // thing left. Human-mode uninstall must still gate on consent, and must
    // not simultaneously claim there is nothing to remove.
    const status = await runAgent(dir, ["status"]);
    assertEquals(status.code, 0, status.output);
    assert(
      await pathExists(join(dir, ".git", "discern")),
      "status should re-record runtime state under .git",
    );

    const unconfirmed = await runAgent(dir, ["uninstall"]);
    assertEquals(unconfirmed.code, 1, unconfirmed.output);
    assert(
      unconfirmed.output.includes("needs confirmation"),
      unconfirmed.output,
    );
    assert(
      !unconfirmed.output.includes("nothing to remove"),
      unconfirmed.output,
    );
    assert(await pathExists(join(dir, ".git", "discern")));

    const confirmed = await runAgent(dir, ["uninstall", "--yes"]);
    assertEquals(confirmed.code, 0, confirmed.output);
    assertEquals(await pathExists(join(dir, ".git", "discern")), false);
  });
});

Deno.test("uninstall refuses while a linked worktree is still active", async () => {
  await withTempDir(async (dir) => {
    await wireFullHarness(dir);
    // A linked worktree in flight — uninstall must not pull the wiring out from
    // under it.
    await git(dir, "worktree", "add", "-b", "agent/inflight", join(dir, "wt"));

    const result = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(result.code, 1, result.output);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.error, "active_worktrees");

    // Nothing was removed — the refusal is total.
    assert(await pathExists(join(dir, "CLAUDE.md")));
  });
});

Deno.test("uninstall outside a discern install reports not_initialized", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "# not discern\n");
    await gitInit(dir);
    const result = await runAgent(dir, ["uninstall", "--json"]);
    assertEquals(result.code, 1, result.output);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.error, "not_initialized");
  });
});
