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
 *
 * A read has three outcomes: absent, the file's text, or unreadable. A file
 * that exists but cannot be read makes every value the set supplies unknown,
 * since it could hold the winning definition of any key; each caller decides
 * whether that refuses or degrades, and none reads it as absence.
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  isManagedValuesMarker,
  managedValuesMarker,
} from "../../shared/brand.ts";
import type { EnvReader } from "../../shared/env.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../../shared/file_ownership.ts";
import {
  resolveContainedProjectReadPath,
  resolveContainedProjectWritePath,
} from "../../shared/project_path.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";

/** The default `[worktree].env_files` when a caller has no config in hand. */
export const DEFAULT_ENV_FILES: readonly string[] = [".env", ".env.local"];

/** The scoped subject of discern's one marker in a shared env file. */
export const WORKTREE_ENVIRONMENT_MARKER_SUBJECT = "Worktree values";

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
  const marker = managedValuesMarker(
    WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
    ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    env,
  );
  return [
    marker,
    ...next.filter((line) =>
      !isManagedValuesMarker(
        line,
        WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
        ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
      )
    ),
  ].join("\n");
}

/** A configured env file that exists but cannot be read. */
export interface EnvFileUnreadable {
  readonly state: "unreadable";
  /** The configured entry, relative to the checkout root. */
  readonly file: string;
  /** The entry's absolute location under the checkout root. */
  readonly path: string;
  /** The operating system's account of the failed read. */
  readonly reason: string;
}

/** One env-file read: absent, the file's text, or unreadable. */
export type EnvFileRead =
  | { readonly state: "absent" }
  | { readonly state: "text"; readonly text: string }
  | EnvFileUnreadable;

/** The configured env files' texts in precedence order, or the first file
 * that exists but cannot be read. */
export type EnvFilesRead =
  | { readonly state: "read"; readonly texts: readonly string[] }
  | EnvFileUnreadable;

/**
 * Read one env-style file under `root`. A missing file, a missing or stale
 * checkout, and a path that leaves the project are absent; a contained
 * symbolic link remains readable. Every other failure is unreadable, with the
 * operating system's reason.
 */
export async function readEnvFileAt(
  root: string,
  file: string,
): Promise<EnvFileRead> {
  try {
    const path = await resolveContainedProjectReadPath(root, file);
    const text = path === undefined ? undefined : await readTextIfExists(path);
    return text === undefined ? { state: "absent" } : { state: "text", text };
  } catch (error) {
    return {
      state: "unreadable",
      file,
      path: join(root, file),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read the configured env files once, preserving their precedence order. One
 * unreadable file makes the set unreadable. */
export async function readEnvFilesAt(
  root: string,
  files: readonly string[],
): Promise<EnvFilesRead> {
  const texts: string[] = [];
  for (const file of files) {
    const read = await readEnvFileAt(root, file);
    if (read.state === "unreadable") {
      return read;
    }
    if (read.state === "text") {
      texts.push(read.text);
    }
  }
  return { state: "read", texts };
}

/** The refusal for a configured env file discern cannot read. */
export function envFileUnreadableMessage(read: EnvFileUnreadable): string {
  return `discern could not read the env file ${read.path}: ${read.reason}. ` +
    "Make that path a readable file, then run the command again.";
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
 * Upsert `KEY=value` into the worktree's env files: update the LAST listed file
 * that already defines the key, else append to the FIRST existing listed file —
 * or, with `opts.create`, create that first file. Returns true when written,
 * false when no listed file exists and creation was not asked for (the value
 * stays discoverable via `discern identity`). The caller decides what to log.
 * An unreadable listed file refuses: it could hold the definition to update.
 */
export async function writeEnvVar(
  worktreeRoot: string,
  key: string,
  value: string,
  files: readonly string[] = DEFAULT_ENV_FILES,
  opts: { create?: boolean; env?: EnvReader } = {},
  env: EnvReader = opts.env ?? Deno.env,
): Promise<boolean> {
  const texts = new Map<string, string>();
  for (const file of files) {
    const read = await readEnvFileAt(worktreeRoot, file);
    if (read.state === "unreadable") {
      throw new Error(envFileUnreadableMessage(read));
    }
    if (read.state === "text") {
      texts.set(file, read.text);
    }
  }
  // Prefer updating where the key already lives (last definition wins on read,
  // so that is the definition to move).
  let target = files.findLast((file) =>
    envTextDefines(texts.get(file) ?? "", key)
  );
  let creating = false;
  // Else the first existing file; else (create) the first listed file.
  target ??= files.find((file) => texts.has(file));
  if (target === undefined) {
    const first = files[0];
    if (!(opts.create ?? false) || first === undefined) {
      return false;
    }
    target = first;
    creating = true;
  }
  const text = texts.get(target) ?? "";
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
  const next = upsertEnvLine(text, key, value, env);
  if (creating) {
    await Deno.writeTextFile(path, next, { createNew: true, mode: 0o600 });
  } else {
    await Deno.writeTextFile(path, next);
  }
  return true;
}
