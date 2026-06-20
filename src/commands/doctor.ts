/**
 * `icculus doctor` — verify the install. Every check returns an actionable
 * diagnostic: not just pass/fail, but the exact fix when something is wrong.
 *
 * With the engine in the binary (no committed shell engine, no `agent`
 * dispatcher, no manifest) the checks are in-process and few: the config parses,
 * the recorded schema is current, and the capabilities resolve through the
 * engine's own config reader.
 */

import { join } from "@std/path";
import { resolveConfigPath } from "../lib/paths.ts";
import { Logger } from "../lib/log.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { resolveRecordedSchema } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { Config } from "../shared/config_read.ts";
import { isKnownCapability } from "../shared/capabilities.ts";

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

  // 1. the config (.icculus/config.toml, or a legacy icculus.toml) exists and parses.
  const tomlPath = (await resolveConfigPath(destDir)) ??
    join(destDir, ".icculus/config.toml");
  let toml: ReturnType<typeof parseIcculusToml> | undefined;
  let tomlText: string | undefined;
  try {
    tomlText = await Deno.readTextFile(tomlPath);
    toml = parseIcculusToml(tomlText);
    checks.push({
      name: ".icculus/config.toml",
      ok: true,
      detail: "present and valid TOML",
    });
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    checks.push({
      name: ".icculus/config.toml",
      ok: false,
      detail: isMissing
        ? "not found in this directory"
        : `invalid: ${error instanceof Error ? error.message : String(error)}`,
      fix: isMissing
        ? "run `icculus init` to scaffold the harness here"
        : "fix the TOML syntax in .icculus/config.toml",
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
      fix: "run `icculus upgrade` to migrate the install",
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
      fix: "fix the [capabilities] table in .icculus/config.toml",
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
  // library. The pre-binary engine exported `ICCULUS_LIB`, and a recipe could
  // `. "$ICCULUS_LIB/bootstrap.sh"` for config/output helpers. That library is
  // gone (the engine is in the binary), so such a recipe now breaks at runtime;
  // flag it and point at the new contract. README.md is documentation, not a
  // recipe, so it is skipped.
  try {
    const cfg = new Config(tomlText);
    const recipesDir = join(
      destDir,
      cfg.get("recipes.dir", ".icculus/recipes"),
    );
    const offenders: string[] = [];
    let scanned = 0;
    try {
      for await (const entry of Deno.readDir(recipesDir)) {
        if (!entry.isFile || entry.name === "README.md") {
          continue;
        }
        scanned++;
        const body = await Deno.readTextFile(join(recipesDir, entry.name));
        if (body.includes("ICCULUS_LIB") || body.includes("bootstrap.sh")) {
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
          "recipes are standalone executables now — read config with `icculus config get` instead of sourcing `$ICCULUS_LIB/bootstrap.sh` (see .icculus/recipes/README.md)",
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

  // 7. worktree-automation layering (advisory). If .claude/settings.json carries
  // a worktree-lifecycle hook whose command does not invoke the harness CLI, a
  // different tool also automates worktrees here and would double setup/teardown.
  // Advisory only (a warn, still healthy): the install is fine, but the operator
  // should reconcile the hooks. "Ours" = the command calls `icculus` (an install)
  // or `deno task dev` (this repo self-hosting from source).
  try {
    const raw = await Deno.readTextFile(join(destDir, ".claude/settings.json"));
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
      .filter((c) => !c.includes("icculus") && !c.includes("deno task dev"));
    if (foreign.length > 0) {
      checks.push({
        name: "worktree automation",
        ok: true,
        warn: true,
        detail:
          "another tool also automates worktrees in .claude/settings.json (a worktree hook does not call `icculus`)",
        fix:
          "reconcile the hooks by hand so worktree setup/teardown isn't doubled",
      });
    }
  } catch {
    // No settings.json, a malformed one, or unreadable: this advisory is
    // best-effort, so skip it silently (install validity is checked above).
  }

  return checks;
}

/** Run `icculus doctor`. Returns a process exit code (0 = healthy). */
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

  log.heading("icculus doctor");
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
