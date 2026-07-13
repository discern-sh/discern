/**
 * The kit version — single source of truth.
 *
 * The version lives in `deno.json` (the package version). Importing it as a
 * JSON module means `deno compile` bundles the literal into the binary, so the
 * compiled installer reports the right version with no filesystem lookup. Every
 * `{{kit_version}}` substitution and the `--version` flag read it from here.
 */

import denoJson from "../../deno.json" with { type: "json" };

/** The current kit version, e.g. "1.0.0". */
export const KIT_VERSION: string = denoJson.version;

/**
 * The one honest way to get a newer discern binary, cited verbatim by every
 * surface that mentions updating it. discern makes no network requests — no
 * update polling, no telemetry, no auto-updater — so a newer binary is always a
 * step the user takes themselves: re-run the install script from the project
 * README (each build is published on the repository's releases page). Guarded
 * by test: no shipped string may invent a channel (a package manager, an
 * auto-updater) this constant doesn't name.
 */
export const UPDATE_CHANNEL =
  "re-run the install script from the README at https://github.com/jackwh/discern";

/**
 * The install **schema version** — the anchor the migration system steps from
 * (ADR 0014). Distinct from `KIT_VERSION` on purpose: `KIT_VERSION` is the
 * package's semver for display, while this is a plain monotonic integer that
 * bumps *only* when an installed project needs a migration to stay correct.
 * `setup` stamps the current value into the config (`[meta].schema_version`);
 * `upgrade` reads the recorded value, brings the install forward, and re-stamps.
 * Most releases need no migration and leave this untouched.
 *
 * The current shape is schema **20**. The chain: schema-1→2 backfills
 * `[project].main_branch`; schema-2→3 consolidates the install surface under
 * `.discern/` (config + guidance seeds); schema-3→4 converts
 * `[slots]`→`[capabilities]`/`[checks]`, inlines ratchet runs, folds side-gates
 * into `[scopes.<name>].gate`, and drops `[evidence]` (ADR 0017/0018);
 * schema-4→5 prunes the pre-existing on-disk engine tree (`.discern/engine/`,
 * the root `agent`, `.discern/manifest.json`) a schema-4 install carried;
 * schema-5→6 **dissolves `.discern/`** into the single-file
 * footprint — config to a root `discern.toml`, guidance/recipes/authored-skills
 * moved out, bundled skills pruned, `[features]`/`[guidance]`/`[skills]` sections
 * added (ADR 0020); schema-6→7 moves one-time setup instructions out of a materialized skill into the
 * `discern setup` command — it prunes the stale legacy materialized setup-skill copy and back-fills `[meta].bootstrapped = true` for an already-configured
 * install so the new setup reminder never nags it (ADR 0024); schema-7 to 8
 * generalizes the hard-coded `[worktree.db]`/`[worktree.dev_server]` adapters into
 * the generic `[worktree.resources.<name>]` seam — it carries non-empty
 * clone/drop and link/unlink forward as create/destroy, deletes the legacy tables,
 * and adds the commented resource examples (ADR 0025); schema-8→9 **untracks the
 * generated `AGENTS.md`** — it adds `/AGENTS.md` to `.gitignore` so the compiled
 * agent file joins `CLAUDE.md`/`GEMINI.md` as a build artifact, and notes the
 * one-time `git rm --cached AGENTS.md` (ADR 0034); schema-9→10 ignores
 * `/.agents/skills/`, the cross-tool dir skills now materialize into for
 * Codex/Gemini (ADR 0042); schema-10→11 drops `[features].mcp` — the MCP server
 * is core infrastructure now, not a toggle (ADR 0045); schema-11→12 renames the
 * `[worktree].graduate_to` value `"main"` → `"trunk"` so the landing role is
 * branch-name-agnostic rather than reading as a branch literally named main
 * (ADR 0048); schema-12→13 adds the documented `[worktree].root` key — empty ⇒ a
 * sibling of the repo (`<repo>.worktrees`), a relative/absolute path overrides —
 * so worktrees adopt the non-nested placement instead of `.claude/worktrees`
 * (ADR 0052); schema-13→14 removes the `.claude/settings.local.json` gitignore
 * exception so machine-local provider settings remain ignored (ADR 0089);
 * schema-14→15 **consolidates the authored surface under the visible
 * `discern/` namespace** — each source path whose key is not pointed away from
 * its legacy root default (the guidance seed, the map tree, authored skills,
 * recipes, the deferred-work ledger, the brief) moves to its `discern/`
 * default from the paths registry, with pointed paths untouched (ADR
 * 0099/0102); schema-15→16 **retires the `[features]` toggles** and the
 * duplicate `[worktree].enabled` key — every subsystem is core, discarded
 * non-default preferences are named in the notes, and a `features.skills =
 * false` becomes an authored `[skills].exclude` covering the bundled set (ADR
 * 0101); schema-16→17 **drops `[worktree].graduate_to`** — `discern accept`
 * always lands on the trunk (the landing model's single push target; composing
 * work below the trunk happens on the pull axis, `start --from` /
 * `update --from` — ADR 0110); schema-17→18 renames the `[ratchets]` quality-
 * metric table to `[standards]`; schema-18→19 renames `[docs]` to `[map]` and
 * pins the installed tree's current directory (ADR 0120); schema-19→20 renames
 * Project Recipes to Project Scripts, moves the previous default directory, and
 * preserves custom or colliding directory layouts (ADR 0137). See `MIGRATIONS`. A config with no
 * `[meta].schema_version` is read as schema 1 (or a legacy manifest's recorded
 * version), then migrated forward.
 */
export const SCHEMA_VERSION = 20;
