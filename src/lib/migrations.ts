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
 * 0.x→1.0 `upgrade` ADR 0014 retired was not ported — the current shape was
 * declared schema 1 and the chain grows from there). Later steps append as
 * further bumps; the final one prunes the on-disk `.discern/engine/` tree a
 * schema-4 install carried.
 *
 * A step transforms an install through a {@link MigrationContext}: it can edit
 * the install config comment-preserving, move/remove/rewrite seed files, and
 * deep-merge `.claude/settings.json`. The file moves are what make a rename
 * safe — content is carried to the new path.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { TomlEditor, tomlString } from "./toml_edit.ts";
import { mergeSettings } from "./settings_merge.ts";
import { parseDiscernToml, renderTomlStringList } from "./toml_render.ts";
import {
  readConfigTemplate,
  sectionBlockFromTemplate,
} from "./config_template.ts";
import type { EnvReader } from "../shared/env.ts";
import { KNOWN_CAPABILITIES } from "./config.ts";
import { bundledSkillNames } from "./skills.ts";
import { resolveBundledSkillsDir } from "./paths.ts";
import { DEFAULT_AGENTS } from "../shared/config_schema.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathName,
} from "../shared/paths_registry.ts";

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Escape one literal token for interpolation into a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rename one top-level TOML key without touching comments, strings, or a same-named
 * key nested under another table. Covers the legal spellings discern configs use:
 * a table family (`[old]`, `[old.name]`), a root dotted key, and a root inline
 * table. Single- and double-quoted key tokens retain their quote style.
 *
 * Kept generic because launch vocabulary changes more than one config table; one
 * comment-preserving implementation should carry all of them.
 */
function renameTopLevelTomlKey(
  text: string,
  from: string,
  to: string,
): string {
  const escaped = escapeRegExp(from);
  const spelling = `(?:${escaped}|"${escaped}"|'${escaped}')`;
  const rewriteSpelling = (value: string): string => {
    if (value.startsWith('"')) return `"${to}"`;
    if (value.startsWith("'")) return `'${to}'`;
    return to;
  };

  // A root assignment can only occur before the first table header; once TOML
  // enters a table, later assignments belong to it. Limiting the rewrite to this
  // prefix prevents `[project]\nratchets = "team wording"` from being touched.
  const firstHeader = text.search(/^\s*\[{1,2}\s*[A-Za-z0-9_"']/mu);
  const rootEnd = firstHeader === -1 ? text.length : firstHeader;
  const root = text.slice(0, rootEnd).replace(
    new RegExp(`^(\\s*)(${spelling})(?=\\s*(?:\\.|=))`, "gmu"),
    (_match, prefix: string, key: string) => `${prefix}${rewriteSpelling(key)}`,
  );
  const rest = text.slice(rootEnd);

  // Table headers may occur anywhere after root assignments. The lookahead keeps
  // the match on the first path segment only, including a bare `[old]` header.
  return (root + rest).replace(
    new RegExp(
      `^(\\s*\\[{1,2}\\s*)(${spelling})(?=\\s*(?:\\.|\\]{1,2}))`,
      "gmu",
    ),
    (_match, prefix: string, key: string) => `${prefix}${rewriteSpelling(key)}`,
  );
}

/** The operations a migration step performs against an install. */
export interface MigrationContext {
  /** Absolute destination root of the install being migrated. */
  readonly destDir: string;
  /**
   * Env reader for any env-sourced override a step consults (e.g. the templates
   * dir behind {@link readConfigTemplate}). Injectable so a migration test never
   * mutates the process env, which would race across parallel test files.
   * Defaults to `Deno.env`.
   */
  readonly env: EnvReader;
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
  /** Read the install config (`.discern/config.toml`, or a legacy `discern.toml`), or undefined. */
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
 * is a long-standing engine-read field; an install whose `discern.toml` predates
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
        raw = parseDiscernToml(text).raw;
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
      "consolidate the install surface under .discern/ (move the config + guidance seeds)",
    apply: async (ctx) => {
      // Carry the SEEDS into the `.discern/` namespace. A seed is the user's, so a
      // rename here is the only thing that moves its content forward. `rename`
      // wraps Deno.rename (whole-directory moves) and is idempotent — a no-op once
      // the source is gone, so a re-run, or an install already in the new layout,
      // passes through cleanly.
      await ctx.rename("discern.toml", ".discern/config.toml");
      await ctx.rename(".ai/guidelines", ".discern/guidelines");
      // The `bin/agent` dispatcher and `.ai/skills` are not moved: skills are
      // re-materialized at the new path by the upgrade, and the `.discern/engine/`
      // tree — dispatcher included — is pruned by the final chain step. Repoint
      // the worktree hooks at the root `./agent` dispatcher, which still exists at
      // this schema, so `./agent` is correct here. The final prune step then
      // removes the dispatcher and repoints the hook at the on-PATH `discern`
      // binary.
      await ctx.rewrite(
        ".claude/settings.json",
        (t) => t.replaceAll("./bin/agent", "./agent"),
      );
      // Best-effort: the default neutral-scope globs named `.ai/`; guidance now
      // lives under `.discern/`. A customised list simply won't match — harmless.
      await ctx.rewrite(
        ".discern/config.toml",
        (t) => t.replaceAll('".ai/"', '".discern/"'),
      );
      ctx.note(
        "moved discern.toml→.discern/config.toml and .ai/guidelines→.discern/guidelines",
      );
      ctx.note(
        ".discern/skills are re-materialized by the upgrade; run `discern refresh` after",
      );
    },
  },
  {
    from: 3,
    // ADR 0017/0018
    describe:
      "convert [slots]→[capabilities]/[checks], inline ratchet runs, fold side-gates into [scopes.<name>].gate, drop [evidence]",
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
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

      // Idempotency: an unmigrated config is detectable by [slots.*], array-valued
      // [scopes] keys, [scopes.side_gates], or [evidence]. Once migrated, none of
      // those remain, so a re-run (or an already-migrated config) returns early.
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
        e.deleteSection("scopes"); // the array-keyed bare [scopes] table
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
      "prune the pre-existing on-disk shell engine (.discern/engine/, the root agent, .discern/manifest.json)",
    apply: async (ctx) => {
      // A schema-4 install carried a committed engine on disk: the generic engine
      // tree, a root `agent` dispatcher, and a hash-tracking manifest. None of
      // those exist on a fresh install — the engine is in the binary — so an
      // upgrading install must shed them. All three removals are idempotent (a
      // no-op when already gone), so this is safe on a fresh install too. The
      // skill symlinks under `.claude/skills/` that the `agent` dispatcher's
      // `guidelines` step created still point at the re-materialized
      // `.discern/skills/`, so they need no surgery here; the next `discern
      // refresh` reconciles them.
      const had = await ctx.exists(".discern/engine") ||
        await ctx.exists("agent") ||
        await ctx.exists(".discern/manifest.json");
      await ctx.removeAll(".discern/engine");
      await ctx.remove("agent");
      await ctx.remove(".discern/manifest.json");
      // The worktree hooks called the now-deleted `./agent` dispatcher; repoint
      // them at the on-PATH `discern` binary so they survive the prune. In
      // settings `./agent` only ever names the dispatcher (the `agent/<name>`
      // branch prefix has no `./`), so this literal swap is safe and idempotent
      // — a no-op once already repointed, or when there is no settings file.
      // `upgrade` never re-merges the settings seed, so this step is what
      // carries the hooks across the upgrade.
      await ctx.rewrite(
        ".claude/settings.json",
        (t) => t.replaceAll("./agent", "discern"),
      );
      // A schema-4 install committed its skills (managed at that schema) and may
      // not ignore the now-materialized/compiled artifacts. Ensure `.gitignore` ignores
      // them — append only what is missing (idempotent), never clobbering the
      // user's file. Untracking already-committed copies (`git rm --cached`) is a
      // git-index operation left to the operator; a migration only edits files.
      const ignore = (await ctx.readText(".gitignore")) ?? "";
      const wantIgnore: Array<[RegExp, string]> = [
        [/^\s*\/?\.discern\/skills\b/m, "/.discern/skills/"],
        [/^\s*\/?CLAUDE\.md\b/m, "/CLAUDE.md"],
      ];
      const missingIgnore = wantIgnore
        .filter(([re]) => !re.test(ignore))
        .map(([, line]) => line);
      if (missingIgnore.length > 0) {
        const block = [
          "# discern: materialized/compiled artifacts (re-published on upgrade)",
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
          "removed the legacy shell engine, root agent, and manifest.json; repointed the worktree hooks at `discern`",
        );
      }
    },
  },
  {
    from: 5,
    // ADR 0020
    describe:
      "dissolve .discern/ into the single-file footprint: config → root discern.toml; move guidance/recipes/authored skills out; prune bundled skills; add [guidance]/[skills]",
    apply: async (ctx) => {
      // Capture the legacy [project].agents (to seed [guidance].agents) BEFORE
      // moving the config, while it is still readable at its old location.
      let legacyAgents: string[] = [];
      const before = await ctx.readConfig();
      if (before !== undefined) {
        try {
          const raw = parseDiscernToml(before).raw;
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
      await ctx.rename(".discern/config.toml", "discern.toml");

      // 2. Add the new sections. A fresh `setup` lays the whole template down, so
      // its config reads fully documented; an only-if-absent *line* edit here
      // would instead append bare keys at EOF, leaving a migrated config
      // progressively worse-documented than an init'd one the longer it has
      // existed. So when a section is wholly absent — the common case, since
      // [guidance]/[skills] are new in schema 6 — insert its canonical
      // doc-commented block from the template at its canonical position, giving a
      // migrated config the same quality as a fresh one. Fall back to a bare key
      // edit only when a section is already partly present (so a hand edit is
      // never clobbered) or the template can't be read. ([features] — new at this
      // schema, retired at 16 (ADR 0101) — is deliberately NOT written: the chain
      // runs to the current schema, so inserting a section a later step deletes
      // would be churn.)
      const movedText = await ctx.readConfig();
      let raw: Record<string, unknown> = {};
      if (movedText !== undefined) {
        try {
          raw = parseDiscernToml(movedText).raw;
        } catch {
          // belt-and-braces; leave raw empty so every section is treated absent.
        }
      }
      const guidanceTbl = isRecord(raw.guidance) ? raw.guidance : undefined;
      const skillsTbl = isRecord(raw.skills) ? raw.skills : undefined;
      const recipesTbl = isRecord(raw.recipes) ? raw.recipes : undefined;
      const agents = legacyAgents.length > 0
        ? legacyAgents
        : [...DEFAULT_AGENTS];
      const tmpl = await readConfigTemplate(ctx.env);
      // A section's canonical block from the template, with content tokens filled
      // (only [guidance] carries one, `{{agents_array}}`). Undefined when the
      // template is unavailable or the section is not in it.
      const block = (section: string): string | undefined =>
        tmpl === undefined
          ? undefined
          : sectionBlockFromTemplate(tmpl, section)?.replace(
            "{{agents_array}}",
            renderTomlStringList(agents),
          );
      await ctx.editToml((e) => {
        // [meta] first and documented, when an install predating it never had one
        // (a legacy, manifest-anchored upgrade would otherwise gain a bare [meta]
        // at EOF from the schema stamp). Only-if-absent: an existing [meta] is
        // left exactly where it is.
        const metaBlock = block("meta");
        if (!e.hasSection("meta") && metaBlock !== undefined) {
          e.insertSectionBlockAtTop(metaBlock);
        }

        // [guidance] / [skills] — grouped after [project]. Inserted
        // in order so each is the anchor for the next; the bare fallback fills
        // any key whose value is absent (all of them when the section is new).
        const guidanceBlock = block("guidance");
        if (guidanceTbl === undefined && guidanceBlock !== undefined) {
          e.insertSectionBlockAfter("project", guidanceBlock);
        } else {
          if (guidanceTbl?.sources === undefined) {
            e.setStringArray("guidance.sources", ["guidance.md"]);
          }
          if (guidanceTbl?.agents === undefined) {
            e.setStringArray("guidance.agents", agents);
          }
        }

        const skillsBlock = block("skills");
        if (skillsTbl === undefined && skillsBlock !== undefined) {
          e.insertSectionBlockAfter("guidance", skillsBlock);
        } else if (skillsTbl?.dir === undefined) {
          e.setString("skills.dir", "skills");
        }

        // [recipes] — canonically last. When present, only repoint the dead
        // `.discern/recipes` default (never touching a custom dir).
        const recipesBlock = block("recipes");
        if (recipesTbl === undefined && recipesBlock !== undefined) {
          e.insertSectionBlockAfter("gate", recipesBlock);
        } else {
          const rdir = typeof recipesTbl?.dir === "string"
            ? recipesTbl.dir
            : undefined;
          if (rdir === undefined || rdir === ".discern/recipes") {
            e.setString("recipes.dir", "recipes");
          }
        }

        // The agents list now lives under [guidance]; drop the legacy copy.
        e.deleteKey("project.agents");
      });

      // 3. Move the user's guideline prose → ./guidance.md (concatenated).
      if (
        !(await ctx.exists("guidance.md")) &&
        (await ctx.exists(".discern/guidelines"))
      ) {
        const dir = join(ctx.destDir, ".discern/guidelines");
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

      // 4. Move recipes → ./recipes/ (the `.discern/recipes` README is
      // documentation; dropped with .discern/ below).
      if (await ctx.exists(".discern/recipes")) {
        for await (
          const entry of Deno.readDir(join(ctx.destDir, ".discern/recipes"))
        ) {
          if (entry.name === "README.md") {
            continue;
          }
          await ctx.rename(
            `.discern/recipes/${entry.name}`,
            `recipes/${entry.name}`,
          );
        }
        ctx.note("moved recipes → ./recipes/");
      }

      // 5. Move the brief → ./brief.md (authored intent, read by `discern setup`).
      await ctx.rename(".discern/brief.md", "brief.md");

      // 6. Split skills (§3.5): authored dirs move to ./skills/; pristine bundled
      // copies are pruned (the binary re-ships them). A bundled-NAMED dir whose
      // CONTENTS differ from the bundled one — in ANY file, not just SKILL.md —
      // is a customization, preserved as authored rather than lost (R1), and
      // noted loudly.
      if (await ctx.exists(".discern/skills")) {
        const bundled = new Set(await bundledSkillNames());
        for await (
          const entry of Deno.readDir(join(ctx.destDir, ".discern/skills"))
        ) {
          if (!entry.isDirectory) {
            continue;
          }
          const name = entry.name;
          const isPristineBundled = bundled.has(name) &&
            await sameSkillTree(ctx.destDir, name);
          if (isPristineBundled) {
            await ctx.removeAll(`.discern/skills/${name}`);
          } else {
            await ctx.rename(`.discern/skills/${name}`, `skills/${name}`);
            ctx.note(
              bundled.has(name)
                ? `preserved CUSTOMIZED skill skills/${name} (it differs from the built-in; it now overrides it)`
                : `preserved authored skill: skills/${name}`,
            );
          }
        }
      }

      // 7. Fix .gitignore: drop the dead .discern/ ignores, ensure the new
      // generated mirrors are ignored, and keep AGENTS.md tracked.
      await fixGitignoreForSchema6(ctx);

      // 8. Delete the now-emptied .discern/ namespace.
      await ctx.removeAll(".discern");
      ctx.note(
        "dissolved .discern/ — the footprint is now a root discern.toml",
      );
    },
  },
  {
    from: 6,
    // ADR 0024
    describe:
      "retire the setup skill for the `discern setup` command: prune the stale legacy materialized setup-skill copy and back-fill [meta].bootstrapped for an already-configured install",
    apply: async (ctx) => {
      // Setup instructions are now CLI-served, not a materialized skill. Remove the
      // pristine legacy copy a schema-6 install left under .claude/skills/: it is no longer in the bundled set, so `materializeSkills` treats it as a foreign dir and
      // would leave it forever. Idempotent (a no-op once gone). An authored skill with that legacy basename is a symlink, not a tree we ship — removing the link is harmless, the next refresh re-links it from [skills].dir.
      // discern-allow-retrospective: "no longer in the bundled set" is the live
      // bundled set this prune acts on, not a past state.
      await ctx.removeAll(".claude/skills/bootstrap");

      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const meta = isRecord(raw.meta) ? raw.meta : {};
      if (meta.bootstrapped !== undefined) {
        return; // the marker is already decided — never overwrite the user's value.
      }
      // Back-fill: an install that already has capabilities wired or a docs/ tree
      // is effectively bootstrapped, so record it and the reminder stays quiet. A
      // bare install gets no marker — absent ≡ not set up everywhere, so its
      // first `discern setup` runs normally. Only-if-true keeps "absent"
      // meaning exactly one thing.
      const caps = isRecord(raw.capabilities) ? raw.capabilities : {};
      const configured = Object.keys(caps).length > 0 ||
        await ctx.exists("docs");
      if (configured) {
        await ctx.editToml((e) => e.setBool("meta.bootstrapped", true));
        ctx.note(
          "back-filled [meta].bootstrapped = true (install already configured)",
        );
      } else {
        ctx.note(
          "not yet bootstrapped — run `discern setup` to seed the docs",
        );
      }
    },
  },
  {
    from: 7,
    // ADR 0025
    describe:
      "generalize [worktree.db]/[worktree.dev_server] into [worktree.resources.<name>]; carry non-empty commands forward as create/destroy, then add the commented resource examples",
    apply: async (ctx) => {
      await migrateLegacyWorktreeResources(ctx);
    },
  },
  {
    from: 8,
    describe:
      "untrack the generated AGENTS.md, and clean any stale [worktree.db]/[worktree.dev_server] tables left by early schema-8 templates",
    apply: async (ctx) => {
      await migrateLegacyWorktreeResources(ctx);
      await ignoreAgentsMd(ctx);
    },
  },
  {
    from: 9,
    // ADR 0042
    describe:
      "ignore /.agents/skills/: skills now materialize there for Codex/Gemini (the cross-tool standard), so the generated dir joins .claude/skills as an untracked build artifact",
    apply: async (ctx) => {
      await ignoreAgentsSkills(ctx);
    },
  },
  {
    from: 10,
    // ADR 0045
    describe:
      "drop [features].mcp — the MCP server is core infrastructure now, not a toggle; its config block is wired unconditionally",
    apply: async (ctx) => {
      // Idempotent: deleteKey removes only the `mcp = …` line (inline comment and
      // all), leaving the rest of [features] and its doc comments intact; a no-op
      // when the key is already absent.
      await ctx.editToml((e) => e.deleteKey("features.mcp"));
    },
  },
  {
    from: 11,
    // ADR 0048
    describe:
      'rename the [worktree].graduate_to value "main" → "trunk" so the landing role is branch-name-agnostic, not read as a branch literally named main',
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const worktree = isRecord(raw.worktree) ? raw.worktree : {};
      // Only the renamed legacy value needs carrying. "branch" (the default),
      // an already-migrated "trunk", or an absent key are all left untouched —
      // so this is idempotent and never invents a key the user didn't set.
      if (worktree.graduate_to !== "main") {
        return;
      }
      await ctx.editToml((e) => e.setString("worktree.graduate_to", "trunk"));
      ctx.note('renamed [worktree].graduate_to = "main" → "trunk"');
    },
  },
  {
    from: 12,
    // ADR 0052
    describe:
      "add the documented [worktree].root key (empty ⇒ a sibling of the repo; relative/absolute overrides) so worktrees adopt the non-nested placement",
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const worktree = isRecord(raw.worktree) ? raw.worktree : {};
      // Idempotent: add the key only when absent. An empty `root` IS the new
      // sibling default, so this changes no behaviour for an existing worktree —
      // it surfaces the option (and lets a user pin a custom or nested location).
      // Existing nested worktrees keep working: the engine finds them via git, so
      // the flip is forward-only.
      if (worktree.root !== undefined) {
        return;
      }
      await ctx.rewrite("discern.toml", (t) => insertWorktreeRootKey(t));
      ctx.note(
        'added [worktree].root = "" — worktrees now default to a sibling of the repo, not nested .claude/worktrees',
      );
    },
  },
  {
    from: 13,
    // ADR 0089
    describe:
      "remove the .claude/settings.local.json gitignore exception so machine-local provider settings stay ignored",
    apply: async (ctx) => {
      await removeClaudeLocalSettingsGitignoreException(ctx);
    },
  },
  {
    from: 14,
    // ADR 0099/0102
    describe:
      "consolidate the authored surface under the visible discern/ namespace: each unpointed source (the guidance seed, the docs tree, authored skills, recipes, the deferred-work ledger, the brief) moves from its old root default to its discern/ default; pointed paths are untouched",
    apply: async (ctx) => {
      await migrateIntoNamespace(ctx);
    },
  },
  {
    from: 15,
    // ADR 0101
    describe:
      "retire the [features] toggles and [worktree].enabled — every subsystem is core now; a features.skills = false becomes an authored [skills].exclude of the bundled set",
    apply: async (ctx) => {
      await retireFeatureToggles(ctx);
    },
  },
  {
    from: 16,
    // ADR 0110
    describe:
      "drop [worktree].graduate_to — `discern accept` always lands on the trunk; composition happens on the pull axis instead",
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const worktree = isRecord(raw.worktree) ? raw.worktree : {};
      // Idempotent: only a config still carrying the key is touched.
      if (worktree.graduate_to === undefined) {
        return;
      }
      const dropped = worktree.graduate_to;
      await ctx.rewrite("discern.toml", removeAcceptToKey);
      // The note claims only what actually happened: the lexical rewrite covers
      // the table and dotted line forms, so PROVE the key is gone by re-parsing
      // before saying "dropped" — an exotic spelling (an inline table) gets an
      // honest "remove it by hand" instead of a success that loops the user
      // through `discern upgrade` forever.
      let stillThere = false;
      try {
        const after = await ctx.readConfig();
        const reparsed = after === undefined ? {} : parseDiscernToml(after).raw;
        const wt = isRecord(reparsed.worktree) ? reparsed.worktree : {};
        stillThere = wt.graduate_to !== undefined;
      } catch {
        stillThere = true; // can't prove it's gone — don't claim it is
      }
      ctx.note(
        stillThere
          ? `[worktree].graduate_to = "${String(dropped)}" is written in a ` +
            "form this migration can't rewrite — remove the key from " +
            "discern.toml by hand: `discern accept` always lands on the " +
            "trunk now"
          : `dropped [worktree].graduate_to = "${String(dropped)}" — ` +
            "`discern accept` always lands on the trunk now; to compose work " +
            "below the trunk, pull with `start --from` / `update --from`",
      );
    },
  },
  {
    from: 17,
    // ADR 0120
    describe: "rename the [ratchets] quality-metric table to [standards]",
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return;
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseDiscernToml(text).raw;
      } catch {
        return; // upgrade validates syntax before migration; belt-and-braces.
      }
      if (raw.ratchets === undefined) {
        return; // already migrated, or no standards configured.
      }
      if (raw.standards !== undefined) {
        throw new Error(
          "discern.toml contains both [ratchets] and [standards]. Move the entries " +
            "under [standards], remove [ratchets], then run `discern upgrade` again.",
        );
      }

      const migrated = renameTopLevelTomlKey(text, "ratchets", "standards");
      let after: Record<string, unknown>;
      try {
        after = parseDiscernToml(migrated).raw;
      } catch {
        throw new Error(
          "discern could not rename [ratchets] to [standards] safely. Rename the " +
            "table in discern.toml, then run `discern upgrade` again.",
        );
      }
      if (after.ratchets !== undefined || after.standards === undefined) {
        throw new Error(
          "discern.toml uses a [ratchets] key spelling this migration cannot rewrite. " +
            "Rename it to [standards], then run `discern upgrade` again.",
        );
      }

      await ctx.rewrite(
        "discern.toml",
        (current) => renameTopLevelTomlKey(current, "ratchets", "standards"),
      );
      ctx.note("renamed [ratchets] to [standards]");
    },
  },
];

/**
 * Remove the `graduate_to` key line — the table form (`graduate_to =` under
 * `[worktree]`) or the dotted top-level form (`worktree.graduate_to =`) — plus
 * the contiguous comment paragraph directly above it, but only when that
 * paragraph is actually about the landing destination (it mentions "accept"),
 * so a user's own unrelated comment is never eaten. The blank run the removal
 * leaves is collapsed at the removal site only — never a whole-file reformat.
 * A no-op without the key.
 */
function removeAcceptToKey(text: string): string {
  const lines = text.split("\n");
  let idx = lines.findIndex((l) =>
    /^\s*worktree\s*\.\s*graduate_to\s*=/.test(l)
  );
  if (idx === -1) {
    idx = lines.findIndex((l) => /^\s*graduate_to\s*=/.test(l));
  }
  if (idx === -1) {
    return removeAcceptToInlineEntry(text);
  }
  let start = idx;
  let bannerStart = idx;
  while (
    bannerStart - 1 >= 0 &&
    (lines[bannerStart - 1] ?? "").trim().startsWith("#")
  ) {
    bannerStart--;
  }
  if (
    bannerStart < idx &&
    /accept/i.test(lines.slice(bannerStart, idx).join("\n"))
  ) {
    start = bannerStart;
  }
  lines.splice(start, idx - start + 1);
  while (
    start > 0 && start < lines.length &&
    (lines[start - 1] ?? "").trim() === "" &&
    (lines[start] ?? "").trim() === ""
  ) {
    lines.splice(start, 1);
  }
  return lines.join("\n");
}

/**
 * Remove a `graduate_to` entry from an INLINE `worktree = { … }` table — the
 * third legal spelling of the same key. Only the entry (its value is a simple
 * string) and one adjoining comma are touched, so sibling entries with commas
 * of their own (an array value) are never split. Anything still stranger — a
 * quoted dotted key, say — is left for the migration's verify step to admit
 * honestly rather than guess at.
 */
function removeAcceptToInlineEntry(text: string): string {
  return text.split("\n").map((line) => {
    if (!/^\s*worktree\s*=\s*\{.*\}/.test(line)) {
      return line;
    }
    return line
      .replace(/graduate_to\s*=\s*("[^"]*"|'[^']*')\s*,\s*/, "")
      .replace(/,\s*graduate_to\s*=\s*("[^"]*"|'[^']*')/, "")
      .replace(/graduate_to\s*=\s*("[^"]*"|'[^']*')/, "");
  }).join("\n");
}

/**
 * The schema-15→16 transform (ADR 0101): drop the `[features]` section (banner
 * comment included) and the duplicate `[worktree].enabled` key. A discarded
 * preference is NAMED in the notes, never silently eaten: each
 * `features.<name> = false` gets a note, and `features.skills = false` is mapped
 * to its honest equivalent — an authored `[skills].exclude` covering every
 * bundled skill (trim the list to bring individual skills back). The stale
 * "(Inert when [features].<name> = false.)" template comments are scrubbed
 * best-effort. Idempotent: a config with neither the section nor the key is
 * untouched.
 */
async function retireFeatureToggles(ctx: MigrationContext): Promise<void> {
  const text = await ctx.readConfig();
  if (text === undefined) {
    return; // no config to evolve.
  }
  let raw: Record<string, unknown>;
  try {
    raw = parseDiscernToml(text).raw;
  } catch {
    return; // unparseable — upgrade validates the config first; belt-and-braces.
  }
  const features = isRecord(raw.features) ? raw.features : undefined;
  const worktree = isRecord(raw.worktree) ? raw.worktree : {};

  // features.skills = false → the honest equivalent: exclude every bundled skill
  // by name. Merged with any existing exclude list (never clobbered).
  if (features?.skills === false) {
    const skillsTbl = isRecord(raw.skills) ? raw.skills : {};
    const existing = Array.isArray(skillsTbl.exclude)
      ? skillsTbl.exclude.filter((s): s is string => typeof s === "string")
      : [];
    const merged = [...new Set([...existing, ...await bundledSkillNames()])]
      .sort();
    await ctx.editToml((e) => e.setStringArray("skills.exclude", merged));
    ctx.note(
      "[features].skills = false became [skills].exclude covering every bundled skill — the honest equivalent; remove names from the list to bring individual skills back",
    );
  }

  // Name every other disabled toggle the drop discards (ADR 0101).
  for (const [name, value] of Object.entries(features ?? {})) {
    if (name === "skills" || value !== false) {
      continue;
    }
    ctx.note(
      `dropped [features].${name} = false — the subsystem toggles were retired (every subsystem is core now); the escape is behavioral, not configurational`,
    );
  }
  if (worktree.enabled === false) {
    ctx.note(
      "dropped [worktree].enabled = false — session-start worktree setup is built in now (a silent no-op outside a linked worktree)",
    );
  }

  if (features !== undefined) {
    await ctx.rewrite("discern.toml", removeFeaturesSection);
  }
  if (worktree.enabled !== undefined) {
    await ctx.editToml((e) => e.deleteKey("worktree.enabled"));
  }

  // Scrub the retired toggles from the template's own comment prose — the exact
  // phrasings the schema-15 template shipped. Best-effort literal swaps: a
  // hand-edited comment simply stays as the user wrote it.
  await ctx.rewrite("discern.toml", (t) =>
    t
      .replace(
        " (Inert\n# when [features].worktrees = false.)",
        "",
      )
      .replace(" (Inert when [features].ratchets = false.)", "")
      .replace(" (Inert when [features].coupling = false.)", ""));
}

/**
 * Remove the whole `[features]` section: the header, its key lines (up to the
 * first blank/comment/header), the banner comment paragraph directly above it —
 * but only when that paragraph is actually about `[features]`, so a user's own
 * unrelated comment is never eaten — and the blank separators, collapsed back to
 * one blank run. A no-op without the header.
 */
function removeFeaturesSection(text: string): string {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === "[features]");
  if (idx === -1) {
    return text;
  }
  let end = idx + 1;
  while (end < lines.length) {
    const t = (lines[end] ?? "").trim();
    if (t === "" || t.startsWith("#") || t.startsWith("[")) {
      break;
    }
    end++;
  }
  // The banner sits above the header, separated by blank line(s): walk past the
  // blanks, then take the contiguous comment paragraph when it names [features].
  let start = idx;
  let probe = idx;
  while (probe - 1 >= 0 && (lines[probe - 1] ?? "").trim() === "") {
    probe--;
  }
  let bannerStart = probe;
  while (
    bannerStart - 1 >= 0 &&
    (lines[bannerStart - 1] ?? "").trim().startsWith("#")
  ) {
    bannerStart--;
  }
  if (
    bannerStart < probe &&
    lines.slice(bannerStart, probe).join("\n").includes("[features]")
  ) {
    start = bannerStart;
  }
  // Consume the blank separators after the body — the blank run ABOVE the removed
  // block (kept intact) already separates the neighbours it leaves adjacent.
  while (end < lines.length && (lines[end] ?? "").trim() === "") {
    end++;
  }
  lines.splice(start, end - start);
  return lines.join("\n");
}

/** A migration decision for one registry path: whether its config key is
 * pointed away from the pre-namespace default. */
interface NamespaceMoveDecision {
  /** The registry entry being considered. */
  name: SourcePathName;
  /** True when the configured value differs from the legacy default — the user
   * typed a path, so the migration must not touch it. */
  pointed: boolean;
  /** True when the key is literally written in the config (at the legacy
   * default), so a move must also update the written value to the new default. */
  keyWritten: boolean;
}

/** Strip a trailing slash for filesystem operations (`docs/` → `docs`). */
function fsPath(p: string): string {
  return p.replace(/\/+$/, "");
}

/** Canonicalize a configured dir-ish value for default comparison: trim, drop a
 * leading `./` and any trailing slashes. */
function canonicalDir(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Read a dotted key from a raw parsed config, or undefined. */
function rawValueAt(
  raw: Record<string, unknown>,
  dotted: string,
): unknown {
  let node: unknown = raw;
  for (const seg of dotted.split(".")) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node[seg];
  }
  return node;
}

/**
 * Whether a keyed registry path is pointed away from its pre-namespace default.
 * Absent ⇒ unpointed (the legacy schema default governed). A list key (the guidance
 * sources) is unpointed when empty or exactly the one legacy default entry; a
 * dir key when it canonicalizes to the legacy default.
 */
function decideNamespaceMove(
  raw: Record<string, unknown>,
  name: SourcePathName,
): NamespaceMoveDecision {
  const entry = SOURCE_PATHS[name];
  if (entry.key === null) {
    return { name, pointed: false, keyWritten: false }; // fixed location (the brief)
  }
  const value = rawValueAt(raw, entry.key);
  if (value === undefined) {
    return { name, pointed: false, keyWritten: false };
  }
  if (Array.isArray(value)) {
    const unpointed = value.length === 0 ||
      (value.length === 1 && value[0] === entry.legacyPath);
    return { name, pointed: !unpointed, keyWritten: true };
  }
  if (typeof value === "string") {
    const unpointed = canonicalDir(value) === canonicalDir(entry.legacyPath);
    return { name, pointed: !unpointed, keyWritten: true };
  }
  // An unrecognizable shape — never touch it.
  return { name, pointed: true, keyWritten: true };
}

/**
 * The schema-14→15 transform (ADR 0099/0102): consolidate the authored surface
 * under the visible `discern/` namespace. Enumerates the paths registry — for
 * each source path whose config key is NOT pointed away from the legacy default,
 * move the file/dir from its pre-namespace location to its `discern/` default
 * (creating the namespace dir as needed) and update an explicitly-written key to
 * the new default. A pointed path is untouched; a move blocked by an occupied
 * target keeps the legacy location working by pinning the key to it explicitly.
 * Also carries `[project].gotchas_doc` and the seeded neutral-scope globs across
 * a docs/skills move, best-effort — same craft as the 2→3 glob repoint.
 */
async function migrateIntoNamespace(ctx: MigrationContext): Promise<void> {
  const text = await ctx.readConfig();
  if (text === undefined) {
    return; // no config to evolve.
  }
  let raw: Record<string, unknown>;
  try {
    raw = parseDiscernToml(text).raw;
  } catch {
    return; // unparseable — upgrade validates the config first; belt-and-braces.
  }

  const moved: SourcePathName[] = [];
  const pinned: SourcePathName[] = [];
  const repoint: Array<{ key: string; value: string | string[] }> = [];

  for (const name of SOURCE_PATH_NAMES) {
    const entry = SOURCE_PATHS[name];
    const decision = decideNamespaceMove(raw, name);
    if (decision.pointed) {
      continue; // the user typed a path — their consent, their layout.
    }
    const from = fsPath(entry.legacyPath);
    const to = fsPath(entry.defaultPath);
    const sourceExists = await ctx.exists(from);
    const targetOccupied = await ctx.exists(to);

    if (sourceExists && targetOccupied) {
      // Can't move without clobbering — keep the legacy location WORKING by
      // pinning the key to it explicitly (placement-is-consent: the pin records
      // the layout the install actually has). The brief has no key to pin.
      if (entry.key !== null) {
        repoint.push({
          key: entry.key,
          value: entry.key === "guidance.sources"
            ? [entry.legacyPath]
            : entry.legacyPath,
        });
        pinned.push(name);
      }
      ctx.note(
        `left ${entry.legacyPath} in place — ${entry.defaultPath} already exists; resolve the collision and move it yourself if wanted`,
      );
      continue;
    }

    if (sourceExists) {
      await ctx.rename(from, to);
      moved.push(name);
    }
    // Converge an explicitly-written old-default key on the new default (the
    // move carried the content; an absent key already reads the new default).
    if (decision.keyWritten && entry.key !== null) {
      repoint.push({
        key: entry.key,
        value: entry.key === "guidance.sources"
          ? [entry.defaultPath]
          : entry.defaultPath,
      });
    }
  }

  // Carry [project].gotchas_doc across a docs move: it points INTO the tree
  // that just moved, so rewrite its prefix (only when it wasn't pointed
  // elsewhere — a path outside the legacy docs default is untouched).
  const docsEntry = SOURCE_PATHS.docs;
  const gotchas = rawValueAt(raw, "project.gotchas_doc");
  if (
    moved.includes("docs") && typeof gotchas === "string" &&
    gotchas.startsWith(docsEntry.legacyPath)
  ) {
    repoint.push({
      key: "project.gotchas_doc",
      value: `${docsEntry.defaultPath}${
        gotchas.slice(docsEntry.legacyPath.length)
      }`,
    });
  }

  if (repoint.length > 0) {
    await ctx.editToml((e) => {
      for (const { key, value } of repoint) {
        if (Array.isArray(value)) {
          e.setStringArray(key, value);
        } else {
          e.setString(key, value);
        }
      }
    });
  }

  // Best-effort: the pre-namespace template seeded literal neutral-scope globs for the
  // docs tree and the authored skills; repoint them at the moved locations so
  // the neutral scope keeps matching. A customised glob simply won't match the
  // pattern — harmless (same craft as the 2→3 `.ai/` repoint).
  const globSwaps: Array<[string, string]> = [];
  if (moved.includes("docs")) {
    globSwaps.push([
      `"${SOURCE_PATHS.docs.legacyPath}"`,
      `"${SOURCE_PATHS.docs.defaultPath}"`,
    ]);
  }
  if (moved.includes("skills")) {
    globSwaps.push([
      `"${SOURCE_PATHS.skills.legacyPath}/"`,
      `"${SOURCE_PATHS.skills.defaultPath}/"`,
    ]);
  }
  if (globSwaps.length > 0) {
    await ctx.rewrite("discern.toml", (t) => {
      let out = t;
      for (const [oldGlob, newGlob] of globSwaps) {
        out = out.replaceAll(oldGlob, newGlob);
      }
      return out;
    });
  }

  if (moved.length > 0) {
    ctx.note(
      `moved into the discern/ namespace: ${
        moved.map((n) => SOURCE_PATHS[n].legacyPath).join(", ")
      }`,
    );
  }
  if (pinned.length > 0) {
    ctx.note(
      `pinned to their existing locations: ${
        pinned.map((n) =>
          `${SOURCE_PATHS[n].key} = ${SOURCE_PATHS[n].legacyPath}`
        )
          .join(", ")
      }`,
    );
  }
}

/**
 * Insert the documented `[worktree].root` key as the first key of the existing
 * `[worktree]` table (right after its header), preserving everything else. A
 * no-op when there is no `[worktree]` header (the schema default — a sibling —
 * then governs at read time regardless). Kept in sync with the `[worktree]`
 * region of templates/discern.toml.tmpl.
 */
function insertWorktreeRootKey(text: string): string {
  const lines = text.split("\n");
  const hdr = lines.findIndex((l) => l.trim() === "[worktree]");
  if (hdr === -1) {
    return text;
  }
  lines.splice(hdr + 1, 0, ...WORKTREE_ROOT_BLOCK.split("\n"));
  return lines.join("\n");
}

/** The documented `[worktree].root` block a fresh init / this migration lays
 * down. Kept in sync with the `[worktree]` region of templates/discern.toml.tmpl. */
const WORKTREE_ROOT_BLOCK =
  `# Where per-worktree checkouts are created (a <name> dir is made under it).
#   ""  (the default) a SIBLING of the repo, "<repo>.worktrees/<name>" — visible
#       and adjacent, never nested inside the checkout (a worktree nested in its
#       own repo is an anti-pattern: recursive tools double-count it, and walking
#       up to the repo root mis-resolves the worktree's .git file).
#   a RELATIVE path resolves against the repo root (".claude/worktrees" nests
#       them inside the repo; "../wts" a custom sibling).
#   an ABSOLUTE path is used as-is.
root = ""`;

async function removeClaudeLocalSettingsGitignoreException(
  ctx: MigrationContext,
): Promise<void> {
  const existing = await ctx.readText(".gitignore");
  if (existing === undefined) {
    return;
  }
  const lines = existing.split("\n");
  const filtered = lines.filter((line) =>
    !/^\s*!\/?\.claude\/settings\.local\.json\s*$/.test(line)
  );
  if (filtered.length === lines.length) {
    return;
  }
  await ctx.writeText(".gitignore", filtered.join("\n"));
  ctx.note(
    "kept .claude/settings.local.json ignored as machine-local settings",
  );
}

/** Render a live `[worktree.resources.<name>]` table (only the non-empty keys). */
function liveResourceBlock(
  name: string,
  create: string,
  destroy: string,
): string {
  const lines = [`[worktree.resources.${name}]`];
  if (create !== "") {
    lines.push(`create  = ${tomlString(create)}`);
  }
  if (destroy !== "") {
    lines.push(`destroy = ${tomlString(destroy)}`);
  }
  return lines.join("\n");
}

async function migrateLegacyWorktreeResources(
  ctx: MigrationContext,
): Promise<void> {
  const text = await ctx.readConfig();
  if (text === undefined) {
    return; // no config to evolve.
  }
  let raw: Record<string, unknown>;
  try {
    raw = parseDiscernToml(text).raw;
  } catch {
    return; // unparseable — upgrade validates the config before stamping.
  }
  const worktree = isRecord(raw.worktree) ? raw.worktree : {};
  const legacyDb = isRecord(worktree.db) ? worktree.db : undefined;
  const legacyDev = isRecord(worktree.dev_server)
    ? worktree.dev_server
    : undefined;
  // Idempotency: the legacy shape is exactly the presence of these tables; the
  // final rewrite removes both, so a re-run (or an already-new config) returns.
  if (legacyDb === undefined && legacyDev === undefined) {
    return;
  }
  const resources = isRecord(worktree.resources) ? worktree.resources : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const dbCreate = str(legacyDb?.clone);
  const dbDestroy = str(legacyDb?.drop);
  const devCreate = str(legacyDev?.link);
  const devDestroy = str(legacyDev?.unlink);

  // Convert a legacy table to a live resource only when its command is non-empty
  // and a hand-added resource of that name does not already exist.
  const blocks: string[] = [];
  const converted: string[] = [];
  if (resources.db === undefined && (dbCreate !== "" || dbDestroy !== "")) {
    blocks.push(liveResourceBlock("db", dbCreate, dbDestroy));
    converted.push("db");
  }
  if (
    resources.dev_server === undefined &&
    (devCreate !== "" || devDestroy !== "")
  ) {
    blocks.push(liveResourceBlock("dev_server", devCreate, devDestroy));
    converted.push("dev_server");
  }
  const insertBlock = blocks.length > 0
    ? blocks.join("\n\n")
    : (Object.keys(resources).length > 0 ? "" : COMMENTED_RESOURCES_BLOCK);

  await ctx.rewrite("discern.toml", (t) => {
    let out = removeTableBlock(t, "[worktree.db]");
    out = removeTableBlock(out, "[worktree.dev_server]");
    if (insertBlock !== "") {
      out = insertAfterWorktreeBase(out, insertBlock);
    }
    return out.replace(/\n{3,}/g, "\n\n");
  });

  if (converted.length > 0) {
    ctx.note(
      `converted ${
        converted.map((n) => `[worktree.${n}]`).join(" + ")
      } → [worktree.resources.*] (any inline comments on the old keys were not carried)`,
    );
  } else {
    ctx.note(
      "removed the empty [worktree.db]/[worktree.dev_server]; added commented [worktree.resources.*] examples",
    );
  }
}

/**
 * Remove a config table — its `[header]`, its key/value body (up to
 * the first blank, comment, or next header), the contiguous comment paragraph that
 * directly precedes it (its OWN doc comment), and one trailing blank separator.
 * Unlike `TomlEditor.deleteSection` (greedy to the next header), this stops at the
 * blank/comment boundary, so the FOLLOWING section keeps its own doc comment. A
 * no-op when the header is absent.
 */
function removeTableBlock(text: string, header: string): string {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim() === header);
  if (idx === -1) {
    return text;
  }
  let end = idx + 1;
  while (end < lines.length) {
    const t = (lines[end] ?? "").trim();
    if (t === "" || t.startsWith("#") || t.startsWith("[")) {
      break;
    }
    end++;
  }
  let start = idx;
  while (start - 1 >= 0 && (lines[start - 1] ?? "").trim().startsWith("#")) {
    start--;
  }
  if (end < lines.length && (lines[end] ?? "").trim() === "") {
    end++; // consume the one blank line that separated the table
  }
  lines.splice(start, end - start);
  return lines.join("\n");
}

/**
 * Insert `block` right after the LAST scalar key of the `[worktree]` table (its
 * keys are interspersed with doc comments, so this scans the whole table body up
 * to the first subsection/next-section header), separated by blank lines — where
 * the legacy db/dev_server tables sat, before `[worktree.setup]`. Appends at EOF
 * when there is no `[worktree]` table.
 */
function insertAfterWorktreeBase(text: string, block: string): string {
  const lines = text.split("\n");
  const hdr = lines.findIndex((l) => l.trim() === "[worktree]");
  if (hdr === -1) {
    return `${text.replace(/\n+$/, "")}\n\n${block}\n`;
  }
  // The [worktree] table body runs to the next header (subsection or top-level).
  let bodyEnd = hdr + 1;
  while (
    bodyEnd < lines.length && !(lines[bodyEnd] ?? "").trim().startsWith("[")
  ) {
    bodyEnd++;
  }
  // Insert after the last `key = value` line (skipping comments/blanks).
  let insertAt = hdr + 1;
  for (let i = hdr + 1; i < bodyEnd; i++) {
    const t = (lines[i] ?? "").trim();
    if (t !== "" && !t.startsWith("#")) {
      insertAt = i + 1;
    }
  }
  lines.splice(insertAt, 0, "", ...block.split("\n"));
  return lines.join("\n");
}

/** The commented `[worktree.resources.*]` examples a fresh init / migration lays
 * down — db and dev_server demoted to examples, plus a generic resource. Kept in
 * sync with the `[worktree]` region of templates/discern.toml.tmpl. */
const COMMENTED_RESOURCES_BLOCK =
  `# A per-worktree database, so tests never clash. Uses @db@ (db-name-safe).
# [worktree.resources.db]
# create  = "createdb -T @project_slug@_template @db@"
# destroy = "dropdb --if-exists @db@"

# A per-worktree dev-server site (a Docker vhost, an ngrok tunnel, a reverse-proxy
# entry, …). Uses @site@ (DNS-safe). Declared after db so it is torn down first.
# [worktree.resources.dev_server]
# create  = "link-site @site@ @port@"
# destroy = "unlink-site @site@"

# Any other isolated resource — an emulator, a queue, a bucket, a namespace.
# [worktree.resources.example]
# create   = "make-thing @resource@"
# destroy  = "destroy-thing @resource@"   # idempotent: may re-run via worktree prune
# ensure   = "ensure-thing @resource@"   # optional: reconcile drift at session start
# required = true                          # optional: false = create failure is non-fatal
# retries  = 0                             # optional: retry create/destroy N times
# gc       = true                          # optional: false = never orphan-prune it
#                                          #   (teardown-only; for data-loss-sensitive ones)`;

/**
 * Whether the install's `.discern/skills/<name>` is byte-identical to the bundled
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
  const installed = join(destDir, ".discern/skills", name);
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
 * Rewrite `.gitignore` for the schema-6 layout: remove any `.discern/`-pointed
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
    // Drop dead `.discern` ignore RULES and any (mistaken) AGENTS.md ignore, but
    // keep comments and blanks intact (a rule line is non-blank, non-`#`).
    .filter((l) => {
      const t = l.trim();
      if (t === "" || t.startsWith("#")) {
        return true;
      }
      return !/\.discern/.test(l) && !/^\/?AGENTS\.md$/.test(t);
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
    text = `${base}\n\n# discern: generated/ephemeral artifacts\n${
      additions.join("\n")
    }\n`;
  }
  if (text !== existing) {
    await ctx.writeText(".gitignore", text);
    ctx.note("updated .gitignore for the schema-6 layout");
  }
}

/**
 * Add `/AGENTS.md` to `.gitignore` so the compiled agent file joins `/CLAUDE.md`
 * and `/GEMINI.md` as an untracked build artifact (ADR 0034). The schema-6 step
 * deliberately KEPT `AGENTS.md` tracked; this reverses that now that the currency
 * check guards drift and the reviewable unit is the source.
 *
 * A `.gitignore` entry alone does not drop an already-committed file from the
 * index, so the step also NOTES the one-time `git rm --cached AGENTS.md` for the
 * user to run — untracking is a deliberate, committed history change, not
 * something an upgrade should stage silently. Idempotent: a no-op when AGENTS.md
 * is already ignored, and when there is no `.gitignore` to amend.
 */
async function ignoreAgentsMd(ctx: MigrationContext): Promise<void> {
  const existing = await ctx.readText(".gitignore");
  if (existing === undefined) {
    return; // no .gitignore to amend (init always seeds one) — nothing to do.
  }
  if (/^\s*\/?AGENTS\.md\b/m.test(existing)) {
    return; // already ignored — idempotent no-op.
  }
  const lines = existing.split("\n");
  // Group it with the other compiled mirrors: insert just before the first
  // /CLAUDE.md (or /GEMINI.md) rule. Failing that, append under a discern note.
  const at = lines.findIndex((l) =>
    /^\s*\/?CLAUDE\.md\b/.test(l) || /^\s*\/?GEMINI\.md\b/.test(l)
  );
  let text: string;
  if (at !== -1) {
    lines.splice(at, 0, "/AGENTS.md");
    text = lines.join("\n");
  } else {
    const base = existing.replace(/\n+$/, "");
    text =
      `${base}\n\n# discern: the compiled agent file is a build artifact\n/AGENTS.md\n`;
  }
  await ctx.writeText(".gitignore", text);
  ctx.note(
    "ignored AGENTS.md (now a generated build artifact). Run `git rm --cached AGENTS.md` once to stop tracking it, then commit.",
  );
}

/**
 * Add `/.agents/skills/` to `.gitignore`. Skills now materialize into each agent's
 * skills dir; for Codex and Gemini that is the cross-tool `.agents/skills/` standard
 * (Codex's repo path, Gemini's preferred alias). The generated dir joins
 * `.claude/skills/` as an untracked build artifact. Idempotent: a no-op when already
 * ignored, and when there is no `.gitignore` to amend.
 */
async function ignoreAgentsSkills(ctx: MigrationContext): Promise<void> {
  const existing = await ctx.readText(".gitignore");
  if (existing === undefined) {
    return; // no .gitignore to amend (init always seeds one) — nothing to do.
  }
  if (/^\s*\/?\.agents\/skills\b/m.test(existing)) {
    return; // already ignored — idempotent no-op.
  }
  const lines = existing.split("\n");
  // Group it with the .claude/* materialized-skills ignore: insert after the
  // `/.claude/*` rule and its `!`-exception lines. Failing that, append under a note.
  let at = lines.findIndex((l) => /^\s*\/?\.claude\/\*/.test(l));
  let text: string;
  if (at !== -1) {
    at++;
    while (at < lines.length && /^\s*!/.test(lines[at] ?? "")) {
      at++; // step past the !/.claude/settings… exceptions
    }
    lines.splice(at, 0, "/.agents/skills/");
    text = lines.join("\n");
  } else {
    const base = existing.replace(/\n+$/, "");
    text =
      `${base}\n\n# discern: skills materialized for Codex/Gemini (the cross-tool .agents/skills/ standard)\n/.agents/skills/\n`;
  }
  await ctx.writeText(".gitignore", text);
  ctx.note(
    "ignored .agents/skills/ (skills now materialize there for Codex/Gemini).",
  );
}

/** Build the context a migration uses to transform the install at `destDir`. */
export function createMigrationContext(
  destDir: string,
  onNote: (message: string) => void = () => {},
  env: EnvReader = Deno.env,
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
  // `.discern/config.toml` if present, else a legacy root `discern.toml`. Resolved
  // per call so a step that renames the config is seen by any later step.
  async function configRel(): Promise<string> {
    return (await exists(".discern/config.toml"))
      ? ".discern/config.toml"
      : "discern.toml";
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
    env,
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
  /** Env reader threaded to the migration context (defaults to `Deno.env`);
   * a test injects a fake instead of mutating the process env. */
  env?: EnvReader | undefined;
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

  const ctx = createMigrationContext(destDir, params.onNote, params.env);
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
