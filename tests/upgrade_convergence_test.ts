/**
 * The migration-system invariant (ADR 0014/0020): an install brought forward by
 * `upgrade` must reach the **current schema**, with its config migrated into the
 * **same shape** a fresh setup produces at that schema — now the dissolved
 * single-file `discern.toml` footprint. (Byte-for-byte convergence is gone: a
 * migrated *seed* carries no surrounding comments, which is fine — the seed is
 * the user's, not the kit's.)
 *
 * Installs are created in throwaway dirs (not git repos), so `upgrade`'s
 * clean-tree guard sees a non-repo; `--allow-dirty` keeps the runs deterministic.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { copy } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { readTarget, runCli, withTempDir } from "./helpers.ts";
import { parseConfig } from "../src/shared/config_schema.ts";
import { sectionBlockFromTemplate } from "../src/lib/config_template.ts";
import {
  DISCERN_GITIGNORE_BEGIN,
  DISCERN_GITIGNORE_END,
} from "../src/lib/agent_gitignore.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";

const HISTORICAL_FIXTURES = join(
  dirname(fromFileUrl(import.meta.url)),
  "fixtures",
  "historical-installs",
);

const STABLE_TARGETS = [
  "discern.toml",
  ".gitignore",
  ".claude/settings.json",
] as const;

/** Scaffold a fresh install into `dir`. `--name` is pinned for parity with a
 * real in-place upgrade (which keeps the same directory). */
async function setup(dir: string): Promise<void> {
  assertEquals(
    (await runCli([
      "setup",
      "--confirmed",
      "--yes",
      "--slug",
      "demo",
      "--name",
      "Demo",
    ], dir))
      .code,
    0,
  );
}

/** Run `upgrade --allow-dirty --json` and return the parsed report. */
// deno-lint-ignore no-explicit-any
async function upgrade(dir: string): Promise<any> {
  const r = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
  assertEquals(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  await assertCurrentConfigValid(dir);
  await assertDiscernTomlTidy(dir, "upgrade");
  return res;
}

/** Run `upgrade --check --json` and return the parsed report plus exit code. */
// deno-lint-ignore no-explicit-any
async function upgradeCheck(dir: string): Promise<{ code: number; res: any }> {
  const r = await runCli(["upgrade", "--check", "--json"], dir);
  return { code: r.code, res: JSON.parse(r.stdout) };
}

/** Run `upgrade --dry-run --json` and return the parsed report. */
// deno-lint-ignore no-explicit-any
async function upgradeDryRun(dir: string): Promise<any> {
  const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
  assertEquals(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Layout-agnostic config path: the new root `discern.toml`, else the legacy
 * `.discern/config.toml`. */
async function configPath(dir: string): Promise<string> {
  const root = join(dir, "discern.toml");
  try {
    await Deno.stat(root);
    return root;
  } catch {
    return join(dir, ".discern/config.toml");
  }
}

async function assertCurrentConfigValid(dir: string): Promise<void> {
  const { issues } = parseConfig(
    await Deno.readTextFile(await configPath(dir)),
  );
  assertEquals(issues, [], "upgraded discern.toml should validate cleanly");
}

async function readStableTargets(
  dir: string,
): Promise<Record<(typeof STABLE_TARGETS)[number], string>> {
  const bytes = {} as Record<(typeof STABLE_TARGETS)[number], string>;
  for (const rel of STABLE_TARGETS) {
    bytes[rel] = await readTarget(dir, rel);
  }
  return bytes;
}

async function assertSecondUpgradeIsByteStable(dir: string): Promise<void> {
  const before = await readStableTargets(dir);
  const res = await upgrade(dir);
  assertEquals(res.data.migrations_applied, []);
  assertEquals(await readStableTargets(dir), before);
}

/** True when a path exists under an install dir. */
async function pathExists(dir: string, rel: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, rel));
    return true;
  } catch {
    return false;
  }
}

/** The recorded `[meta].schema_version` of an install's config. */
async function recordedSchema(dir: string): Promise<number> {
  const m = (await Deno.readTextFile(await configPath(dir))).match(
    /schema_version\s*=\s*(\d+)/,
  );
  return m ? Number(m[1]) : NaN;
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = await configPath(dir);
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

async function removeConfigSection(
  dir: string,
  section: string,
): Promise<void> {
  const path = await configPath(dir);
  const text = await Deno.readTextFile(path);
  const block = sectionBlockFromTemplate(text, section);
  assertExists(block, `expected [${section}] in ${path}`);
  await Deno.writeTextFile(
    path,
    text.replace(`\n\n${block}`, "").replace(block, ""),
  );
}

Deno.test("upgrade of a current install applies no migrations and stays at the current schema", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const fresh = await recordedSchema(dir);
    const res = await upgrade(dir);
    assertEquals(res.verb, "upgrade");
    assertEquals(res.data.migrations_applied, []);
    assertEquals(res.data.schema.current, fresh);
    assertEquals(await recordedSchema(dir), fresh);
  });
});

Deno.test("upgrade reconciles a current-schema config missing a fixed template section", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await removeConfigSection(dir, "scripts");

    const check = await upgradeCheck(dir);
    assertEquals(check.code, 1);
    assertEquals(check.res.data.pending_migrations, []);
    assertEquals(check.res.data.pending_reconciliation, [{
      kind: "section",
      path: "scripts",
    }]);

    const res = await upgrade(dir);
    assertEquals(res.data.migrations_applied, []);
    assertEquals(res.data.config_reconciled, [{
      kind: "section",
      path: "scripts",
    }]);
    const toml = await readTarget(dir, "discern.toml");
    assertStringIncludes(
      toml,
      "# [scripts] — your own executable project scripts",
    );
    assertStringIncludes(toml, "\n[scripts]\n");
    assertStringIncludes(toml, 'dir = "discern/scripts"');
    await assertSecondUpgradeIsByteStable(dir);
  });
});

/** Simulate a config written before a record-table knob existed: drop the
 * `margin` documentation lines from the [standards] banner. */
async function dropMarginFromStandardsBanner(dir: string): Promise<void> {
  const path = await configPath(dir);
  const text = await Deno.readTextFile(path);
  const stale = text.replace(
    /\n#\s+margin\b[\s\S]*?ordinary fluctuation\.\n/u,
    "\n",
  );
  assert(stale !== text, "a fresh [standards] banner should document `margin`");
  await Deno.writeTextFile(path, stale);
}

Deno.test("upgrade refreshes a record-table banner that lags the current template", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await dropMarginFromStandardsBanner(dir);

    const check = await upgradeCheck(dir);
    assertEquals(check.code, 1);
    assertEquals(check.res.data.pending_migrations, []);
    assertEquals(check.res.data.pending_reconciliation, [{
      kind: "banner",
      path: "standards",
    }]);

    const beforeDryRun = await readTarget(dir, "discern.toml");
    const dryRun = await upgradeDryRun(dir);
    assertEquals(dryRun.data.pending_reconciliation, [{
      kind: "banner",
      path: "standards",
    }]);
    assertEquals(await readTarget(dir, "discern.toml"), beforeDryRun);

    const res = await upgrade(dir);
    assertEquals(res.data.migrations_applied, []);
    assertEquals(res.data.config_reconciled, [{
      kind: "banner",
      path: "standards",
    }]);
    // the newly-documented knob reaches the install …
    assertStringIncludes(await readTarget(dir, "discern.toml"), "#   margin");
    // … and the install is now current and byte-stable.
    assertEquals((await upgradeCheck(dir)).code, 0);
    await assertSecondUpgradeIsByteStable(dir);
  });
});

Deno.test("upgrade reconciles a messy legacy .gitignore to one discern block", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const messy = [
      DISCERN_GITIGNORE_BEGIN,
      "...",
      "/AGENTS.md",
      "/CLAUDE.md",
      "...",
      "/.agents/skills/",
      "# Per-branch work evidence captured by the gate (runtime store, not source).",
      "",
      "# --- macOS ---",
      ".DS_Store",
      "**/.DS_Store",
      "",
      "# discern: materialized/compiled artifacts (re-published on upgrade)",
      "",
      "# discern: generated/ephemeral artifacts",
      "/GEMINI.md",
      "",
    ].join("\n");
    await Deno.writeTextFile(join(dir, ".gitignore"), messy);

    const check = await upgradeCheck(dir);
    assertEquals(check.code, 1);
    assert(
      check.res.data.pending_gitignore_reconciliation.length > 0,
      "upgrade --check should report pending .gitignore reconciliation",
    );

    const beforeDryRun = await readTarget(dir, ".gitignore");
    const dryRun = await upgradeDryRun(dir);
    assert(
      dryRun.data.pending_gitignore_reconciliation.length > 0,
      "upgrade --dry-run should preview .gitignore reconciliation",
    );
    assertEquals(await readTarget(dir, ".gitignore"), beforeDryRun);

    const res = await upgrade(dir);
    assert(
      res.data.gitignore_reconciled.length > 0,
      "mutating upgrade should report .gitignore reconciliation",
    );
    const gitignore = await readTarget(dir, ".gitignore");
    assertOneGitignoreBlock(gitignore);
    assert(!/^# discern:/m.test(gitignore), gitignore);
    assertStringIncludes(gitignore, "# --- macOS ---\n.DS_Store\n**/.DS_Store");
    await assertSecondUpgradeIsByteStable(dir);
  });
});

Deno.test("a second upgrade is a no-op (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await upgrade(dir);
    await assertSecondUpgradeIsByteStable(dir);
  });
});

function assertOneGitignoreBlock(text: string): void {
  assertEquals(text.match(new RegExp(DISCERN_GITIGNORE_BEGIN, "g"))?.length, 1);
  assertEquals(text.match(new RegExp(DISCERN_GITIGNORE_END, "g"))?.length, 1);
}

Deno.test("upgrade re-materializes the bundled skills and stamps the current schema", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // setup already materialized .claude/skills/; tamper a built-in copy — upgrade
    // must restore it from the binary.
    const skill = join(dir, ".claude/skills/discern-write-adr/SKILL.md");
    await Deno.writeTextFile(skill, "tampered\n");
    const res = await upgrade(dir);
    assert(res.data.skills.copied >= 1, "bundled skills should be re-copied");
    assert(
      !(await readTarget(dir, ".claude/skills/discern-write-adr/SKILL.md"))
        .includes(
          "tampered",
        ),
      "the kit's skill bytes should overwrite the tampered copy",
    );
    assertEquals(await recordedSchema(dir), res.data.schema.current);
  });
});

// ---- the corpus: a real migration carries an old install forward ----------

/** Strip the `main_branch` line(s) from an install's config. */
async function removeMainBranch(dir: string): Promise<void> {
  const p = await configPath(dir);
  const kept = (await Deno.readTextFile(p))
    .split("\n")
    .filter((l) => !/^\s*main_branch\s*=/.test(l));
  await Deno.writeTextFile(p, kept.join("\n"));
}

/** Remove a current-only section before presenting a fresh scaffold as old. */
async function removeCurrentScriptsSection(dir: string): Promise<void> {
  await removeConfigSection(dir, "scripts");
}

Deno.test("a schema-1 install missing main_branch upgrades to the current schema and restores the field", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      // Regress a current install to look like a schema-1 one made before
      // main_branch existed: strip the field and reset the recorded schema. A
      // schema-1 install kept its config at the root (pre-.discern/ consolidation).
      await setup(older);
      await removeMainBranch(older);
      await removeCurrentScriptsSection(older);
      await setSchema(older, 1);

      const res = await upgrade(older); // runs 1→2 … current, materializes, stamps
      assertEquals(
        res.data.migrations_applied.map((m: { from: number }) => m.from),
        [
          1,
          2,
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15,
          16,
          17,
          18,
          19,
          20,
          21,
        ],
      );

      await setup(fresh); // a fresh install at the current schema

      // The migrated install reaches the same schema as a fresh one…
      assertEquals(await recordedSchema(older), await recordedSchema(fresh));
      // …it ends up at the dissolved root footprint…
      assertEquals(await pathExists(older, "discern.toml"), true);
      assertEquals(await pathExists(older, ".discern"), false);
      // …and the 1→2 backfill reached its current home and spelling.
      assertStringIncludes(
        await readTarget(older, "discern.toml"),
        'trunk = "main"',
      );
      assert(
        !(await readTarget(older, "discern.toml")).includes("main_branch ="),
      );
      await assertSecondUpgradeIsByteStable(older);
    });
  });
});

/**
 * Reverse to the schema-3 shape: model a pre-4 install whose config lives at the
 * consolidated `.discern/config.toml` with `[slots]`/`[scopes]`/`[evidence]` and a
 * recorded schema of 3. The 3→4 step transforms the config; 5→6 dissolves it to
 * the root footprint.
 */
async function regressToV3(dir: string): Promise<void> {
  await Deno.remove(join(dir, "discern.toml"));
  await Deno.mkdir(join(dir, ".discern"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".discern/config.toml"),
    [
      "[meta]",
      "schema_version = 3",
      "",
      "[project]",
      'slug = "demo"',
      'main_branch = "main"',
      'agents = ["claude_code", "codex"]',
      "",
      "[slots.format]",
      'phase = "fix"',
      'run = "deno fmt"',
      "",
      "[slots.lint]",
      'phase = "check"',
      'run = "deno lint"',
      "",
      "[scopes]",
      'neutral = ["docs/", ".discern/", ".claude/"]',
      'web = ["src/**"]',
      "",
      "[evidence]",
      "enabled = false",
      "",
    ].join("\n"),
  );
}

Deno.test("a schema-3 [slots] install upgrades to the jobs shape and the current schema", async () => {
  await withTempDir(async (older) => {
    await withTempDir(async (fresh) => {
      await setup(older); // a fresh install at the current schema
      await regressToV3(older); // reverse the seed config to the pre-4 shape

      const res = await upgrade(older); // runs 3→4 … current, materializes, stamps
      assertEquals(
        res.data.migrations_applied.map((m: { from: number }) => m.from),
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      );

      await setup(fresh);
      // The migrated install reaches the same schema as a fresh one.
      assertEquals(await recordedSchema(older), await recordedSchema(fresh));
      // The seed converges in shape at the dissolved footprint: jobs
      // present, the legacy structure gone, the new sections added.
      assertEquals(await pathExists(older, ".discern"), false);
      const toml = await readTarget(older, "discern.toml");
      assertStringIncludes(toml, "[jobs]");
      assertStringIncludes(toml, 'format = "deno fmt"');
      assert(!toml.includes("[slots."));
      assert(!toml.includes("[evidence]"));
      // The retired [features] section never appears — the chain runs straight
      // to the current schema, where the toggles are gone (ADR 0101).
      assert(!toml.includes("[features]"), "no [features] section is added");
      // Papercut 1: the schema-6 sections arrive WITH their doc blocks, grouped
      // after [project] — so a migrated config reads like a fresh setup's, not a
      // pile of bare keys at EOF.
      assertStringIncludes(toml, "# [guidance] — the author-once");
      assertStringIncludes(
        toml,
        "# [skills] — focused, reusable task playbooks",
      );
      const at = (s: string) => toml.indexOf(s);
      assert(
        at("[project]") < at("[guidance]") &&
          at("[guidance]") < at("[skills]"),
        "new sections grouped, in order, after [project]",
      );
      await assertSecondUpgradeIsByteStable(older);
    });
  });
});

Deno.test("a legacy install whose schema lives only in a manifest upgrades, prunes the engine, and dissolves .discern/", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Model a genuine pre-teardown (schema-4) install: config at the consolidated
    // .discern/ location, schema recorded ONLY in a legacy manifest (no [meta]),
    // plus a committed shell engine + agent and hooks calling `./agent`.
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    const stripped = (await Deno.readTextFile(join(dir, "discern.toml")))
      .split("\n")
      .filter((l) =>
        !/^\s*(bootstrapped|schema_version|setup_model|setup_version)\s*=/
          .test(l) && l.trim() !== "[meta]"
      )
      .join("\n");
    await Deno.writeTextFile(join(dir, ".discern/config.toml"), stripped);
    await Deno.remove(join(dir, "discern.toml"));
    await removeConfigSection(dir, "scripts");
    await Deno.writeTextFile(
      join(dir, ".discern/manifest.json"),
      '{ "kit_version": "0.9.0", "schema_version": 4 }\n',
    );
    await Deno.mkdir(join(dir, ".discern/engine"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".discern/engine/finish"),
      "#!/bin/sh\n",
    );
    await Deno.writeTextFile(join(dir, "agent"), "#!/bin/sh\n");
    await Deno.writeTextFile(
      join(dir, ".claude/settings.json"),
      `${
        JSON.stringify({
          hooks: { SessionStart: [{ command: "./agent worktree ensure" }] },
        })
      }\n`,
    );

    const res = await upgrade(dir);
    // The manifest anchored the chain at schema 4, so every later step runs.
    assertEquals(
      res.data.migrations_applied.map((m: { from: number }) => m.from),
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
    );
    // The shell engine, dispatcher, manifest, and the whole .discern/ namespace
    // are gone; the config now lives at the root footprint.
    assertEquals(await pathExists(dir, ".discern"), false);
    assertEquals(await pathExists(dir, "agent"), false);
    assertEquals(await pathExists(dir, "discern.toml"), true);
    // The worktree hooks were repointed off the deleted `./agent` at `discern`.
    const settings = await readTarget(dir, ".claude/settings.json");
    assert(
      !settings.includes("./agent"),
      "hooks still call the deleted ./agent",
    );
    assertStringIncludes(settings, "discern worktree ensure");
    // The .gitignore was rewritten for the dissolved layout: no .discern, the
    // materialized/local paths ignored, the compiled guidance files trackable.
    const gitignore = await readTarget(dir, ".gitignore");
    assert(!/\.discern/.test(gitignore), "no .discern ignore remains");
    assertStringIncludes(gitignore, "/.claude/skills/");
    assert(!gitignore.includes("/GEMINI.md"), gitignore);
    // …and the schema is now stamped in the config the user owns.
    assertEquals(await recordedSchema(dir), res.data.schema.current);
    // Papercut 1: this install had NO [meta] (its version lived only in the
    // manifest). The migration gives it a documented [meta] FIRST — not a bare
    // [meta] appended at EOF by the stamp.
    const toml = await readTarget(dir, "discern.toml");
    assertStringIncludes(toml, "# The install schema version");
    assert(
      toml.indexOf("[meta]") < toml.indexOf("[project]"),
      "[meta] leads the file",
    );
    await assertSecondUpgradeIsByteStable(dir);
  });
});

Deno.test("historical init fixtures upgrade to valid current configs and stay byte-stable", async () => {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(HISTORICAL_FIXTURES)) {
    if (entry.isDirectory) {
      entries.push(entry.name);
    }
  }
  entries.sort();
  assert(entries.length > 0, "historical fixture corpus should not be empty");

  for (const name of entries) {
    await withTempDir(async (dir) => {
      await copy(join(HISTORICAL_FIXTURES, name), dir, { overwrite: true });
      const res = await upgrade(dir);
      assertEquals(
        await recordedSchema(dir),
        res.data.schema.current,
        `${name} should be stamped current after upgrade`,
      );
      await assertSecondUpgradeIsByteStable(dir);
    });
  }
});
