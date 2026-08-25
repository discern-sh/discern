/**
 * The one place the worktree lifecycle reads and writes `DISCERN_*` lines in a
 * worktree's env files. The deterministic port and the per-worktree resource
 * handles are recorded here so a project's OWN tooling — its gate, its scripts,
 * running later in a separate process — can discover this worktree's identity at
 * runtime by reading its env file (the `discern identity --port|--resource`
 * query is the always-available second channel).
 *
 * WHICH files participate is the `[worktree].env_files` list (default
 * `[".env", ".env.local"]`), in precedence order: when READING, the last listed
 * file that defines a key wins (the dotenv override convention); when WRITING,
 * an existing definition is updated in place (in the last file that defines it),
 * and a new key lands in the FIRST listed file. Whether a missing first file is
 * CREATED is the caller's call (`create`): env inheritance creates it (a
 * declared secret must actually arrive in a fresh worktree), while the port and
 * resource recorders only ever update files that exist — a project with no env
 * file discovers identity via `discern identity` instead.
 */

import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  generatedArtifactMarker,
  isGeneratedArtifactMarker,
} from "../../shared/brand.ts";
import type { EnvReader } from "../../shared/env.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../../shared/file_ownership.ts";
import {
  resolveContainedProjectReadPath,
  resolveContainedProjectWritePath,
} from "../../shared/project_path.ts";
import { bestEffortFs, readTextIfExists } from "../../shared/fs_presence.ts";

/** The default `[worktree].env_files` when a caller has no config in hand. */
export const DEFAULT_ENV_FILES: readonly string[] = [".env", ".env.local"];

/**
 * Upsert `KEY=value` into `.env` text: replace the first existing `KEY=` line
 * (value only), else append. When the text ends with a newline (or is empty) the
 * new line slots before the trailing blank so the file keeps exactly one
 * terminating newline; otherwise it is pushed onto the unterminated last line.
 * Pure — the caller owns the I/O.
 */
export function upsertEnvLine(
  envText: string,
  key: string,
  value: string,
  env: EnvReader = Deno.env,
): string {
  const prefix = `${key}=`;
  const lines = envText === "" ? [] : envText.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && line.startsWith(prefix)) {
      replaced = true;
      return `${prefix}${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (envText.endsWith("\n")) {
      next.splice(
        next.length - 1,
        0,
        `${prefix}${value}`,
      );
    } else {
      next.push(`${prefix}${value}`);
    }
  }
  const marker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    env,
  );
  return [
    marker,
    ...next.filter((line) =>
      !isGeneratedArtifactMarker(
        line,
        ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
      )
    ),
  ].join("\n");
}

/**
 * Read one env-style file under `root`. Missing, stale, unreadable, or escaping
 * paths return undefined; a contained symbolic link remains readable.
 */
export async function readEnvFileAt(
  root: string,
  file: string,
): Promise<string | undefined> {
  const path = await resolveContainedProjectReadPath(root, file);
  if (path === undefined) {
    return undefined;
  }
  return await bestEffortFs(() => readTextIfExists(path), {
    onFailure: undefined,
    reason:
      "Env inheritance may skip one stale or unreadable optional source file.",
  });
}

/** Read the configured env files once, preserving their precedence order. */
export async function readEnvFilesAt(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  const readable: string[] = [];
  for (const file of files) {
    const text = await readEnvFileAt(root, file);
    if (text !== undefined) {
      readable.push(text);
    }
  }
  return readable;
}

/**
 * Strip one layer of matching surrounding quotes. A double-quoted value also
 * unescapes the `\"` the writer ({@link formatEnvValue}) escaped, so a value
 * containing a quote round-trips instead of comparing unequal on every read.
 */
export function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

/** Quote a value for an env file only when it contains whitespace, `#`, or a
 * quote — the write-side counterpart of {@link stripQuotes}. */
export function formatEnvValue(value: string): string {
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** Whether `text` defines `key` (a `KEY=` line). Pure. */
export function envTextDefines(text: string, key: string): boolean {
  return text.split("\n").some((line) => line.startsWith(`${key}=`));
}

/** The raw value (everything after the first `=`) of `key` in env text, or
 * undefined when the text does not define it. Pure; no quote stripping. */
export function readEnvLineValue(
  text: string,
  key: string,
): string | undefined {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1);
    }
  }
  return undefined;
}

/** The last definition of `key` in an already-read precedence list. */
export function readEnvValueFromFiles(
  files: readonly string[],
  key: string,
): string | undefined {
  let found: string | undefined;
  for (const text of files) {
    const value = readEnvLineValue(text, key);
    if (value !== undefined) {
      found = value;
    }
  }
  return found;
}

/**
 * The value of `key` across `files` under `root` — the LAST listed file that
 * defines it wins (the dotenv override convention). Undefined when no readable
 * file defines it. Raw value; the caller strips quotes if it cares.
 */
export async function readEnvValueAcross(
  root: string,
  files: readonly string[],
  key: string,
): Promise<string | undefined> {
  return readEnvValueFromFiles(await readEnvFilesAt(root, files), key);
}

/**
 * Upsert `KEY=value` into the worktree's env files: update the LAST listed file
 * that already defines the key, else append to the FIRST existing listed file —
 * or, with `opts.create`, create that first file. Returns true when written,
 * false when no listed file exists and creation was not asked for (the value
 * stays discoverable via `discern identity`). The caller decides what to log.
 */
export async function writeEnvVar(
  worktreeRoot: string,
  key: string,
  value: string,
  files: readonly string[] = DEFAULT_ENV_FILES,
  opts: { create?: boolean; env?: EnvReader } = {},
): Promise<boolean> {
  // Prefer updating where the key already lives (last definition wins on read,
  // so that is the definition to move).
  let target: string | undefined;
  for (const file of files) {
    const text = await readEnvFileAt(worktreeRoot, file);
    if (text !== undefined && envTextDefines(text, key)) {
      target = file;
    }
  }
  // Else the first existing file; else (create) the first listed file.
  if (target === undefined) {
    for (const file of files) {
      if (await readEnvFileAt(worktreeRoot, file) !== undefined) {
        target = file;
        break;
      }
    }
  }
  if (target === undefined) {
    if (!(opts.create ?? false) || files.length === 0) {
      return false;
    }
    target = files[0] as string;
  }
  const text = await readEnvFileAt(worktreeRoot, target) ?? "";
  let path = await resolveContainedProjectWritePath(
    worktreeRoot,
    target,
    "[worktree].env_files",
  );
  if (text === "" && (opts.create ?? false)) {
    await ensureDir(dirname(path));
    path = await resolveContainedProjectWritePath(
      worktreeRoot,
      target,
      "[worktree].env_files",
    );
  }
  await Deno.writeTextFile(
    path,
    upsertEnvLine(text, key, value, opts.env ?? Deno.env),
  );
  return true;
}
