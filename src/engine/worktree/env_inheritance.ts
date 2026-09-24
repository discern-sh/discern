/**
 * Copy declared environment values from the main checkout into a worktree,
 * so the worktree's app can boot with the same secrets. Env files are read
 * through the shared classifier, and every write goes through the worktree
 * env writer.
 */
import type { Logger } from "../../lib/log.ts";
import {
  type EnvFilesRead,
  type EnvFileUnreadable,
  envFileUnreadableMessage,
  formatEnvValue,
  readEnvFilesAt,
  readEnvValueFromFiles,
  stripQuotes,
} from "./env_file.ts";
import { mainRepoPath, WorktreeGitError, writeWorktreeEnvVar } from "./git.ts";

/** Options for {@link inheritMainEnvVars}. */
export interface InheritEnvOptions {
  /** The worktree root (the env files being patched live here). */
  worktreeRoot: string;
  /** The variable names to inherit (the `[worktree].inherit_env` array). */
  vars: string[];
  /** The env files to read from main and write in the worktree, in precedence
   * order (`[worktree].env_files`). */
  files: readonly string[];
  /** The logger for per-var narration. */
  log: Logger;
}

/** Refuse an env read that met an unreadable file, naming that file. */
function assertEnvReadable(
  read: EnvFilesRead,
): asserts read is Exclude<EnvFilesRead, EnvFileUnreadable> {
  if (read.state === "unreadable") {
    throw new WorktreeGitError(envFileUnreadableMessage(read));
  }
}

/**
 * Copy selected env vars from the main checkout's env files into the current
 * worktree's, so the worktree's app can boot with the same secrets. Reads every
 * `[worktree].env_files` entry on the main side (the last file defining a value
 * wins — the dotenv override convention) and writes through the shared
 * {@link writeWorktreeEnvVar} upsert, CREATING the worktree's first env file when none
 * exists — a fresh worktree never has one, and a declared value must actually
 * arrive. Per-var safe-copy policy: skip when main is blank; replace when the
 * worktree value is empty or equals the first configured env file's `.example`
 * default; otherwise leave a customised value alone. Idempotent. An empty
 * `vars` list, or a main checkout with no env file, is a warned no-op. A
 * missing main checkout, an unreadable env file on either side, or a refused
 * env write throws `WorktreeGitError`.
 */
export async function inheritMainEnvVars(
  opts: InheritEnvOptions,
): Promise<void> {
  const { log, files } = opts;
  if (opts.vars.length === 0) {
    return;
  }

  const mainRepo = await mainRepoPath();
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "discern could not find the main checkout while copying environment values. " +
        "Run `git worktree repair`, then re-run `discern worktree setup`.",
    );
  }
  const mainEnv = await readEnvFilesAt(mainRepo, files);
  assertEnvReadable(mainEnv);
  if (mainEnv.texts.length === 0) {
    log.warn(
      `Worktree environment inheritance: the main checkout has no env file (${
        files.join(", ")
      }) — skipping.`,
    );
    return;
  }
  const example = await readEnvFilesAt(
    mainRepo,
    files.slice(0, 1).map((file) => `${file}.example`),
  );
  assertEnvReadable(example);

  for (const varName of opts.vars) {
    if (varName === "") {
      continue;
    }
    const mainRaw = readEnvValueFromFiles(mainEnv.texts, varName);
    const mainValue = stripQuotes(mainRaw ?? "");
    if (mainValue === "") {
      log.warn(
        `Worktree environment inheritance: ${varName} is missing or blank in the main checkout's env files — skipping.`,
      );
      continue;
    }
    const worktreeEnv = await readEnvFilesAt(opts.worktreeRoot, files);
    assertEnvReadable(worktreeEnv);
    const worktreeValue = stripQuotes(
      readEnvValueFromFiles(worktreeEnv.texts, varName) ?? "",
    );
    const exampleValue = stripQuotes(
      readEnvValueFromFiles(example.texts, varName) ?? "",
    );

    if (worktreeValue === mainValue) {
      continue; // already inherited
    }
    if (worktreeValue !== "" && worktreeValue !== exampleValue) {
      log.info(
        `Worktree environment inheritance: ${varName} has a worktree-specific value — leaving it alone.`,
      );
      continue;
    }

    await writeWorktreeEnvVar(
      opts.worktreeRoot,
      varName,
      formatEnvValue(mainValue),
      files,
      { create: true },
    );
    log.ok(`Inherited ${varName} from the main checkout.`);
  }
}
