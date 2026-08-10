/**
 * Project Script discovery and execution.
 *
 * Both the CLI namespace and the desk use this root-aware core. Keeping the
 * project root explicit is what lets the desk inspect and run scripts from a
 * selected worktree instead of accidentally consulting the main checkout.
 */

import { join } from "@std/path";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../shared/environment_variables.ts";
import { emitResult } from "../shared/emit.ts";
import {
  CONFIG_REL,
  findRoot,
  installedConfigRel,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
  scriptEnvVars,
} from "../shared/env.ts";
import { resolveScriptsDir } from "../lib/paths.ts";
import { runOwnedChild } from "./owned_child.ts";
import { reportUnknownCommand } from "./unknown_command.ts";
import {
  type DiscernResult,
  renderHumanOutputGroups,
} from "../shared/result.ts";
import type { ScriptsData } from "../shared/result_schemas.ts";

/** One executable Project Script surfaced by discovery. */
export type ProjectScript = ScriptsData["scripts"][number];

/** Read a Project Script's first `# desc:` line, or undefined when absent. */
async function firstDescLine(file: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(file);
  } catch {
    return undefined;
  }
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
  try {
    const stat = await Deno.stat(path);
    return stat.isFile && ((stat.mode ?? 0) & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** True when a path exists (any type). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Discover every executable file in one configured directory. */
export async function discoverProjectScripts(
  scriptsAbs: string,
): Promise<ProjectScript[]> {
  const scripts: ProjectScript[] = [];
  try {
    for await (const entry of Deno.readDir(scriptsAbs)) {
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
  } catch {
    return [];
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
    console.log(`Project scripts (from ${directory.rel}):`);
    if (entries.length === 0) {
      console.log("  No executable scripts found.");
      return 0;
    }
    for (const entry of entries) {
      const suffix = entry.description === undefined
        ? ""
        : ` ${entry.description}`;
      console.log(`  ${entry.name.padEnd(20)}${suffix}`);
    }
    return 0;
  }

  const scriptFile = join(directory.abs, name.replace(/:/g, "-"));
  if (await isExecutable(scriptFile)) {
    const mainBranch = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk) ||
      config.repository.trunk;
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
    console.error(renderHumanOutputGroups([
      {
        id: "failure",
        items: [
          `discern: script "${name}" exists but is not executable: ${scriptFile}`,
        ],
      },
      {
        id: "recovery",
        items: [`       Run: chmod +x "${scriptFile}"`],
      },
    ]));
    return 1;
  }

  reportUnknownCommand(`scripts ${name}`, undefined, opts);
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
      console.error(`discern: ${NO_PROJECT_MESSAGE}`);
    }
    return 1;
  }
  return await runProjectScriptAt(root, name, args, opts);
}
