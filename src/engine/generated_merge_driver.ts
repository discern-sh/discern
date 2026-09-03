/** Clone-local generated-merge driver reconciliation. */

import { join } from "@std/path";
import { readDirIfExists } from "../shared/fs_presence.ts";
import { runGit } from "../shared/subprocess.ts";
import { splitNulRecords } from "../shared/git_paths.ts";
import { DISCERN_GENERATED_MERGE_DRIVER } from "../lib/agent_gitattributes.ts";
import { resolveCommonGitDir } from "./worktree/git.ts";

export const GENERATED_MERGE_DRIVER_KEY =
  `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`;
export const WORKTREE_CONFIG_EXTENSION_KEY = "extensions.worktreeConfig";
export const GENERATED_MERGE_DRIVER_VALUE = "true";

export type GeneratedMergeDriverOperation =
  | {
    readonly kind: "set-common-driver";
    readonly cwd: string;
    readonly configFile: string;
  }
  | {
    readonly kind: "unset-worktree-driver";
    readonly cwd: string;
    readonly configFile: string;
  }
  | {
    readonly kind: "unset-worktree-extension";
    readonly cwd: string;
    readonly configFile: string;
  }
  | {
    readonly kind: "unset-common-driver";
    readonly cwd: string;
    readonly configFile: string;
  };

export interface GeneratedMergeDriverPlan {
  readonly operations: readonly GeneratedMergeDriverOperation[];
  readonly errors: readonly string[];
  readonly worktreeConfigExtension: "absent" | "remove" | "keep" | "unknown";
}

/** Read every value for one config key at one Git scope. */
async function configValues(
  cwd: string,
  configFile: string,
  key: string,
): Promise<{ readonly values: string[]; readonly error?: string }> {
  const result = await runGit(
    ["config", "--file", configFile, "--get-all", key],
    { cwd },
  );
  if (result.success) {
    return { values: result.stdout.split(/\r?\n/u).filter(Boolean) };
  }
  if (result.code === 1) return { values: [] };
  return {
    values: [],
    error: result.stderr.trim() || result.stdout.trim() ||
      `git config exited ${result.code}`,
  };
}

/** Read every key defined in the current checkout's worktree config. */
async function worktreeConfigKeys(
  cwd: string,
  configFile: string,
): Promise<{ readonly keys: string[]; readonly error?: string }> {
  const result = await runGit(
    [
      "config",
      "--file",
      configFile,
      "-z",
      "--name-only",
      "--get-regexp",
      ".",
    ],
    { cwd },
  );
  if (result.success) {
    return { keys: splitNulRecords(result.stdout) };
  }
  if (result.code === 1) return { keys: [] };
  return {
    keys: [],
    error: result.stderr.trim() || result.stdout.trim() ||
      `git config exited ${result.code}`,
  };
}

/** Existing checkout-local config files, including stale linked-worktree state. */
async function worktreeConfigFiles(commonDir: string): Promise<string[]> {
  const files: string[] = [];
  const main = join(commonDir, "config.worktree");
  try {
    if ((await Deno.stat(main)).isFile) files.push(main);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const worktreesDir = join(commonDir, "worktrees");
  for (const entry of await readDirIfExists(worktreesDir) ?? []) {
    if (!entry.isDirectory) continue;
    const candidate = join(worktreesDir, entry.name, "config.worktree");
    try {
      if ((await Deno.stat(candidate)).isFile) files.push(candidate);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return files.sort();
}

/**
 * Plan one common driver definition and removal of private-era per-worktree
 * copies. `required=false` is the inverse used by uninstall.
 */
export async function planGeneratedMergeDriver(
  root: string,
  required: boolean,
): Promise<GeneratedMergeDriverPlan> {
  const operations: GeneratedMergeDriverOperation[] = [];
  const errors: string[] = [];
  const commonDir = await resolveCommonGitDir(root);
  if (commonDir === undefined) {
    return { operations, errors, worktreeConfigExtension: "absent" };
  }
  const commonConfig = join(commonDir, "config");
  const common = await configValues(
    root,
    commonConfig,
    GENERATED_MERGE_DRIVER_KEY,
  );
  if (common.error !== undefined) {
    errors.push(
      `could not read ${GENERATED_MERGE_DRIVER_KEY}: ${common.error}`,
    );
  } else if (required) {
    if (
      common.values.length !== 1 ||
      common.values[0] !== GENERATED_MERGE_DRIVER_VALUE
    ) {
      operations.push({
        kind: "set-common-driver",
        cwd: root,
        configFile: commonConfig,
      });
    }
  } else if (common.values.length > 0) {
    operations.push({
      kind: "unset-common-driver",
      cwd: root,
      configFile: commonConfig,
    });
  }

  const extension = await configValues(
    root,
    commonConfig,
    WORKTREE_CONFIG_EXTENSION_KEY,
  );
  if (extension.error !== undefined) {
    errors.push(
      `could not read ${WORKTREE_CONFIG_EXTENSION_KEY}: ${extension.error}`,
    );
    return { operations, errors, worktreeConfigExtension: "unknown" };
  }
  if (!extension.values.includes("true")) {
    return { operations, errors, worktreeConfigExtension: "absent" };
  }

  let survivingWorktreeKey = false;
  for (const configFile of await worktreeConfigFiles(commonDir)) {
    const values = await configValues(
      root,
      configFile,
      GENERATED_MERGE_DRIVER_KEY,
    );
    if (values.error !== undefined) {
      errors.push(
        `could not inspect ${GENERATED_MERGE_DRIVER_KEY} in ${configFile}: ${values.error}`,
      );
      survivingWorktreeKey = true;
      continue;
    }
    if (values.values.length > 0) {
      operations.push({
        kind: "unset-worktree-driver",
        cwd: root,
        configFile,
      });
    }
    const keys = await worktreeConfigKeys(root, configFile);
    if (keys.error !== undefined) {
      errors.push(
        `could not inspect worktree config in ${configFile}: ${keys.error}`,
      );
      survivingWorktreeKey = true;
      continue;
    }
    if (
      keys.keys.some((key) =>
        key.toLowerCase() !== GENERATED_MERGE_DRIVER_KEY.toLowerCase()
      )
    ) {
      survivingWorktreeKey = true;
    }
  }
  if (!survivingWorktreeKey) {
    operations.push({
      kind: "unset-worktree-extension",
      cwd: root,
      configFile: commonConfig,
    });
  }
  return {
    operations,
    errors,
    worktreeConfigExtension: survivingWorktreeKey ? "keep" : "remove",
  };
}

/** Apply one precomputed local Git-config operation. */
export async function applyGeneratedMergeDriverOperation(
  operation: GeneratedMergeDriverOperation,
): Promise<string | undefined> {
  const args = operation.kind === "set-common-driver"
    ? [
      "config",
      "--file",
      operation.configFile,
      "--replace-all",
      GENERATED_MERGE_DRIVER_KEY,
      GENERATED_MERGE_DRIVER_VALUE,
    ]
    : operation.kind === "unset-common-driver"
    ? [
      "config",
      "--file",
      operation.configFile,
      "--unset-all",
      GENERATED_MERGE_DRIVER_KEY,
    ]
    : operation.kind === "unset-worktree-driver"
    ? [
      "config",
      "--file",
      operation.configFile,
      "--unset-all",
      GENERATED_MERGE_DRIVER_KEY,
    ]
    : [
      "config",
      "--file",
      operation.configFile,
      "--unset-all",
      WORKTREE_CONFIG_EXTENSION_KEY,
    ];
  const result = await runGit(args, { cwd: operation.cwd });
  return result.success ||
      (operation.kind !== "set-common-driver" && result.code === 1)
    ? undefined
    : result.stderr.trim() || result.stdout.trim() ||
      `git config exited ${result.code}`;
}
