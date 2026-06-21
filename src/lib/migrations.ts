/**
 * The versioned migration chain (ADR 0014).
 *
 * A migration is one **idempotent** step that brings an install from schema
 * version `from` to `from + 1`. `upgrade` reads the install's recorded
 * `schema_version`, runs every pending step in order up to the kit's
 * `SCHEMA_VERSION`, then stamps the new version. The chain is contiguous: there
 * is exactly one step producing each version from 2 up to `SCHEMA_VERSION`.
 *
 * The chain's first step is the schema-1→2 `main_branch` backfill (the bespoke
 * 0.x→1.0 `migrate` ADR 0014 retired was not ported — the current shape was
 * declared schema 1 and the chain grows from there). Later steps append as
 * further bumps; the final one prunes a pre-existing on-disk shell engine left
 * by an install made before the TS-native engine.
 *
 * A step transforms an install through a {@link MigrationContext}: it can edit
 * the install config comment-preserving, move/remove/rewrite seed files, and
 * deep-merge `.claude/settings.json`. The file moves are what make a rename
 * safe — content is carried to the new path.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { TomlEditor } from "./toml_edit.ts";
import { mergeSettings } from "./settings_merge.ts";
import { parseIcculusToml } from "./toml_render.ts";
import { KNOWN_CAPABILITIES } from "./config.ts";
import { bundledSkillNames } from "./skills.ts";
import { resolveBundledSkillsDir } from "./paths.ts";
import { FEATURES } from "../shared/features.ts";

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The operations a migration step performs against an install. */
export interface MigrationContext {
  /** Absolute destination root of the install being migrated. */
  readonly destDir: string;
  /** True if a target-relative path exists. */
  exists(rel: string): Promise<boolean>;
  /** Read a target file as text, or undefined if absent. */
  readText(rel: string): Promise<string | undefined>;
  /** Write a target file (creating parent dirs), replacing any existing. */
  writeText(rel: string, content: string): Promise<void>;
  /** Delete a target file; a no-op if already gone (idempotent). */
  remove(rel: string): Promise<void>;
  /**
   * Recursively delete a target file or directory and its contents; a no-op if
   * already gone (idempotent). For pruning a whole subtree, e.g. a stale engine.
   */
  removeAll(rel: string): Promise<void>;
  /**
   * Move `from` → `to`, content intact, creating `to`'s parent. Idempotent: if
   * `from` is already gone the move is treated as done and it is a no-op, so a
   * re-run never fails.
   */
  rename(from: string, to: string): Promise<void>;
  /** Read-transform-write a target file's text; a no-op if absent or unchanged. */
  rewrite(rel: string, fn: (text: string) => string): Promise<void>;
  /** Read the install config (`.icculus/config.toml`, or a legacy `icculus.toml`), or undefined. */
  readConfig(): Promise<string | undefined>;
  /** Edit the install config comment-preserving; a no-op if there is no config. */
  editToml(fn: (editor: TomlEditor) => void): Promise<void>;
  /** Deep-merge `incoming` into `.claude/settings.json` (created if absent). */
  mergeSettings(incoming: Record<string, unknown>): Promise<void>;
  /** Record a human-readable note about what this step changed. */
  note(message: string): void;
}

/** One step in the migration chain: schema `from` → `from + 1`. */
export interface Migration {
  /** The schema version this step upgrades FROM (it produces `from + 1`). */
  from: number;
  /** One-line description of the transformation (shown in logs / `--json`). */
  describe: string;
  /** Apply the transformation. MUST be idempotent. */
  apply(ctx: MigrationContext): Promise<void>;
}

/**
 * The ordered migration chain (ADR 0014). One step per schema bump, contiguous
 * from 1 up to `SCHEMA_VERSION`.
 *
 * `1 → 2` backfills `[project].main_branch`. It is the first real step — a
 * deliberately small, safe seed evolution that exercises the whole pipeline
 * end-to-end (the kit rename will come later, as a further step). `main_branch`
 * is a long-standing engine-read field; an install whose `icculus.toml` predates
 * it relied on the engine's implicit `"main"` default, so making it explicit is
 * a genuine improvement. Only-if-absent, so a custom integration branch is never
 * clobbered, and a no-op on any install that already has it.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    describe: 'backfill [project].main_branch = "main" when absent',
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseIcculusToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const project = isRecord(raw.project) ? raw.project : {};
      if (
        typeof project.main_branch === "string" && project.main_branch !== ""
      ) {
        return; // already set (perhaps a custom branch) — never clobber.
      }
      await ctx.editToml((e) => e.setString("project.main_branch", "main"));
      ctx.note('backfilled [project].main_branch = "main"');
    },
  },
  {
    from: 2,
    describe:
      "consolidate the install surface under .icculus/ (move the config + guidance seeds)",
    apply: async (ctx) => {
      // Carry the SEEDS into the `.icculus/` namespace. A seed is the user's, so a
      // rename here is the only thing that moves its content forward. `rename`
      // wraps Deno.rename (whole-directory moves) and is idempotent — a no-op once
      // the source is gone, so a re-run, or an install already in the new layout,
      // passes through cleanly.
      await ctx.rename("icculus.toml", ".icculus/config.toml");
      await ctx.rename(".ai/guidelines", ".icculus/guidelines");
      // The old shell dispatcher (bin/agent) and skills (.ai/skills) are not
      // moved: skills are re-materialized at the new path by the upgrade, and the
      // pre-existing shell engine — dispatcher included — is pruned by the final
      // chain step. Repoint the worktree hooks at the root dispatcher path the
      // historical layout used; the dispatcher still exists at this schema, so
      // `./agent` is correct here. The final prune step then removes the
      // dispatcher and repoints the hook at the on-PATH `icculus` binary.
      await ctx.rewrite(
        ".claude/settings.json",
        (t) => t.replaceAll("./bin/agent", "./agent"),
      );
      // Best-effort: the default neutral-scope globs named `.ai/`; guidance now
      // lives under `.icculus/`. A customised list simply won't match — harmless.
      await ctx.rewrite(
        ".icculus/config.toml",
        (t) => t.replaceAll('".ai/"', '".icculus/"'),
      );
      ctx.note(
        "moved icculus.toml→.icculus/config.toml and .ai/guidelines→.icculus/guidelines",
      );
      ctx.note(
        ".icculus/skills are re-materialized by the upgrade; run `icculus guidelines` after",
      );
    },
  },
  {
    from: 3,
    describe:
      "convert [slots]→[capabilities]/[checks], inline ratchet runs, fold side-gates into [scopes.<name>].gate, drop [evidence] (ADR 0017/0018)",
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseIcculusToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }

      const slots = isRecord(raw.slots) ? raw.slots : {};
      const scopesRaw = isRecord(raw.scopes) ? raw.scopes : {};
      const sideGates = isRecord(scopesRaw.side_gates)
        ? scopesRaw.side_gates
        : {};
      const ratchets = isRecord(raw.ratchets) ? raw.ratchets : {};
      const hasArrayScope = Object.entries(scopesRaw).some(
        ([k, v]) => k !== "side_gates" && Array.isArray(v),
      );

      // Idempotency: the old shape is detectable by [slots.*], array-valued
      // [scopes] keys, [scopes.side_gates], or [evidence]. Once migrated, none of
      // those remain, so a re-run (or an already-new config) returns early.
      const hasOldShape = Object.keys(slots).length > 0 ||
        Object.keys(sideGates).length > 0 || hasArrayScope ||
        raw.evidence !== undefined;
      if (!hasOldShape) {
        return;
      }

      // Index the measurement slots (no `phase`) so a ratchet can inline its run.
      const measurementRun: Record<string, string> = {};
      for (const [name, slot] of Object.entries(slots)) {
        if (
          isRecord(slot) && slot.phase === undefined &&
          typeof slot.run === "string"
        ) {
          measurementRun[name] = slot.run;
        }
      }

      await ctx.editToml((e) => {
        // slots → capabilities / checks.
        for (const [name, slot] of Object.entries(slots)) {
          if (!isRecord(slot)) continue;
          const phase = typeof slot.phase === "string" ? slot.phase : undefined;
          const run = typeof slot.run === "string" ? slot.run : undefined;
          if (phase === undefined) continue; // a measurement slot — see ratchets below.
          const isNoop = run === undefined || run === ":";
          const known = Object.hasOwn(KNOWN_CAPABILITIES, name);
          if (
            known &&
            KNOWN_CAPABILITIES[name as keyof typeof KNOWN_CAPABILITIES] ===
              phase
          ) {
            // A known capability at its canonical stage. A `:` no-op is dropped —
            // an absent capability is the new "unfilled".
            if (!isNoop) e.setString(`capabilities.${name}`, run as string);
            else {
              ctx.note(
                `dropped no-op slot "${name}" — add [capabilities.${name}] when you wire it`,
              );
            }
          } else {
            // Any other slot with a phase → a check carrying its stage.
            e.setString(`checks.${name}.stage`, phase);
            if (!isNoop) e.setString(`checks.${name}.run`, run as string);
            if (!known) {
              ctx.note(
                `slot "${name}" (stage ${phase}) became [checks.${name}]; rename to a capability if it is one`,
              );
            }
          }
        }

        // ratchets: inline the referenced measurement slot's run; drop `slot`.
        for (const [rname, r] of Object.entries(ratchets)) {
          if (!isRecord(r)) continue;
          const slotRef = typeof r.slot === "string" ? r.slot : undefined;
          e.deleteKey(`ratchets.${rname}.slot`);
          if (slotRef !== undefined && measurementRun[slotRef] !== undefined) {
            e.setString(`ratchets.${rname}.run`, measurementRun[slotRef]);
          } else if (slotRef !== undefined) {
            ctx.note(
              `ratchet "${rname}" referenced slot "${slotRef}" which has no run; set its run by hand`,
            );
          }
        }

        // scopes: arrays + reserved flags + side_gates → [scopes.<name>] tables.
        // The reserved `neutral`/`previewable` become flagged scopes (renamed to
        // docs/assets, matching the template); `web` is the implicit `code`
        // default and is dropped.
        for (const [sname, val] of Object.entries(scopesRaw)) {
          if (sname === "side_gates" || !Array.isArray(val)) continue;
          if (sname === "web") continue;
          const globs = val.filter((g): g is string => typeof g === "string");
          const target = sname === "neutral"
            ? "docs"
            : sname === "previewable"
            ? "assets"
            : sname;
          e.setStringArray(`scopes.${target}.paths`, globs);
          if (sname === "neutral") e.setBool(`scopes.${target}.neutral`, true);
          if (sname === "previewable") {
            e.setBool(`scopes.${target}.previewable`, true);
          }
          const gate = sideGates[sname];
          if (typeof gate === "string") {
            e.setString(`scopes.${target}.gate`, gate);
          }
        }
        // A side gate whose scope had no glob array still needs a home.
        for (const [scope, cmd] of Object.entries(sideGates)) {
          if (typeof cmd !== "string" || Array.isArray(scopesRaw[scope])) {
            continue;
          }
          e.setString(`scopes.${scope}.gate`, cmd);
          ctx.note(
            `side gate "${scope}" had no scope paths; created [scopes.${scope}] with only a gate`,
          );
        }

        // Delete the legacy structure (read fully above before any deletion).
        for (const name of Object.keys(slots)) e.deleteSection(`slots.${name}`);
        e.deleteSection("scopes"); // the old array-keyed bare table
        e.deleteSection("scopes.side_gates");
        e.deleteSection("evidence");
      });

      ctx.note(
        "migrated slots→capabilities/checks, scopes→tables, inlined ratchet runs, removed [evidence]",
      );
    },
  },
  {
    from: 4,
    describe:
      "prune the pre-existing on-disk shell engine (.icculus/engine/, the root agent, .icculus/manifest.json)",
    apply: async (ctx) => {
      // An install made before the TS-native engine carried a committed shell
      // engine: the generic engine tree, a root `agent` dispatcher, and a
      // hash-tracking manifest. None of those exist on a fresh install anymore —
      // the engine is in the binary — so an upgrading install must shed them.
      // All three removals are idempotent (a no-op when already gone), so this is
      // safe on a fresh install too. The skill symlinks under `.claude/skills/`
      // that the old dispatcher's `guidelines` step created still point at the
      // re-materialized `.icculus/skills/`, so they need no surgery here; the
      // next `icculus guidelines` reconciles them.
      const had = await ctx.exists(".icculus/engine") ||
        await ctx.exists("agent") ||
        await ctx.exists(".icculus/manifest.json");
      await ctx.removeAll(".icculus/engine");
      await ctx.remove("agent");
      await ctx.remove(".icculus/manifest.json");
      // The worktree hooks called the now-deleted `./agent` dispatcher; repoint
      // them at the on-PATH `icculus` binary so they survive the prune. In
      // settings `./agent` only ever names the dispatcher (the `agent/<name>`
      // branch prefix has no `./`), so this literal swap is safe and idempotent
      // — a no-op once already repointed, or when there is no settings file.
      // `upgrade` never re-merges the settings seed, so this step is what
      // carries the hooks across the cutover.
      await ctx.rewrite(
        ".claude/settings.json",
        (t) => t.replaceAll("./agent", "icculus"),
      );
      // A pre-cutover install committed its skills (they were managed) and may not
      // ignore the now-materialized/compiled artifacts. Ensure `.gitignore` ignores
      // them — append only what is missing (idempotent), never clobbering the
      // user's file. Untracking already-committed copies (`git rm --cached`) is a
      // git-index operation left to the operator; a migration only edits files.
      const ignore = (await ctx.readText(".gitignore")) ?? "";
      const wantIgnore: Array<[RegExp, string]> = [
        [/^\s*\/?\.icculus\/skills\b/m, "/.icculus/skills/"],
        [/^\s*\/?CLAUDE\.md\b/m, "/CLAUDE.md"],
      ];
      const missingIgnore = wantIgnore
        .filter(([re]) => !re.test(ignore))
        .map(([, line]) => line);
      if (missingIgnore.length > 0) {
        const block = [
          "# icculus: materialized/compiled artifacts (re-published on upgrade)",
          ...missingIgnore,
        ].join("\n");
        const base = ignore === "" ? "" : `${ignore.replace(/\n+$/, "")}\n\n`;
        await ctx.writeText(".gitignore", `${base}${block}\n`);
        ctx.note(
          `gitignored materialized artifacts: ${missingIgnore.join(", ")}`,
        );
      }
      if (had) {
        ctx.note(
          "removed the legacy shell engine, root agent, and manifest.json; repointed the worktree hooks at `icculus`",
        );
      }
    },
  },
  {
    from: 5,
    describe:
      "dissolve .icculus/ into the single-file footprint: config → root icculus.toml; move guidance/recipes/authored skills out; prune bundled skills; add [features]/[guidance]/[skills] (ADR 0020)",
    apply: async (ctx) => {
      // Capture the legacy [project].agents (to seed [guidance].agents) BEFORE
      // moving the config, while it is still readable at its old location.
      let legacyAgents: string[] = [];
      const before = await ctx.readConfig();
      if (before !== undefined) {
        try {
          const raw = parseIcculusToml(before).raw;
          const project = isRecord(raw.project) ? raw.project : {};
          if (Array.isArray(project.agents)) {
            legacyAgents = project.agents.filter(
              (a): a is string => typeof a === "string",
            );
          }
        } catch {
          // unparseable — upgrade validates the config first; belt-and-braces.
        }
      }

      // 1. Move the config to the root single-file footprint.
      await ctx.rename(".icculus/config.toml", "icculus.toml");

      // 2. Add the new sections (only-if-absent), migrating agents across. The
      // line editor appends functional sections; the full commented blocks live
      // in the template for reference.
      const movedText = await ctx.readConfig();
      let raw: Record<string, unknown> = {};
      if (movedText !== undefined) {
        try {
          raw = parseIcculusToml(movedText).raw;
        } catch {
          // belt-and-braces; leave raw empty so every section is treated absent.
        }
      }
      const features = isRecord(raw.features) ? raw.features : {};
      const guidance = isRecord(raw.guidance) ? raw.guidance : {};
      const skills = isRecord(raw.skills) ? raw.skills : {};
      const recipes = isRecord(raw.recipes) ? raw.recipes : {};
      await ctx.editToml((e) => {
        for (const f of FEATURES) {
          if (features[f] === undefined) {
            e.setBool(`features.${f}`, true);
          }
        }
        if (guidance.sources === undefined) {
          e.setStringArray("guidance.sources", ["guidance.md"]);
        }
        if (guidance.agents === undefined) {
          e.setStringArray(
            "guidance.agents",
            legacyAgents.length > 0 ? legacyAgents : ["claude_code", "codex"],
          );
        }
        if (skills.dir === undefined) {
          e.setString("skills.dir", "skills");
        }
        const rdir = typeof recipes.dir === "string" ? recipes.dir : undefined;
        if (rdir === undefined || rdir === ".icculus/recipes") {
          e.setString("recipes.dir", "recipes");
        }
        // The agents list now lives under [guidance]; drop the legacy copy.
        e.deleteKey("project.agents");
      });

      // 3. Move the user's guideline prose → ./guidance.md (concatenated).
      if (
        !(await ctx.exists("guidance.md")) &&
        (await ctx.exists(".icculus/guidelines"))
      ) {
        const dir = join(ctx.destDir, ".icculus/guidelines");
        const files: string[] = [];
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile && entry.name.endsWith(".md")) {
            files.push(entry.name);
          }
        }
        files.sort();
        if (files.length > 0) {
          let body = "";
          for (const f of files) {
            body += await Deno.readTextFile(join(dir, f));
            if (!body.endsWith("\n")) {
              body += "\n";
            }
            body += "\n";
          }
          await ctx.writeText("guidance.md", body.replace(/\n+$/, "\n"));
          ctx.note(`moved ${files.length} guideline file(s) → guidance.md`);
        }
      }

      // 4. Move recipes → ./recipes/ (the old README is documentation; dropped
      // with .icculus/ below).
      if (await ctx.exists(".icculus/recipes")) {
        for await (
          const entry of Deno.readDir(join(ctx.destDir, ".icculus/recipes"))
        ) {
          if (entry.name === "README.md") {
            continue;
          }
          await ctx.rename(
            `.icculus/recipes/${entry.name}`,
            `recipes/${entry.name}`,
          );
        }
        ctx.note("moved recipes → ./recipes/");
      }

      // 5. Move the brief → ./brief.md (authored intent, read by /bootstrap).
      await ctx.rename(".icculus/brief.md", "brief.md");

      // 6. Split skills (§3.5): authored dirs move to ./skills/; pristine bundled
      // copies are pruned (the binary re-ships them). A bundled-NAMED dir whose
      // CONTENTS differ from the bundled one — in ANY file, not just SKILL.md —
      // is a customization, preserved as authored rather than lost (R1), and
      // noted loudly.
      if (await ctx.exists(".icculus/skills")) {
        const bundled = new Set(await bundledSkillNames());
        for await (
          const entry of Deno.readDir(join(ctx.destDir, ".icculus/skills"))
        ) {
          if (!entry.isDirectory) {
            continue;
          }
          const name = entry.name;
          const isPristineBundled = bundled.has(name) &&
            await sameSkillTree(ctx.destDir, name);
          if (isPristineBundled) {
            await ctx.removeAll(`.icculus/skills/${name}`);
          } else {
            await ctx.rename(`.icculus/skills/${name}`, `skills/${name}`);
            ctx.note(
              bundled.has(name)
                ? `preserved CUSTOMIZED skill skills/${name} (it differs from the built-in; it now overrides it)`
                : `preserved authored skill: skills/${name}`,
            );
          }
        }
      }

      // 7. Fix .gitignore: drop the dead .icculus/ ignores, ensure the new
      // generated mirrors are ignored, and keep AGENTS.md tracked.
      await fixGitignoreForSchema6(ctx);

      // 8. Delete the now-emptied .icculus/ namespace.
      await ctx.removeAll(".icculus");
      ctx.note(
        "dissolved .icculus/ — the footprint is now a root icculus.toml",
      );
    },
  },
];

/**
 * Whether the install's `.icculus/skills/<name>` is byte-identical to the bundled
 * built-in's — the WHOLE directory tree, every file, not just `SKILL.md`. A
 * pristine materialized copy (identical) is safe to prune (the binary re-ships
 * it); ANY difference — a changed, added, or removed file anywhere in the tree —
 * means the user customized it, so it must be preserved (R1). Erring toward
 * preservation: a read/resolve failure compares unequal.
 */
async function sameSkillTree(destDir: string, name: string): Promise<boolean> {
  let bundledDir: string;
  try {
    bundledDir = await resolveBundledSkillsDir();
  } catch {
    return false;
  }
  const installed = join(destDir, ".icculus/skills", name);
  const ship = join(bundledDir, name);
  const a = await treeFiles(installed);
  const b = await treeFiles(ship);
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  const bySet = new Set(b);
  for (const rel of a) {
    if (!bySet.has(rel)) {
      return false; // a file present on one side but not the other
    }
    if (!(await sameBytes(join(installed, rel), join(ship, rel)))) {
      return false;
    }
  }
  return true;
}

/** Sorted relative paths of every regular file under `dir`, or undefined if the
 * directory can't be read. */
async function treeFiles(dir: string): Promise<string[] | undefined> {
  try {
    const out: string[] = [];
    for await (const entry of walk(dir, { includeDirs: false })) {
      out.push(relative(dir, entry.path));
    }
    return out.sort();
  } catch {
    return undefined;
  }
}

/** Whether two files have byte-identical contents (false if either is unreadable). */
async function sameBytes(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([Deno.readFile(a), Deno.readFile(b)]);
    if (x.length !== y.length) {
      return false;
    }
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrite `.gitignore` for the schema-6 layout: remove any `.icculus/`-pointed
 * ignore, ensure `/CLAUDE.md` and `/GEMINI.md` are ignored, and ensure
 * `/AGENTS.md` is NOT (it is the one tracked agent file). Idempotent; a no-op
 * when there is no `.gitignore`.
 */
async function fixGitignoreForSchema6(ctx: MigrationContext): Promise<void> {
  const existing = await ctx.readText(".gitignore");
  if (existing === undefined) {
    return;
  }
  const lines = existing.split("\n")
    // Drop dead `.icculus` ignore RULES and any (mistaken) AGENTS.md ignore, but
    // keep comments and blanks intact (a rule line is non-blank, non-`#`).
    .filter((l) => {
      const t = l.trim();
      if (t === "" || t.startsWith("#")) {
        return true;
      }
      return !/\.icculus/.test(l) && !/^\/?AGENTS\.md$/.test(t);
    });
  const has = (re: RegExp): boolean => lines.some((l) => re.test(l));
  const additions: string[] = [];
  if (!has(/^\s*\/?CLAUDE\.md\b/)) additions.push("/CLAUDE.md");
  if (!has(/^\s*\/?GEMINI\.md\b/)) additions.push("/GEMINI.md");
  if (!has(/^\s*\/?\.claude\/\*/)) {
    additions.push("/.claude/*", "!/.claude/settings.json");
  }
  let text = lines.join("\n");
  if (additions.length > 0) {
    const base = text.replace(/\n+$/, "");
    text = `${base}\n\n# icculus: generated/ephemeral artifacts\n${
      additions.join("\n")
    }\n`;
  }
  if (text !== existing) {
    await ctx.writeText(".gitignore", text);
    ctx.note("updated .gitignore for the schema-6 layout");
  }
}

/** Build the context a migration uses to transform the install at `destDir`. */
export function createMigrationContext(
  destDir: string,
  onNote: (message: string) => void = () => {},
): MigrationContext {
  const abs = (rel: string) => join(destDir, rel);

  async function exists(rel: string): Promise<boolean> {
    try {
      await Deno.stat(abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async function readText(rel: string): Promise<string | undefined> {
    try {
      return await Deno.readTextFile(abs(rel));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  async function writeText(rel: string, content: string): Promise<void> {
    await ensureDir(dirname(abs(rel)));
    await Deno.writeTextFile(abs(rel), content);
  }

  async function remove(rel: string): Promise<void> {
    try {
      await Deno.remove(abs(rel));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async function removeAll(rel: string): Promise<void> {
    try {
      await Deno.remove(abs(rel), { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async function rename(from: string, to: string): Promise<void> {
    if (!(await exists(from))) {
      return; // already moved (or never existed) — idempotent no-op.
    }
    await ensureDir(dirname(abs(to)));
    await Deno.rename(abs(from), abs(to));
  }

  async function rewrite(
    rel: string,
    fn: (text: string) => string,
  ): Promise<void> {
    const text = await readText(rel);
    if (text === undefined) {
      return;
    }
    const next = fn(text);
    if (next !== text) {
      await Deno.writeTextFile(abs(rel), next);
    }
  }

  // Resolve the config's target-relative path for THIS install: the consolidated
  // `.icculus/config.toml` if present, else a legacy root `icculus.toml`. Resolved
  // per call so a step that renames the config is seen by any later step.
  async function configRel(): Promise<string> {
    return (await exists(".icculus/config.toml"))
      ? ".icculus/config.toml"
      : "icculus.toml";
  }

  async function readConfig(): Promise<string | undefined> {
    return await readText(await configRel());
  }

  async function editToml(fn: (editor: TomlEditor) => void): Promise<void> {
    const rel = await configRel();
    const text = await readText(rel);
    if (text === undefined) {
      return;
    }
    const editor = new TomlEditor(text);
    fn(editor);
    await Deno.writeTextFile(abs(rel), editor.toString());
  }

  async function mergeSettingsInto(
    incoming: Record<string, unknown>,
  ): Promise<void> {
    const rel = ".claude/settings.json";
    const existing = await readText(rel);
    const base: unknown = existing === undefined ? {} : JSON.parse(existing);
    const merged = mergeSettings(base, incoming);
    await ensureDir(dirname(abs(rel)));
    await Deno.writeTextFile(abs(rel), `${JSON.stringify(merged, null, 2)}\n`);
  }

  return {
    destDir,
    exists,
    readText,
    writeText,
    remove,
    removeAll,
    rename,
    rewrite,
    readConfig,
    editToml,
    mergeSettings: mergeSettingsInto,
    note: onNote,
  };
}

/**
 * The steps that bring `recorded` up to `current`, in ascending order — every
 * migration whose `from` lies in `[recorded, current)`.
 */
export function pendingMigrations(
  recorded: number,
  current: number,
  registry: Migration[] = MIGRATIONS,
): Migration[] {
  return registry
    .filter((m) => m.from >= recorded && m.from < current)
    .sort((a, b) => a.from - b.from);
}

/**
 * Run every pending migration to bring an install from schema `from` to `to`,
 * in order. Throws if the chain cannot bridge the gap — the pending steps must
 * be exactly `from, from+1, …, to-1`, or a version in between has no step.
 * Returns the steps applied (empty when already current).
 */
export async function applyMigrations(params: {
  destDir: string;
  from: number;
  to: number;
  registry?: Migration[] | undefined;
  onNote?: ((message: string) => void) | undefined;
}): Promise<Migration[]> {
  const { destDir, from, to } = params;
  const registry = params.registry ?? MIGRATIONS;
  const pending = pendingMigrations(from, to, registry);

  // The pending steps must form a contiguous run from `from` up to `to`.
  const expected: number[] = [];
  for (let v = from; v < to; v++) {
    expected.push(v);
  }
  const got = pending.map((m) => m.from);
  if (
    got.length !== expected.length || got.some((v, i) => v !== expected[i])
  ) {
    throw new Error(
      `broken migration chain: cannot migrate schema ${from} → ${to}; ` +
        `have steps for [${got.join(", ")}], need [${expected.join(", ")}].`,
    );
  }

  const ctx = createMigrationContext(destDir, params.onNote);
  for (const m of pending) {
    await m.apply(ctx);
  }
  return pending;
}

/**
 * True when `registry` is a well-formed chain for `current`: exactly one step
 * for each version in `[1, current)`, none duplicated or out of range. A guard
 * the build can assert against `SCHEMA_VERSION` so a malformed chain is caught
 * before it ever runs.
 */
export function isChainContiguous(
  registry: Migration[],
  current: number,
): boolean {
  const froms = registry.map((m) => m.from).sort((a, b) => a - b);
  if (froms.length !== current - 1) {
    return false;
  }
  return froms.every((v, i) => v === i + 1);
}
