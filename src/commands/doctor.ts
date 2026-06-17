/**
 * `icculus doctor` — verify the install and, if the harness is present, fold in
 * its own `bin/agent doctor`. Every check returns an actionable diagnostic: not
 * just pass/fail, but the exact fix when something is wrong.
 */

import { join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { selfCmd } from "../lib/invocation.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { parseManifest } from "../lib/manifest.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";

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
  /** The exact remedy, set when `ok` is false. */
  fix?: string;
}

/** Stat a path, returning its info or undefined if absent. */
async function statOrUndefined(
  path: string,
): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.stat(path);
  } catch {
    return undefined;
  }
}

/** True when a file's mode has any execute bit set. */
function isExecutable(info: Deno.FileInfo): boolean {
  return ((info.mode ?? 0) & 0o111) !== 0;
}

/** Run the installer-level checks against `destDir`. */
export async function runChecks(destDir: string): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. icculus.toml exists and parses.
  const tomlPath = join(destDir, "icculus.toml");
  try {
    const text = await Deno.readTextFile(tomlPath);
    parseIcculusToml(text);
    checks.push({
      name: "icculus.toml",
      ok: true,
      detail: "present and valid TOML",
    });
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    checks.push({
      name: "icculus.toml",
      ok: false,
      detail: isMissing
        ? "not found in this directory"
        : `invalid: ${error instanceof Error ? error.message : String(error)}`,
      fix: isMissing
        ? "run `icculus init` to scaffold the harness here"
        : "fix the TOML syntax in icculus.toml",
    });
  }

  // 2. bin/agent exists and is executable.
  const agentPath = join(destDir, "bin/agent");
  const agentInfo = await statOrUndefined(agentPath);
  if (agentInfo === undefined) {
    checks.push({
      name: "bin/agent",
      ok: false,
      detail: "not found",
      fix: "run `icculus init` (or `icculus upgrade`) to restore bin/agent",
    });
  } else if (!isExecutable(agentInfo)) {
    checks.push({
      name: "bin/agent",
      ok: false,
      detail: "present but not executable",
      fix: `run: chmod +x ${agentPath}`,
    });
  } else {
    checks.push({
      name: "bin/agent",
      ok: true,
      detail: "present and executable",
    });
  }

  // 3. manifest present, matching this kit version, at the current schema.
  const manifestPath = join(destDir, ".icculus/manifest.json");
  const syncCmd = await selfCmd("sync");
  try {
    const manifest = parseManifest(await Deno.readTextFile(manifestPath));
    if (manifest.kit_version === KIT_VERSION) {
      checks.push({
        name: "manifest",
        ok: true,
        detail: `present, kit version ${manifest.kit_version}`,
      });
    } else {
      checks.push({
        name: "manifest",
        ok: false,
        detail:
          `kit version ${manifest.kit_version} ≠ installer ${KIT_VERSION}`,
        fix: `run \`${syncCmd}\` to refresh managed files to this version`,
      });
    }
    // Schema currency: an install behind this build's schema needs the
    // migration chain run (ADR 0014), which `upgrade` does automatically.
    if (manifest.schema_version === SCHEMA_VERSION) {
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
          `install schema v${manifest.schema_version}, this build expects v${SCHEMA_VERSION}`,
        fix: `run \`${syncCmd}\` to migrate the install`,
      });
    }
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    checks.push({
      name: "manifest",
      ok: false,
      detail: isMissing
        ? "not found"
        : `unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      fix:
        "run `icculus init` (or `icculus upgrade`) to write .icculus/manifest.json",
    });
  }

  return checks;
}

/**
 * Delegate to the harness's own `bin/agent doctor` when present and executable.
 * Returns undefined when there is nothing to delegate to. Failure to spawn is
 * itself reported as a (failing) check rather than crashing.
 */
async function delegateToAgent(destDir: string): Promise<Check | undefined> {
  const agentPath = join(destDir, "bin/agent");
  const info = await statOrUndefined(agentPath);
  if (info === undefined || !isExecutable(info)) {
    return undefined;
  }
  // The agent dispatcher routes `doctor` to .icculus/engine/doctor; if that
  // recipe is not present yet (early kit), treat a non-zero "unknown recipe" as
  // a soft skip rather than a hard failure.
  try {
    const command = new Deno.Command(agentPath, {
      args: ["doctor"],
      cwd: destDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const out = new TextDecoder().decode(stdout).trim();
    const err = new TextDecoder().decode(stderr).trim();
    if (code === 0) {
      return {
        name: "bin/agent doctor",
        ok: true,
        detail: out || "harness self-check passed",
      };
    }
    // Distinguish "no doctor recipe yet" from a real harness failure.
    if (/unknown recipe/.test(err)) {
      return {
        name: "bin/agent doctor",
        ok: true,
        detail: "harness has no doctor recipe yet (skipped)",
      };
    }
    return {
      name: "bin/agent doctor",
      ok: false,
      detail: err || out || `exited ${code}`,
      fix: "address the harness self-check failure above",
    };
  } catch (error) {
    return {
      name: "bin/agent doctor",
      ok: false,
      detail: `could not run bin/agent: ${
        error instanceof Error ? error.message : String(error)
      }`,
      fix: "ensure bin/agent is a runnable POSIX script",
    };
  }
}

/** Run `icculus doctor`. Returns a process exit code (0 = healthy). */
export async function runDoctor(options: DoctorOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  const checks = await runChecks(destDir);
  const delegated = await delegateToAgent(destDir);
  if (delegated) {
    checks.push(delegated);
  }

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
    if (check.ok) {
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
    log.ok("All checks passed.");
  } else {
    log.error("Some checks failed — see the fixes above.");
  }
  return healthy ? 0 : 1;
}
