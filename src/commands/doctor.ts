/**
 * `discern doctor` — verify the install. Every check returns an actionable
 * diagnostic: not just pass/fail, but the exact fix when something is wrong.
 *
 * With the engine in the binary (no committed shell engine, no `agent`
 * dispatcher, no manifest) the checks are in-process and few: the config parses,
 * the recorded schema is current, and the capabilities resolve through the
 * engine's own config reader.
 */

import { join } from "@std/path";
import {
  resolveConfigPath,
  resolveGuidanceSources,
  resolveRecipesDir,
  resolveSkillsDir,
} from "../lib/paths.ts";
import { CONFIG_REL } from "../shared/env.ts";
import { Logger } from "../lib/log.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { resolveRecordedSchema } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { Config } from "../shared/config_read.ts";
import {
  enabledFeatures,
  FEATURES,
  isFeatureEnabled,
} from "../shared/features.ts";
import { capStage, isKnownCapability } from "../shared/capabilities.ts";

/** Options accepted by the `doctor` command. */
export interface DoctorOptions {
  json: boolean;
  noColor: boolean;
}

/** One diagnostic result. */
export interface Check {
  name: string;
  ok: boolean;
  /** What was found (always set). */
  detail: string;
  /** The exact remedy, set when `ok` is false (or for an advisory `warn`). */
  fix?: string;
  /** An advisory: rendered as a warning, but does NOT make doctor unhealthy. */
  warn?: boolean;
}

/** The first whitespace-delimited word of a command, or undefined for an empty
 * command or the `:` no-op. */
function firstWord(command: string): string | undefined {
  const word = command.trim().split(/\s+/)[0];
  return word === undefined || word === "" || word === ":" ? undefined : word;
}

/** Whether a regular file exists at `path`. */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Whether `word` resolves as a command (on PATH, a shell builtin, or a path). */
async function commandResolves(word: string): Promise<boolean> {
  try {
    const out = await new Deno.Command("sh", {
      args: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", word],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

/** Run the installer-level checks against `destDir`. */
export async function runChecks(destDir: string): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. the config (discern.toml, or a legacy .discern/config.toml) exists and parses.
  const tomlPath = (await resolveConfigPath(destDir)) ??
    join(destDir, CONFIG_REL);
  let toml: ReturnType<typeof parseDiscernToml> | undefined;
  let tomlText: string | undefined;
  try {
    tomlText = await Deno.readTextFile(tomlPath);
    toml = parseDiscernToml(tomlText);
    checks.push({
      name: "discern.toml",
      ok: true,
      detail: "present and valid TOML",
    });
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    checks.push({
      name: "discern.toml",
      ok: false,
      detail: isMissing
        ? "not found in this directory"
        : `invalid: ${error instanceof Error ? error.message : String(error)}`,
      fix: isMissing
        ? "run `discern init` to scaffold the harness here"
        : "fix the TOML syntax in discern.toml",
    });
    // Without a parseable config the remaining checks have nothing to read.
    return checks;
  }

  // 2. schema currency — the recorded `[meta].schema_version` matches this build.
  const recorded = await resolveRecordedSchema(toml.raw, destDir);
  if (recorded === SCHEMA_VERSION) {
    checks.push({
      name: "schema version",
      ok: true,
      detail: `schema ${SCHEMA_VERSION} (current)`,
    });
  } else {
    checks.push({
      name: "schema version",
      ok: false,
      detail:
        `install schema v${recorded}, this build expects v${SCHEMA_VERSION}`,
      fix: "run `discern upgrade` to migrate the install",
    });
  }

  // 3. capabilities resolve — the engine's own reader parses the config and the
  // declared [capabilities] are all in the known vocabulary.
  try {
    const cfg = new Config(tomlText);
    const declared = cfg.keys("capabilities");
    const unknown = declared.filter((k) => !isKnownCapability(k));
    if (unknown.length === 0) {
      checks.push({
        name: "capabilities",
        ok: true,
        detail: declared.length === 0
          ? "none wired yet (gate passes without checking)"
          : `wired: ${declared.join(", ")}`,
      });
    } else {
      checks.push({
        name: "capabilities",
        ok: false,
        detail: `unknown capability key(s): ${unknown.join(", ")}`,
        fix:
          "rename to a known capability (format, build, lint, typecheck, test) or move it under [checks]",
      });
    }
  } catch (error) {
    checks.push({
      name: "capabilities",
      ok: false,
      detail: `could not read capabilities: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: "fix the [capabilities] table in discern.toml",
    });
  }

  // 4. capability/check commands resolve — the first word of each declared
  // command is on PATH, so the gate will not die with "command not found".
  try {
    const cfg = new Config(tomlText);
    const commands: { label: string; word: string }[] = [];
    for (const cap of cfg.keys("capabilities")) {
      if (!isKnownCapability(cap)) {
        continue;
      }
      for (const c of cfg.array(`capabilities.${cap}`)) {
        const word = firstWord(c);
        if (word !== undefined) {
          commands.push({ label: cap, word });
        }
      }
    }
    for (const chk of cfg.subsections("checks")) {
      for (const c of cfg.array(`checks.${chk}.run`)) {
        const word = firstWord(c);
        if (word !== undefined) {
          commands.push({ label: chk, word });
        }
      }
    }
    const missing: string[] = [];
    for (const { label, word } of commands) {
      if (!(await commandResolves(word))) {
        missing.push(`${label} → ${word}`);
      }
    }
    if (missing.length === 0) {
      checks.push({
        name: "capability commands",
        ok: true,
        detail: commands.length === 0 ? "none to check" : "all resolve on PATH",
      });
    } else {
      checks.push({
        name: "capability commands",
        ok: false,
        detail: `command not found: ${missing.join(", ")}`,
        fix: "install the tool, or fix the command in [capabilities]/[checks]",
      });
    }
  } catch {
    // The capabilities check above already reported any config read failure.
  }

  // 5. recipe contract — no project recipe still sources the retired shell
  // library. The pre-binary engine exported `DISCERN_LIB`, and a recipe could
  // `. "$DISCERN_LIB/bootstrap.sh"` for config/output helpers. That library is
  // gone (the engine is in the binary), so such a recipe now breaks at runtime;
  // flag it and point at the new contract. README.md is documentation, not a
  // recipe, so it is skipped.
  try {
    const cfg = new Config(tomlText);
    const { abs: recipesDir } = resolveRecipesDir(destDir, cfg);
    const offenders: string[] = [];
    let scanned = 0;
    try {
      for await (const entry of Deno.readDir(recipesDir)) {
        if (!entry.isFile || entry.name === "README.md") {
          continue;
        }
        scanned++;
        const body = await Deno.readTextFile(join(recipesDir, entry.name));
        if (body.includes("DISCERN_LIB") || body.includes("bootstrap.sh")) {
          offenders.push(entry.name);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // No recipes directory — nothing to check.
    }
    if (offenders.length === 0) {
      checks.push({
        name: "recipe contract",
        ok: true,
        detail: scanned === 0
          ? "no project recipes to check"
          : `${scanned} recipe(s); none source the retired shell library`,
      });
    } else {
      checks.push({
        name: "recipe contract",
        ok: false,
        detail: `recipe(s) source the removed shell library: ${
          offenders.join(", ")
        }`,
        fix:
          "recipes are standalone executables now — read config with `discern config get` instead of sourcing the retired `$DISCERN_LIB` shell library",
      });
    }
  } catch {
    // A config read failure was already reported by an earlier check.
  }

  // 6. `sh` resolves — the job runner and the recipe fallthrough both exec via
  // `sh -c`, so a missing `sh` would break the gate and every project recipe.
  if (await commandResolves("sh")) {
    checks.push({ name: "sh", ok: true, detail: "present on PATH" });
  } else {
    checks.push({
      name: "sh",
      ok: false,
      detail: "`sh` is not on PATH",
      fix:
        "install a POSIX shell — the gate and project recipes run commands via `sh -c`",
    });
  }

  // 7. guidance/skills config resolves — if [guidance].sources or [skills].dir is
  // configured, report what it resolves to. Both are present-only (an absent
  // match/dir is fine), so this is informational: it surfaces a typo'd path
  // before the user wonders why their guidance/skills aren't picked up.
  try {
    const cfg = new Config(tomlText);
    if (isFeatureEnabled(cfg, "guidance")) {
      const sources = await resolveGuidanceSources(destDir, cfg);
      checks.push({
        name: "guidance sources",
        ok: true,
        detail: sources.length === 0
          ? "no source files match [guidance].sources yet (built-in guidance still compiles)"
          : `${sources.length} source file(s) resolve`,
      });
    }
    if (isFeatureEnabled(cfg, "skills")) {
      const { rel, abs } = resolveSkillsDir(destDir, cfg);
      let authored = 0;
      try {
        for await (const e of Deno.readDir(abs)) {
          if (e.isDirectory) authored++;
        }
      } catch { /* absent dir — fine, built-ins still apply */ }
      checks.push({
        name: "skills",
        ok: true,
        detail: authored === 0
          ? `no authored skills in ${rel}/ yet (built-ins still apply)`
          : `${authored} authored skill(s) in ${rel}/`,
      });
    }
  } catch {
    // a config read failure was already reported above.
  }

  // 8. features — surface the [features] toggle state, so a user can SEE which
  // subsystems are on without inferring it from missing `--help` verbs.
  try {
    const cfg = new Config(tomlText);
    const on = new Set(enabledFeatures(cfg));
    const off = FEATURES.filter((f) => !on.has(f));
    checks.push({
      name: "features",
      ok: true,
      detail: off.length === 0
        ? "all on (worktrees, ratchets, guidance, skills, docs)"
        : `on: ${[...on].join(", ") || "none"}; off: ${off.join(", ")}`,
    });
  } catch {
    // a config read failure was already reported above.
  }

  // 9. gotchas doc resolves — if [project].gotchas_doc is set, the file the gate
  // points a failing agent at must exist (a 5→6 migration of a `.discern/`-pointed
  // doc, or a typo, can leave it dangling).
  try {
    const cfg = new Config(tomlText);
    const doc = cfg.get("project.gotchas_doc", "").trim();
    if (doc !== "") {
      const abs = doc.startsWith("/") ? doc : join(destDir, doc);
      const exists = await fileExists(abs);
      checks.push(
        exists
          ? { name: "gotchas doc", ok: true, detail: `${doc} resolves` }
          : {
            name: "gotchas doc",
            ok: false,
            detail:
              `[project].gotchas_doc points at "${doc}", which does not exist`,
            fix:
              "point [project].gotchas_doc at an existing file, or clear it (empty disables the pointer)",
          },
      );
    }
  } catch {
    // a config read failure was already reported above.
  }

  // 10. worktree-automation layering (advisory). If .claude/settings.json carries
  // a worktree-lifecycle hook whose command does not invoke the harness CLI, a
  // different tool also automates worktrees here and would double setup/teardown.
  // Advisory only (a warn, still healthy): the install is fine, but the operator
  // should reconcile the hooks. "Ours" = the command calls `discern` (an install)
  // or `deno task dev` (this repo self-hosting from source). Skipped when the
  // worktrees feature is off (the hooks are inert / not discern's concern).
  let worktreesOn = true;
  try {
    worktreesOn = isFeatureEnabled(new Config(tomlText), "worktrees");
  } catch { /* reported above */ }
  if (worktreesOn) {
    try {
      const raw = await Deno.readTextFile(
        join(destDir, ".claude/settings.json"),
      );
      const settings = JSON.parse(raw) as {
        hooks?: Record<
          string,
          Array<{ hooks?: Array<{ command?: unknown }> }> | undefined
        >;
      };
      const groups = settings.hooks ?? {};
      const foreign = [
        ...(groups.WorktreeCreate ?? []),
        ...(groups.WorktreeRemove ?? []),
        ...(groups.SessionStart ?? []),
      ]
        .flatMap((g) => g.hooks ?? [])
        .map((h) => (typeof h.command === "string" ? h.command : ""))
        .filter((c) => /worktree/i.test(c))
        .filter((c) => !c.includes("discern") && !c.includes("deno task dev"));
      if (foreign.length > 0) {
        checks.push({
          name: "worktree automation",
          ok: true,
          warn: true,
          detail:
            "another tool also automates worktrees in .claude/settings.json (a worktree hook does not call `discern`)",
          fix:
            "reconcile the hooks by hand so worktree setup/teardown isn't doubled",
        });
      }
    } catch {
      // No settings.json, a malformed one, or unreadable: this advisory is
      // best-effort, so skip it silently (install validity is checked above).
    }
  }

  // 11. capability-shaped checks (advisory). The symmetric counterpart to check
  // 3 (which flags a capability key that belongs in [checks]): a [checks.<name>]
  // whose name IS a standard capability and whose stage is that capability's
  // canonical stage is almost certainly meant to be a [capabilities] entry —
  // which doctor reports and `discern bootstrap` fills, and a check does not. Nudge toward
  // the free capability slot. Advisory only (still healthy): a custom-named check
  // with a standard stage is legitimate when the label is the point.
  try {
    const cfg = new Config(tomlText);
    const wired = new Set(cfg.keys("capabilities").filter(isKnownCapability));
    const misfiled = cfg.subsections("checks").filter((chk) =>
      isKnownCapability(chk) && !wired.has(chk) &&
      cfg.get(`checks.${chk}.stage`, "") === capStage(chk)
    );
    if (misfiled.length > 0) {
      checks.push({
        name: "capability-shaped checks",
        ok: true,
        warn: true,
        detail: `${
          misfiled.map((c) => `[checks.${c}]`).join(", ")
        } match a standard capability at its canonical stage`,
        fix: `wire as a capability instead (e.g. [capabilities].${
          misfiled[0]
        } = "…"), so doctor reports it and \`discern bootstrap\` can fill it — unless the [checks.${
          misfiled[0]
        }] name is deliberate`,
      });
    }
  } catch {
    // a config read failure was already reported above.
  }

  // 12. dead worktree adapters (hard fail). The engine reads only
  // [worktree.resources.<name>] now; a leftover [worktree.db]/[worktree.dev_server]
  // is dead config — and dangerously SILENT (setup would succeed with no database).
  // The schema check above catches an un-upgraded install, but a hand-maintained
  // config that never bumped its version would pass that, so flag the tables
  // directly.
  try {
    const cfg = new Config(tomlText);
    const dead = ["worktree.db", "worktree.dev_server"].filter((t) =>
      cfg.has(t)
    );
    if (dead.length > 0) {
      checks.push({
        name: "worktree resources",
        ok: false,
        detail: `dead config: [${
          dead.join("] / [")
        }] — the engine now reads [worktree.resources.<name>]`,
        fix:
          "run `discern upgrade`, or move clone/drop→[worktree.resources.db].create/destroy and link/unlink→[worktree.resources.dev_server].create/destroy by hand, then delete the legacy tables",
      });
    }
  } catch {
    // a config read failure was already reported above.
  }

  // 13. worktree-resource commands resolve (advisory). The first word of each
  // declared create/destroy/ensure should be on PATH, so a worktree round won't
  // die with "command not found".
  try {
    const cfg = new Config(tomlText);
    const missing: string[] = [];
    for (const name of cfg.subsections("worktree.resources")) {
      for (const verb of ["create", "destroy", "ensure"]) {
        const word = firstWord(
          cfg.get(`worktree.resources.${name}.${verb}`, ""),
        );
        if (word !== undefined && !(await commandResolves(word))) {
          missing.push(`${name}.${verb} → ${word}`);
        }
      }
    }
    if (missing.length > 0) {
      checks.push({
        name: "worktree resource commands",
        ok: true,
        warn: true,
        detail: `command not found: ${missing.join(", ")}`,
        fix:
          "install the tool, or fix the command in [worktree.resources.<name>]",
      });
    }
  } catch {
    // a config read failure was already reported above.
  }

  return checks;
}

/** Run `discern doctor`. Returns a process exit code (0 = healthy). */
export async function runDoctor(options: DoctorOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  const checks = await runChecks(destDir);
  const healthy = checks.every((c) => c.ok);

  if (options.json) {
    log.jsonResult({
      ok: healthy,
      kit_version: KIT_VERSION,
      checks,
    });
    return healthy ? 0 : 1;
  }

  log.heading("discern doctor");
  for (const check of checks) {
    if (check.warn) {
      log.warn(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    } else if (check.ok) {
      log.ok(`${check.name}: ${check.detail}`);
    } else {
      log.error(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    }
  }
  log.line();
  if (healthy) {
    const advisories = checks.filter((c) => c.warn).length;
    log.ok(
      advisories > 0
        ? "All checks passed (see the advisory above)."
        : "All checks passed.",
    );
  } else {
    log.error("Some checks failed — see the fixes above.");
  }
  return healthy ? 0 : 1;
}
