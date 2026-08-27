/**
 * Project Script discovery and execution.
 *
 * Both the CLI namespace and the desk use this root-aware core. Keeping the
 * project root explicit is what lets the desk inspect and run scripts from a
 * selected worktree instead of accidentally consulting the main checkout.
 */

import { join } from "@std/path";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { commandEvidence } from "../shared/command_evidence.ts";
import { emitResult } from "../shared/emit.ts";
import {
  CONFIG_REL,
  findRoot,
  installedConfigRel,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
  scriptEnvVars,
} from "../shared/env.ts";
import { Logger } from "../lib/log.ts";
import { reportFailure } from "../lib/narration.ts";
import { resolveScriptsDir } from "../lib/paths.ts";
import { renderAlignedRows } from "../lib/text.ts";
import { terminalLine } from "../lib/terminal.ts";
import { runOwnedChild } from "./owned_child.ts";
import { integrationBranch } from "./worktree/git.ts";
import { reportUnknownCommand } from "./unknown_command.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { ScriptsData } from "../shared/result_schemas.ts";
import {
  pathExists,
  readDirIfExists,
  readTextIfExists,
  statIfExists,
} from "../shared/fs_presence.ts";

/** One executable Project Script surfaced by discovery. */
export type ProjectScript = ScriptsData["scripts"][number];

/**
 * One Project Script as the Desk must present it before execution.
 *
 * Discovery retains regular files that are not executable so the action can
 * explain the exact recovery instead of making a configured capability vanish.
 * Execution still uses {@link runProjectScriptAt}, which revalidates the same
 * executable predicate immediately before it spawns the file.
 */
export interface DeskProjectScript extends ProjectScript {
  readonly path?: string;
  readonly workingDirectory?: string;
  readonly availability?: "enabled" | "disabled";
  readonly reason?: string;
  readonly confirmation?: "required";
  readonly destructive?: "undeclared";
}

/** Complete Desk discovery, including why no script can currently run. */
export interface DeskProjectScriptInventory {
  readonly directory: string;
  readonly scripts: readonly DeskProjectScript[];
  readonly unavailableReason?: string;
}

/** Read a Project Script's first `# desc:` line, or undefined when absent. */
async function firstDescLine(file: string): Promise<string | undefined> {
  const text = await readTextIfExists(file);
  if (text === undefined) return undefined;
  for (const line of text.split("\n")) {
    const match = line.match(/^# desc:\s?(.*)$/);
    if (match !== null) {
      return match[1];
    }
  }
  return undefined;
}

/** Whether a path is an executable regular file. */
async function isExecutable(path: string): Promise<boolean> {
  const stat = await statIfExists(path);
  return stat !== undefined && stat.isFile && ((stat.mode ?? 0) & 0o111) !== 0;
}

/** Discover every executable file in one configured directory. */
export async function discoverProjectScripts(
  scriptsAbs: string,
): Promise<ProjectScript[]> {
  const scripts: ProjectScript[] = [];
  const entries = await readDirIfExists(scriptsAbs);
  if (entries === undefined) return [];
  for (const entry of entries) {
    if (!entry.isFile) {
      continue;
    }
    const file = join(scriptsAbs, entry.name);
    if (!(await isExecutable(file))) {
      continue;
    }
    const description = await firstDescLine(file);
    scripts.push({
      name: entry.name,
      ...(description === undefined ? {} : { description }),
    });
  }
  return scripts.sort((a, b) => a.name.localeCompare(b.name));
}

/** Discover the Project Scripts of the checkout at `root` under an
 * already-loaded config — for callers that hold the config in hand and must
 * not pay for (or re-answer) a second read of it. */
export async function listProjectScriptsWithConfig(
  root: string,
  config: DiscernConfig,
): Promise<ProjectScript[]> {
  return await discoverProjectScripts(resolveScriptsDir(root, config).abs);
}

/**
 * Inspect every regular file in the configured Project Scripts directory.
 *
 * This is deliberately additive to the CLI's executable-only listing: existing
 * `scripts --json` consumers retain their wire contract while the interactive
 * Desk can keep unavailable project-authored commands visible and actionable.
 */
export async function inspectDeskProjectScriptsWithConfig(
  root: string,
  config: DiscernConfig,
): Promise<DeskProjectScriptInventory> {
  const directory = resolveScriptsDir(root, config);
  const entries = await readDirIfExists(directory.abs);
  if (entries === undefined) {
    return {
      directory: directory.abs,
      scripts: [],
      unavailableReason:
        `Project Scripts directory ${directory.abs} does not exist. Create it and add an executable script.`,
    };
  }
  const scripts: DeskProjectScript[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue;
    const path = join(directory.abs, entry.name);
    const executable = await isExecutable(path);
    const description = await firstDescLine(path);
    scripts.push({
      name: entry.name,
      ...(description === undefined ? {} : { description }),
      path,
      workingDirectory: root,
      availability: executable ? "enabled" : "disabled",
      ...(executable ? {} : {
        reason: `Project Script ${path} is not executable. Run: ${
          commandEvidence(["chmod", "+x", path])
        }`,
      }),
      confirmation: "required",
      destructive: "undeclared",
    });
  }
  scripts.sort((left, right) => left.name.localeCompare(right.name));
  const enabled = scripts.filter((script) => script.availability === "enabled");
  return {
    directory: directory.abs,
    scripts,
    ...(enabled.length > 0 ? {} : {
      unavailableReason: scripts.length === 0
        ? `No Project Script files exist in ${directory.abs}. Add an executable script.`
        : scripts[0]?.reason ??
          `No executable Project Scripts exist in ${directory.abs}.`,
    }),
  };
}

/** Discover the Project Scripts configured by the checkout rooted at `root`. */
export async function listProjectScripts(
  root: string,
): Promise<ProjectScript[]> {
  return await listProjectScriptsWithConfig(root, await loadConfig(root));
}

/** Build the bare `scripts --json` listing from one resolved checkout. */
export async function projectScriptsResult(
  root: string,
): Promise<DiscernResult<ScriptsData>> {
  const config = await loadConfig(root);
  const directory = resolveScriptsDir(root, config);
  return {
    ok: true,
    verb: "scripts",
    data: {
      scripts: await discoverProjectScripts(directory.abs),
      directory: directory.rel,
    },
  };
}

export interface RunProjectScriptOptions {
  readonly json?: boolean;
  /** Child working directory. The CLI inherits its caller; the desk passes the
   * selected worktree root explicitly. */
  readonly cwd?: string;
  /** Additional environment values for the child process. */
  readonly env?: Record<string, string>;
  /** Return to an owning interactive surface after an interrupt. */
  readonly resumeAfterInterrupt?: boolean;
}

/** List or run a Project Script against an explicit checkout root. */
export async function runProjectScriptAt(
  root: string,
  name: string | undefined,
  args: string[],
  opts: RunProjectScriptOptions = {},
): Promise<number> {
  const config: DiscernConfig = await loadConfig(root);
  const directory = resolveScriptsDir(root, config);

  if (name === undefined) {
    const entries = await discoverProjectScripts(directory.abs);
    if (opts.json ?? false) {
      emitResult({
        ok: true,
        verb: "scripts",
        data: {
          scripts: entries,
          directory: directory.rel,
        } satisfies ScriptsData,
      });
      return 0;
    }
    const log = new Logger({ json: false, noColor: false });
    log.line(`Project scripts (from ${terminalLine(directory.rel)}):`);
    if (entries.length === 0) {
      log.line("  No executable scripts found.");
      return 0;
    }
    for (
      const row of renderAlignedRows(entries.map((entry) => ({
        label: terminalLine(entry.name),
        body: entry.description === undefined
          ? ""
          : terminalLine(entry.description),
      })))
    ) log.line(row);
    return 0;
  }

  const scriptFile = join(directory.abs, name.replace(/:/g, "-"));
  if (await isExecutable(scriptFile)) {
    const mainBranch = integrationBranch(config.repository.trunk);
    const tomlPath = join(
      root,
      (await installedConfigRel(root)) ?? CONFIG_REL,
    );
    const child = await runOwnedChild(scriptFile, {
      args,
      env: {
        ...scriptEnvVars({
          root,
          tomlPath,
          scriptsDir: directory.rel,
          scriptsAbs: directory.abs,
          mainBranch,
        }),
        ...opts.env,
      },
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      resumeAfterInterrupt: opts.resumeAfterInterrupt ?? false,
    });
    return child.status.code;
  }

  if (await pathExists(scriptFile)) {
    reportFailure(
      new Logger({ json: false, noColor: false }),
      `script "${name}" exists but is not executable: ${scriptFile}`,
      [`Run: chmod +x "${scriptFile}"`],
    );
    return 1;
  }

  reportUnknownCommand(`scripts ${name}`, undefined, "scripts", opts);
  return 1;
}

/** CLI wrapper: resolve the caller's project, then use the shared core. */
export async function runProjectScript(
  name: string | undefined,
  args: string[],
  opts: RunProjectScriptOptions = {},
): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    if (opts.json ?? false) {
      emitResult(notInitializedResult("scripts"));
    } else {
      new Logger({ json: false, noColor: false }).error(NO_PROJECT_MESSAGE);
    }
    return 1;
  }
  return await runProjectScriptAt(root, name, args, opts);
}
